CREATE DATABASE IF NOT EXISTS huggingface_scrapy;
CREATE DATABASE IF NOT EXISTS opensource;

CREATE TABLE huggingface_scrapy.model_repos (
  id String, _id String, author LowCardinality(String), lastModified DateTime64(3, 'UTC'), createdAt DateTime64(3, 'UTC'),
  private UInt8, gated UInt8, disabled UInt8, pipeline_tag LowCardinality(String), library_name LowCardinality(String),
  tags Array(LowCardinality(String)), downloads Nullable(UInt64), likes Nullable(UInt64), downloadsAllTime Nullable(UInt64)
) ENGINE = ReplacingMergeTree(lastModified) ORDER BY (id, _id);

CREATE TABLE huggingface_scrapy.dataset_repos (
  id String, _id String, author LowCardinality(String), lastModified DateTime64(3, 'UTC'), createdAt DateTime64(3, 'UTC'),
  private UInt8, gated UInt8, disabled UInt8, tags Array(LowCardinality(String)), citation Nullable(String), description String,
  downloads Nullable(UInt64), likes Nullable(UInt64), downloadsAllTime Nullable(UInt64)
) ENGINE = ReplacingMergeTree(lastModified) ORDER BY (id, _id);

CREATE TABLE huggingface_scrapy.dllk_history (
  id String, _id String, download_count UInt32, like_count UInt32, crawl_time DateTime64(3, 'UTC')
) ENGINE = MergeTree ORDER BY (_id, crawl_time);

INSERT INTO huggingface_scrapy.model_repos VALUES
('Qwen/模型', 'model-public', 'Qwen', '2026-07-20 00:00:00.000', '2026-01-01 00:00:00.000', 0, 0, 0, 'text-generation', 'transformers', ['unicode','qwen'], 150, 12, 1200),
('org/private-now', 'model-private', 'org', '2026-06-01 00:00:00.000', '2025-01-01 00:00:00.000', 0, 0, 0, '', '', [], 10, 1, 20),
('org/private-now', 'model-private', 'org', '2026-07-01 00:00:00.000', '2025-01-01 00:00:00.000', 1, 0, 0, '', '', [], 10, 1, 20);

INSERT INTO huggingface_scrapy.dataset_repos VALUES
('org/data', 'dataset-public', 'org', '2026-07-21 00:00:00.000', '2026-02-01 00:00:00.000', 0, 1, 0, ['dataset'], NULL, 'fixture dataset', 30, 4, 90);

INSERT INTO huggingface_scrapy.dllk_history VALUES
('Qwen/模型', 'model-public', 100, 10, '2026-07-19 00:00:00.000'),
('Qwen/模型', 'model-public', 150, 12, '2026-07-21 00:00:00.000'),
('org/data', 'dataset-public', 20, 3, '2026-07-20 00:00:00.000');

CREATE TABLE opensource.name_info (platform LowCardinality(String), id UInt64, name String, openrank Float64, type LowCardinality(String))
ENGINE = MergeTree ORDER BY (id, platform);
CREATE TABLE opensource.repo_info (
  platform LowCardinality(String), id UInt64, status LowCardinality(String), updated_at DateTime,
  description String, default_branch LowCardinality(String), homepage_url String, isFork UInt8,
  primary_language String, license LowCardinality(String), topics Array(String), created_at DateTime
) ENGINE = MergeTree ORDER BY (platform, id, updated_at);
CREATE TABLE opensource.global_openrank (
  platform LowCardinality(String), repo_id UInt64, repo_name String, type LowCardinality(String), created_at DateTime, openrank Float64
) ENGINE = MergeTree ORDER BY (repo_id, platform, created_at);
INSERT INTO opensource.name_info VALUES ('GitHub', 42, 'X-lab2017/open-digger', 100, 'Repo');
INSERT INTO opensource.repo_info VALUES ('GitHub', 42, 'normal', '2026-07-01 00:00:00', 'Open source metrics', 'master', '', 0, 'TypeScript', 'Apache-2.0', ['metrics'], '2020-01-01 00:00:00');
INSERT INTO opensource.global_openrank VALUES
('GitHub', 42, 'X-lab2017/open-digger', 'Repo', '2026-06-01 00:00:00', 10),
('GitHub', 42, 'X-lab2017/open-digger', 'Repo', '2026-07-01 00:00:00', 12);
