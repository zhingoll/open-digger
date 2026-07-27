import assert from 'assert';
import fs from 'fs';
import path from 'path';

describe('open-digger-unified-data-access Skill', () => {
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

  it('names exactly the four supported MCP tools', () => {
    const expected = ['list_data_sources', 'search_entities', 'get_entity_profile', 'get_entity_metrics'];
    expected.forEach(tool => assert(skill.includes(`\`${tool}\``), `${tool} missing`));
    assert(!skill.includes('compare_entities'));
  });

  it('contains four replayable scenarios with tool inputs', () => {
    for (const scenario of ['Unified search', 'Hugging Face profile', 'Cross-source metric comparison', 'Partial source failure']) {
      assert(skill.includes(`### ${scenario}`), `${scenario} missing`);
    }
    assert((skill.match(/"arguments"/g) ?? []).length >= 4);
    assert(/"entity_id"\s*:\s*"Qwen\/Qwen3-8B"/.test(skill));
    assert(/"entity_id"\s*:\s*"X-lab2017\/open-digger"/.test(skill));
  });

  it('requires provenance and honest missing/partial-data handling', () => {
    for (const term of ['source', 'as_of', 'data_quality', 'partial', 'warnings']) assert(skill.includes(`\`${term}\``));
    assert(skill.includes('Never invent'));
    assert(skill.includes('unavailable'));
  });

  it('forbids SQL, credentials, and Gateway bypasses', () => {
    assert(skill.includes('Never generate or execute arbitrary SQL'));
    assert(skill.includes('Never request database credentials'));
    assert(skill.includes('Never bypass the Data Gateway'));
  });

  it('has matching UI metadata', () => {
    assert(agent.includes('display_name: "OpenDigger Unified Data Access"'));
    assert(agent.includes('$open-digger-unified-data-access'));
  });
});
