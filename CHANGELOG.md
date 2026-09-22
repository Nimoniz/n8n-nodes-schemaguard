# Changelog

All notable changes to SchemaGuard are documented here.

## 0.3.1

- Fixed package documentation for the scoped npm package
- Added a validated importable n8n webhook example workflow
- Added payload extraction before SchemaGuard to avoid monitoring volatile webhook metadata
- Verified installation from npm in a clean n8n instance
- Verified persistent baseline behavior in production webhook executions
- Verified integer-to-string type drift detection and structured blocking output
- Passed the official n8n community package security scanner

## 0.3.0

- Persistent baseline per node using n8n workflow static data
- Baseline reset and clear operations
- Ignore / Warn / Block policies per anomaly type
- Structured anomaly output
- Stop workflow or return blocked result
- Nested object and array path support
- Ignored path patterns with wildcards
- Field presence-drop detection
- Null-rate spike detection
- Item-count anomaly detection
- Empty-output handling without duplicate removed-field noise