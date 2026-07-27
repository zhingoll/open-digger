import assert from 'assert';
import http from 'http';
import { AddressInfo } from 'net';
import { DataAdapter } from '../src/dataGateway/adapter';
import { DataGateway } from '../src/dataGateway/gateway';
import { createDataGatewayHttpServer } from '../src/dataGateway/http';
import { AdapterResult, EntityData, EntityLocator, MetricValue, SearchOptions, SearchResult } from '../src/dataGateway/types';

class HttpTestAdapter implements DataAdapter {
  readonly provider: 'opendigger' | 'opengauge';
  readonly entityTypes: readonly ('repository' | 'model')[];
  constructor(
    readonly source: 'github' | 'huggingface',
    private readonly behavior: 'ok' | 'fail' | 'secret-fail' | 'slow' = 'ok',
    private readonly delayMs = 0,
  ) {
    this.provider = source === 'github' ? 'opendigger' : 'opengauge';
    this.entityTypes = source === 'github' ? ['repository'] : ['model'];
  }
  async search(query: string, _options: SearchOptions): Promise<AdapterResult<SearchResult[]>> {
    if (this.delayMs) await new Promise(resolve => setTimeout(resolve, this.delayMs));
    if (this.behavior === 'fail') throw new Error('offline');
    if (this.behavior === 'secret-fail') throw new Error('SELECT secret FROM db at 10.0.0.8 password=hunter2');
    return this.wrap([{ source: this.source, entity_type: this.source === 'github' ? 'repository' : 'model',
      entity_id: `例子/${query}`, name: query, source_url: `https://example.test/${encodeURIComponent(query)}` }]);
  }
  async getEntity(locator: EntityLocator): Promise<AdapterResult<EntityData> | null> {
    if (this.behavior === 'secret-fail') throw new Error('clickhouse://user:pass@10.0.0.8 SELECT');
    if (locator.namespace === 'missing') return null;
    return this.wrap({ source: this.source, entity_type: locator.entity_type,
      entity_id: `${locator.namespace}/${locator.name}`, name: locator.name,
      source_url: 'https://example.test/entity', attributes: {}, metrics: {} });
  }
  async getMetrics(_locator: EntityLocator): Promise<AdapterResult<Record<string, MetricValue>> | null> {
    return this.wrap({});
  }
  private wrap<T>(data: T): AdapterResult<T> {
    return { data, as_of: '2026-07-27T00:00:00.000Z', provider: this.provider, data_quality: [], warnings: [] };
  }
}

async function request(port: number, path: string, method = 'GET'): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method }, response => {
      const chunks: Buffer[] = [];
      response.on('data', chunk => chunks.push(Buffer.from(chunk)));
      response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject); req.end();
  });
}

describe('DataGateway aggregation controls', () => {
  it('applies one global limit with deterministic source ordering', async () => {
    const gateway = new DataGateway([new HttpTestAdapter('huggingface'), new HttpTestAdapter('github')]);
    const result = await gateway.search('模型', { limit: 1 });
    assert.strictEqual(result.data.length, 1);
    assert.strictEqual(result.data[0].source, 'huggingface');
  });

  it('times out one source and returns the other as partial success', async () => {
    const gateway = new DataGateway([new HttpTestAdapter('github', 'slow', 60), new HttpTestAdapter('huggingface')],
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
    server = createDataGatewayHttpServer(new DataGateway([new HttpTestAdapter('github'), new HttpTestAdapter('huggingface')]));
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
      new HttpTestAdapter('github', 'secret-fail'), new HttpTestAdapter('huggingface', 'secret-fail'),
    ]));
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
      new HttpTestAdapter('github', 'fail'), new HttpTestAdapter('huggingface'),
    ]));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
    const response = await request(port, '/v1/search?q=qwen');
    assert.strictEqual(response.status, 200);
    assert.strictEqual(JSON.parse(response.body).meta.partial, true);
  });

  it('returns a sanitized 500 for an unexpected entity failure', async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    server = createDataGatewayHttpServer(new DataGateway([new HttpTestAdapter('github', 'secret-fail')]));
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
