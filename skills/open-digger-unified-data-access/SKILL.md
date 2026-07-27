---
name: open-digger-unified-data-access
description: Query and compare unified GitHub repository and Hugging Face model or dataset data through the OpenDigger Data Gateway MCP. Use for cross-source search, entity profiles, current or historical metrics, provenance checks, data-quality interpretation, and partial-source failure handling.
---

# OpenDigger Unified Data Access

Use only the Data Gateway MCP tools. Treat their responses as source records, not as permission to infer missing facts.

## Workflow

1. Call `list_data_sources` when availability or supported entity types are unknown.
2. Call `search_entities` to resolve an entity ID. Narrow `sources` or `entity_types` when the request is source-specific.
3. Call `get_entity_profile` for attributes plus metrics, or `get_entity_metrics` when only metrics are needed.
4. Report each record's `source`, `as_of`, and `data_quality`. For search, also inspect `partial` and `warnings`.
5. Compare values only when their definitions and units are compatible. Keep GitHub `github.*` and Hugging Face `huggingface.*` metrics visibly attributed.

## Tool inputs

- `list_data_sources`: no arguments.
- `search_entities`: `query`; optional `sources`, `entity_types`, and integer `limit` from 1 through 100.
- `get_entity_profile`: `source`, `entity_type`, and `entity_id` in `namespace/name` form.
- `get_entity_metrics`: the same locator fields as the profile tool.

Supported source/type pairs are GitHub `repository`, and Hugging Face `model` or `dataset`. Do not substitute account or organization queries unless `list_data_sources` explicitly reports support.

## Interpretation rules

- Preserve timestamps. Do not present records with different `as_of` values as simultaneous observations without saying so.
- Explain every `data_quality` flag relevant to the answer.
- If `partial` is true, use the successful results and name unavailable sources from `warnings`.
- Never invent missing attributes, metrics, history points, entities, or source results. Say that the value is unavailable.
- Do not turn Hugging Face downloads and GitHub OpenRank into a composite score. They measure different things.

## Guardrails

- Never generate or execute arbitrary SQL.
- Never request database credentials.
- Never bypass the Data Gateway, call ClickHouse directly, or expose internal table names.
- Never retry around Gateway validation or private-entity filtering.
- Return the sanitized tool error when a request fails; do not speculate about internal connection details.

## Replayable scenarios

### Unified search

Search both sources and report `partial` and `warnings` with the results.

```json
{"tool":"search_entities","arguments":{"query":"qwen","sources":["github","huggingface"],"limit":10}}
```

### Hugging Face profile

Fetch the profile, retain provenance and quality flags, and state unavailable fields honestly.

```json
{"tool":"get_entity_profile","arguments":{"source":"huggingface","entity_type":"model","entity_id":"Qwen/Qwen3-8B"}}
```

### Cross-source metric comparison

Fetch each entity independently. Compare definitions, units, `as_of`, and `data_quality`; do not merge the metrics.

```json
{"tool":"get_entity_metrics","arguments":{"source":"github","entity_type":"repository","entity_id":"X-lab2017/open-digger"}}
```

```json
{"tool":"get_entity_metrics","arguments":{"source":"huggingface","entity_type":"model","entity_id":"Qwen/Qwen3-8B"}}
```

### Partial source failure

Run the unified search. If one source fails, answer from successful data while explicitly naming the unavailable source and warning.

```json
{"tool":"search_entities","arguments":{"query":"open source metrics","sources":["github","huggingface"],"limit":20}}
```
