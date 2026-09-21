# SchemaGuard v0.3 — Quick Start

## 1. Start development mode

```bash
npm install
npm run build
npm test
npm run dev
```

Open the local n8n instance printed by the dev command.

## 2. Minimal workflow

```text
Webhook → Extract Body → SchemaGuard → IF / destination
```

## 3. Recommended first settings

- Operation: `Protect Workflow`
- Baseline Strategy: `Learn Once`
- Removed Field: `Block`
- Type Change: `Block`
- Null Rate Spike: `Warn`
- Field Presence Drop: `Warn`
- Item Count Change: `Warn`
- Empty Output: `Block`
- When a Block Rule Matches: `Stop Workflow`

## 4. Learn or reset a baseline

Set Operation to `Reset Baseline From Current Input`, execute once with known-good production-shaped data, then switch back to `Protect Workflow`.

## 5. Structured block mode

To route failures yourself, set:

`When a Block Rule Matches → Return Structured Result`

Then add an IF node and test:

```text
{{ $json._schemaGuard.blocked }} is true
```

A blocked item contains a structure similar to:

```json
{
  "_schemaGuard": {
    "status": "blocked",
    "blocked": true,
    "anomalyCount": 1,
    "blockingCount": 1,
    "anomalies": [
      {
        "kind": "typeChanged",
        "policy": "block",
        "path": "id",
        "message": "Type changed: id (integer → string)",
        "details": { "from": "integer", "to": "string" }
      }
    ]
  }
}
```

## 6. Ignore dynamic fields

Use `Ignored Paths` for values whose structure is intentionally volatile:

```text
updatedAt
metadata.*
orders[].traceId
```
