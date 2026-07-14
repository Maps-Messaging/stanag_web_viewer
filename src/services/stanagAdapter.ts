import type { Drone, DroneTask, GeoPoint, TaskState, TaskType } from '../models/types';

export interface ParsedTaskStatus {
  taskId: string;
  droneId: string;
  state: TaskState;
  message?: string;
}

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Expected a JSON object');
  }
  return value as Record<string, unknown>;
}

function asNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new Error(`Expected numeric field: ${field}`);
  }
  return value;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Expected string field: ${field}`);
  }
  return value;
}

export function parseDroneState(payload: unknown): Drone {
  const data = asObject(payload);
  const position = asObject(data.position);

  return {
    id: asString(data.droneId ?? data.id, 'droneId'),
    name: typeof data.name === 'string' ? data.name : asString(data.droneId ?? data.id, 'droneId'),
    position: {
      latitude: asNumber(position.latitude, 'position.latitude'),
      longitude: asNumber(position.longitude, 'position.longitude'),
      altitude: typeof position.altitude === 'number' ? position.altitude : undefined,
    },
    heading: typeof data.heading === 'number' ? data.heading : 0,
    groundSpeed: typeof data.groundSpeed === 'number' ? data.groundSpeed : 0,
    batteryPercent: typeof data.batteryPercent === 'number' ? data.batteryPercent : undefined,
    lastSeen: Date.now(),
    activeTaskId: typeof data.activeTaskId === 'string' ? data.activeTaskId : undefined,
  };
}

export function parseTaskStatus(payload: unknown): ParsedTaskStatus {
  const data = asObject(payload);
  return {
    taskId: asString(data.taskId, 'taskId'),
    droneId: asString(data.droneId, 'droneId'),
    state: asString(data.state, 'state') as TaskState,
    message: typeof data.message === 'string' ? data.message : undefined,
  };
}

export function buildTaskCommand(task: DroneTask): unknown {
  return {
    messageType: 'TASK_COMMAND',
    taskId: task.id,
    target: {
      droneId: task.droneId,
    },
    task: {
      type: task.type,
      geometry: buildGeometry(task.type, task.points),
      parameters: task.parameters,
    },
    createdAt: new Date(task.createdAt).toISOString(),
  };
}

export function buildCancelCommand(task: DroneTask): unknown {
  return {
    messageType: 'TASK_CANCEL',
    taskId: task.id,
    target: {
      droneId: task.droneId,
    },
    createdAt: new Date().toISOString(),
  };
}

function buildGeometry(type: TaskType, points: GeoPoint[]): unknown {
  switch (type) {
    case 'REPOSITION':
      return { type: 'POINT', point: points[0] };
    case 'NAVIGATE':
      return { type: 'LINE', points };
    case 'LOITER':
      return { type: 'ORBIT', centre: points[0] };
  }
}
