import SwaggerParser from '@apidevtools/swagger-parser';
import assert from 'assert';
import fs from 'fs';
import path from 'path';

interface ConnectorScenario {
  method: string;
  path: string;
}

describe('open-digger-unified-data-access no-code Skill', () => {
  const skillDir = path.resolve('skills/open-digger-unified-data-access');
  const skill = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
  const agent = fs.readFileSync(path.join(skillDir, 'agents/openai.yaml'), 'utf8');

  it('has valid minimal frontmatter and no placeholders', () => {
    const match = skill.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    assert(match);
    const keys = match[1].split(/\r?\n/).filter(Boolean).map(line => line.split(':', 1)[0]);
    assert.deepStrictEqual(keys, ['name', 'description']);
    assert(match[1].includes('name: open-digger-unified-data-access'));
    assert(!skill.includes('TODO'));
  });

  it('uses only an OpenAPI-imported OpenShare HTTP Connector', () => {
    assert(skill.includes('OpenShare HTTP Connector'));
    assert(skill.includes('docs/openapi/data-gateway.v1.yaml'));
    assert(skill.includes('native HTTP/OpenAPI Connector support'));
    assert(skill.includes('Do not use MCP or stdio'));
    assert(skill.includes('Do not use curl, Node, Python'));
  });

  it('references credential names without containing a plaintext API key', () => {
    assert(skill.includes('OPENSHARE_DATA_GATEWAY_BASE_URL'));
    assert(skill.includes('OPENSHARE_DATA_GATEWAY_API_KEY'));
    assert(skill.includes('credential names, not credential values'));
    assert(!/Bearer\s+[A-Za-z0-9._~+\/-]{16,}/.test(skill));
  });

  it('contains exactly four replayable user scenarios', () => {
    const headings = ['Discover data sources', 'Unified search', 'Hugging Face profile', 'Cross-source metric comparison'];
    assert.strictEqual((skill.match(/^### /gm) ?? []).length, headings.length);
    for (const heading of headings) assert(skill.includes(`### ${heading}`), `${heading} missing`);
    const requests = scenarios(skill);
    assert.strictEqual(requests.length, 5);
    assert(requests.every(request => request.method === 'GET' && request.path.startsWith('/v1/')));
  });

  it('keeps every documented scenario on an operation in the OpenAPI contract', async () => {
    const api = await SwaggerParser.validate(path.resolve('docs/openapi/data-gateway.v1.yaml')) as any;
    const templates = Object.keys(api.paths);
    for (const scenario of scenarios(skill)) {
      assert(templates.some(template => matchesTemplate(template, scenario.path)), `No OpenAPI operation for ${scenario.path}`);
    }
  });

  it('requires provenance and honest missing or partial-data handling', () => {
    for (const term of ['source', 'as_of', 'provider', 'data_quality', 'partial', 'warnings']) assert(skill.includes(`\`${term}\``));
    assert(skill.includes('Never invent'));
    assert(skill.includes('unavailable source'));
    assert(skill.includes('Retry-After'));
  });

  it('forbids database access, arbitrary SQL, raw keys, and policy bypasses', () => {
    assert(skill.includes('Do not connect to ClickHouse'));
    assert(skill.includes('Do not generate or execute arbitrary SQL'));
    assert(skill.includes('do not request the raw key'));
    assert(skill.includes('Do not bypass validation'));
  });

  it('contains no executable helper files and has matching UI metadata', () => {
    const files = listFiles(skillDir).map(file => path.relative(skillDir, file).replace(/\\/g, '/')).sort();
    assert.deepStrictEqual(files, ['SKILL.md', 'agents/openai.yaml']);
    assert(agent.includes('display_name: "OpenDigger Unified Data Access"'));
    assert(agent.includes('OpenShare HTTP Connector'));
    assert(agent.includes('$open-digger-unified-data-access'));
  });
});

function scenarios(skill: string): ConnectorScenario[] {
  return Array.from(skill.matchAll(/```json\r?\n([\s\S]*?)\r?\n```/g), match => JSON.parse(match[1]) as ConnectorScenario);
}

function matchesTemplate(template: string, requestPath: string): boolean {
  const pathname = new URL(requestPath, 'http://connector.test').pathname;
  const pattern = template
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\\\{[^/]+\\\}/g, '[^/]+');
  return new RegExp(`^${pattern}$`).test(pathname);
}

function listFiles(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(root, entry.name);
    return entry.isDirectory() ? listFiles(target) : [target];
  });
}
