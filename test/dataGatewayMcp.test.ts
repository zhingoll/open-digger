import assert from 'assert';
import path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

describe('Data Gateway MCP process E2E', function () {
  this.timeout(15000);
  let client: Client;
  let transport: StdioClientTransport;

  beforeEach(async () => {
    client = new Client({ name: 'data-gateway-test-client', version: '1.0.0' }, { capabilities: {} });
    transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.resolve('.data-gateway-test-dist/test/fixtures/dataGateway/mcpFixtureServer.js')],
      cwd: process.cwd(),
      stderr: 'pipe',
    });
    await client.connect(transport);
  });
  afterEach(async () => client.close());

  it('initializes and lists exactly four public Gateway tools', async () => {
    const result = await client.listTools();
    assert.deepStrictEqual(result.tools.map(tool => tool.name).sort(), [
      'get_entity_metrics', 'get_entity_profile', 'list_data_sources', 'search_entities',
    ]);
  });

  it('calls all four tools over stdio', async () => {
    const sources = await client.callTool({ name: 'list_data_sources', arguments: {} });
    assert.strictEqual(sources.isError, undefined);
    const search = await client.callTool({ name: 'search_entities', arguments: { query: 'qwen', limit: 2 } });
    assert.strictEqual(search.isError, undefined);
    assert.strictEqual(parsed(search).data.length, 2);
    const profile = await client.callTool({ name: 'get_entity_profile', arguments: {
      source: 'huggingface', entity_type: 'model', entity_id: 'Qwen/Qwen3-8B',
    } });
    assert.strictEqual(parsed(profile).data.entity_id, 'Qwen/Qwen3-8B');
    const metrics = await client.callTool({ name: 'get_entity_metrics', arguments: {
      source: 'github', entity_type: 'repository', entity_id: 'X-lab2017/open-digger',
    } });
    assert.strictEqual(parsed(metrics).data['github.openrank'].value, 12);
  });

  it('rejects invalid tool parameters through the MCP protocol', async () => {
    const result = await client.callTool({ name: 'get_entity_profile', arguments: {
      source: 'gitlab', entity_type: 'repository', entity_id: 'org/repo',
    } });
    assert.strictEqual(result.isError, true);
  });

  it('returns partial results after a source failure or timeout', async () => {
    for (const query of ['partial', 'timeout']) {
      const result = await client.callTool({ name: 'search_entities', arguments: { query } });
      assert.strictEqual(result.isError, undefined);
      assert.strictEqual(parsed(result).meta.partial, true);
      assert.deepStrictEqual(parsed(result).data.map((item: { source: string }) => item.source), ['huggingface']);
    }
  });

  it('redacts SQL, credentials, and connection details from tool errors', async () => {
    const result = await client.callTool({ name: 'get_entity_profile', arguments: {
      source: 'huggingface', entity_type: 'model', entity_id: 'org/secret',
    } });
    assert.strictEqual(result.isError, true);
    const serialized = JSON.stringify(result);
    assert(!serialized.includes('SELECT'));
    assert(!serialized.includes('10.0.0.8'));
    assert(!serialized.includes('password'));
  });
});

function parsed(result: any): any {
  const blocks = result.content as { type: string; text?: string }[];
  const text = blocks.find(block => block.type === 'text')?.text;
  assert(text); return JSON.parse(text);
}
