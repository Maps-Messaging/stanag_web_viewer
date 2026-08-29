import type { DroneTask, TwinState } from '../models/types';

const CONTROLLED_TASK_STATES = new Set<DroneTask['state']>(['ACTIVE', 'EXECUTING']);
const AUTO_TASK_TYPES = new Set<DroneTask['type']>([
  'NAVIGATE',
  'PATROL',
  'SCREEN',
  'STANDBY',
  'SURVEY',
]);

export interface TaskControlWarning {
  expectedMode: string;
  actualMode: string;
}

export function getTaskControlWarning(twin: TwinState | undefined, task: DroneTask | undefined): TaskControlWarning | undefined {
  if (!twin || !task || !CONTROLLED_TASK_STATES.has(task.state)) return undefined;
  if (!twin.modelName?.toLowerCase().includes('stickleback')) return undefined;

  const expectedMode = task.type === 'REPOSITION'
    ? 'GUIDED'
    : AUTO_TASK_TYPES.has(task.type)
      ? 'AUTO'
      : undefined;
  if (!expectedMode) return undefined;

  const actualMode = twin.flightMode?.trim().toUpperCase();
  if (!actualMode || actualMode === expectedMode) return undefined;

  return {
    expectedMode,
    actualMode,
  };
}
