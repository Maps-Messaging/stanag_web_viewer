import type { Drone, DroneTask, TaskState } from '../models/types';

const DEFAULT_STALE_MILLIS = 10_000;

export const TELEMETRY_STALE_MILLIS = positiveNumber(
  import.meta.env.VITE_TELEMETRY_STALE_MILLIS,
  DEFAULT_STALE_MILLIS,
);

export const CANCELLABLE_TASK_STATES = new Set<TaskState>([
  'SUBMITTED',
  'PENDING',
  'ACCEPTED',
  'ACTIVE',
  'EXECUTING',
]);

const TERMINAL_TASK_STATES = new Set<TaskState>([
  'PREEMPTED',
  'CANCELLED',
  'COMPLETED',
  'ABORTED',
  'LOST',
  'FAILED',
  'REJECTED',
]);

const TASK_STATE_RANK: Record<TaskState, number> = {
  DRAFT: 0,
  SUBMITTED: 1,
  SCHEDULED: 2,
  PENDING: 3,
  ACCEPTED: 4,
  ACTIVE: 5,
  EXECUTING: 6,
  CANCEL_REQUESTED: 7,
  PREEMPTING: 8,
  PREEMPTED: 9,
  CANCELLED: 10,
  COMPLETED: 11,
  ABORTED: 12,
  LOST: 13,
  FAILED: 14,
  REJECTED: 15,
};

export function isTelemetryFresh(
  drone: Pick<Drone, 'lastSeen' | 'stale'>,
  now = Date.now(),
  staleAfterMillis = TELEMETRY_STALE_MILLIS,
): boolean {
  return !drone.stale && now - drone.lastSeen <= staleAfterMillis;
}

export function telemetryLabel(
  drone: Pick<Drone, 'position' | 'lastSeen' | 'stale'>,
  now = Date.now(),
  staleAfterMillis = TELEMETRY_STALE_MILLIS,
): 'LIVE' | 'STALE' | 'KNOWN' {
  if (!drone.position) return 'KNOWN';
  return isTelemetryFresh(drone, now, staleAfterMillis) ? 'LIVE' : 'STALE';
}

export function shouldApplyTaskState(existing: TaskState, incoming: TaskState): boolean {
  if (TERMINAL_TASK_STATES.has(existing)) return existing === incoming;
  if (TERMINAL_TASK_STATES.has(incoming)) return true;
  return TASK_STATE_RANK[incoming] >= TASK_STATE_RANK[existing];
}

export function mergePercentComplete(existing: number | undefined, incoming: number | undefined): number | undefined {
  if (incoming === undefined) return existing;
  if (existing === undefined) return incoming;
  return incoming;
}

export function taskSeverity(state: DroneTask['state']): 'success' | 'info' | 'warning' | 'error' {
  if (state === 'COMPLETED') return 'success';
  if (state === 'FAILED' || state === 'REJECTED' || state === 'ABORTED' || state === 'LOST') return 'error';
  if (state === 'CANCEL_REQUESTED' || state === 'PREEMPTING' || state === 'PREEMPTED' || state === 'CANCELLED') return 'warning';
  return 'info';
}

function positiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
