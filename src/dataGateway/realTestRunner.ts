import assert from 'assert';
import http from 'http';
import { AddressInfo } from 'net';
import { createDataGatewayHttpSecurityFromEnv } from './auth';
import { createDataGatewayFromEnv } from './clickHouseExecutor';
import { createDataGatewayHttpServer } from './http';

interface HttpResult {
  status: number;
  body: any;
  text: string;
}

const REQUIRED = [
  'OPENDIGGER_CLICKHOUSE_URL', 'OPENDIGGER_CLICKHOUSE_USER', 'OPENDIGGER_CLICKHOUSE_PASSWORD', 'OPENDIGGER_CLICKHOUSE_DATABASE',
  'OPENGAUGE_CLICKHOUSE_URL', 'OPENGAUGE_CLICKHOUSE_USER', 'OPENGAUGE_CLICKHOUSE_PASSWORD', 'OPENGAUGE_CLICKHOUSE_DATABASE',
  'DATA_GATEWAY_TEST_API_KEY',
] as const;

async function run(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (REQUIRED.some(name => !env[name])) throw new Error('Missing required real-data test configuration');
  const apiKey = env.DATA_GATEWAY_TEST_API_KEY as string;
  const auditLines: string[] = [];
  const security = createDataGatewayHttpSecurityFromEnv({
    ...env,
    DATA_GATEWAY_API_KEYS: apiKey,
    DATA_GATEWAY_RATE_LIMIT_MAX_REQUESTS: '100',
  }, { write: record => { auditLines.push(JSON.stringify(record)); } });
  const runtime = createDataGatewayFromEnv(env);
  const server = createDataGatewayHttpServer(runtime.gateway, security);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = (server.address() as AddressInfo).port;
  const publicValues: string[] = [];
  try {
    const unauthorized = await request(port, '/v1/sources', 'invalid-real-test-key-000000000000');
    assert.strictEqual(unauthorized.status, 401);
    publicValues.push(unauthorized.text);

    const sources = await ok(port, '/v1/sources', apiKey, publicValues);
    assert.deepStrictEqual(sources.data.map((source: any) => source.source), ['github', 'huggingface']);

    const githubSearch = await ok(port, '/v1/search?q=open-digger&sources=github&entity_types=repository&limit=1', apiKey, publicValues);
    const hfSearch = await ok(port, '/v1/search?q=qwen&sources=huggingface&entity_types=model,dataset&limit=1', apiKey, publicValues);
    assert.strictEqual(githubSearch.meta.partial, false);
    assert.strictEqual(hfSearch.meta.partial, false);
    assert(githubSearch.data.length > 0, 'GitHub real-data search returned no entity');
    assert(hfSearch.data.length > 0, 'Hugging Face real-data search returned no entity');

    await verifyEntity(port, githubSearch.data[0], apiKey, publicValues);
    await verifyEntity(port, hfSearch.data[0], apiKey, publicValues);
    assertSafe(`${publicValues.join('\n')}\n${auditLines.join('\n')}`, env, apiKey);
    process.stdout.write('REAL_GATEWAY sources=2 github_search=ok huggingface_search=ok profiles=2 metrics=2 unauthorized=401 redaction=ok\n');
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await runtime.close();
  }
}

async function verifyEntity(port: number, entity: any, apiKey: string, publicValues: string[]): Promise<void> {
  const parts = String(entity.entity_id).split('/');
  assert.strictEqual(parts.length, 2, 'Real entity ID is not namespace/name');
  const root = entity.source === 'github'
    ? '/v1/github/repositories'
    : `/v1/huggingface/${entity.entity_type}s`;
  const route = `${root}/${encodeURIComponent(parts[0])}/${encodeURIComponent(parts[1])}`;
  const profile = await ok(port, route, apiKey, publicValues);
  const metrics = await ok(port, `${route}/metrics`, apiKey, publicValues);
  assert(profile.meta.as_of && Array.isArray(profile.meta.data_quality));
  assert(metrics.meta.as_of && Array.isArray(metrics.meta.data_quality));
}

async function ok(port: number, route: string, apiKey: string, publicValues: string[]): Promise<any> {
  const response = await request(port, route, apiKey);
  publicValues.push(response.text);
  assert.strictEqual(response.status, 200, `${route} returned ${response.status}`);
  assert.strictEqual(response.body.schema_version, '1.0');
  return response.body;
}

function request(port: number, route: string, apiKey: string): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const outgoing = http.get({ host: '127.0.0.1', port, path: route, headers: { Authorization: `Bearer ${apiKey}` } }, response => {
      const chunks: Buffer[] = [];
      response.on('data', chunk => chunks.push(Buffer.from(chunk)));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        try { resolve({ status: response.statusCode ?? 0, body: JSON.parse(text), text }); }
        catch { reject(new Error('Real-data Gateway returned invalid JSON')); }
      });
    });
    outgoing.setTimeout(10000, () => outgoing.destroy(new Error('Real-data Gateway request timed out')));
    outgoing.on('error', reject);
  });
}

function assertSafe(serialized: string, env: NodeJS.ProcessEnv, apiKey: string): void {
  const protectedConnectionFields = [0, 2, 3, 4, 6, 7].map(index => env[REQUIRED[index]]);
  const forbidden = [
    apiKey,
    ...protectedConnectionFields,
    'SELECT ',
    '\n    at ',
  ].filter((value): value is string => Boolean(value));
  for (const marker of forbidden) assert(!serialized.includes(marker), 'Real-data response or audit output leaked a protected value');
}

void run().catch(() => {
  process.stderr.write('REAL_GATEWAY failed (details redacted)\n');
  process.exitCode = 1;
});
