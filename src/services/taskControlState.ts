import type { DroneTask, TwinState } from '../models/types';

const CONTROLLED_TASK_STATES = new Set<DroneTask['state']>(['ACTIVE', 'EXECUTING']);

export interface TaskControlWarning {
  expectedMode: string;
  actualMode: string;
}

export function getTaskControlWarning(twin: TwinState | undefined, task: DroneTask | undefined): TaskControlWarning | undefined {
  if (!twin || !task || !CONTROLLED_TASK_STATES.has(task.state)) return undefined;
  if (!twin.modelName?.toLowerCase().includes('stickleback')) return undefined;

  const actualMode = twin.flightMode?.trim().toUpperCase();
  if (!actualMode || actualMode === 'GUIDED') return undefined;

  return {
    expectedMode: 'GUIDED',
    actualMode,
  };
}
