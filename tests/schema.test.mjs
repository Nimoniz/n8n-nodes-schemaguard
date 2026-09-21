import test from 'node:test';
import assert from 'node:assert/strict';
import { compareSchemas, evaluateDiff, inferSchema, shouldBlock } from '../dist/nodes/SchemaGuard/schema.js';

const defaults = {
  addedField: 'ignore',
  removedField: 'block',
  typeChanged: 'block',
  nullRateChanged: 'warn',
  presenceRateChanged: 'warn',
  itemCountChanged: 'warn',
  emptyOutput: 'block',
};

test('infers nested objects and arrays', () => {
  const schema = inferSchema([{ customer: { id: 1, email: 'a@b.com' }, orders: [{ amount: 9.9 }] }], '2026-01-01T00:00:00.000Z');
  assert.equal(schema.fields['customer.id'].type, 'integer');
  assert.equal(schema.fields['customer.email'].type, 'string');
  assert.equal(schema.fields['orders[].amount'].type, 'number');
});

test('removed field and type change block by default', () => {
  const before = inferSchema([{ id: 1, email: 'a@b.com' }]);
  const after = inferSchema([{ id: '1' }]);
  const anomalies = evaluateDiff(compareSchemas(before, after), defaults);
  assert.equal(anomalies.length, 2);
  assert.equal(shouldBlock(anomalies), true);
});

test('null-rate spike warns but does not block by default', () => {
  const before = inferSchema([{ email: 'a' }, { email: 'b' }, { email: 'c' }, { email: 'd' }]);
  const after = inferSchema([{ email: null }, { email: null }, { email: null }, { email: 'd' }]);
  const anomalies = evaluateDiff(compareSchemas(before, after, 0.5), defaults);
  assert.equal(anomalies.length, 1);
  assert.equal(anomalies[0].kind, 'nullRateChanged');
  assert.equal(anomalies[0].policy, 'warn');
  assert.equal(shouldBlock(anomalies), false);
});

test('detects partial field disappearance via presence rate', () => {
  const before = inferSchema([{ email: 'a' }, { email: 'b' }, { email: 'c' }, { email: 'd' }]);
  const after = inferSchema([{ email: 'a' }, {}, {}, {}]);
  const diff = compareSchemas(before, after, 1, 10, 0.5);
  assert.equal(diff.presenceRateChanged.length, 1);
  assert.equal(diff.presenceRateChanged[0].path, 'email');
  const anomalies = evaluateDiff(diff, defaults);
  assert.equal(anomalies[0].kind, 'presenceRateChanged');
});

test('ignored paths support wildcards', () => {
  const schema = inferSchema([{ id: 1, updatedAt: 'x', metadata: { trace: 'abc', stable: 1 } }], undefined, ['updatedAt', 'metadata.*']);
  assert.ok(schema.fields.id);
  assert.equal(schema.fields.updatedAt, undefined);
  assert.equal(schema.fields['metadata.trace'], undefined);
  assert.equal(schema.fields['metadata.stable'], undefined);
});

test('added fields are ignored by default', () => {
  const before = inferSchema([{ id: 1 }]);
  const after = inferSchema([{ id: 1, name: 'Jane' }]);
  const anomalies = evaluateDiff(compareSchemas(before, after), defaults);
  assert.equal(anomalies.length, 0);
});

test('empty output produces one dedicated anomaly only', () => {
  const before = inferSchema([{ id: 1, email: 'a@b.com' }]);
  const after = inferSchema([]);
  const diff = compareSchemas(before, after);
  assert.ok(diff.emptyOutput);
  assert.equal(diff.removed.length, 0);
  const anomalies = evaluateDiff(diff, defaults);
  assert.equal(anomalies.length, 1);
  assert.equal(anomalies[0].kind, 'emptyOutput');
  assert.equal(shouldBlock(anomalies), true);
});

test('policy can turn a null spike into a block', () => {
  const before = inferSchema([{ email: 'a' }, { email: 'b' }, { email: 'c' }, { email: 'd' }]);
  const after = inferSchema([{ email: null }, { email: null }, { email: null }, { email: 'd' }]);
  const anomalies = evaluateDiff(compareSchemas(before, after, 0.5), { ...defaults, nullRateChanged: 'block' });
  assert.equal(shouldBlock(anomalies), true);
});
