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

## Installation

Install the package as an n8n community node using:

```text
@nimoniz/n8n-nodes-schemaguard
```

For self-hosted n8n, install it from the Community Nodes settings using the package name above.

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
    "blockingCount": 1,
    "warningCount": 0,
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

## Recommended first test

1. Add SchemaGuard to your workflow.
2. Set **Operation** to `Reset Baseline From Current Input`.
3. Send input where `id` is an integer.
4. Switch **Operation** back to `Protect Workflow`.
5. Send the same data again and confirm `status = ok`.
6. Change `id` to a string.
7. Confirm SchemaGuard reports `integer → string`.

## Baseline strategies

SchemaGuard supports two baseline strategies:

### Learn Once

The initial baseline is learned once and remains unchanged until you manually reset or clear it.

### Refresh After Healthy Run

The baseline is updated after a healthy execution with no detected anomalies.

## Policies

Each anomaly type can be configured independently with one of these policies:

- `Ignore`
- `Warn`
- `Block`

Supported anomaly policies include:

- Added Field
- Removed Field
- Type Change
- Null Rate Spike
- Field Presence Drop
- Item Count Change
- Empty Output

## Block behavior

When a blocking anomaly is detected, SchemaGuard can either:

### Stop Workflow

The node throws an n8n error and stops workflow execution.

### Return Structured Result

The workflow continues and each output item receives `_schemaGuard` metadata.

This mode is useful when you want to route failures yourself using an IF or Switch node.

Example condition:

```text
{{ $json._schemaGuard.blocked }}
```

## Ignored paths

Use `Ignored Paths` for fields whose structure is intentionally volatile.

Examples:

```text
updatedAt
metadata.*
orders[].traceId
```

Multiple paths can be separated by commas or new lines.

## Baseline persistence

SchemaGuard stores its baseline using n8n workflow static data.

For realistic persistence testing, use an active workflow with a production trigger such as a production webhook.

Manual editor test executions may not persist static data between runs.

## Privacy

SchemaGuard performs its analysis inside the n8n node.

It does not send workflow payloads to an external SchemaGuard service.

## Development

Clone the repository and run:

```bash
npm install
npm run build
npm test
npm run lint
npm run dev
```

## Validation

Before publishing:

```bash
npm run validate
npm pack --dry-run
```

You can also run the official n8n community package scanner:

```bash
npx @n8n/scan-community-package @nimoniz/n8n-nodes-schemaguard
```

## Security

SchemaGuard has passed the n8n community package security scanner.

The project does not require runtime dependencies beyond n8n itself and does not access the filesystem or environment variables during node execution.

## Repository

GitHub:

```text
https://github.com/Nimoniz/n8n-nodes-schemaguard
```

npm:

```text
@nimoniz/n8n-nodes-schemaguard
```

## License

MIT
