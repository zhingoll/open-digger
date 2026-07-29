---
name: open-digger-unified-data-access
description: Query unified GitHub repository and Hugging Face model or dataset data through an OpenShare HTTP Connector imported from the OpenDigger Data Gateway OpenAPI contract. Use for source discovery, search, profiles, metrics, provenance, data-quality interpretation, and partial-source handling.
---

# OpenDigger Unified Data Access

Use only the OpenShare HTTP Connector imported from `docs/openapi/data-gateway.v1.yaml`. This is a no-code workflow: the user does not install this repository, run scripts, or receive database access.

## Required client configuration

The client administrator must configure the Connector before this Skill is used:

- Store the deployed Gateway base URL in the client credential named `OPENSHARE_DATA_GATEWAY_BASE_URL`.
- Store the API key in the client Secret or Credential named `OPENSHARE_DATA_GATEWAY_API_KEY` and bind it to the OpenAPI `bearerAuth` scheme.
- Import the OpenAPI contract and expose its eight read-only GET operations through the Connector.

These are credential names, not credential values. Never ask the user to paste a key into a prompt, never place a key in this Skill, and never echo an authorization header.

## Operation selection

1. Use `GET /v1/sources` to discover available sources and supported entity types.
2. Use `GET /v1/search` to resolve an entity ID. Narrow `sources` and `entity_types` when the request is source-specific.
3. Use the GitHub repository or Hugging Face model/dataset profile route for attributes plus metrics.
4. Use the corresponding `/metrics` route when only metrics or history is needed.

Supported pairs are GitHub `repository`, and Hugging Face `model` or `dataset`. Do not invent account, organization, or unsupported-source operations.

## Interpretation rules

- Preserve `source`, `as_of`, `provider`, and every `data_quality` flag.
- For search, always inspect `partial` and `warnings`. If `partial` is true, use successful records but name each unavailable source reported by `warnings`.
- Never invent missing attributes, entities, metrics, history points, timestamps, or source results.
- Compare values only when definitions and units are compatible. Never combine GitHub OpenRank and Hugging Face downloads into one score.
- A `401` means the client credential binding must be repaired; do not request the raw key.
- A `429` means wait for the `Retry-After` interval before retrying.

## Guardrails

- Do not use MCP or stdio.
- Do not use curl, Node, Python, or any other script to bypass the Connector.
- Do not connect to ClickHouse or request database credentials.
- Do not generate or execute arbitrary SQL.
- Do not bypass validation, private-entity filtering, rate limits, or sanitized errors.
- Do not claim compatibility with every AI Agent; this workflow requires a client with native HTTP/OpenAPI Connector support.

## Replayable scenarios

The JSON blocks describe Connector requests, not executable scripts. The Connector supplies the configured base URL and credential.

### Discover data sources

List available sources before answering a question with an uncertain source or entity type.

```json
{"method":"GET","path":"/v1/sources"}
```

### Unified search

Search both sources. Report `partial` and `warnings`; the same request must remain useful if either source is temporarily unavailable.

```json
{"method":"GET","path":"/v1/search?q=qwen&sources=github,huggingface&limit=10"}
```

### Hugging Face profile

Fetch the profile and retain provenance, timestamp, and quality flags. State unavailable fields honestly.

```json
{"method":"GET","path":"/v1/huggingface/models/Qwen/Qwen3-8B"}
```

### Cross-source metric comparison

Fetch the two entities independently. Compare definitions, units, `as_of`, and `data_quality`; do not merge the metrics.

```json
{"method":"GET","path":"/v1/github/repositories/X-lab2017/open-digger/metrics"}
```

```json
{"method":"GET","path":"/v1/huggingface/models/Qwen/Qwen3-8B/metrics"}
```
