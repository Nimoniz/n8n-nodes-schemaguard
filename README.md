# SchemaGuard for n8n

Catch schema drift and suspicious data changes **before they silently break downstream automations**.

SchemaGuard is a community node for n8n that learns the normal structure of workflow data, compares later executions against that baseline, and can warn or block when the shape of the data changes.

## Why SchemaGuard?

A workflow can be technically successful while still producing bad data.

```text
External API
    ↓
HTTP Request  ✅ 200 OK
    ↓
SchemaGuard   🚨 id: integer → string
    ↓
CRM / DB      blocked before bad data is written
```

Typical causes include upstream API changes, missing fields, unexpected null values, scraping changes, and empty responses.

## What it detects

- Added fields
- Removed fields
- Type changes
- Null-rate spikes
- Partial field disappearance
- Abnormal item-count changes
- Empty outputs
- Nested object and array path changes

## Main features

- Persistent baseline per SchemaGuard node
- Reset or clear the baseline from the node UI
- `Ignore`, `Warn`, or `Block` policy per anomaly type
- `Stop Workflow` or `Return Structured Result` behavior
- Ignored paths with wildcard support, such as `metadata.*`
- Structured anomaly metadata for IF/Switch/alert routing
- Local execution: workflow payloads are not sent to an external SchemaGuard service

## Example

Baseline:

```json
{
  "id": 101,
  "email": "alice@example.com"
}
```

Later input:

```json
{
  "id": "101",
  "email": "alice@example.com"
}
```

SchemaGuard can return:

```json
{
  "_schemaGuard": {
    "status": "blocked",
    "blocked": true,
    "anomalyCount": 1,
    "anomalies": [
      {
        "kind": "typeChanged",
        "policy": "block",
        "path": "id",
        "message": "Type changed: id (integer → string)",
        "details": {
          "from": "integer",
          "to": "string"
        }
      }
    ]
  }
}
```

This makes routing straightforward:

```text
SchemaGuard
    ↓
IF _schemaGuard.blocked
 ├─ true  → Slack / Email / Error handler
 └─ false → CRM / DB / downstream workflow
```

## Installation

Once published to npm, install the package as a community node using:

```text
n8n-nodes-schemaguard
```

For local development:

```bash
npm install
npm run build
npm test
npm run dev
```

## Recommended first test

1. Set **Operation** to `Reset Baseline From Current Input`.
2. Send input where `id` is an integer.
3. Switch **Operation** back to `Protect Workflow`.
4. Send the same data again and confirm `status = ok`.
5. Change `id` to a string.
6. Confirm SchemaGuard reports `integer → string`.

## Baseline persistence

SchemaGuard currently stores its baseline using n8n workflow static data. For realistic persistence testing, use an active/published workflow with a production trigger such as a production webhook. Manual editor test executions may not persist static data between runs.

## Development commands

```bash
npm install
npm run build
npm test
npm run lint
npm run dev
```

Before publishing:

```bash
npm run validate
npm pack --dry-run
```

See `PUBLISH_CHECKLIST.md` for the complete first-release checklist.

## Privacy

SchemaGuard v0.3 performs its analysis inside the n8n node. It does not send workflow payloads to an external SchemaGuard service.

## License

MIT
