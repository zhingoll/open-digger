CREATE DATABASE opensource;

CREATE TABLE opensource.name_info (
  platform LowCardinality(String), id UInt64, name String, openrank Float64, type LowCardinality(String)
) ENGINE = MergeTree ORDER BY (id, platform);

CREATE TABLE opensource.repo_info (
  platform LowCardinality(String), id UInt64, status LowCardinality(String), updated_at DateTime,
  description String, default_branch LowCardinality(String), homepage_url String, isFork UInt8,
  primary_language String, license LowCardinality(String), topics Array(String), created_at DateTime
) ENGINE = MergeTree ORDER BY (platform, id, updated_at);

CREATE TABLE opensource.global_openrank (
  platform LowCardinality(String), repo_id UInt64, repo_name String,
  type LowCardinality(String), created_at DateTime, openrank Float64
) ENGINE = MergeTree ORDER BY (repo_id, platform, created_at);

INSERT INTO opensource.name_info VALUES
('GitHub', 42, 'X-lab2017/open-digger', 100, 'Repo'),
('GitHub', 43, 'unicode/模型', 80, 'Repo'),
('GitHub', 44, 'QwenLM/Qwen-Agent', 70, 'Repo');

INSERT INTO opensource.repo_info VALUES
('GitHub', 42, 'normal', '2026-07-01 00:00:00', 'Open source metrics', 'master', '', 0, 'TypeScript', 'Apache-2.0', ['metrics'], '2020-01-01 00:00:00'),
('GitHub', 43, 'normal', '2026-07-02 00:00:00', 'Unicode repository', 'main', '', 0, 'Python', 'MIT', ['unicode'], '2024-01-01 00:00:00'),
('GitHub', 44, 'normal', '2026-07-03 00:00:00', 'Qwen agent framework', 'main', '', 0, 'Python', 'Apache-2.0', ['qwen'], '2023-01-01 00:00:00');

INSERT INTO opensource.global_openrank VALUES
('GitHub', 42, 'X-lab2017/open-digger', 'Repo', '2026-06-01 00:00:00', 10),
('GitHub', 42, 'X-lab2017/open-digger', 'Repo', '2026-07-01 00:00:00', 12),
('GitHub', 43, 'unicode/模型', 'Repo', '2026-07-01 00:00:00', 8),
('GitHub', 44, 'QwenLM/Qwen-Agent', 'Repo', '2026-07-01 00:00:00', 7);
