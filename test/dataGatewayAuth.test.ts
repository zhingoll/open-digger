import assert from 'assert';
import http from 'http';
import { AddressInfo } from 'net';
import {
  ApiKeyRateLimiter, AuditRecord, DataGatewayHttpSecurity, HashedApiKeyVerifier,
  createDataGatewayHttpSecurityFromEnv,
} from '../src/dataGateway/auth';
import { DataGateway } from '../src/dataGateway/gateway';
import { createDataGatewayHttpServer } from '../src/dataGateway/http';
import { startDataGatewayServer } from '../src/dataGateway/server';

const KEY_ONE = 'rotation-key-one-000000000000000001';
const KEY_TWO = 'rotation-key-two-000000000000000002';

describe('Data Gateway API key boundary', () => {
  it('refuses startup without a valid authentication configuration', async () => {
    await assert.rejects(startDataGatewayServer({}), /DATA_GATEWAY_API_KEYS/);
    assert.throws(() => createDataGatewayHttpSecurityFromEnv({ DATA_GATEWAY_API_KEYS: 'short' }), /32 and 512/);
  });

  it('stores digests and accepts rotated keys with constant-length fingerprints', async () => {
    const verifier = new HashedApiKeyVerifier([KEY_ONE, KEY_TWO]);
    const first = await verifier.verify(KEY_ONE);
    const second = await verifier.verify(KEY_TWO);
    assert(first && second);
    assert.strictEqual(first.fingerprint.length, 12);
    assert.notStrictEqual(first.fingerprint, second.fingerprint);
    assert.strictEqual(await verifier.verify('wrong-key-00000000000000000000000'), null);
    assert(!JSON.stringify(verifier).includes(KEY_ONE));
    assert(!JSON.stringify(verifier).includes(KEY_TWO));
  });

  it('returns sanitized 401 for missing, malformed, and invalid Bearer credentials', async () => {
    await withServer(defaultSecurity(), async port => {
      for (const authorization of [undefined, 'Basic abc', 'Bearer wrong-key-00000000000000000000000']) {
        const response = await request(port, '/v1/sources', authorization);
        assert.strictEqual(response.status, 401);
        assert.strictEqual(response.headers['www-authenticate'], 'Bearer');
        assert.strictEqual(response.body.error.code, 'unauthorized');
        assert(!response.text.includes('wrong-key'));
        assert(!response.text.includes('digest'));
      }
    });
  });

  it('authenticates oversized v1 request targets before returning validation errors', async () => {
    const oversized = `/v1/search?q=${'x'.repeat(3000)}`;
    await withServer(defaultSecurity(), async port => {
      assert.strictEqual((await request(port, oversized)).status, 401);
      assert.strictEqual((await request(port, oversized, `Bearer ${KEY_ONE}`)).status, 400);
    });
  });

  it('accepts both active rotation keys and a replaceable verifier', async () => {
    await withServer(defaultSecurity(), async port => {
      assert.strictEqual((await request(port, '/v1/sources', `Bearer ${KEY_ONE}`)).status, 200);
      assert.strictEqual((await request(port, '/v1/sources', `Bearer ${KEY_TWO}`)).status, 200);
    });
    const replaceable = defaultSecurity();
    replaceable.verifier = { verify: async key => key === 'external-verifier-token' ? { fingerprint: 'external0001' } : null };
    await withServer(replaceable, async port => {
      assert.strictEqual((await request(port, '/v1/sources', 'Bearer external-verifier-token')).status, 200);
    });
  });

  it('isolates rate limits by verified key and recovers after the window', async () => {
    let now = 1000;
    const records: AuditRecord[] = [];
    const security = defaultSecurity(2, 1000, () => now, records);
    await withServer(security, async port => {
      assert.strictEqual((await request(port, '/v1/sources', `Bearer ${KEY_ONE}`)).status, 200);
      assert.strictEqual((await request(port, '/v1/sources', `Bearer ${KEY_ONE}`)).status, 200);
      const limited = await request(port, '/v1/sources', `Bearer ${KEY_ONE}`);
      assert.strictEqual(limited.status, 429);
      assert.strictEqual(limited.headers['retry-after'], '1');
      assert.strictEqual((await request(port, '/v1/sources', `Bearer ${KEY_TWO}`)).status, 200);
      now += 1000;
      assert.strictEqual((await request(port, '/v1/sources', `Bearer ${KEY_ONE}`)).status, 200);
    });
    assert(records.some(record => record.status === 429));
  });

  it('audits only request ID, fingerprint, method, normalized route, status, and duration', async () => {
    const records: AuditRecord[] = [];
    await withServer(defaultSecurity(100, 60000, Date.now, records), async port => {
      const secretQuery = 'do-not-log-this-query';
      await request(port, `/v1/search?q=${secretQuery}`, `Bearer ${KEY_ONE}`);
      const serialized = JSON.stringify(records);
      assert(!serialized.includes(secretQuery));
      assert(!serialized.includes(KEY_ONE));
      assert(!serialized.includes('Authorization'));
      assert.deepStrictEqual(Object.keys(records[0]).sort(), [
        'duration_ms', 'key_fingerprint', 'method', 'request_id', 'route', 'status',
      ]);
      assert.strictEqual(records[0].route, '/v1/search');
    });
  });
});

function defaultSecurity(
  maxRequests = 100,
  windowMs = 60000,
  now: () => number = Date.now,
  records: AuditRecord[] = [],
): DataGatewayHttpSecurity {
  return {
    verifier: new HashedApiKeyVerifier([KEY_ONE, KEY_TWO]),
    rateLimiter: new ApiKeyRateLimiter(maxRequests, windowMs, now),
    auditLogger: { write: record => { records.push(record); } },
    requestId: () => '0123456789abcdef0123456789abcdef',
    now,
  };
}

async function withServer(security: DataGatewayHttpSecurity, run: (port: number) => Promise<void>): Promise<void> {
  const server = createDataGatewayHttpServer(new DataGateway([]), security);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await run((server.address() as AddressInfo).port);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

function request(port: number, path: string, authorization?: string): Promise<{
  status: number; headers: http.IncomingHttpHeaders; body: any; text: string;
}> {
  return new Promise((resolve, reject) => {
    const headers = authorization ? { Authorization: authorization } : undefined;
    const outgoing = http.get({ host: '127.0.0.1', port, path, headers }, response => {
      const chunks: Buffer[] = [];
      response.on('data', chunk => chunks.push(Buffer.from(chunk)));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: response.statusCode ?? 0, headers: response.headers, body: JSON.parse(text), text });
      });
    });
    outgoing.on('error', reject);
  });
}
