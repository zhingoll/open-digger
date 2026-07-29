import assert from 'assert';
import http from 'http';
import { AddressInfo } from 'net';
import { ApiKeyRateLimiter, DataGatewayHttpSecurity, HashedApiKeyVerifier } from '../src/dataGateway/auth';
import { DataGateway } from '../src/dataGateway/gateway';
import { GitHubAdapter } from '../src/dataGateway/githubAdapter';
import { HuggingFaceAdapter, QueryExecutor, QueryParams } from '../src/dataGateway/huggingFaceAdapter';
import { createDataGatewayHttpServer } from '../src/dataGateway/http';

type Behavior = 'ok' | 'fail' | 'secret-fail' | 'slow';
const API_KEY = 'test-api-key-00000000000000000001';

function security(): DataGatewayHttpSecurity {
  return {
    verifier: new HashedApiKeyVerifier([API_KEY]),
    rateLimiter: new ApiKeyRateLimiter(1000, 60000),
    auditLogger: { write: () => undefined },
    requestId: () => 'test-request-id',
    now: Date.now,
  };
}

function github(behavior: Behavior = 'ok'): GitHubAdapter {
  return new GitHubAdapter(executor(behavior, async <T>(sql: string, params: QueryParams = {}) => {
    if (sql.includes('positionCaseInsensitiveUTF8')) return [{ id: 42, name: `例子/${params.query}` }] as T[];
    if (sql.includes('name_info')) {
      if (String(params.entityId).startsWith('missing/')) return [] as T[];
      return [{ id: 42, name: params.entityId }] as T[];
    }
    if (sql.includes('repo_info')) return [{ description: 'metrics', default_branch: 'master', homepage_url: '', is_fork: 0,
      primary_language: 'TypeScript', license: 'Apache-2.0', topics: [], created_at: '2020-01-01 00:00:00',
      source_updated_at: '2026-07-01 00:00:00' }] as T[];
    if (sql.includes('global_openrank')) return [{ observed_at: '2026-07-01 00:00:00', value: 12 }] as T[];
    return [] as T[];
  }));
}

function huggingface(behavior: Behavior = 'ok'): HuggingFaceAdapter {
  return new HuggingFaceAdapter(executor(behavior, async <T>(sql: string, params: QueryParams = {}) => {
    if (sql.includes('positionCaseInsensitiveUTF8')) {
      if (sql.includes('dataset_repos')) return [] as T[];
      return [{ id: `例子/${params.query}`, updated_at: '2026-07-01 00:00:00' }] as T[];
    }
    if (sql.includes('AS author')) return [{ id: params.entityId, author: '例子', created_at: '2026-01-01 00:00:00',
      updated_at: '2026-07-01 00:00:00', pipeline_tag: '', library_name: '', tags: [], gated: 0, disabled: 0 }] as T[];
    if (sql.includes('AS downloads_all_time')) return [{ internal_id: 'hf-id', downloads: 1, likes: 1,
      downloads_all_time: 1, updated_at: '2026-07-01 00:00:00' }] as T[];
    if (sql.includes('dllk_history')) return [] as T[];
    return [] as T[];
  }));
}

function executor(behavior: Behavior, handle: QueryExecutor): QueryExecutor {
  return async <T>(sql: string, params: QueryParams = {}) => {
    if (behavior === 'slow') await new Promise(resolve => setTimeout(resolve, 60));
    if (behavior === 'fail') throw new Error('offline');
    if (behavior === 'secret-fail') throw new Error('SELECT password FROM db at 10.0.0.8');
    return handle<T>(sql, params);
  };
}

async function request(port: number, path: string, method = 'GET', apiKey = API_KEY): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined;
    const req = http.request({ host: '127.0.0.1', port, path, method, headers }, response => {
      const chunks: Buffer[] = [];
      response.on('data', chunk => chunks.push(Buffer.from(chunk)));
      response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject); req.end();
  });
}

describe('DataGateway aggregation controls', () => {
  it('applies one global limit with deterministic source ordering', async () => {
    const gateway = new DataGateway([huggingface(), github()]);
    const result = await gateway.search('模型', { limit: 1 });
    assert.strictEqual(result.data.length, 1);
    assert.strictEqual(result.data[0].source, 'huggingface');
  });

  it('times out one source and returns the other as partial success', async () => {
    const gateway = new DataGateway([github('slow'), huggingface()],
      () => new Date('2026-07-27T00:00:00Z'), 10);
    const result = await gateway.search('qwen');
    assert.strictEqual(result.meta.partial, true);
    assert.deepStrictEqual(result.meta.warnings, ['github: unavailable']);
    assert.deepStrictEqual(result.data.map(item => item.source), ['huggingface']);
  });
});

describe('Data Gateway HTTP E2E', () => {
  let server: http.Server;
  let port: number;
  beforeEach(async () => {
    server = createDataGatewayHttpServer(new DataGateway([github(), huggingface()]), security());
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterEach(async () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));

  it('serves sources, Unicode search, profiles, and metrics through the Gateway', async () => {
    assert.strictEqual((await request(port, '/v1/sources')).status, 200);
    const search = await request(port, `/v1/search?q=${encodeURIComponent('模型')}&sources=github,huggingface&limit=2`);
    assert.strictEqual(search.status, 200);
    assert.strictEqual(JSON.parse(search.body).data.length, 2);
    assert.strictEqual((await request(port, `/v1/huggingface/models/${encodeURIComponent('组织')}/${encodeURIComponent('模型')}`)).status, 200);
    assert.strictEqual((await request(port, '/v1/github/repositories/X-lab2017/open-digger/metrics')).status, 200);
  });

  it('returns 400, 404, and 405 for invalid requests', async () => {
    assert.strictEqual((await request(port, '/v1/search?q=&limit=0')).status, 400);
    assert.strictEqual((await request(port, '/v1/unknown')).status, 404);
    const method = await request(port, '/v1/search?q=x', 'POST');
    assert.strictEqual(method.status, 405);
    assert.strictEqual(method.headers.allow, 'GET');
    assert.strictEqual((await request(port, `/v1/search?q=${'x'.repeat(3000)}`)).status, 400);
  });

  it('returns 404 for unknown entities', async () => {
    assert.strictEqual((await request(port, '/v1/github/repositories/missing/repo')).status, 404);
  });

  it('returns 503 when every source fails without leaking internals', async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    server = createDataGatewayHttpServer(new DataGateway([
      github('secret-fail'), huggingface('secret-fail'),
    ]), security());
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
    const response = await request(port, '/v1/search?q=x');
    assert.strictEqual(response.status, 503);
    assert(!response.body.includes('SELECT'));
    assert(!response.body.includes('10.0.0.8'));
    assert(!response.body.includes('hunter2'));
  });

  it('returns partial 200 when only one source fails', async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    server = createDataGatewayHttpServer(new DataGateway([
      github('fail'), huggingface(),
    ]), security());
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
    const response = await request(port, '/v1/search?q=qwen');
    assert.strictEqual(response.status, 200);
    assert.strictEqual(JSON.parse(response.body).meta.partial, true);
  });

  it('returns a sanitized 500 for an unexpected entity failure', async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    server = createDataGatewayHttpServer(new DataGateway([github('secret-fail')]), security());
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
    const response = await request(port, '/v1/github/repositories/org/repo');
    assert.strictEqual(response.status, 500);
    assert.strictEqual(JSON.parse(response.body).error.code, 'internal_error');
    assert(!response.body.includes('SELECT'));
    assert(!response.body.includes('10.0.0.8'));
    assert(!response.body.includes('pass'));
  });
});
