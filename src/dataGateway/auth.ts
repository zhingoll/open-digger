import { createHash, randomBytes, timingSafeEqual } from 'crypto';

export interface VerifiedApiKey {
  fingerprint: string;
}

export interface ApiKeyVerifier {
  verify(apiKey: string): Promise<VerifiedApiKey | null>;
}

interface StoredKey {
  digest: Buffer;
  fingerprint: string;
}

export class HashedApiKeyVerifier implements ApiKeyVerifier {
  private readonly keys: StoredKey[];

  constructor(apiKeys: string[]) {
    if (apiKeys.length === 0) throw new Error('At least one API key is required');
    if (apiKeys.some(key => key.length < 32 || key.length > 512)) {
      throw new Error('API keys must be between 32 and 512 characters');
    }
    this.keys = apiKeys.map(key => {
      const digest = hash(key);
      return { digest, fingerprint: digest.toString('hex').slice(0, 12) };
    });
  }

  async verify(apiKey: string): Promise<VerifiedApiKey | null> {
    const candidate = hash(apiKey);
    let match: StoredKey | undefined;
    for (const stored of this.keys) {
      if (timingSafeEqual(candidate, stored.digest)) match = stored;
    }
    return match ? { fingerprint: match.fingerprint } : null;
  }
}

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

interface RateLimitWindow {
  startedAt: number;
  count: number;
}

export class ApiKeyRateLimiter {
  private readonly windows = new Map<string, RateLimitWindow>();

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {
    if (!Number.isInteger(maxRequests) || maxRequests < 1) throw new Error('Rate limit max requests must be a positive integer');
    if (!Number.isInteger(windowMs) || windowMs < 1) throw new Error('Rate limit window must be a positive integer');
  }

  consume(fingerprint: string): RateLimitDecision {
    const current = this.now();
    const existing = this.windows.get(fingerprint);
    if (!existing || current - existing.startedAt >= this.windowMs) {
      this.windows.set(fingerprint, { startedAt: current, count: 1 });
      return { allowed: true, retryAfterSeconds: 0 };
    }
    if (existing.count < this.maxRequests) {
      existing.count++;
      return { allowed: true, retryAfterSeconds: 0 };
    }
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((this.windowMs - (current - existing.startedAt)) / 1000)),
    };
  }
}

export interface AuditRecord {
  request_id: string;
  key_fingerprint: string;
  method: string;
  route: string;
  status: number;
  duration_ms: number;
}

export interface AuditLogger {
  write(record: AuditRecord): void;
}

export class JsonAuditLogger implements AuditLogger {
  constructor(private readonly output: (line: string) => void = line => process.stderr.write(line)) {}

  write(record: AuditRecord): void {
    this.output(`${JSON.stringify(record)}\n`);
  }
}

export interface DataGatewayHttpSecurity {
  verifier: ApiKeyVerifier;
  rateLimiter: ApiKeyRateLimiter;
  auditLogger: AuditLogger;
  requestId(): string;
  now(): number;
}

export function createDataGatewayHttpSecurityFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  auditLogger: AuditLogger = new JsonAuditLogger(),
): DataGatewayHttpSecurity {
  const rawKeys = required(env, 'DATA_GATEWAY_API_KEYS');
  const keys = rawKeys.split(',').map(key => key.trim());
  if (keys.some(key => !key) || new Set(keys).size !== keys.length) {
    throw new Error('DATA_GATEWAY_API_KEYS must contain unique non-empty comma-separated keys');
  }
  const maxRequests = positiveInteger(env.DATA_GATEWAY_RATE_LIMIT_MAX_REQUESTS, 120, 'DATA_GATEWAY_RATE_LIMIT_MAX_REQUESTS');
  const windowMs = positiveInteger(env.DATA_GATEWAY_RATE_LIMIT_WINDOW_MS, 60000, 'DATA_GATEWAY_RATE_LIMIT_WINDOW_MS');
  return {
    verifier: new HashedApiKeyVerifier(keys),
    rateLimiter: new ApiKeyRateLimiter(maxRequests, windowMs),
    auditLogger,
    requestId: () => randomBytes(16).toString('hex'),
    now: Date.now,
  };
}

function hash(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`);
  return parsed;
}
