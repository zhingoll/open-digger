CREATE DATABASE huggingface_scrapy;

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
('Qwen/模型', 'model-unicode', 'Qwen', '2026-07-20 00:00:00.000', '2026-01-01 00:00:00.000', 0, 0, 0, 'text-generation', 'transformers', ['unicode','qwen'], 150, 12, 1200),
('Qwen/Qwen3-8B', 'model-qwen3', 'Qwen', '2026-07-20 00:00:00.000', '2026-01-01 00:00:00.000', 0, 0, 0, 'text-generation', 'transformers', ['qwen','text-generation'], 150, 12, 1200),
('org/private-now', 'model-private', 'org', '2026-06-01 00:00:00.000', '2025-01-01 00:00:00.000', 0, 0, 0, '', '', [], 10, 1, 20),
('org/private-now', 'model-private', 'org', '2026-07-01 00:00:00.000', '2025-01-01 00:00:00.000', 1, 0, 0, '', '', [], 10, 1, 20);

INSERT INTO huggingface_scrapy.dataset_repos VALUES
('org/data', 'dataset-public', 'org', '2026-07-21 00:00:00.000', '2026-02-01 00:00:00.000', 0, 1, 0, ['dataset'], NULL, 'fixture dataset', 30, 4, 90);

INSERT INTO huggingface_scrapy.dllk_history VALUES
('Qwen/模型', 'model-unicode', 100, 10, '2026-07-19 00:00:00.000'),
('Qwen/模型', 'model-unicode', 150, 12, '2026-07-21 00:00:00.000'),
('Qwen/Qwen3-8B', 'model-qwen3', 100, 10, '2026-07-19 00:00:00.000'),
('Qwen/Qwen3-8B', 'model-qwen3', 150, 12, '2026-07-21 00:00:00.000'),
('org/data', 'dataset-public', 20, 3, '2026-07-20 00:00:00.000');
