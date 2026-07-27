# OpenDigger Data Gateway v1

The Data Gateway is one read-only application boundary for OpenDigger GitHub data and OpenGauge Hugging Face data. It queries the two existing ClickHouse databases independently and combines results in memory. It does not migrate data, create a third production database, or perform cross-database joins.

## Public contract

All entity and metric responses use `schema_version: "1.0"`. Entity records carry `source`, `entity_type`, `entity_id`, `source_url`, attributes, and namespaced metrics. Metadata carries `as_of`, `provider`, `data_quality`, and `warnings`. Search metadata additionally reports `partial`; callers must inspect it before treating a cross-source result as complete.

HTTP endpoints:

- `GET /v1/sources`
- `GET /v1/search?q=...&sources=github,huggingface&entity_types=repository,model,dataset&limit=20`
- `GET /v1/github/repositories/{owner}/{repo}` and `/metrics`
- `GET /v1/huggingface/models/{namespace}/{name}` and `/metrics`
- `GET /v1/huggingface/datasets/{namespace}/{name}` and `/metrics`

Search limits are integers from 1 through 100. Search text is limited to 256 characters. All ClickHouse values are supplied through query parameters; database identifiers come only from validated environment configuration. Private Hugging Face entities are excluded according to their latest record.

## Configuration

Use API-specific read-only ClickHouse accounts. Do not use crawler write credentials.

```text
OPENDIGGER_CLICKHOUSE_URL
OPENDIGGER_CLICKHOUSE_USER
OPENDIGGER_CLICKHOUSE_PASSWORD
OPENDIGGER_CLICKHOUSE_DATABASE
OPENGAUGE_CLICKHOUSE_URL
OPENGAUGE_CLICKHOUSE_USER
OPENGAUGE_CLICKHOUSE_PASSWORD
OPENGAUGE_CLICKHOUSE_DATABASE
DATA_GATEWAY_ADAPTER_TIMEOUT_MS    optional, default 5000
DATA_GATEWAY_HOST                  optional, default 127.0.0.1
DATA_GATEWAY_PORT                  optional, default 3000
```

Start the HTTP service with `npm run start:data-gateway`. Errors returned to clients are stable and sanitized; SQL, credentials, connection addresses, and stack traces are never included.

## MCP

Start the stdio MCP service with `npm run start:data-gateway:mcp`. It exposes exactly four read-only tools and calls the same `DataGateway` methods as HTTP:

- `list_data_sources`
- `search_entities`
- `get_entity_profile`
- `get_entity_metrics`

The companion Skill is `skills/open-digger-unified-data-access`. It requires callers to preserve source attribution, `as_of`, quality flags, and partial-failure warnings.

## Verification

Run unit, HTTP E2E, MCP process E2E, and Skill checks with:

```text
npm run test:data-gateway
```

Run the real ClickHouse suite with:

```text
npm run test:data-gateway:clickhouse
```

The system runner starts two pinned, physically separate ClickHouse containers: OpenDigger on `127.0.0.1:18123` and OpenGauge on `127.0.0.1:18124`. Each container contains only its own database and boundary fixtures. The suite then starts the compiled HTTP server and a real stdio MCP client, exercises all four MCP tools and the four scenarios documented by the companion Skill, stops and restarts each database independently, and verifies recovery without restarting the Gateway processes.

The same command also sends 1,000 mixed HTTP requests with 20 concurrent workers and reports success/error counts plus p50, p95, and maximum latency. Test output includes recovery timing and the stable Gateway PID. Cleanup always runs `docker compose down -v` and reports remaining project containers, networks, and volumes; all three counts must be zero.

To confirm that physical isolation is enforced, point the Hugging Face test connection at the OpenDigger endpoint while using that endpoint's test password. The suite must fail because both configured ports are equal and the Hugging Face database is absent:

```powershell
$env:DATA_GATEWAY_TEST_HF_URL='http://127.0.0.1:18123'
$env:DATA_GATEWAY_TEST_HF_PASSWORD='opendigger-test-password'
npm run test:data-gateway:clickhouse
```

Run the normal command in a fresh shell (or remove both environment overrides) to restore the valid configuration. All fixtures and credentials in this compose project are synthetic and must never be reused for production.
