export type PrimitiveType = 'null' | 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array';
export type AnomalyPolicy = 'ignore' | 'warn' | 'block';
export type AnomalyKind =
  | 'addedField'
  | 'removedField'
  | 'typeChanged'
  | 'nullRateChanged'
  | 'presenceRateChanged'
  | 'itemCountChanged'
  | 'emptyOutput';

export interface FieldProfile {
  type: PrimitiveType;
  observed: number;
  nullCount: number;
  nullRate: number;
  presentInItems: number;
  presenceRate: number;
}

export interface SchemaSnapshot {
  version: 3;
  itemCount: number;
  fields: Record<string, FieldProfile>;
  learnedAt: string;
}

export interface SchemaDiff {
  added: string[];
  removed: string[];
  typeChanged: Array<{ path: string; from: PrimitiveType; to: PrimitiveType }>;
  nullRateChanged: Array<{ path: string; from: number; to: number; delta: number }>;
  presenceRateChanged: Array<{ path: string; from: number; to: number; delta: number }>;
  itemCountChanged?: { from: number; to: number; ratio: number };
  emptyOutput?: { from: number; to: 0 };
}

export interface PolicyConfig {
  addedField: AnomalyPolicy;
  removedField: AnomalyPolicy;
  typeChanged: AnomalyPolicy;
  nullRateChanged: AnomalyPolicy;
  presenceRateChanged: AnomalyPolicy;
  itemCountChanged: AnomalyPolicy;
  emptyOutput: AnomalyPolicy;
}

export interface EvaluatedAnomaly {
  kind: AnomalyKind;
  policy: AnomalyPolicy;
  path?: string;
  message: string;
  details?: Record<string, unknown>;
}

interface FieldAccumulator {
  types: PrimitiveType[];
  nulls: number;
  observed: number;
  topLevelItems: Set<number>;
}

function valueType(value: unknown): PrimitiveType {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  if (typeof value === 'object') return 'object';
  if (typeof value === 'boolean') return 'boolean';
  return 'string';
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .trim()
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

export function createPathMatcher(patterns: string[]): (path: string) => boolean {
  const regexes = patterns.map((p) => p.trim()).filter(Boolean).map(globToRegExp);
  return (path: string) => regexes.some((rx) => rx.test(path));
}

function visit(
  value: unknown,
  path: string,
  topLevelItemIndex: number,
  accumulator: Map<string, FieldAccumulator>,
): void {
  const currentType = valueType(value);
  const current = accumulator.get(path) ?? {
    types: [],
    nulls: 0,
    observed: 0,
    topLevelItems: new Set<number>(),
  };

  current.observed += 1;
  current.topLevelItems.add(topLevelItemIndex);
  if (currentType === 'null') current.nulls += 1;
  else current.types.push(currentType);
  accumulator.set(path, current);

  if (currentType === 'object' && value) {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      visit(child, path ? `${path}.${key}` : key, topLevelItemIndex, accumulator);
    }
  }

  if (currentType === 'array') {
    for (const child of value as unknown[]) {
      visit(child, `${path}[]`, topLevelItemIndex, accumulator);
    }
  }
}

function mostSpecificType(types: PrimitiveType[]): PrimitiveType {
  if (types.length === 0) return 'null';
  const unique = new Set(types);
  if (unique.size === 1) return types[0];
  if (unique.has('number') && unique.has('integer') && unique.size === 2) return 'number';
  return types[types.length - 1];
}

export function inferSchema(
  items: Array<Record<string, unknown>>,
  learnedAt = new Date().toISOString(),
  ignoredPatterns: string[] = [],
): SchemaSnapshot {
  const accumulator = new Map<string, FieldAccumulator>();
  const ignored = createPathMatcher(ignoredPatterns);

  items.forEach((item, index) => {
    for (const [key, value] of Object.entries(item)) visit(value, key, index, accumulator);
  });

  const fields: Record<string, FieldProfile> = {};
  for (const [path, stats] of accumulator.entries()) {
    if (ignored(path)) continue;
    const presentInItems = stats.topLevelItems.size;
    fields[path] = {
      type: mostSpecificType(stats.types),
      observed: stats.observed,
      nullCount: stats.nulls,
      nullRate: stats.observed === 0 ? 0 : stats.nulls / stats.observed,
      presentInItems,
      presenceRate: items.length === 0 ? 0 : presentInItems / items.length,
    };
  }

  return { version: 3, itemCount: items.length, fields, learnedAt };
}

export function compareSchemas(
  previous: SchemaSnapshot,
  current: SchemaSnapshot,
  nullRateThreshold = 0.25,
  itemCountRatioThreshold = 0.75,
  presenceRateDropThreshold = 0.5,
): SchemaDiff {
  if (previous.itemCount > 0 && current.itemCount === 0) {
    return {
      added: [],
      removed: [],
      typeChanged: [],
      nullRateChanged: [],
      presenceRateChanged: [],
      emptyOutput: { from: previous.itemCount, to: 0 },
    };
  }

  const previousPaths = new Set(Object.keys(previous.fields));
  const currentPaths = new Set(Object.keys(current.fields));

  const added = [...currentPaths].filter((path) => !previousPaths.has(path)).sort();
  const removed = [...previousPaths].filter((path) => !currentPaths.has(path)).sort();
  const typeChanged: SchemaDiff['typeChanged'] = [];
  const nullRateChanged: SchemaDiff['nullRateChanged'] = [];
  const presenceRateChanged: SchemaDiff['presenceRateChanged'] = [];

  for (const path of [...previousPaths].filter((candidate) => currentPaths.has(candidate))) {
    const before = previous.fields[path];
    const after = current.fields[path];

    if (before.type !== after.type) {
      typeChanged.push({ path, from: before.type, to: after.type });
    }

    const nullDelta = after.nullRate - before.nullRate;
    if (nullDelta >= nullRateThreshold) {
      nullRateChanged.push({ path, from: before.nullRate, to: after.nullRate, delta: nullDelta });
    }

    const presenceDrop = before.presenceRate - after.presenceRate;
    if (presenceDrop >= presenceRateDropThreshold) {
      presenceRateChanged.push({
        path,
        from: before.presenceRate,
        to: after.presenceRate,
        delta: presenceDrop,
      });
    }
  }

  let itemCountChanged: SchemaDiff['itemCountChanged'];
  if (previous.itemCount > 0) {
    const ratio = current.itemCount / previous.itemCount;
    const relativeDelta = Math.abs(current.itemCount - previous.itemCount) / previous.itemCount;
    if (relativeDelta >= itemCountRatioThreshold) {
      itemCountChanged = { from: previous.itemCount, to: current.itemCount, ratio };
    }
  } else if (current.itemCount > 0) {
    itemCountChanged = { from: 0, to: current.itemCount, ratio: Number.POSITIVE_INFINITY };
  }

  return { added, removed, typeChanged, nullRateChanged, presenceRateChanged, itemCountChanged };
}

export function evaluateDiff(diff: SchemaDiff, policies: PolicyConfig): EvaluatedAnomaly[] {
  const anomalies: EvaluatedAnomaly[] = [];

  if (diff.emptyOutput && policies.emptyOutput !== 'ignore') {
    anomalies.push({
      kind: 'emptyOutput',
      policy: policies.emptyOutput,
      message: `Output became empty (${diff.emptyOutput.from} → 0 items)`,
      details: diff.emptyOutput,
    });
    return anomalies;
  }

  for (const path of diff.removed) {
    if (policies.removedField !== 'ignore') {
      anomalies.push({
        kind: 'removedField',
        policy: policies.removedField,
        path,
        message: `Removed field: ${path}`,
      });
    }
  }

  for (const change of diff.typeChanged) {
    if (policies.typeChanged !== 'ignore') {
      anomalies.push({
        kind: 'typeChanged',
        policy: policies.typeChanged,
        path: change.path,
        message: `Type changed: ${change.path} (${change.from} → ${change.to})`,
        details: { from: change.from, to: change.to },
      });
    }
  }

  for (const change of diff.nullRateChanged) {
    if (policies.nullRateChanged !== 'ignore') {
      anomalies.push({
        kind: 'nullRateChanged',
        policy: policies.nullRateChanged,
        path: change.path,
        message: `Null rate increased: ${change.path} (${(change.from * 100).toFixed(1)}% → ${(change.to * 100).toFixed(1)}%)`,
        details: { from: change.from, to: change.to, delta: change.delta },
      });
    }
  }

  for (const change of diff.presenceRateChanged) {
    if (policies.presenceRateChanged !== 'ignore') {
      anomalies.push({
        kind: 'presenceRateChanged',
        policy: policies.presenceRateChanged,
        path: change.path,
        message: `Field presence dropped: ${change.path} (${(change.from * 100).toFixed(1)}% → ${(change.to * 100).toFixed(1)}%)`,
        details: { from: change.from, to: change.to, delta: change.delta },
      });
    }
  }

  if (diff.itemCountChanged && policies.itemCountChanged !== 'ignore') {
    anomalies.push({
      kind: 'itemCountChanged',
      policy: policies.itemCountChanged,
      message: `Item count changed: ${diff.itemCountChanged.from} → ${diff.itemCountChanged.to}`,
      details: diff.itemCountChanged,
    });
  }

  for (const path of diff.added) {
    if (policies.addedField !== 'ignore') {
      anomalies.push({ kind: 'addedField', policy: policies.addedField, path, message: `Added field: ${path}` });
    }
  }

  return anomalies;
}

export function shouldBlock(anomalies: EvaluatedAnomaly[]): boolean {
  return anomalies.some((anomaly) => anomaly.policy === 'block');
}

export function hasWarnings(anomalies: EvaluatedAnomaly[]): boolean {
  return anomalies.some((anomaly) => anomaly.policy === 'warn');
}
