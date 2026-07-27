import assert from 'assert';
import { DataGateway } from '../src/dataGateway/gateway';
import { GitHubAdapter } from '../src/dataGateway/githubAdapter';
import { HuggingFaceAdapter, QueryExecutor, QueryParams } from '../src/dataGateway/huggingFaceAdapter';
import { DataGatewayError, publicError } from '../src/dataGateway/errors';

describe('Data Gateway v1 validation', () => {
  it('rejects empty and overlong searches', async () => {
    const gateway = new DataGateway([]);
    await assert.rejects(gateway.search('   '), /query/i);
    await assert.rejects(gateway.search('x'.repeat(257)), /query/i);
  });

  it('rejects invalid limits instead of silently clamping them', async () => {
    const gateway = new DataGateway([]);
    for (const limit of [0, -1, 1.5, 101, Number.NaN]) {
      await assert.rejects(gateway.search('valid', { limit }), /limit/i);
    }
  });

  it('rejects invalid source and entity type at runtime', async () => {
    const gateway = new DataGateway([]);
    await assert.rejects(gateway.search('x', { sources: ['gitlab' as 'github'] }), /source/i);
    await assert.rejects(gateway.search('x', { entity_types: ['space' as 'model'] }), /entity type/i);
  });

  it('redacts SQL, credentials, and connection details from internal failures', () => {
    const secret = 'clickhouse://readonly:password@10.0.0.8:8123 SELECT * FROM repo_info';
    const result = publicError(new Error(secret));
    assert.strictEqual(result.status, 500);
    const serialized = JSON.stringify(result.body);
    assert(!serialized.includes('password'));
    assert(!serialized.includes('10.0.0.8'));
    assert(!serialized.includes('SELECT'));
    assert.strictEqual(result.body.error.code, 'internal_error');

    const safe = publicError(new DataGatewayError('invalid_request', 'Invalid limit', 400));
    assert.deepStrictEqual(safe, { status: 400, body: { error: { code: 'invalid_request', message: 'Invalid limit' } } });
  });
});

describe('GitHubAdapter', () => {
  it('parameterizes Unicode and SQL-injection search input', async () => {
    const calls: { sql: string; params: QueryParams }[] = [];
    const query: QueryExecutor = async <T>(sql: string, params: QueryParams = {}) => {
      calls.push({ sql, params });
      return [{ id: 1, name: '组织/模型', updated_at: '2026-07-01 00:00:00' }] as T[];
    };
    const adapter = new GitHubAdapter(query);
    const input = "模型' OR 1=1 --";
    const result = await adapter.search(input, { entity_types: ['repository'], limit: 10 });
    assert.strictEqual(result.data[0].entity_id, '组织/模型');
    assert.strictEqual(calls[0].params.query, input);
    assert(!calls[0].sql.includes(input));
    assert(calls[0].sql.includes('{query:String}'));
  });

  it('maps repository metadata and sorted deduplicated OpenRank history', async () => {
    const query: QueryExecutor = async <T>(sql: string) => {
      if (sql.includes('FROM opensource.name_info')) return [{ id: 42, name: 'X-lab2017/open-digger' }] as T[];
      if (sql.includes('FROM opensource.repo_info')) return [{ description: 'metrics', default_branch: 'master', homepage_url: '', is_fork: 0,
        primary_language: 'TypeScript', license: 'Apache-2.0', topics: ['metrics'], created_at: '2020-01-01 00:00:00', updated_at: '2026-07-01 00:00:00' }] as T[];
      if (sql.includes('FROM opensource.global_openrank')) return [
        { observed_at: '2026-02-01 00:00:00', value: 2 },
        { observed_at: '2026-01-01 00:00:00', value: 1 },
        { observed_at: '2026-02-01 00:00:00', value: 3 },
      ] as T[];
      return [];
    };
    const adapter = new GitHubAdapter(query);
    const entity = await adapter.getEntity({ entity_type: 'repository', namespace: 'X-lab2017', name: 'open-digger' });
    assert(entity);
    assert.strictEqual(entity.data.attributes.primary_language, 'TypeScript');
    assert.deepStrictEqual(entity.data.metrics['github.openrank'].series, [
      { time: '2026-01-01T00:00:00.000Z', value: 1 },
      { time: '2026-02-01T00:00:00.000Z', value: 3 },
    ]);
    assert.strictEqual(entity.data.metrics['github.openrank'].value, 3);
  });

  it('returns unknown repositories as null and marks missing history', async () => {
    const missing = new GitHubAdapter(async <T>() => [] as T[]);
    assert.strictEqual(await missing.getEntity({ entity_type: 'repository', namespace: 'none', name: 'none' }), null);

    const noHistory = new GitHubAdapter(async <T>(sql: string) => {
      if (sql.includes('name_info')) return [{ id: 1, name: 'a/b' }] as T[];
      if (sql.includes('repo_info')) return [{ description: '', default_branch: '', homepage_url: '', is_fork: 0,
        primary_language: '', license: '', topics: [], created_at: '2020-01-01 00:00:00', updated_at: '2026-01-01 00:00:00' }] as T[];
      return [] as T[];
    });
    const result = await noHistory.getMetrics({ entity_type: 'repository', namespace: 'a', name: 'b' });
    assert(result);
    assert(result.data_quality.includes('metric_history_missing'));
  });
});

describe('HuggingFaceAdapter boundary behavior', () => {
  it('does not expose an entity that changed from public to private', async () => {
    const query: QueryExecutor = async <T>(sql: string) => {
      assert(sql.includes('HAVING argMax(private, lastModified) = 0'));
      return [] as T[];
    };
    const adapter = new HuggingFaceAdapter(query);
    assert.strictEqual(await adapter.getEntity({ entity_type: 'model', namespace: 'org', name: 'private-now' }), null);
  });

  it('sorts, deduplicates, and quality-marks incomplete history', async () => {
    const query: QueryExecutor = async <T>(sql: string) => {
      if (sql.includes('AS downloads_all_time')) return [{ internal_id: 'id', downloads: 5, likes: 2,
        downloads_all_time: null, updated_at: '2026-03-01 00:00:00' }] as T[];
      if (sql.includes('dllk_history')) return [
        { download_count: 2, like_count: 1, crawl_time: '2026-02-01 00:00:00' },
        { download_count: 1, like_count: 1, crawl_time: '2026-01-01 00:00:00' },
        { download_count: 3, like_count: 2, crawl_time: '2026-02-01 00:00:00' },
      ] as T[];
      return [] as T[];
    };
    const result = await new HuggingFaceAdapter(query).getMetrics({ entity_type: 'model', namespace: 'org', name: 'm' });
    assert(result);
    assert.deepStrictEqual(result.data['huggingface.downloads_history'].series, [
      { time: '2026-01-01T00:00:00.000Z', value: 1 },
      { time: '2026-02-01T00:00:00.000Z', value: 3 },
    ]);
    assert(result.data_quality.includes('metric_value_missing'));
  });
});
