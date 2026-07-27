import assert from 'assert';
import { spawn, spawnSync } from 'child_process';
import { once } from 'events';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { performance } from 'perf_hooks';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createClickHouseExecutor } from '../src/dataGateway/clickHouseExecutor';
import { GitHubAdapter } from '../src/dataGateway/githubAdapter';
import { HuggingFaceAdapter } from '../src/dataGateway/huggingFaceAdapter';

interface HttpResult {
  status: number;
  body: any;
  text: string;
}

interface SkillScenario {
  tool: string;
  arguments: Record<string, unknown>;
}

const GITHUB_URL = process.env.DATA_GATEWAY_TEST_GITHUB_URL ?? 'http://127.0.0.1:18123';
const HF_URL = process.env.DATA_GATEWAY_TEST_HF_URL ?? 'http://127.0.0.1:18124';
const GITHUB_PASSWORD = 'opendigger-test-password';
const HF_PASSWORD = 'opengauge-test-password';
const HF_CONNECTION_PASSWORD = process.env.DATA_GATEWAY_TEST_HF_PASSWORD ?? HF_PASSWORD;
const HTTP_PORT = 18125;
const HTTP_BASE = `http://127.0.0.1:${HTTP_PORT}`;
const COMPOSE_FILE = path.resolve('docker-compose.data-gateway.test.yml');
const COMPOSE_PROJECT = 'open-digger-data-gateway-test';
const FORBIDDEN_PUBLIC_MARKERS = [
  'SELECT ', 'opensource', 'huggingface_scrapy', 'DB::Exception',
  '127.0.0.1:18123', '127.0.0.1:18124', 'password=', '\n    at ',
  GITHUB_PASSWORD, HF_PASSWORD,
];

describe('real two-backend Data Gateway system integration', function () {
  this.timeout(180000);

  const githubConnection = createClickHouseExecutor({ url: GITHUB_URL, username: 'default', password: GITHUB_PASSWORD });
  const hfConnection = createClickHouseExecutor({ url: HF_URL, username: 'default', password: HF_CONNECTION_PASSWORD });
  const github = new GitHubAdapter(githubConnection.query, 'opensource');
  const hf = new HuggingFaceAdapter(hfConnection.query, 'huggingface_scrapy');
  const runtimeEnv = {
    ...process.env,
    OPENDIGGER_CLICKHOUSE_URL: GITHUB_URL,
    OPENDIGGER_CLICKHOUSE_USER: 'default',
    OPENDIGGER_CLICKHOUSE_PASSWORD: GITHUB_PASSWORD,
    OPENDIGGER_CLICKHOUSE_DATABASE: 'opensource',
    OPENGAUGE_CLICKHOUSE_URL: HF_URL,
    OPENGAUGE_CLICKHOUSE_USER: 'default',
    OPENGAUGE_CLICKHOUSE_PASSWORD: HF_CONNECTION_PASSWORD,
    OPENGAUGE_CLICKHOUSE_DATABASE: 'huggingface_scrapy',
    DATA_GATEWAY_ADAPTER_TIMEOUT_MS: '1200',
  };

  let httpProcess: ReturnType<typeof spawn>;
  let httpPid = 0;
  let httpLogs = '';
  let mcpClient: Client;
  let mcpTransport: StdioClientTransport;
  let mcpLogs = '';

  before(async () => {
    const serverFile = path.resolve('.data-gateway-test-dist/src/dataGateway/server.js');
    httpProcess = spawn(process.execPath, [serverFile], {
      cwd: process.cwd(),
      env: { ...runtimeEnv, DATA_GATEWAY_HOST: '127.0.0.1', DATA_GATEWAY_PORT: String(HTTP_PORT) },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });
    httpPid = httpProcess.pid ?? 0;
    httpProcess.stdout?.on('data', chunk => { httpLogs += chunk.toString(); });
    httpProcess.stderr?.on('data', chunk => { httpLogs += chunk.toString(); });
    await waitUntil(async () => (await requestJson('/v1/sources')).status === 200, 'HTTP server startup');

    mcpClient = new Client({ name: 'two-backend-system-test', version: '1.0.0' }, { capabilities: {} });
    mcpTransport = new StdioClientTransport({
      command: process.execPath,
      args: [path.resolve('.data-gateway-test-dist/src/dataGateway/mcp/stdio.js')],
      cwd: process.cwd(),
      env: runtimeEnv,
      stderr: 'pipe',
    });
    mcpTransport.stderr?.on('data', chunk => { mcpLogs += chunk.toString(); });
    await mcpClient.connect(mcpTransport);
  });

  after(async () => {
    await mcpClient?.close();
    await stopChild(httpProcess);
    await Promise.all([githubConnection.close(), hfConnection.close()]);
    assertPublic(`${httpLogs}\n${mcpLogs}`);
  });

  it('uses two distinct ClickHouse endpoints with mutually absent databases', async () => {
    assert.notStrictEqual(new URL(GITHUB_URL).port, new URL(HF_URL).port);
    const githubRows = await githubConnection.query<{ count: number }>('SELECT count() AS count FROM opensource.name_info');
    const hfRows = await hfConnection.query<{ count: number }>('SELECT uniqExact(id) AS count FROM huggingface_scrapy.model_repos');
    assert.strictEqual(Number(githubRows[0].count), 3);
    assert.strictEqual(Number(hfRows[0].count), 3);
    await assert.rejects(
      githubConnection.query('SELECT count() FROM huggingface_scrapy.model_repos'),
      /UNKNOWN_DATABASE|does not exist/,
    );
    await assert.rejects(
      hfConnection.query('SELECT count() FROM opensource.name_info'),
      /UNKNOWN_DATABASE|does not exist/,
    );
  });

  it('executes parameterized Unicode and injection searches against the HF backend', async () => {
    const injection = await hf.search("模型' OR 1=1 --", { entity_types: ['model'], limit: 10 });
    assert.strictEqual(injection.data.length, 0);
    const unicode = await hf.search('模型', { entity_types: ['model'], limit: 10 });
    assert.deepStrictEqual(unicode.data.map(item => item.entity_id), ['Qwen/模型']);
  });

  it('returns exact HF model values and ordered histories', async () => {
    for (const name of ['模型', 'Qwen3-8B']) {
      const result = await hf.getEntity({ entity_type: 'model', namespace: 'Qwen', name });
      assert(result);
      assert.strictEqual(result.data.metrics['huggingface.downloads'].value, 150);
      assert.deepStrictEqual(
        result.data.metrics['huggingface.downloads_history'].series?.map(point => point.value),
        [100, 150],
      );
      assert.strictEqual(result.provider, 'opengauge');
      assert.strictEqual(result.as_of, '2026-07-21T00:00:00.000Z');
      assert.deepStrictEqual(result.data_quality, []);
    }
  });

  it('filters the latest private model and returns the dataset fixture', async () => {
    assert.strictEqual(await hf.getEntity({ entity_type: 'model', namespace: 'org', name: 'private-now' }), null);
    const dataset = await hf.getEntity({ entity_type: 'dataset', namespace: 'org', name: 'data' });
    assert(dataset);
    assert.strictEqual(dataset.data.attributes.description, 'fixture dataset');
    assert.strictEqual(dataset.data.metrics['huggingface.downloads'].value, 30);
  });

  it('returns exact GitHub metadata and OpenRank history', async () => {
    const repository = await github.getEntity({ entity_type: 'repository', namespace: 'X-lab2017', name: 'open-digger' });
    assert(repository);
    assert.strictEqual(repository.data.metrics['github.openrank'].value, 12);
    assert.deepStrictEqual(repository.data.metrics['github.openrank'].series?.map(point => point.value), [10, 12]);
    assert.strictEqual(repository.provider, 'opendigger');
    assert.strictEqual(repository.as_of, '2026-07-01T00:00:00.000Z');
    assert.deepStrictEqual(repository.data_quality, []);
  });

  it('serves real HTTP sources, searches, profiles, metrics, privacy, and provenance', async () => {
    const sources = await expectHttp('/v1/sources');
    assert.deepStrictEqual(sources.body.data.map((item: any) => item.source), ['github', 'huggingface']);

    const search = await expectHttp('/v1/search?q=qwen&sources=github,huggingface&limit=10');
    assert.strictEqual(search.body.meta.partial, false);
    assert(search.body.data.some((item: any) => item.source === 'github' && item.entity_id === 'QwenLM/Qwen-Agent'));
    assert(search.body.data.some((item: any) => item.source === 'huggingface' && item.entity_id === 'Qwen/Qwen3-8B'));

    const githubProfile = await expectHttp('/v1/github/repositories/X-lab2017/open-digger');
    assert.strictEqual(githubProfile.body.data.metrics['github.openrank'].value, 12);
    assert.strictEqual(githubProfile.body.meta.provider, 'opendigger');
    assert.strictEqual(githubProfile.body.meta.as_of, '2026-07-01T00:00:00.000Z');
    assert.deepStrictEqual(githubProfile.body.meta.data_quality, []);

    const githubMetrics = await expectHttp('/v1/github/repositories/X-lab2017/open-digger/metrics');
    assert.deepStrictEqual(githubMetrics.body.data['github.openrank'].series.map((point: any) => point.value), [10, 12]);

    const hfProfile = await expectHttp('/v1/huggingface/models/Qwen/Qwen3-8B');
    assert.strictEqual(hfProfile.body.data.metrics['huggingface.downloads'].value, 150);
    assert.deepStrictEqual(hfProfile.body.data.metrics['huggingface.downloads_history'].series.map((point: any) => point.value), [100, 150]);
    assert.strictEqual(hfProfile.body.meta.provider, 'opengauge');
    assert.strictEqual(hfProfile.body.meta.as_of, '2026-07-21T00:00:00.000Z');
    assert.deepStrictEqual(hfProfile.body.meta.data_quality, []);

    const hfMetrics = await expectHttp('/v1/huggingface/models/Qwen/Qwen3-8B/metrics');
    assert.strictEqual(hfMetrics.body.data['huggingface.downloads'].value, 150);

    const dataset = await expectHttp('/v1/huggingface/datasets/org/data');
    assert.strictEqual(dataset.body.data.attributes.description, 'fixture dataset');
    const datasetMetrics = await expectHttp('/v1/huggingface/datasets/org/data/metrics');
    assert.strictEqual(datasetMetrics.body.data['huggingface.downloads'].value, 30);

    const unicode = await expectHttp(`/v1/search?q=${encodeURIComponent('模型')}`);
    assert(unicode.body.data.some((item: any) => item.entity_id === 'Qwen/模型'));
    const privateEntity = await requestJson('/v1/huggingface/models/org/private-now');
    assert.strictEqual(privateEntity.status, 404);
    assertPublic(privateEntity.text);
    assert.strictEqual(httpProcess.exitCode, null);
  });

  it('serves all four MCP tools and replays the healthy Skill scenarios', async () => {
    const tools = await mcpClient.listTools();
    assert.deepStrictEqual(tools.tools.map(tool => tool.name).sort(), [
      'get_entity_metrics', 'get_entity_profile', 'list_data_sources', 'search_entities',
    ]);

    const listed = await callMcp('list_data_sources', {});
    assert.deepStrictEqual(listed.data.map((item: any) => item.source), ['github', 'huggingface']);

    const unified = skillScenarios('Unified search')[0];
    const unifiedResult = await callMcp(unified.tool, unified.arguments);
    assert.strictEqual(unifiedResult.meta.partial, false);
    assert(unifiedResult.data.some((item: any) => item.source === 'github'));
    assert(unifiedResult.data.some((item: any) => item.source === 'huggingface'));

    const profileScenario = skillScenarios('Hugging Face profile')[0];
    const profile = await callMcp(profileScenario.tool, profileScenario.arguments);
    assert.strictEqual(profile.data.entity_id, 'Qwen/Qwen3-8B');
    assert.strictEqual(profile.data.metrics['huggingface.downloads'].value, 150);
    assert.strictEqual(profile.meta.provider, 'opengauge');
    assert.deepStrictEqual(profile.meta.data_quality, []);

    const metricScenarios = skillScenarios('Cross-source metric comparison');
    assert.strictEqual(metricScenarios.length, 2);
    const githubMetrics = await callMcp(metricScenarios[0].tool, metricScenarios[0].arguments);
    const hfMetrics = await callMcp(metricScenarios[1].tool, metricScenarios[1].arguments);
    assert.strictEqual(githubMetrics.data['github.openrank'].value, 12);
    assert.strictEqual(hfMetrics.data['huggingface.downloads'].value, 150);
  });

  it('degrades on HF loss and recovers without restarting HTTP or MCP', async () => {
    const startedAt = performance.now();
    await stopAndRecover(
      'opengauge-clickhouse',
      async () => {
        await assert.rejects(hfConnection.query('SELECT 1'));
        const githubProfile = await expectHttp('/v1/github/repositories/X-lab2017/open-digger');
        assert.strictEqual(githubProfile.body.data.metrics['github.openrank'].value, 12);
        const partial = await expectHttp('/v1/search?q=open-digger&sources=github,huggingface');
        assert.strictEqual(partial.body.meta.partial, true);
        assert(partial.body.data.length > 0 && partial.body.data.every((item: any) => item.source === 'github'));
        assert(partial.body.meta.warnings.some((warning: string) => warning.startsWith('huggingface:')));

        const scenario = skillScenarios('Partial source failure')[0];
        const mcpPartial = await callMcp(scenario.tool, scenario.arguments);
        assert.strictEqual(mcpPartial.meta.partial, true);
        assert(mcpPartial.data.length > 0 && mcpPartial.data.every((item: any) => item.source === 'github'));
        assert(mcpPartial.meta.warnings.some((warning: string) => warning.startsWith('huggingface:')));
      },
      async () => {
        const httpRecovered = await waitForCompleteSearch('open-digger');
        const mcpRecovered = await waitForMcpCompleteSearch('open-digger');
        assert.strictEqual(httpRecovered.meta.partial, false);
        assert.strictEqual(mcpRecovered.meta.partial, false);
      },
    );
    assert.strictEqual(httpProcess.pid, httpPid);
    assert.strictEqual(httpProcess.exitCode, null);
    process.stdout.write(`RECOVERY hf stopped=confirmed http_partial=true mcp_partial=true recovered_ms=${Math.round(performance.now() - startedAt)} gateway_pid=${httpPid}\n`);
  });

  it('degrades on GitHub loss and recovers symmetrically without a Gateway restart', async () => {
    const startedAt = performance.now();
    await stopAndRecover(
      'opendigger-clickhouse',
      async () => {
        await assert.rejects(githubConnection.query('SELECT 1'));
        const hfProfile = await expectHttp('/v1/huggingface/models/Qwen/Qwen3-8B');
        assert.strictEqual(hfProfile.body.data.metrics['huggingface.downloads'].value, 150);
        const partial = await expectHttp('/v1/search?q=qwen&sources=github,huggingface');
        assert.strictEqual(partial.body.meta.partial, true);
        assert(partial.body.data.length > 0 && partial.body.data.every((item: any) => item.source === 'huggingface'));
        assert(partial.body.meta.warnings.some((warning: string) => warning.startsWith('github:')));
        const mcpPartial = await callMcp('search_entities', {
          query: 'qwen', sources: ['github', 'huggingface'], limit: 10,
        });
        assert.strictEqual(mcpPartial.meta.partial, true);
        assert(mcpPartial.data.length > 0 && mcpPartial.data.every((item: any) => item.source === 'huggingface'));
        assert(mcpPartial.meta.warnings.some((warning: string) => warning.startsWith('github:')));
      },
      async () => {
        const httpRecovered = await waitForCompleteSearch('qwen');
        const mcpRecovered = await waitForMcpCompleteSearch('qwen');
        assert.strictEqual(httpRecovered.meta.partial, false);
        assert.strictEqual(mcpRecovered.meta.partial, false);
      },
    );
    assert.strictEqual(httpProcess.pid, httpPid);
    assert.strictEqual(httpProcess.exitCode, null);
    process.stdout.write(`RECOVERY github stopped=confirmed http_partial=true mcp_partial=true recovered_ms=${Math.round(performance.now() - startedAt)} gateway_pid=${httpPid}\n`);
  });

  it('handles 1000 mixed HTTP requests at concurrency 20 with valid responses', async () => {
    const paths = [
      '/v1/sources',
      '/v1/search?q=open-digger&sources=github,huggingface',
      '/v1/search?q=qwen&sources=github,huggingface',
      '/v1/github/repositories/X-lab2017/open-digger',
      '/v1/github/repositories/X-lab2017/open-digger/metrics',
      '/v1/huggingface/models/Qwen/Qwen3-8B',
      '/v1/huggingface/models/Qwen/Qwen3-8B/metrics',
      '/v1/huggingface/datasets/org/data',
      '/v1/huggingface/datasets/org/data/metrics',
      `/v1/search?q=${encodeURIComponent('模型')}`,
    ];
    const latencies: number[] = [];
    const errors: string[] = [];
    let next = 0;
    let success = 0;

    async function worker(): Promise<void> {
      while (true) {
        const index = next++;
        if (index >= 1000) return;
        const startedAt = performance.now();
        try {
          const response = await requestJson(paths[index % paths.length]);
          if (response.status !== 200) throw new Error(`status ${response.status}`);
          if (!response.body || response.body.schema_version !== '1.0' || response.body.data === undefined) {
            throw new Error('invalid response envelope');
          }
          assertPublic(response.text);
          success++;
        } catch (error) {
          errors.push(`${paths[index % paths.length]}: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
          latencies.push(performance.now() - startedAt);
        }
      }
    }

    await Promise.all(Array.from({ length: 20 }, () => worker()));
    latencies.sort((left, right) => left - right);
    const p50 = percentile(latencies, 0.50);
    const p95 = percentile(latencies, 0.95);
    const max = latencies[latencies.length - 1];
    process.stdout.write(`STABILITY requests=1000 concurrency=20 success=${success} errors=${errors.length} p50_ms=${p50.toFixed(1)} p95_ms=${p95.toFixed(1)} max_ms=${max.toFixed(1)} gateway_pid=${httpPid}\n`);
    assert.strictEqual(errors.length, 0, errors.slice(0, 5).join('\n'));
    assert.strictEqual(success, 1000);
    assert.strictEqual(httpProcess.pid, httpPid);
    assert.strictEqual(httpProcess.exitCode, null);
  });

  async function callMcp(tool: string, args: Record<string, unknown>): Promise<any> {
    const result = await mcpClient.callTool({ name: tool, arguments: args });
    assert.strictEqual(result.isError, undefined, JSON.stringify(result));
    const blocks = result.content as { type: string; text?: string }[];
    const text = blocks.find(block => block.type === 'text')?.text;
    assert(text, `MCP tool ${tool} returned no text`);
    assertPublic(text);
    return JSON.parse(text);
  }

  async function stopAndRecover(
    service: string,
    degraded: () => Promise<void>,
    recovered: () => Promise<void>,
  ): Promise<void> {
    compose('stop', service);
    let degradedError: unknown;
    try { await degraded(); } catch (error) { degradedError = error; }
    compose('start', service);
    let recoveryError: unknown;
    try { await recovered(); } catch (error) { recoveryError = error; }
    if (degradedError) throw degradedError;
    if (recoveryError) throw recoveryError;
  }

  async function waitForCompleteSearch(query: string): Promise<any> {
    return waitUntil(async () => {
      const response = await requestJson(`/v1/search?q=${encodeURIComponent(query)}&sources=github,huggingface`);
      return response.status === 200 && response.body.meta?.partial === false ? response.body : false;
    }, `HTTP recovery for ${query}`);
  }

  async function waitForMcpCompleteSearch(query: string): Promise<any> {
    return waitUntil(async () => {
      const result = await callMcp('search_entities', {
        query, sources: ['github', 'huggingface'], limit: 20,
      });
      return result.meta?.partial === false ? result : false;
    }, `MCP recovery for ${query}`);
  }
});

async function expectHttp(route: string): Promise<HttpResult> {
  const response = await requestJson(route);
  assert.strictEqual(response.status, 200, `${route}: ${response.text}`);
  assertPublic(response.text);
  return response;
}

function requestJson(route: string): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const request = http.get(`${HTTP_BASE}${route}`, response => {
      const chunks: Buffer[] = [];
      response.on('data', chunk => chunks.push(Buffer.from(chunk)));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        try {
          resolve({ status: response.statusCode ?? 0, body: JSON.parse(text), text });
        } catch (error) {
          reject(new Error(`Invalid JSON from ${route}: ${error instanceof Error ? error.message : String(error)}`));
        }
      });
    });
    request.setTimeout(5000, () => request.destroy(new Error(`HTTP timeout for ${route}`)));
    request.on('error', reject);
  });
}

async function waitUntil<T>(operation: () => Promise<T | false>, description: string, timeoutMs = 30000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const value = await operation();
      if (value !== false) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw new Error(`${description} timed out${lastError ? `: ${lastError instanceof Error ? lastError.message : String(lastError)}` : ''}`);
}

function compose(...args: string[]): void {
  const result = spawnSync('docker', [
    'compose', '--project-name', COMPOSE_PROJECT, '-f', COMPOSE_FILE, ...args,
  ], { encoding: 'utf8', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`docker compose ${args.join(' ')} failed: ${result.stderr}`);
}

function skillScenarios(heading: string): SkillScenario[] {
  const skill = fs.readFileSync(path.resolve('skills/open-digger-unified-data-access/SKILL.md'), 'utf8');
  const marker = `### ${heading}`;
  const start = skill.indexOf(marker);
  assert(start >= 0, `${marker} missing`);
  const next = skill.indexOf('\n### ', start + marker.length);
  const section = skill.slice(start, next >= 0 ? next : skill.length);
  const scenarios: SkillScenario[] = [];
  const pattern = /```json\r?\n([\s\S]*?)\r?\n```/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(section)) !== null) scenarios.push(JSON.parse(match[1]));
  assert(scenarios.length > 0, `${marker} has no JSON scenario`);
  return scenarios;
}

function assertPublic(value: string): void {
  for (const marker of FORBIDDEN_PUBLIC_MARKERS) {
    assert(!value.includes(marker), `Public output leaked internal marker: ${marker}`);
  }
}

function percentile(sortedValues: number[], quantile: number): number {
  return sortedValues[Math.floor((sortedValues.length - 1) * quantile)];
}

async function stopChild(child: ReturnType<typeof spawn> | undefined): Promise<void> {
  if (!child || child.exitCode !== null) return;
  const gracefulExit = once(child, 'exit');
  child.kill('SIGTERM');
  await Promise.race([gracefulExit, delay(5000)]);
  if (child.exitCode === null) {
    const forcedExit = once(child, 'exit');
    if (process.platform === 'win32' && child.pid) {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        encoding: 'utf8',
        shell: false,
      });
    } else {
      child.kill('SIGKILL');
    }
    await Promise.race([forcedExit, delay(5000)]);
    assert.ok(
      child.exitCode !== null || !isPidAlive(child.pid),
      `Child process ${child.pid ?? 'unknown'} did not exit`,
    );
  }
}

function isPidAlive(pid: number | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}
