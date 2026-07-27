import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DataGatewayError, publicError } from '../errors';
import { DataGateway } from '../gateway';
import { EntityLocator, EntityType } from '../types';

const sourceSchema = z.enum(['github', 'huggingface']);
const entityTypeSchema = z.enum(['repository', 'model', 'dataset', 'account', 'organization']);

export function createDataGatewayMcpServer(gateway: DataGateway): McpServer {
  const server = new McpServer({ name: 'open-digger-data-gateway', version: '1.0.0' });
  const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

  server.registerTool('list_data_sources', {
    description: 'List GitHub and Hugging Face sources available through the OpenDigger Data Gateway.',
    annotations: readOnly,
  }, async () => success({ schema_version: '1.0', data: gateway.listSources() }));

  server.registerTool('search_entities', {
    description: 'Search GitHub repositories and Hugging Face models or datasets through the unified Gateway.',
    inputSchema: {
      query: z.string().min(1).max(256),
      sources: z.array(sourceSchema).min(1).optional(),
      entity_types: z.array(entityTypeSchema).min(1).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    }, annotations: readOnly,
  }, async ({ query, sources, entity_types, limit }) => safely(async () => {
    const result = await gateway.search(query, { sources, entity_types, limit });
    if (result.meta.partial && result.data.length === 0) {
      throw new DataGatewayError('service_unavailable', 'All requested data sources are unavailable', 503);
    }
    return result;
  }));

  const entityInput = {
    source: sourceSchema,
    entity_type: entityTypeSchema,
    entity_id: z.string().min(3).max(513).regex(/^[^/]+\/[^/]+$/, 'entity_id must be namespace/name'),
  };
  server.registerTool('get_entity_profile', {
    description: 'Get a unified entity profile, provenance, as_of timestamp, quality flags, and metrics.',
    inputSchema: entityInput, annotations: readOnly,
  }, async input => safely(async () => {
    const result = await gateway.getEntity(input.source, locator(input.entity_type, input.entity_id));
    if (!result) throw new DataGatewayError('not_found', 'Entity not found', 404);
    return result;
  }));

  server.registerTool('get_entity_metrics', {
    description: 'Get current and historical metrics for a GitHub or Hugging Face entity through the Gateway.',
    inputSchema: entityInput, annotations: readOnly,
  }, async input => safely(async () => {
    const result = await gateway.getMetrics(input.source, locator(input.entity_type, input.entity_id));
    if (!result) throw new DataGatewayError('not_found', 'Entity not found', 404);
    return result;
  }));
  return server;
}

function locator(entityType: EntityType, entityId: string): EntityLocator {
  const slash = entityId.indexOf('/');
  return { entity_type: entityType, namespace: entityId.slice(0, slash), name: entityId.slice(slash + 1) };
}

function success(value: unknown): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

async function safely(operation: () => Promise<unknown>): Promise<{ content: { type: 'text'; text: string }[]; isError?: boolean }> {
  try { return success(await operation()); }
  catch (error) {
    const result = publicError(error);
    return { ...success(result.body), isError: true };
  }
}
