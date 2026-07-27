import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { DataGateway } from '../../../src/dataGateway/gateway';
import { GitHubAdapter } from '../../../src/dataGateway/githubAdapter';
import { HuggingFaceAdapter, QueryExecutor, QueryParams } from '../../../src/dataGateway/huggingFaceAdapter';
import { createDataGatewayMcpServer } from '../../../src/dataGateway/mcp/server';

const githubQuery: QueryExecutor = async <T>(sql: string, params: QueryParams = {}) => {
  if (params.query === 'partial') throw new Error('github offline');
  if (params.query === 'timeout') await new Promise(resolve => setTimeout(resolve, 100));
  if (sql.includes('positionCaseInsensitiveUTF8')) return [{ id: 42, name: `X-lab2017/${params.query}` }] as T[];
  if (sql.includes('name_info')) return [{ id: 42, name: 'X-lab2017/open-digger' }] as T[];
  if (sql.includes('repo_info')) return [{ description: 'metrics', default_branch: 'master', homepage_url: '', is_fork: 0,
    primary_language: 'TypeScript', license: 'Apache-2.0', topics: ['metrics'], created_at: '2020-01-01 00:00:00',
    source_updated_at: '2026-07-01 00:00:00' }] as T[];
  if (sql.includes('global_openrank')) return [{ observed_at: '2026-07-01 00:00:00', value: 12 }] as T[];
  return [] as T[];
};

const hfQuery: QueryExecutor = async <T>(sql: string, params: QueryParams = {}) => {
  if (params.entityId === 'org/secret') throw new Error('SELECT password FROM db at 10.0.0.8');
  if (sql.includes('positionCaseInsensitiveUTF8')) {
    if (sql.includes('dataset_repos')) return [] as T[];
    return [{ id: `Qwen/${params.query}`, updated_at: '2026-07-01 00:00:00' }] as T[];
  }
  if (sql.includes('AS author')) return [{ id: params.entityId, author: 'Qwen', created_at: '2026-01-01 00:00:00',
    updated_at: '2026-07-01 00:00:00', pipeline_tag: 'text-generation', library_name: 'transformers', tags: [], gated: 0, disabled: 0 }] as T[];
  if (sql.includes('AS downloads_all_time')) return [{ internal_id: 'hf-id', downloads: 150, likes: 12,
    downloads_all_time: 1200, updated_at: '2026-07-01 00:00:00' }] as T[];
  if (sql.includes('dllk_history')) return [{ download_count: 150, like_count: 12, crawl_time: '2026-07-02 00:00:00' }] as T[];
  return [] as T[];
};

const gateway = new DataGateway([
  new GitHubAdapter(githubQuery), new HuggingFaceAdapter(hfQuery),
], () => new Date('2026-07-27T00:00:00Z'), 20);

void createDataGatewayMcpServer(gateway).connect(new StdioServerTransport()).catch(() => { process.exitCode = 1; });
