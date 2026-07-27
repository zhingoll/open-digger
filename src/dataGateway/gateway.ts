import { DataAdapter } from './adapter';
import { DataGatewayError } from './errors';
import {
  DATA_GATEWAY_SCHEMA_VERSION,
  DataSource,
  EntityLocator,
  EntityResponse,
  EntityType,
  MetricsResponse,
  SearchResponse,
  SearchResult,
  SourceDescription,
} from './types';

const DEFAULT_SEARCH_LIMIT = 20;
const MAX_SEARCH_LIMIT = 100;
const MAX_SEARCH_QUERY_LENGTH = 256;
const DATA_SOURCES: readonly DataSource[] = ['github', 'huggingface'];
const ENTITY_TYPES: readonly EntityType[] = ['repository', 'model', 'dataset', 'account', 'organization'];

export interface GatewaySearchOptions {
  sources?: DataSource[];
  entity_types?: EntityType[];
  limit?: number;
}

export class DataGateway {
  private readonly adapters = new Map<DataSource, DataAdapter>();
  private readonly now: () => Date;
  private readonly adapterTimeoutMs: number;

  constructor(adapters: DataAdapter[], now: () => Date = () => new Date(), adapterTimeoutMs = 5000) {
    this.now = now;
    if (!Number.isFinite(adapterTimeoutMs) || adapterTimeoutMs < 1) throw new Error('Adapter timeout must be positive');
    this.adapterTimeoutMs = adapterTimeoutMs;
    for (const adapter of adapters) {
      if (this.adapters.has(adapter.source)) {
        throw new Error(`Duplicate data adapter for source: ${adapter.source}`);
      }
      this.adapters.set(adapter.source, adapter);
    }
  }

  listSources(): SourceDescription[] {
    return Array.from(this.adapters.values()).map(adapter => ({
      source: adapter.source,
      provider: adapter.provider,
      entity_types: [...adapter.entityTypes],
    }));
  }

  async search(query: string, options: GatewaySearchOptions = {}): Promise<SearchResponse> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) throw new DataGatewayError('invalid_request', 'Search query must not be empty', 400);
    if (normalizedQuery.length > MAX_SEARCH_QUERY_LENGTH) throw new DataGatewayError('invalid_request', 'Search query is too long', 400);

    const limit = options.limit ?? DEFAULT_SEARCH_LIMIT;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_SEARCH_LIMIT) {
      throw new DataGatewayError('invalid_request', `Search limit must be an integer between 1 and ${MAX_SEARCH_LIMIT}`, 400);
    }
    this.validateEntityTypes(options.entity_types);
    const adapters = this.selectAdapters(options.sources);
    const settled = await Promise.allSettled(
      adapters.map(adapter => this.withTimeout(adapter.search(normalizedQuery, {
        entity_types: options.entity_types,
        limit,
      }))),
    );
    const data: SearchResult[] = [];
    const warnings: string[] = [];

    settled.forEach((result, index) => {
      const source = adapters[index].source;
      if (result.status === 'rejected') {
        warnings.push(`${source}: unavailable`);
      } else {
        data.push(...result.value.data);
        warnings.push(...result.value.warnings.map(warning => `${source}: ${warning}`));
      }
    });

    return {
      schema_version: DATA_GATEWAY_SCHEMA_VERSION,
      data: data.slice(0, limit),
      meta: {
        as_of: this.now().toISOString(),
        partial: warnings.length > 0,
        warnings,
      },
    };
  }

  async getEntity(source: DataSource, locator: EntityLocator): Promise<EntityResponse | null> {
    const adapter = this.adapters.get(source);
    if (!adapter) throw new DataGatewayError('invalid_request', `Unsupported data source: ${source}`, 400);
    if (!adapter.entityTypes.includes(locator.entity_type)) {
      throw new DataGatewayError('invalid_request', `Unsupported entity type for ${source}: ${locator.entity_type}`, 400);
    }
    const result = await this.withTimeout(adapter.getEntity(locator));
    if (!result) return null;

    return {
      schema_version: DATA_GATEWAY_SCHEMA_VERSION,
      data: result.data,
      meta: {
        as_of: result.as_of,
        provider: result.provider,
        data_quality: result.data_quality,
        warnings: result.warnings,
      },
    };
  }

  async getMetrics(source: DataSource, locator: EntityLocator): Promise<MetricsResponse | null> {
    const adapter = this.adapters.get(source);
    if (!adapter) throw new DataGatewayError('invalid_request', `Unsupported data source: ${source}`, 400);
    if (!adapter.entityTypes.includes(locator.entity_type)) {
      throw new DataGatewayError('invalid_request', `Unsupported entity type for ${source}: ${locator.entity_type}`, 400);
    }
    const result = await this.withTimeout(adapter.getMetrics(locator));
    if (!result) return null;

    return {
      schema_version: DATA_GATEWAY_SCHEMA_VERSION,
      data: result.data,
      meta: {
        as_of: result.as_of,
        provider: result.provider,
        data_quality: result.data_quality,
        warnings: result.warnings,
      },
    };
  }

  private selectAdapters(sources?: DataSource[]): DataAdapter[] {
    if (!sources || sources.length === 0) return Array.from(this.adapters.values());
    sources.forEach(source => {
      if (!DATA_SOURCES.includes(source)) throw new DataGatewayError('invalid_request', `Unsupported data source: ${source}`, 400);
    });
    return Array.from(new Set(sources)).map(source => {
      const adapter = this.adapters.get(source);
      if (!adapter) throw new DataGatewayError('invalid_request', `Unsupported data source: ${source}`, 400);
      return adapter;
    });
  }

  private validateEntityTypes(entityTypes?: EntityType[]): void {
    entityTypes?.forEach(entityType => {
      if (!ENTITY_TYPES.includes(entityType)) throw new DataGatewayError('invalid_request', `Unsupported entity type: ${entityType}`, 400);
    });
  }

  private async withTimeout<T>(operation: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new DataGatewayError('service_unavailable', 'Data source timed out', 503)), this.adapterTimeoutMs);
      operation.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
    });
  }
}
