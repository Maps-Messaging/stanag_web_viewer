import type { DroneTask, DroneTelemetryUpdate, GeoPoint, MavlinkSequenceStatus, MavlinkStreamStatus, TwinState } from '../models/types';
import { parseDynamicTrack } from '../services/dynamicUpdateAdapter';
import { getStanagMessageType, parseNodeMessage, parseTaskAdmin, parseTaskStatus } from '../services/stanagAdapter';
import { useAppStore } from '../state/useAppStore';

export function dispatchStanagMessage(payload: unknown): void {
  const store = useAppStore.getState();
  const messageType = getStanagMessageType(payload);

  if (messageType === 'MessageTypeEnum_NODE_DESCRIPTION' || messageType === 'MessageTypeEnum_NODE_STATUS') {
    const node = parseNodeMessage(payload);
    store.upsertDrone(node.drone);

    if (messageType === 'MessageTypeEnum_NODE_DESCRIPTION') {
      store.addEvent({
        level: 'INFO',
        message: `${node.messageType}: ${node.drone.name}`,
        payload,
      });
    }

    return;
  }

  if (messageType === 'MessageTypeEnum_DYNAMIC_UPDATE') {
    try {
      const detection = parseDynamicTrack(payload);
      store.upsertDetection(detection);
      store.addEvent({
        level: 'INFO',
        message: `DYNAMIC_UPDATE TRACK: ${detection.name} ${detection.id}`,
        payload,
      });
    } catch (error) {
      store.addEvent({
        level: 'WARN',
        message: `Unsupported DYNAMIC_UPDATE: ${error instanceof Error ? error.message : String(error)}`,
        payload,
      });
    }
    return;
  }

  if (messageType === 'MessageTypeEnum_TASK_ADMIN') {
    const admin = parseTaskAdmin(payload);

    if (admin.action === 'PUSH' && admin.task) {
      store.upsertTask(withDisplayFields(admin.task));
      store.addEvent({
        level: 'INFO',
        message: `TASK_ADMIN PUSH: ${admin.task.type} ${admin.taskId}`,
        payload,
      });
      return;
    }

    const existing = store.tasks[admin.taskId];
    if (!existing) {
      store.addEvent({
        level: 'WARN',
        message: `TASK_ADMIN CANCEL received for unknown task ${admin.taskId}`,
        payload,
      });
      return;
    }

    store.upsertTask({
      ...existing,
      state: 'CANCEL_REQUESTED',
      updatedAt: Date.now(),
    });
    store.addEvent({
      level: 'INFO',
      message: `TASK_ADMIN CANCEL: ${admin.taskId}`,
      payload,
    });
    return;
  }

  if (messageType === 'MessageTypeEnum_TASK_FEEDBACK' || messageType === 'MessageTypeEnum_TASK_RESULT') {
    const status = parseTaskStatus(payload);
    const existing = store.tasks[status.taskId];

    if (!existing) {
      store.addEvent({
        level: 'WARN',
        message: `${status.messageType} received for unknown task ${status.taskId}`,
        payload,
      });
      return;
    }

    store.upsertTask({
      ...existing,
      state: status.state,
      percentComplete: status.percentComplete ?? existing.percentComplete,
      updatedAt: Date.now(),
      message: status.message,
    });

    store.addEvent({
      level: status.state === 'FAILED' || status.state === 'REJECTED' ? 'ERROR' : 'INFO',
      message: `${status.messageType}: ${status.taskId} ${status.state}${
        status.percentComplete === undefined ? '' : ` ${status.percentComplete.toFixed(1)}%`
      }${status.message ? `: ${status.message}` : ''}`,
      payload,
    });
    return;
  }

  store.addEvent({
    level: 'WARN',
    message: `Unsupported STANAG message type: ${messageType}`,
    payload,
  });
}

function withDisplayFields(task: DroneTask): DroneTask {
  switch (task.geometry.type) {
    case 'POINT':
      return { ...task, geometryType: 'POINT', point: task.geometry.point };
    case 'CIRCLE':
      return { ...task, geometryType: 'CIRCLE', point: task.geometry.centre, radiusMeters: task.geometry.radiusMeters };
    case 'LINE':
    case 'RECTANGLE':
    case 'POLYGON':
      return { ...task, geometryType: task.geometry.type, point: task.geometry.points[0] };
    case 'CORRIDOR':
      return { ...task, geometryType: 'CORRIDOR', point: task.geometry.centreLine[0] };
  }
}

export function dispatchTwinMessage(payload: unknown): void {
  if (!isRecord(payload)) return;
  const uuid = stringValue(payload.uuid);
  if (!uuid) return;

  const store = useAppStore.getState();
  if (!store.drones[uuid]) return;

  const orientation = recordValue(payload.orientation);
  const geoPosition = recordValue(payload.geoPosition);
  const velocityVector = recordValue(payload.velocityVector);
  const heading = numberValue(payload.headingDegrees) ?? numberValue(orientation?.yawDegrees);
  const groundSpeed = numberValue(payload.groundSpeedMetersPerSecond);
  const climbRate = numberValue(payload.verticalSpeedMetersPerSecond);
  const course = calculateCourseDegrees(velocityVector) ?? heading;
  const lastSeen = parseTimestamp(payload.lastSeenAt) ?? Date.now();

  const telemetry: DroneTelemetryUpdate = removeUndefinedValues({
    position: buildPosition(geoPosition),
    heading,
    roll: numberValue(orientation?.rollDegrees),
    pitch: numberValue(orientation?.pitchDegrees),
    yaw: numberValue(orientation?.yawDegrees),
    groundSpeed,
    course,
    climbRate,
    lastSeen,
    twin: payload as TwinState,
  });

  store.updateDroneTelemetry(uuid, telemetry);
}

function buildPosition(geoPosition: Record<string, unknown> | undefined): GeoPoint | undefined {
  if (!geoPosition) return undefined;
  const latitude = numberValue(geoPosition.latitude);
  const longitude = numberValue(geoPosition.longitude);
  if (latitude === undefined || longitude === undefined) return undefined;
  return { latitude, longitude, altitude: numberValue(geoPosition.altitudeMslMeters) };
}

function calculateCourseDegrees(velocityVector: Record<string, unknown> | undefined): number | undefined {
  if (!velocityVector) return undefined;
  const north = numberValue(velocityVector.northMetersPerSecond);
  const east = numberValue(velocityVector.eastMetersPerSecond);
  if (north === undefined || east === undefined) return undefined;
  if (Math.abs(north) < 0.0001 && Math.abs(east) < 0.0001) return undefined;
  return normaliseDegrees(Math.atan2(east, north) * 180 / Math.PI);
}

function normaliseDegrees(value: number): number {
  return (value % 360 + 360) % 360;
}

function parseTimestamp(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : timestamp;
}

function removeUndefinedValues<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function dispatchMavlinkStreamStatus(systemId: number, payload: unknown): void {
  if (!Number.isInteger(systemId) || systemId < 1 || systemId > 255 || !isRecord(payload)) return;
  const status = stringValue(payload.status);
  if (!isMavlinkSequenceStatus(status)) return;

  const streamStatus: MavlinkStreamStatus = {
    previousSequenceNumber: integerValue(payload.previousSequenceNumber) ?? 0,
    currentSequenceNumber: integerValue(payload.currentSequenceNumber) ?? 0,
    expectedSequenceNumber: integerValue(payload.expectedSequenceNumber) ?? 0,
    delta: integerValue(payload.delta) ?? 0,
    lostPackets: integerValue(payload.lostPackets) ?? 0,
    timestamp: integerValue(payload.timestamp) ?? Date.now(),
    statusChanged: booleanValue(payload.statusChanged) ?? false,
    status,
  };

  useAppStore.getState().updateMavlinkStreamStatus(systemId, streamStatus);
}

function isMavlinkSequenceStatus(value: string | undefined): value is MavlinkSequenceStatus {
  return value === 'INITIAL' || value === 'OK' || value === 'LOSS' || value === 'RESET' || value === 'OUT_OF_ORDER';
}

function integerValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}
