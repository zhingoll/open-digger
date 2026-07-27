import assert from 'assert';
import { createClickHouseExecutor } from '../src/dataGateway/clickHouseExecutor';
import { GitHubAdapter } from '../src/dataGateway/githubAdapter';
import { HuggingFaceAdapter } from '../src/dataGateway/huggingFaceAdapter';

describe('real ClickHouse Data Gateway integration', function () {
  this.timeout(30000);
  const connection = createClickHouseExecutor({ url: 'http://127.0.0.1:18123', username: 'default', password: '' });
  const hf = new HuggingFaceAdapter(connection.query, 'huggingface_scrapy');
  const github = new GitHubAdapter(connection.query, 'opensource');
  after(async () => connection.close());

  it('executes parameterized Unicode HF search against real ClickHouse', async () => {
    const injection = await hf.search("模型' OR 1=1 --", { entity_types: ['model'], limit: 10 });
    assert.strictEqual(injection.data.length, 0);
    const unicode = await hf.search('模型', { entity_types: ['model'], limit: 10 });
    assert.deepStrictEqual(unicode.data.map(item => item.entity_id), ['Qwen/模型']);
  });

  it('executes HF profile and ordered history SQL with real field types', async () => {
    const result = await hf.getEntity({ entity_type: 'model', namespace: 'Qwen', name: '模型' });
    assert(result);
    assert.strictEqual(result.data.metrics['huggingface.downloads'].value, 150);
    assert.deepStrictEqual(result.data.metrics['huggingface.downloads_history'].series?.map(point => point.value), [100, 150]);
  });

  it('filters a repository whose latest version became private', async () => {
    assert.strictEqual(await hf.getEntity({ entity_type: 'model', namespace: 'org', name: 'private-now' }), null);
  });

  it('executes dataset and GitHub adapters against separate schemas', async () => {
    const dataset = await hf.getEntity({ entity_type: 'dataset', namespace: 'org', name: 'data' });
    assert(dataset); assert.strictEqual(dataset.data.attributes.description, 'fixture dataset');
    const repository = await github.getEntity({ entity_type: 'repository', namespace: 'X-lab2017', name: 'open-digger' });
    assert(repository); assert.strictEqual(repository.data.metrics['github.openrank'].value, 12);
  });
});
