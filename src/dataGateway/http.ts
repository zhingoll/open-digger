import http, { IncomingMessage, ServerResponse } from 'http';
import { DataGatewayHttpSecurity } from './auth';
import { DataGateway } from './gateway';
import { DataGatewayError, publicError } from './errors';
import { DataSource, EntityLocator, EntityType } from './types';

const MAX_REQUEST_TARGET_LENGTH = 2048;

export function createDataGatewayHttpServer(gateway: DataGateway, security: DataGatewayHttpSecurity): http.Server {
  return http.createServer((request, response) => {
    void handleRequest(gateway, security, request, response);
  });
}

async function handleRequest(
  gateway: DataGateway,
  security: DataGatewayHttpSecurity,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const startedAt = security.now();
  const requestId = security.requestId();
  let fingerprint = 'unauthenticated';
  let route = 'unmatched';
  response.setHeader('X-Request-ID', requestId);
  try {
    const requestTarget = request.url ?? '/';
    const url = parseRequestTarget(requestTarget);
    if (isV1Pathname(url.pathname)) {
      const verified = await authenticate(request, security);
      fingerprint = verified.fingerprint;
      const decision = security.rateLimiter.consume(fingerprint);
      if (!decision.allowed) {
        response.setHeader('Retry-After', String(decision.retryAfterSeconds));
        throw new DataGatewayError('rate_limited', 'Rate limit exceeded', 429);
      }
    }
    if (requestTarget.length > MAX_REQUEST_TARGET_LENGTH) throw invalid('Request target is too long');
    route = auditRoute(url.pathname);
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      throw new DataGatewayError('method_not_allowed', 'Only GET is supported', 405);
    }
    if (url.pathname === '/v1/sources') {
      send(response, 200, { schema_version: '1.0', data: gateway.listSources(), meta: { as_of: new Date().toISOString() } });
      return;
    }
    if (url.pathname === '/v1/search') {
      const query = url.searchParams.get('q') ?? '';
      const sources = csv<DataSource>(url.searchParams.get('sources'));
      const entityTypes = csv<EntityType>(url.searchParams.get('entity_types'));
      const rawLimit = url.searchParams.get('limit');
      const limit = rawLimit === null ? undefined : Number(rawLimit);
      const result = await gateway.search(query, { sources, entity_types: entityTypes, limit });
      if (result.meta.partial && result.data.length === 0) {
        throw new DataGatewayError('service_unavailable', 'All requested data sources are unavailable', 503);
      }
      send(response, 200, result); return;
    }
    const entityRoute = parseEntityRoute(url.pathname);
    if (!entityRoute) throw new DataGatewayError('not_found', 'Route not found', 404);
    const result = entityRoute.metrics
      ? await gateway.getMetrics(entityRoute.source, entityRoute.locator)
      : await gateway.getEntity(entityRoute.source, entityRoute.locator);
    if (!result) throw new DataGatewayError('not_found', 'Entity not found', 404);
    send(response, 200, result);
  } catch (error) {
    const result = publicError(error);
    if (result.status === 401) response.setHeader('WWW-Authenticate', 'Bearer');
    send(response, result.status, result.body);
  } finally {
    security.auditLogger.write({
      request_id: requestId,
      key_fingerprint: fingerprint,
      method: request.method ?? 'UNKNOWN',
      route,
      status: response.statusCode,
      duration_ms: Math.max(0, security.now() - startedAt),
    });
  }
}

function parseRequestTarget(requestTarget: string): URL {
  try {
    return new URL(requestTarget, 'http://127.0.0.1');
  } catch {
    throw invalid('Invalid request target');
  }
}

function isV1Pathname(pathname: string): boolean {
  return pathname === '/v1' || pathname.startsWith('/v1/');
}

async function authenticate(request: IncomingMessage, security: DataGatewayHttpSecurity): Promise<{ fingerprint: string }> {
  const authorization = request.headers.authorization;
  const match = typeof authorization === 'string'
    ? authorization.match(/^Bearer ([A-Za-z0-9\-._~+/]+=*)$/)
    : null;
  if (!match) throw unauthorized();
  const verified = await security.verifier.verify(match[1]);
  if (!verified) throw unauthorized();
  return verified;
}

function unauthorized(): DataGatewayError {
  return new DataGatewayError('unauthorized', 'A valid Bearer API key is required', 401);
}

function auditRoute(pathname: string): string {
  if (pathname === '/v1/sources' || pathname === '/v1/search') return pathname;
  const route = parseEntityRoute(pathname);
  if (!route) return 'unmatched';
  const prefix = route.source === 'github'
    ? '/v1/github/repositories'
    : `/v1/huggingface/${route.locator.entity_type}s`;
  return `${prefix}/{namespace}/{name}${route.metrics ? '/metrics' : ''}`;
}

function parseEntityRoute(pathname: string): { source: DataSource; locator: EntityLocator; metrics: boolean } | null {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] !== 'v1') return null;
  let source: DataSource; let entityType: EntityType;
  if (parts[1] === 'github' && parts[2] === 'repositories') { source = 'github'; entityType = 'repository'; }
  else if (parts[1] === 'huggingface' && parts[2] === 'models') { source = 'huggingface'; entityType = 'model'; }
  else if (parts[1] === 'huggingface' && parts[2] === 'datasets') { source = 'huggingface'; entityType = 'dataset'; }
  else return null;
  const metrics = parts[5] === 'metrics';
  if (parts.length !== (metrics ? 6 : 5)) return null;
  const namespace = decodePart(parts[3]); const name = decodePart(parts[4]);
  return { source, locator: { entity_type: entityType, namespace, name }, metrics };
}

function decodePart(value: string): string {
  try {
    const decoded = decodeURIComponent(value);
    if (!decoded || decoded.length > 256 || decoded.includes('/')) throw invalid('Invalid entity path');
    return decoded;
  } catch (error) {
    if (error instanceof DataGatewayError) throw error;
    throw invalid('Invalid URL encoding');
  }
}

function csv<T extends string>(value: string | null): T[] | undefined {
  if (value === null || value === '') return undefined;
  const values = value.split(',');
  if (values.some(item => !item)) throw invalid('Invalid comma-separated parameter');
  return values as T[];
}

function invalid(message: string): DataGatewayError { return new DataGatewayError('invalid_request', message, 400); }

function send(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Length', Buffer.byteLength(payload));
  response.end(payload);
}
