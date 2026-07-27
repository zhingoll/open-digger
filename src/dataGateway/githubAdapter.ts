import { DataAdapter } from './adapter';
import { QueryExecutor } from './huggingFaceAdapter';
import { toIsoTime } from './time';
import { AdapterResult, EntityData, EntityLocator, EntityType, MetricSeriesPoint, MetricValue, SearchOptions, SearchResult } from './types';

interface SearchRow { id: number; name: string; }
interface RepoIdentityRow { id: number; name: string; }
interface RepoMetadataRow {
  description: string; default_branch: string; homepage_url: string; is_fork: number | boolean;
  primary_language: string; license: string; topics: string[]; created_at: string; updated_at: string;
}
interface OpenRankRow { observed_at: string; value: number | null; }
const ENTITY_TYPES: readonly EntityType[] = ['repository'];

export class GitHubAdapter implements DataAdapter {
  readonly source = 'github' as const;
  readonly provider = 'opendigger' as const;
  readonly entityTypes = ENTITY_TYPES;
  private readonly query: QueryExecutor;
  private readonly database: string;
  private readonly now: () => Date;

  constructor(query: QueryExecutor, database = 'opensource', now: () => Date = () => new Date()) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(database)) throw new Error('Invalid ClickHouse database name');
    this.query = query; this.database = database; this.now = now;
  }

  async search(query: string, options: SearchOptions): Promise<AdapterResult<SearchResult[]>> {
    if (options.entity_types && !options.entity_types.includes('repository')) return this.result([]);
    const rows = await this.query<SearchRow>(`
SELECT id, name FROM ${this.database}.name_info
WHERE platform = {platform:String} AND type = {repoType:String}
  AND positionCaseInsensitiveUTF8(name, {query:String}) > 0
ORDER BY openrank DESC, name ASC LIMIT {limit:UInt32}`,
    { platform: 'GitHub', repoType: 'Repo', query, limit: options.limit });
    return this.result(rows.map(row => ({ source: this.source, entity_type: 'repository', entity_id: row.name,
      name: this.displayName(row.name), source_url: `https://github.com/${row.name}` })));
  }

  async getEntity(locator: EntityLocator): Promise<AdapterResult<EntityData> | null> {
    this.assertLocator(locator);
    const identity = await this.resolve(locator); if (!identity) return null;
    const rows = await this.query<RepoMetadataRow>(`
SELECT argMax(description, updated_at) AS description, argMax(default_branch, updated_at) AS default_branch,
  argMax(homepage_url, updated_at) AS homepage_url, argMax(isFork, updated_at) AS is_fork,
  argMax(primary_language, updated_at) AS primary_language, argMax(license, updated_at) AS license,
  argMax(topics, updated_at) AS topics, min(created_at) AS created_at, max(updated_at) AS updated_at
FROM ${this.database}.repo_info
WHERE platform = {platform:String} AND id = {repoId:UInt64} AND status = {status:String}
HAVING count() > 0 LIMIT 1`, { platform: 'GitHub', repoId: identity.id, status: 'normal' });
    const metadata = rows[0]; if (!metadata) return null;
    const metrics = await this.metricsFor(identity.id, metadata.updated_at);
    const dataQuality = [...metrics.data_quality, ...(metadata.description ? [] : ['description_missing'])];
    return { data: { source: this.source, entity_type: 'repository', entity_id: identity.name,
      name: this.displayName(identity.name), source_url: `https://github.com/${identity.name}`,
      attributes: { description: metadata.description, default_branch: metadata.default_branch,
        homepage_url: metadata.homepage_url, is_fork: Boolean(metadata.is_fork),
        primary_language: metadata.primary_language, license: metadata.license, topics: metadata.topics,
        created_at: toIsoTime(metadata.created_at), updated_at: toIsoTime(metadata.updated_at) },
      metrics: metrics.data }, as_of: metrics.as_of, provider: this.provider,
      data_quality: Array.from(new Set(dataQuality)), warnings: metrics.warnings };
  }

  async getMetrics(locator: EntityLocator): Promise<AdapterResult<Record<string, MetricValue>> | null> {
    this.assertLocator(locator); const identity = await this.resolve(locator); if (!identity) return null;
    return this.metricsFor(identity.id, this.now().toISOString());
  }

  private async resolve(locator: EntityLocator): Promise<RepoIdentityRow | null> {
    const rows = await this.query<RepoIdentityRow>(`
SELECT id, name FROM ${this.database}.name_info
WHERE platform = {platform:String} AND type = {repoType:String} AND name = {entityId:String}
ORDER BY openrank DESC LIMIT 1`, { platform: 'GitHub', repoType: 'Repo', entityId: `${locator.namespace}/${locator.name}` });
    return rows[0] ?? null;
  }

  private async metricsFor(repoId: number, fallbackTime: string): Promise<AdapterResult<Record<string, MetricValue>>> {
    const rows = await this.query<OpenRankRow>(`
SELECT toString(created_at) AS observed_at, sum(openrank) AS value
FROM ${this.database}.global_openrank
WHERE platform = {platform:String} AND type = {repoType:String} AND repo_id = {repoId:UInt64}
GROUP BY created_at ORDER BY created_at ASC LIMIT {historyLimit:UInt32}`,
    { platform: 'GitHub', repoType: 'Repo', repoId, historyLimit: 1200 });
    const series = this.normalizeSeries(rows); const latest = series[series.length - 1];
    const observedAt = latest?.time ?? toIsoTime(fallbackTime);
    const data: Record<string, MetricValue> = latest ? { 'github.openrank': {
      value: latest.value, unit: 'openrank', observed_at: latest.time, series } } : {};
    return { data, as_of: observedAt, provider: this.provider,
      data_quality: latest ? [] : ['metric_history_missing'], warnings: [] };
  }

  private normalizeSeries(rows: OpenRankRow[]): MetricSeriesPoint[] {
    const byTime = new Map<string, number | null>();
    rows.forEach(row => byTime.set(toIsoTime(row.observed_at), row.value));
    return Array.from(byTime, ([time, value]) => ({ time, value })).sort((a, b) => a.time.localeCompare(b.time));
  }
  private result<T>(data: T): AdapterResult<T> { return { data, as_of: this.now().toISOString(), provider: this.provider, data_quality: [], warnings: [] }; }
  private assertLocator(locator: EntityLocator): asserts locator is EntityLocator & { entity_type: 'repository' } {
    if (locator.entity_type !== 'repository') throw new Error('Unsupported GitHub entity type');
    if (!locator.namespace.trim() || !locator.name.trim()) throw new Error('GitHub owner and repository must not be empty');
  }
  private displayName(entityId: string): string { return entityId.split('/').pop() ?? entityId; }
}
