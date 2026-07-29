import SwaggerParser from '@apidevtools/swagger-parser';
import assert from 'assert';
import http from 'http';
import { AddressInfo } from 'net';
import path from 'path';
import { DataAdapter } from '../src/dataGateway/adapter';
import { ApiKeyRateLimiter, DataGatewayHttpSecurity, HashedApiKeyVerifier } from '../src/dataGateway/auth';
import { DataGateway } from '../src/dataGateway/gateway';
import { createDataGatewayHttpServer } from '../src/dataGateway/http';
import { AdapterResult, DataSource, EntityData, EntityLocator, EntityType, MetricValue, SearchOptions, SearchResult } from '../src/dataGateway/types';

const API_KEY = 'openapi-contract-key-00000000000001';
const specificationPath = path.resolve('docs/openapi/data-gateway.v1.yaml');

describe('Data Gateway OpenAPI 3.1 contract', () => {
  it('parses and validates as OpenAPI 3.1 with eight secured operations', async () => {
    const api = await SwaggerParser.validate(specificationPath) as any;
    assert.strictEqual(api.openapi, '3.1.0');
    assert.strictEqual(Object.keys(api.paths).length, 8);
    assert.deepStrictEqual(api.security, [{ bearerAuth: [] }]);
    assert.strictEqual(api.components.securitySchemes.bearerAuth.scheme, 'bearer');
    assert.strictEqual(api.components.responses.Unauthorized.headers['WWW-Authenticate'].schema.const, 'Bearer');
    assert.strictEqual(api.servers[0].url, '{gatewayBaseUrl}');
  });

  it('documents every required public error status without exposing SQL', async () => {
    const api = await SwaggerParser.dereference(specificationPath) as any;
    const statuses = new Set<string>();
    for (const pathItem of Object.values<any>(api.paths)) {
      Object.keys(pathItem.get.responses).forEach(status => statuses.add(status));
    }
    for (const status of ['400', '401', '404', '405', '429', '500', '503']) assert(statuses.has(status), `${status} missing`);
    const serialized = JSON.stringify(api);
    assert(!serialized.includes('ClickHouse'));
    assert(!serialized.includes('SELECT '));
    assert(!serialized.includes('DATA_GATEWAY_API_KEYS'));
  });

  it('matches every operation to a real authenticated HTTP response', async () => {
    const server = createDataGatewayHttpServer(new DataGateway([
      new ContractAdapter('github', 'opendigger', ['repository']),
      new ContractAdapter('huggingface', 'opengauge', ['model', 'dataset']),
    ]), security());
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    try {
      const cases = [
        '/v1/sources',
        '/v1/search?q=qwen&sources=github,huggingface&limit=10',
        '/v1/github/repositories/X-lab2017/open-digger',
        '/v1/github/repositories/X-lab2017/open-digger/metrics',
        '/v1/huggingface/models/Qwen/Qwen3-8B',
        '/v1/huggingface/models/Qwen/Qwen3-8B/metrics',
        '/v1/huggingface/datasets/org/data',
        '/v1/huggingface/datasets/org/data/metrics',
      ];
      for (const route of cases) {
        const response = await request(port, route, API_KEY);
        assert.strictEqual(response.status, 200, `${route}: ${response.text}`);
        assert.strictEqual(response.body.schema_version, '1.0');
        assert(response.body.data !== undefined);
        assert(response.body.meta?.as_of);
      }
      assert.strictEqual((await request(port, '/v1/sources', 'wrong-key-00000000000000000000000')).status, 401);
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
});

class ContractAdapter implements DataAdapter {
  constructor(
    readonly source: DataSource,
    readonly provider: 'opendigger' | 'opengauge',
    readonly entityTypes: readonly EntityType[],
  ) {}

  async search(query: string, _options: SearchOptions): Promise<AdapterResult<SearchResult[]>> {
    return this.wrap([{ source: this.source, entity_type: this.entityTypes[0], entity_id: `${query}/entity`, name: 'entity', source_url: 'https://example.test/entity' }]);
  }

  async getEntity(locator: EntityLocator): Promise<AdapterResult<EntityData>> {
    return this.wrap({
      source: this.source,
      entity_type: locator.entity_type,
      entity_id: `${locator.namespace}/${locator.name}`,
      name: locator.name,
      source_url: 'https://example.test/entity',
      attributes: {},
      metrics: { 'test.metric': metric() },
    });
  }

  async getMetrics(_locator: EntityLocator): Promise<AdapterResult<Record<string, MetricValue>>> {
    return this.wrap({ 'test.metric': metric() });
  }

  private wrap<T>(data: T): AdapterResult<T> {
    return { data, as_of: '2026-07-29T00:00:00.000Z', provider: this.provider, data_quality: [], warnings: [] };
  }
}

function metric(): MetricValue {
  return { value: 1, unit: null, observed_at: '2026-07-29T00:00:00.000Z' };
}

function security(): DataGatewayHttpSecurity {
  return {
    verifier: new HashedApiKeyVerifier([API_KEY]),
    rateLimiter: new ApiKeyRateLimiter(100, 60000),
    auditLogger: { write: () => undefined },
    requestId: () => 'openapi-contract-request-id',
    now: Date.now,
  };
}

function request(port: number, route: string, apiKey: string): Promise<{ status: number; body: any; text: string }> {
  return new Promise((resolve, reject) => {
    const outgoing = http.get({ host: '127.0.0.1', port, path: route, headers: { Authorization: `Bearer ${apiKey}` } }, response => {
      const chunks: Buffer[] = [];
      response.on('data', chunk => chunks.push(Buffer.from(chunk)));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: response.statusCode ?? 0, body: JSON.parse(text), text });
      });
    });
    outgoing.on('error', reject);
  });
}
