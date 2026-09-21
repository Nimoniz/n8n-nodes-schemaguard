import type { IExecuteFunctions, INodeExecutionData, INodeType, INodeTypeDescription } from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import {
  compareSchemas,
  evaluateDiff,
  hasWarnings,
  inferSchema,
  shouldBlock,
  type AnomalyPolicy,
  type EvaluatedAnomaly,
  type PolicyConfig,
  type SchemaSnapshot,
} from './schema';

interface SchemaGuardStaticData {
  baseline?: SchemaSnapshot;
}

const policyOptions = [
  { name: 'Ignore', value: 'ignore' },
  { name: 'Warn', value: 'warn' },
  { name: 'Block', value: 'block' },
];

function parseIgnoredPaths(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function resultMetadata(
  status: 'baseline_learned' | 'baseline_reset' | 'baseline_cleared' | 'ok' | 'warning' | 'blocked',
  current: SchemaSnapshot,
  baseline?: SchemaSnapshot,
  anomalies: EvaluatedAnomaly[] = [],
) {
  return {
    status,
    blocked: status === 'blocked',
    checkedAt: new Date().toISOString(),
    baselineLearnedAt: baseline?.learnedAt,
    baselineItems: baseline?.itemCount ?? current.itemCount,
    currentItems: current.itemCount,
    anomalyCount: anomalies.length,
    blockingCount: anomalies.filter((a) => a.policy === 'block').length,
    warningCount: anomalies.filter((a) => a.policy === 'warn').length,
    anomalies,
  };
}

export class SchemaGuard implements INodeType {
 description: INodeTypeDescription = {
  displayName: 'SchemaGuard',
  name: 'schemaGuard',

  icon: { light: 'file:schemaguard.svg', dark: 'file:schemaguard-dark.svg' },

  group: ['transform'],
  version: 1,

  subtitle: '={{$parameter["operation"]}}',

  description: 'Detect schema drift and suspicious data changes before they break your workflow',

  defaults: {
    name: 'SchemaGuard',
  },

  inputs: [NodeConnectionTypes.Main],
  outputs: [NodeConnectionTypes.Main],

  usableAsTool: true,
    properties: [
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        default: 'protect',
        noDataExpression: true,
        options: [
          { name: 'Protect Workflow', value: 'protect' },
          { name: 'Reset Baseline From Current Input', value: 'resetBaseline' },
          { name: 'Clear Baseline', value: 'clearBaseline' },
        ],
      },
      {
        displayName: 'Baseline Strategy',
        name: 'baselineStrategy',
        type: 'options',
        default: 'learnOnce',
        displayOptions: { show: { operation: ['protect'] } },
        options: [
          { name: 'Learn Once', value: 'learnOnce' },
          { name: 'Refresh After Healthy Run', value: 'refreshHealthy' },
        ],
      },
      {
        displayName: 'Ignored Paths',
        name: 'ignoredPaths',
        type: 'string',
        default: '',
        placeholder: 'updatedAt, metadata.*, orders[].traceId',
        description: 'Comma- or newline-separated paths. * acts as a wildcard.',
      },
      {
        displayName: 'Null Rate Increase Threshold',
        name: 'nullRateThreshold',
        type: 'number',
        typeOptions: { minValue: 0, maxValue: 1, numberPrecision: 2 },
        default: 0.5,
        displayOptions: { show: { operation: ['protect'] } },
      },
      {
        displayName: 'Field Presence Drop Threshold',
        name: 'presenceRateDropThreshold',
        type: 'number',
        typeOptions: { minValue: 0, maxValue: 1, numberPrecision: 2 },
        default: 0.5,
        displayOptions: { show: { operation: ['protect'] } },
        description: 'Detects a field that still exists, but disappears from many items',
      },
      {
        displayName: 'Item Count Change Threshold',
        name: 'itemCountRatioThreshold',
        type: 'number',
        typeOptions: { minValue: 0, maxValue: 10, numberPrecision: 2 },
        default: 0.75,
        displayOptions: { show: { operation: ['protect'] } },
      },
      { displayName: 'Added Field', name: 'addedFieldPolicy', type: 'options', default: 'ignore', options: policyOptions, displayOptions: { show: { operation: ['protect'] } } },
      { displayName: 'Removed Field', name: 'removedFieldPolicy', type: 'options', default: 'block', options: policyOptions, displayOptions: { show: { operation: ['protect'] } } },
      { displayName: 'Type Change', name: 'typeChangedPolicy', type: 'options', default: 'block', options: policyOptions, displayOptions: { show: { operation: ['protect'] } } },
      { displayName: 'Null Rate Spike', name: 'nullRateChangedPolicy', type: 'options', default: 'warn', options: policyOptions, displayOptions: { show: { operation: ['protect'] } } },
      { displayName: 'Field Presence Drop', name: 'presenceRateChangedPolicy', type: 'options', default: 'warn', options: policyOptions, displayOptions: { show: { operation: ['protect'] } } },
      { displayName: 'Item Count Change', name: 'itemCountChangedPolicy', type: 'options', default: 'warn', options: policyOptions, displayOptions: { show: { operation: ['protect'] } } },
      { displayName: 'Empty Output', name: 'emptyOutputPolicy', type: 'options', default: 'block', options: policyOptions, displayOptions: { show: { operation: ['protect'] } } },
      {
        displayName: 'When a Block Rule Matches',
        name: 'blockBehavior',
        type: 'options',
        default: 'stop',
        displayOptions: { show: { operation: ['protect'] } },
        options: [
          { name: 'Stop Workflow', value: 'stop' },
          { name: 'Return Structured Result', value: 'return' },
        ],
        description: 'Return Structured Result is useful when you want to route the blocked result yourself',
      },
      {
        displayName: 'Attach SchemaGuard Metadata',
        name: 'attachMetadata',
        type: 'boolean',
        default: true,
        displayOptions: { show: { operation: ['protect'] } },
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const operation = this.getNodeParameter('operation', 0, 'protect') as 'protect' | 'resetBaseline' | 'clearBaseline';
    const ignoredPaths = parseIgnoredPaths(this.getNodeParameter('ignoredPaths', 0, '') as string);
    const staticData = this.getWorkflowStaticData('node') as SchemaGuardStaticData;
    const current = inferSchema(items.map((item) => item.json as Record<string, unknown>), undefined, ignoredPaths);

    if (operation === 'clearBaseline') {
      delete staticData.baseline;
      const metadata = resultMetadata('baseline_cleared', current);
      return [items.map((item, index) => ({ ...item, json: { ...item.json, _schemaGuard: metadata }, pairedItem: item.pairedItem ?? { item: index } }))];
    }

    if (operation === 'resetBaseline') {
      staticData.baseline = current;
      const metadata = resultMetadata('baseline_reset', current, current);
      return [items.map((item, index) => ({ ...item, json: { ...item.json, _schemaGuard: metadata }, pairedItem: item.pairedItem ?? { item: index } }))];
    }

    const baselineStrategy = this.getNodeParameter('baselineStrategy', 0, 'learnOnce') as 'learnOnce' | 'refreshHealthy';
    const nullRateThreshold = this.getNodeParameter('nullRateThreshold', 0, 0.5) as number;
    const presenceRateDropThreshold = this.getNodeParameter('presenceRateDropThreshold', 0, 0.5) as number;
    const itemCountRatioThreshold = this.getNodeParameter('itemCountRatioThreshold', 0, 0.75) as number;
    const attachMetadata = this.getNodeParameter('attachMetadata', 0, true) as boolean;
    const blockBehavior = this.getNodeParameter('blockBehavior', 0, 'stop') as 'stop' | 'return';

    const policies: PolicyConfig = {
      addedField: this.getNodeParameter('addedFieldPolicy', 0, 'ignore') as AnomalyPolicy,
      removedField: this.getNodeParameter('removedFieldPolicy', 0, 'block') as AnomalyPolicy,
      typeChanged: this.getNodeParameter('typeChangedPolicy', 0, 'block') as AnomalyPolicy,
      nullRateChanged: this.getNodeParameter('nullRateChangedPolicy', 0, 'warn') as AnomalyPolicy,
      presenceRateChanged: this.getNodeParameter('presenceRateChangedPolicy', 0, 'warn') as AnomalyPolicy,
      itemCountChanged: this.getNodeParameter('itemCountChangedPolicy', 0, 'warn') as AnomalyPolicy,
      emptyOutput: this.getNodeParameter('emptyOutputPolicy', 0, 'block') as AnomalyPolicy,
    };

    if (!staticData.baseline) {
      staticData.baseline = current;
      if (!attachMetadata) return [items];
      const metadata = resultMetadata('baseline_learned', current, current);
      return [items.map((item, index) => ({ ...item, json: { ...item.json, _schemaGuard: metadata }, pairedItem: item.pairedItem ?? { item: index } }))];
    }

    const diff = compareSchemas(staticData.baseline, current, nullRateThreshold, itemCountRatioThreshold, presenceRateDropThreshold);
    const anomalies = evaluateDiff(diff, policies);
    const blocked = shouldBlock(anomalies);
    const status = blocked ? 'blocked' : hasWarnings(anomalies) ? 'warning' : 'ok';
    const metadata = resultMetadata(status, current, staticData.baseline, anomalies);

    if (blocked && blockBehavior === 'stop') {
      const blocking = anomalies.filter((a) => a.policy === 'block');
      const summary = blocking.map((a) => a.message).join('\n');
      const structured = JSON.stringify({ status: 'blocked', anomalies: blocking }, null, 2);
      throw new NodeOperationError(this.getNode(), `SchemaGuard blocked the workflow (${blocking.length} anomaly/anomalies)`, {
        description: `${summary}\n\nStructured result:\n${structured}`,
      });
    }

    if (!blocked && baselineStrategy === 'refreshHealthy' && anomalies.length === 0) {
      staticData.baseline = current;
    }

    if (!attachMetadata && !(blocked && blockBehavior === 'return')) return [items];

    return [items.map((item, index) => ({
      ...item,
      json: { ...item.json, _schemaGuard: metadata },
      pairedItem: item.pairedItem ?? { item: index },
    }))];
  }
}
