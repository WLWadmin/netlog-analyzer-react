import {
  readEventData,
  readFiniteNumber,
  readLocalId,
  readRecord,
  readString,
} from '../parsers/trace/eventAccessors';
import type { ChromiumTraceEvent } from '../parsers/trace/types';

export type CpuQuerySort =
  | 'start-time'
  | 'self-time'
  | 'total-time'
  | 'sample-hits';

export interface CpuQueryInput {
  range: { startUs: number; endUs: number };
  sort: CpuQuerySort;
  limit: number;
  continuation?: string;
}

export interface CpuQueryExecutionOptions {
  isCancelled(): boolean;
  timeoutMs: number;
  now(): number;
  yieldControl(): Promise<void>;
  yieldInterval?: number;
}

export class CpuQueryCancelled extends Error {}
export class CpuQueryTimeout extends Error {}

export interface CpuAggregateNode {
  id: string;
  nodeId: number;
  entityId: string;
  parentId?: string;
  functionName: string;
  selfTimeUs: number;
  totalTimeUs: number;
  sampleHits: number;
  callCount?: number;
  depth: number;
  evidenceIds: string[];
}

export interface CpuFlameFrame {
  id: string;
  nodeId: number;
  entityId: string;
  parentId?: string;
  functionName: string;
  startUs: number;
  durationUs: number;
  depth: number;
  sampleHits: number;
  evidenceIds: string[];
}

export interface CpuTruncation {
  truncated: boolean;
  returnedCount: number;
  totalMatched: number;
  continuation?: string;
}

export interface CpuAggregateResult {
  capability: 'available' | 'partial' | 'missing';
  range: { startUs: number; endUs: number };
  nodes: CpuAggregateNode[];
  truncation: CpuTruncation;
  limitations: string[];
}

export interface CpuFlameChartResult {
  capability: 'available' | 'partial' | 'missing';
  range: { startUs: number; endUs: number };
  frames: CpuFlameFrame[];
  truncation: CpuTruncation;
  limitations: string[];
}

interface ProfileNode {
  id: number;
  functionName: string;
  parentId?: number;
}

interface ProfileSample {
  nodeId: number;
  startUs: number;
  endUs: number;
}

interface Profile {
  key: string;
  evidenceId: string;
  nodes: Map<number, ProfileNode>;
  parentIds: Map<number, number>;
  samples: ProfileSample[];
  cursorUs: number;
}

function profileKey(event: ChromiumTraceEvent): string | undefined {
  const processId = readFiniteNumber(event.pid);
  const profileId = readLocalId(event.id) ?? readLocalId(readEventData(event)?.id);
  return processId === undefined || profileId === undefined
    ? undefined
    : `${processId}:${profileId}`;
}

function clippedDuration(
  startUs: number,
  endUs: number,
  range: CpuQueryInput['range'],
): number {
  return Math.max(0, Math.min(endUs, range.endUs) - Math.max(startUs, range.startUs));
}

function nodeEntityId(profile: Profile, nodeId: number): string {
  return `cpu:node:${profile.key}:${nodeId}`;
}

function aggregateId(
  profile: Profile,
  bottomUp: boolean,
  path: readonly ProfileNode[],
): string {
  return `cpu:${bottomUp ? 'bottom-up' : 'call-tree'}:${profile.key}:${
    path.map(node => node.id).join('/')
  }`;
}

function page<T>(
  values: T[],
  input: CpuQueryInput,
  id: (value: T) => string,
): { values: T[]; truncation: CpuTruncation } {
  const start = input.continuation
    ? Math.max(0, values.findIndex(value => id(value) === input.continuation) + 1)
    : 0;
  const selected = values.slice(start, start + input.limit);
  const truncated = start + selected.length < values.length;
  return {
    values: selected,
    truncation: {
      truncated,
      returnedCount: selected.length,
      totalMatched: values.length,
      ...(truncated && selected.length > 0
        ? { continuation: id(selected[selected.length - 1]) }
        : {}),
    },
  };
}

export class CpuProfileStore {
  private released = false;

  private constructor(
    private readonly profiles: Profile[],
    private readonly limitations: Set<string>,
  ) {}

  static build(events: readonly ChromiumTraceEvent[]): CpuProfileStore {
    const profiles = new Map<string, Profile>();
    const limitations = new Set<string>();
    events.forEach((event, sourceIndex) => {
      const name = readString(event.name);
      if (name !== 'Profile' && name !== 'ProfileChunk') return;
      const key = profileKey(event);
      const timestampUs = readFiniteNumber(event.ts);
      if (!key || timestampUs === undefined) {
        limitations.add('invalid-profile-event');
        return;
      }
      if (name === 'Profile') {
        const startUs = readFiniteNumber(readEventData(event)?.startTime) ?? timestampUs;
        if (!profiles.has(key)) {
          profiles.set(key, {
            key,
            evidenceId: `trace:event:${sourceIndex}`,
            nodes: new Map(),
            parentIds: new Map(),
            samples: [],
            cursorUs: startUs,
          });
        } else {
          limitations.add('duplicate-profile-header');
        }
        return;
      }
      const profile = profiles.get(key);
      if (!profile) {
        limitations.add('orphan-profile-chunk');
        return;
      }
      const data = readEventData(event);
      const cpuProfile = readRecord(data?.cpuProfile);
      const rawNodes = cpuProfile?.nodes;
      if (rawNodes !== undefined && !Array.isArray(rawNodes)) {
        limitations.add('invalid-profile-nodes');
      }
      for (const rawNode of Array.isArray(rawNodes) ? rawNodes : []) {
        const node = readRecord(rawNode);
        const nodeId = readFiniteNumber(node?.id);
        if (nodeId === undefined) continue;
        const existing = profile.nodes.get(nodeId);
        const callFrame = readRecord(node?.callFrame);
        profile.nodes.set(nodeId, {
          id: nodeId,
          functionName: readString(callFrame?.functionName)
            ?? existing?.functionName
            ?? '(anonymous)',
          parentId: existing?.parentId ?? profile.parentIds.get(nodeId),
        });
      }
      for (const rawNode of Array.isArray(rawNodes) ? rawNodes : []) {
        const node = readRecord(rawNode);
        const parentId = readFiniteNumber(node?.id);
        const children = node?.children;
        if (parentId === undefined || !Array.isArray(children)) continue;
        for (const rawChildId of children) {
          const childId = readFiniteNumber(rawChildId);
          if (childId === undefined || childId === parentId) continue;
          if (!profile.parentIds.has(childId)) {
            profile.parentIds.set(childId, parentId);
          }
          const child = profile.nodes.get(childId);
          if (child && child.parentId === undefined) {
            child.parentId = parentId;
          }
        }
      }
      const rawSamples = cpuProfile?.samples;
      const rawDeltas = data?.timeDeltas;
      if (rawSamples === undefined && rawDeltas === undefined) return;
      if (!Array.isArray(rawSamples) || !Array.isArray(rawDeltas)) {
        limitations.add('incomplete-profile-chunk-tail');
        return;
      }
      const count = Math.min(rawSamples.length, rawDeltas.length);
      if (rawSamples.length !== rawDeltas.length) {
        limitations.add('incomplete-profile-chunk-tail');
      }
      for (let index = 0; index < count; index += 1) {
        const nodeId = readFiniteNumber(rawSamples[index]);
        const deltaUs = readFiniteNumber(rawDeltas[index]);
        if (nodeId === undefined || deltaUs === undefined) {
          limitations.add('invalid-profile-sample');
          continue;
        }
        if (deltaUs < 0) {
          limitations.add('negative-profile-time-delta');
          break;
        }
        const startUs = profile.cursorUs;
        profile.cursorUs += deltaUs;
        profile.samples.push({ nodeId, startUs, endUs: profile.cursorUs });
      }
    });
    return new CpuProfileStore([...profiles.values()], limitations);
  }

  getStatus(): {
    capability: 'available' | 'partial' | 'missing';
    limitations: string[];
  } {
    const hasSamples = this.profiles.some(profile => profile.samples.length > 0);
    const orderedLimitations = [...this.limitations].sort();
    if (!hasSamples) {
      return {
        capability: 'missing',
        limitations: orderedLimitations.length > 0
          ? orderedLimitations
          : ['cpu-profile-not-recorded'],
      };
    }
    return {
      capability: orderedLimitations.length > 0 ? 'partial' : 'available',
      limitations: orderedLimitations,
    };
  }

  async queryFlameChart(
    input: CpuQueryInput,
    options?: CpuQueryExecutionOptions,
  ): Promise<CpuFlameChartResult> {
    const status = this.getStatus();
    if (this.released || status.capability === 'missing') {
      return {
        ...status,
        range: input.range,
        frames: [],
        truncation: { truncated: false, returnedCount: 0, totalMatched: 0 },
      };
    }
    const frames: CpuFlameFrame[] = [];
    let processed = 0;
    const startedAt = options?.now();
    for (const profile of this.profiles) {
      for (const [sampleIndex, sample] of profile.samples.entries()) {
        processed += 1;
        await this.checkpoint(processed, startedAt, options);
        const durationUs = clippedDuration(sample.startUs, sample.endUs, input.range);
        if (durationUs <= 0) continue;
        const stack = this.stack(profile, sample.nodeId);
        stack.forEach((node, depth) => {
          frames.push({
            id: `cpu:frame:${profile.key}:${sampleIndex}:${node.id}`,
            nodeId: node.id,
            entityId: nodeEntityId(profile, node.id),
            ...(depth > 0
              ? { parentId: `cpu:frame:${profile.key}:${sampleIndex}:${stack[depth - 1].id}` }
              : {}),
            functionName: node.functionName,
            startUs: Math.max(sample.startUs, input.range.startUs),
            durationUs,
            depth,
            sampleHits: 1,
            evidenceIds: [profile.evidenceId],
          });
        });
      }
    }
    frames.sort((left, right) => left.startUs - right.startUs
      || left.depth - right.depth
      || left.id.localeCompare(right.id));
    const result = page(frames, input, frame => frame.id);
    return {
      ...status,
      range: input.range,
      frames: result.values,
      truncation: result.truncation,
    };
  }

  async queryCallTree(
    input: CpuQueryInput,
    options?: CpuQueryExecutionOptions,
  ): Promise<CpuAggregateResult> {
    return this.queryAggregate(input, false, options);
  }

  async queryBottomUp(
    input: CpuQueryInput,
    options?: CpuQueryExecutionOptions,
  ): Promise<CpuAggregateResult> {
    return this.queryAggregate(input, true, options);
  }

  release(): void {
    for (const profile of this.profiles) {
      profile.nodes.clear();
      profile.parentIds.clear();
      profile.samples.length = 0;
    }
    this.limitations.clear();
    this.released = true;
  }

  private async queryAggregate(
    input: CpuQueryInput,
    bottomUp: boolean,
    options?: CpuQueryExecutionOptions,
  ): Promise<CpuAggregateResult> {
    const status = this.getStatus();
    if (this.released || status.capability === 'missing') {
      return {
        ...status,
        range: input.range,
        nodes: [],
        truncation: { truncated: false, returnedCount: 0, totalMatched: 0 },
      };
    }
    const aggregate = new Map<string, CpuAggregateNode>();
    let processed = 0;
    const startedAt = options?.now();
    for (const profile of this.profiles) {
      for (const sample of profile.samples) {
        processed += 1;
        await this.checkpoint(processed, startedAt, options);
        const durationUs = clippedDuration(sample.startUs, sample.endUs, input.range);
        if (durationUs <= 0) continue;
        const stack = this.stack(profile, sample.nodeId);
        const orderedStack = bottomUp ? [...stack].reverse() : stack;
        orderedStack.forEach((node, depth) => {
          const path = orderedStack.slice(0, depth + 1);
          const key = aggregateId(profile, bottomUp, path);
          const current = aggregate.get(key) ?? {
            id: key,
            nodeId: node.id,
            entityId: nodeEntityId(profile, node.id),
            ...(depth > 0
              ? { parentId: aggregateId(profile, bottomUp, path.slice(0, -1)) }
              : {}),
            functionName: node.functionName,
            selfTimeUs: 0,
            totalTimeUs: 0,
            sampleHits: 0,
            depth,
            evidenceIds: [profile.evidenceId],
          };
          current.totalTimeUs += durationUs;
          if ((bottomUp && depth === 0) || (!bottomUp && depth === stack.length - 1)) {
            current.selfTimeUs += durationUs;
            current.sampleHits += 1;
          }
          aggregate.set(key, current);
        });
      }
    }
    const nodes = [...aggregate.values()];
    nodes.sort((left, right) => {
      const difference = input.sort === 'self-time'
        ? right.selfTimeUs - left.selfTimeUs
        : input.sort === 'sample-hits'
          ? right.sampleHits - left.sampleHits
          : right.totalTimeUs - left.totalTimeUs;
      return difference || left.id.localeCompare(right.id);
    });
    const result = page(nodes, input, node => node.id);
    return {
      ...status,
      range: input.range,
      nodes: result.values,
      truncation: result.truncation,
    };
  }

  private stack(profile: Profile, leafId: number): ProfileNode[] {
    const reversed: ProfileNode[] = [];
    const visited = new Set<number>();
    let current = profile.nodes.get(leafId);
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      reversed.push(current);
      current = current.parentId === undefined
        ? undefined
        : profile.nodes.get(current.parentId);
    }
    return reversed.reverse();
  }

  private async checkpoint(
    processed: number,
    startedAt: number | undefined,
    options: CpuQueryExecutionOptions | undefined,
  ): Promise<void> {
    if (!options) return;
    if (options.isCancelled()) throw new CpuQueryCancelled();
    if (startedAt !== undefined && options.now() - startedAt > options.timeoutMs) {
      throw new CpuQueryTimeout();
    }
    if (processed % (options.yieldInterval ?? 2_048) === 0) {
      await options.yieldControl();
    }
  }
}
