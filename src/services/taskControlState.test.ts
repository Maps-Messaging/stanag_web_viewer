import { describe, expect, it } from 'vitest';
import type { DroneTask, TwinState } from '../models/types';
import { getTaskControlWarning } from './taskControlState';

const activeTask = { state: 'ACTIVE', type: 'REPOSITION' } as DroneTask;
const executingTask = { state: 'EXECUTING', type: 'REPOSITION' } as DroneTask;
const pendingTask = { state: 'PENDING', type: 'REPOSITION' } as DroneTask;

function stickleback(flightMode?: string): TwinState {
  return {
    modelName: 'SticklebackArdupilotUsvModel',
    flightMode,
  };
}

describe('getTaskControlWarning', () => {
  it('does not warn while Stickleback is executing in GUIDED', () => {
    expect(getTaskControlWarning(stickleback('GUIDED'), activeTask)).toBeUndefined();
  });

  it('warns when an active Stickleback task leaves GUIDED', () => {
    expect(getTaskControlWarning(stickleback('RTL'), activeTask)).toEqual({
      expectedMode: 'GUIDED',
      actualMode: 'RTL',
    });
  });

  it('warns when an executing Stickleback task leaves GUIDED', () => {
    expect(getTaskControlWarning(stickleback('MANUAL'), executingTask)).toEqual({
      expectedMode: 'GUIDED',
      actualMode: 'MANUAL',
    });
  });

  it('does not warn before the task is active', () => {
    expect(getTaskControlWarning(stickleback('MANUAL'), pendingTask)).toBeUndefined();
  });

  it('does not warn for another vehicle model', () => {
    expect(getTaskControlWarning({ modelName: 'GenericPx4UavModel', flightMode: 'AUTO' }, activeTask)).toBeUndefined();
  });

  it('does not warn when flight mode is unavailable', () => {
    expect(getTaskControlWarning(stickleback(), activeTask)).toBeUndefined();
  });

  it.each(['NAVIGATE', 'PATROL', 'SCREEN', 'STANDBY', 'SURVEY'] as const)(
    'accepts AUTO while Stickleback is executing a %s task',
    (type) => {
      expect(getTaskControlWarning(stickleback('AUTO'), { ...executingTask, type })).toBeUndefined();
    },
  );

  it('warns when a Stickleback mission task leaves AUTO', () => {
    expect(getTaskControlWarning(stickleback('GUIDED'), { ...activeTask, type: 'NAVIGATE' })).toEqual({
      expectedMode: 'AUTO',
      actualMode: 'GUIDED',
    });
  });

  it.each(['LOITER', 'DETECT'] as const)(
    'does not infer a required mode for %s tasks',
    (type) => {
      expect(getTaskControlWarning(stickleback('MANUAL'), { ...activeTask, type })).toBeUndefined();
    },
  );
});
