import { DataAdapter } from './adapter';
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

  constructor(adapters: DataAdapter[], now: () => Date = () => new Date()) {
    this.now = now;
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
    if (!normalizedQuery) throw new Error('Search query must not be empty');
    if (normalizedQuery.length > MAX_SEARCH_QUERY_LENGTH) throw new Error('Search query is too long');

    const limit = options.limit ?? DEFAULT_SEARCH_LIMIT;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_SEARCH_LIMIT) {
      throw new Error(`Search limit must be an integer between 1 and ${MAX_SEARCH_LIMIT}`);
    }
    this.validateEntityTypes(options.entity_types);
    const adapters = this.selectAdapters(options.sources);
    const settled = await Promise.allSettled(
      adapters.map(adapter => adapter.search(normalizedQuery, {
        entity_types: options.entity_types,
        limit,
      })),
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
    if (!adapter) throw new Error(`Unsupported data source: ${source}`);
    if (!adapter.entityTypes.includes(locator.entity_type)) {
      throw new Error(`Unsupported entity type for ${source}: ${locator.entity_type}`);
    }
    const result = await adapter.getEntity(locator);
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
    if (!adapter) throw new Error(`Unsupported data source: ${source}`);
    if (!adapter.entityTypes.includes(locator.entity_type)) {
      throw new Error(`Unsupported entity type for ${source}: ${locator.entity_type}`);
    }
    const result = await adapter.getMetrics(locator);
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
      if (!DATA_SOURCES.includes(source)) throw new Error(`Unsupported data source: ${source}`);
    });
    return Array.from(new Set(sources)).map(source => {
      const adapter = this.adapters.get(source);
      if (!adapter) throw new Error(`Unsupported data source: ${source}`);
      return adapter;
    });
  }

  private validateEntityTypes(entityTypes?: EntityType[]): void {
    entityTypes?.forEach(entityType => {
      if (!ENTITY_TYPES.includes(entityType)) throw new Error(`Unsupported entity type: ${entityType}`);
    });
  }
}
