# OpenDigger Data Gateway v1

The Data Gateway is one read-only application boundary for OpenDigger GitHub data and OpenGauge Hugging Face data. It queries the two existing ClickHouse databases independently and combines results in memory. It does not migrate data, create a third production database, or perform cross-database joins.

## Public contract

All entity and metric responses use `schema_version: "1.0"`. Entity records carry `source`, `entity_type`, `entity_id`, `source_url`, attributes, and namespaced metrics. Metadata carries `as_of`, `provider`, `data_quality`, and `warnings`. Search metadata additionally reports `partial`; callers must inspect it before treating a cross-source result as complete.

Every `/v1/*` request requires `Authorization: Bearer <API key>`. Missing, malformed, and invalid credentials return a sanitized `401`. Limits are isolated by verified key; a `429` response includes `Retry-After`. Keep API keys in the AI client's Secret or Credential facility—never in a Skill, prompt, source file, or OpenAPI document.

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
DATA_GATEWAY_API_KEYS              comma-separated active keys; each key is 32-512 characters
DATA_GATEWAY_RATE_LIMIT_MAX_REQUESTS optional, default 120
DATA_GATEWAY_RATE_LIMIT_WINDOW_MS  optional, default 60000
```

The service refuses to start without a valid API-key configuration. It stores only SHA-256 key digests and uses constant-time comparisons. Structured audit records contain only request ID, key fingerprint, method, normalized route template, status, and duration; query text, entity IDs, raw keys, SQL, database addresses, credentials, and stacks are excluded.

Start the HTTP service with `npm run start:data-gateway`. Errors returned to clients are stable and sanitized; SQL, credentials, connection addresses, and stack traces are never included.

## OpenAPI connector

The OpenAPI 3.1 contract is `docs/openapi/data-gateway.v1.yaml`. Its server uses a configurable `gatewayBaseUrl` variable rather than a made-up production domain. A compatible AI client can use it without installing this repository or gaining database access:

1. Obtain an API key from the authorized OpenShare key-distribution flow. This Gateway does not implement or invent that external flow.
2. Save the Gateway base URL and API key in the client's Secret or Credential facility.
3. Import `docs/openapi/data-gateway.v1.yaml` as an HTTP/OpenAPI Connector and bind `bearerAuth` to the saved credential.
4. Install the companion Skill and ask for source discovery, search, profiles, or metrics.

Connector compatibility depends on the AI client. The contract does not claim that every Agent product supports OpenAPI connectors.

## No-code Skill

The companion `skills/open-digger-unified-data-access` Skill contains no scripts and requires no repository installation. It directs compatible AI clients to the OpenShare HTTP Connector imported from the OpenAPI contract. The Skill preserves source attribution, `as_of`, quality flags, and partial-failure warnings; it never stores a credential value or grants database access.

## Verification

Run unit, authenticated HTTP E2E, OpenAPI contract, and no-code Skill checks with:

```text
npm run test:data-gateway
```

Run the real ClickHouse suite with:

```text
npm run test:data-gateway:clickhouse
```

After securely injecting both sets of API-specific read-only ClickHouse variables plus `DATA_GATEWAY_TEST_API_KEY`, verify the two existing data services through a temporary authenticated HTTP server with:

```text
npm run test:data-gateway:real
```

The real-data command checks sources, source-specific searches, profiles, metrics, unauthorized access, and response/audit redaction. It never prints environment values. Missing configuration, network failure, empty required search results, or a redaction failure produces a non-zero exit with sanitized output; it does not fall back to fixtures.

The system runner starts two pinned, physically separate ClickHouse containers: OpenDigger on `127.0.0.1:18123` and OpenGauge on `127.0.0.1:18124`. Each container contains only its own database and boundary fixtures. The suite then starts the compiled authenticated HTTP server, replays all four scenarios documented by the companion Skill, stops and restarts each database independently, and verifies recovery without restarting the Gateway process.

The same command also sends 1,000 mixed HTTP requests with 20 concurrent workers and reports success/error counts plus p50, p95, and maximum latency. Test output includes recovery timing and the stable Gateway PID. Cleanup always runs `docker compose down -v` and reports remaining project containers, networks, and volumes; all three counts must be zero.

To confirm that physical isolation is enforced, point the Hugging Face test connection at the OpenDigger endpoint while using that endpoint's test password. The suite must fail because both configured ports are equal and the Hugging Face database is absent:

```powershell
$env:DATA_GATEWAY_TEST_HF_URL='http://127.0.0.1:18123'
$env:DATA_GATEWAY_TEST_HF_PASSWORD='opendigger-test-password'
npm run test:data-gateway:clickhouse
```

Run the normal command in a fresh shell (or remove both environment overrides) to restore the valid configuration. All fixtures and credentials in this compose project are synthetic and must never be reused for production.
