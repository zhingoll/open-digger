import { ClickHouseClient, createClient } from '@clickhouse/client';
import { DataGateway } from './gateway';
import { GitHubAdapter } from './githubAdapter';
import { HuggingFaceAdapter, QueryExecutor, QueryParams } from './huggingFaceAdapter';

export interface ClickHouseConnectionConfig {
  url: string;
  username: string;
  password: string;
}

export interface DataGatewayRuntime {
  gateway: DataGateway;
  close(): Promise<void>;
}

export function createClickHouseExecutor(config: ClickHouseConnectionConfig): { query: QueryExecutor; close(): Promise<void> } {
  const client: ClickHouseClient = createClient(config);
  const query: QueryExecutor = async <T>(sql: string, queryParams: QueryParams = {}): Promise<T[]> => {
    const result = await client.query({ query: sql, query_params: queryParams, format: 'JSONEachRow' });
    return result.json<T>();
  };
  return { query, close: () => client.close() };
}

export function createDataGatewayFromEnv(env: NodeJS.ProcessEnv = process.env): DataGatewayRuntime {
  const github = createClickHouseExecutor(connection(env, 'OPENDIGGER'));
  const huggingface = createClickHouseExecutor(connection(env, 'OPENGAUGE'));
  const githubDatabase = required(env, 'OPENDIGGER_CLICKHOUSE_DATABASE');
  const huggingfaceDatabase = required(env, 'OPENGAUGE_CLICKHOUSE_DATABASE');
  const timeout = optionalPositiveInteger(env.DATA_GATEWAY_ADAPTER_TIMEOUT_MS, 5000, 'DATA_GATEWAY_ADAPTER_TIMEOUT_MS');
  return {
    gateway: new DataGateway([
      new GitHubAdapter(github.query, githubDatabase),
      new HuggingFaceAdapter(huggingface.query, huggingfaceDatabase),
    ], () => new Date(), timeout),
    async close(): Promise<void> { await Promise.all([github.close(), huggingface.close()]); },
  };
}

function connection(env: NodeJS.ProcessEnv, prefix: 'OPENDIGGER' | 'OPENGAUGE'): ClickHouseConnectionConfig {
  return {
    url: required(env, `${prefix}_CLICKHOUSE_URL`),
    username: required(env, `${prefix}_CLICKHOUSE_USER`),
    password: required(env, `${prefix}_CLICKHOUSE_PASSWORD`),
  };
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function optionalPositiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`);
  return parsed;
}
