import type { Detection, DroneTask, DroneTelemetryUpdate, GeoPoint, MavlinkSequenceStatus, MavlinkStreamStatus, TwinState } from '../models/types';
import {
  getDynamicUpdateValueType,
  parseDynamicDataProduct,
  parseDynamicTrack,
  type ParsedDataProduct,
} from '../services/dynamicUpdateAdapter';
import { mergePercentComplete, shouldApplyTaskState } from '../services/operationalState';
import { getStanagMessageType, parseNodeMessage, parseTaskAdmin, parseTaskStatus, type ParsedTaskStatus } from '../services/stanagAdapter';
import { getStanagTask } from '../services/stanagTaskRestClient';
import { useAppStore } from '../state/useAppStore';

const PENDING_TASK_STATUS_TTL_MILLIS = 30_000;
const PENDING_DATA_PRODUCT_TTL_MILLIS = 2 * 60 * 1000;
const unresolvedTaskStatuses = new Map<string, { status: ParsedTaskStatus; payload: unknown; expiresAt: number }>();
const taskDetailRequests = new Set<string>();
const pendingDataProducts = new Map<string, { products: ParsedDataProduct[]; expiresAt: number }>();

export function dispatchStanagMessage(payload: unknown): void {
  try {
    dispatchValidatedStanagMessage(payload);
  } catch (error) {
    useAppStore.getState().addEvent({
      level: 'ERROR',
      message: `Invalid STANAG message: ${formatError(error)}`,
      payload,
    });
  }
}

function dispatchValidatedStanagMessage(payload: unknown): void {
  const store = useAppStore.getState();
  const messageType = getStanagMessageType(payload);

  if (messageType === 'MessageTypeEnum_NODE_DESCRIPTION' || messageType === 'MessageTypeEnum_NODE_STATUS') {
    const node = parseNodeMessage(payload);
    store.upsertDrone(node.drone);

    if (messageType === 'MessageTypeEnum_NODE_DESCRIPTION') {
      store.addEvent({ level: 'INFO', message: `${node.messageType}: ${node.drone.name}`, payload });
    }
    return;
  }

  if (messageType === 'MessageTypeEnum_DYNAMIC_UPDATE') {
    dispatchDynamicUpdate(payload);
    return;
  }

  if (messageType === 'MessageTypeEnum_TASK_ADMIN') {
    dispatchTaskAdmin(payload);
    return;
  }

  if (messageType === 'MessageTypeEnum_TASK_FEEDBACK' || messageType === 'MessageTypeEnum_TASK_RESULT') {
    dispatchTaskStatus(payload);
    return;
  }

  store.addEvent({ level: 'WARN', message: `Unsupported STANAG message type: ${messageType}`, payload });
}

function dispatchDynamicUpdate(payload: unknown): void {
  const store = useAppStore.getState();
  try {
    const valueType = getDynamicUpdateValueType(payload);
    if (valueType === 'ValueTypeEnum_TRACK') {
      const detection = applyPendingDataProducts(parseDynamicTrack(payload));
      const previous = store.detections[detection.id];
      store.upsertDetection(detection);

      if (!previous) {
        store.addEvent({
          level: 'INFO',
          message: `Detection acquired: ${detection.name} ${detection.id}`,
          payload,
        });
      } else if (!previous.rtspUrl && detection.rtspUrl) {
        store.addEvent({
          level: 'INFO',
          message: `Detection video available: ${detection.name} ${detection.id}`,
          payload,
        });
      }
      return;
    }

    if (valueType === 'ValueTypeEnum_DATA_PRODUCT') {
      dispatchDataProduct(parseDynamicDataProduct(payload), payload);
      return;
    }

    store.addEvent({ level: 'WARN', message: `Unsupported DYNAMIC_UPDATE value: ${valueType}`, payload });
  } catch (error) {
    store.addEvent({
      level: 'WARN',
      message: `Unsupported DYNAMIC_UPDATE: ${formatError(error)}`,
      payload,
    });
  }
}

function dispatchDataProduct(dataProduct: ParsedDataProduct, payload: unknown): void {
  const store = useAppStore.getState();
  purgePendingDataProducts();

  if (dataProduct.trackIds.length === 0) {
    store.addEvent({
      level: 'INFO',
      message: `DATA_PRODUCT ${dataProduct.id} has no TRACK references`,
      payload,
    });
    return;
  }

  let attachedCount = 0;
  dataProduct.trackIds.forEach((trackId) => {
    const detection = store.detections[trackId];
    if (!detection) {
      const pending = pendingDataProducts.get(trackId);
      pendingDataProducts.set(trackId, {
        products: mergeDataProducts(pending?.products ?? [], [dataProduct]),
        expiresAt: Date.now() + PENDING_DATA_PRODUCT_TTL_MILLIS,
      });
      return;
    }

    store.upsertDetection(attachDataProducts(detection, [dataProduct]));
    attachedCount += 1;
  });

  store.addEvent({
    level: 'INFO',
    message: attachedCount > 0
        ? `DATA_PRODUCT ${dataProduct.id} attached to ${attachedCount} detection${attachedCount === 1 ? '' : 's'}`
        : `DATA_PRODUCT ${dataProduct.id} buffered pending referenced TRACK`,
    payload,
  });
}

function applyPendingDataProducts(detection: Detection): Detection {
  purgePendingDataProducts();
  const pending = pendingDataProducts.get(detection.id);
  if (!pending) return detection;
  pendingDataProducts.delete(detection.id);
  return attachDataProducts(detection, pending.products);
}

function attachDataProducts(detection: Detection, products: ParsedDataProduct[]): Detection {
  const urls = [...new Set(products.flatMap((product) => product.urls))];
  if (urls.length === 0) return detection;

  const existingUrls = detection.rtspUrl
      ? detection.rtspUrl.split(/\s*,\s*/).filter((url) => url.length > 0)
      : [];
  const combinedUrls = [...new Set([...existingUrls, ...urls])];

  return {
    ...detection,
    rtspUrl: combinedUrls.join(', '),
  };
}

function mergeDataProducts(existing: ParsedDataProduct[], incoming: ParsedDataProduct[]): ParsedDataProduct[] {
  const byId = new Map(existing.map((product) => [product.id, product]));
  incoming.forEach((product) => byId.set(product.id, product));
  return Array.from(byId.values());
}

function purgePendingDataProducts(): void {
  const now = Date.now();
  pendingDataProducts.forEach((pending, trackId) => {
    if (pending.expiresAt <= now) pendingDataProducts.delete(trackId);
  });
}

function dispatchTaskAdmin(payload: unknown): void {
  const store = useAppStore.getState();
  const admin = parseTaskAdmin(payload);

  if (admin.action === 'PUSH' && admin.task) {
    store.upsertTask(withDisplayFields(admin.task));
    const pending = unresolvedTaskStatuses.get(admin.taskId);
    if (pending && pending.expiresAt > Date.now() && pending.status.droneId === admin.droneId) {
      unresolvedTaskStatuses.delete(admin.taskId);
      applyTaskStatus(pending.status, pending.payload);
    }
    store.addEvent({
      level: 'INFO',
      message: `TASK_ADMIN PUSH: ${admin.task.type} ${admin.taskId}`,
      payload,
    });
    return;
  }

  const existing = store.tasks[admin.taskId];
  if (!existing) {
    store.addEvent({ level: 'WARN', message: `TASK_ADMIN CANCEL received for unknown task ${admin.taskId}`, payload });
    return;
  }
  if (existing.droneId !== admin.droneId) {
    store.addEvent({
      level: 'ERROR',
      message: `TASK_ADMIN CANCEL drone mismatch for ${admin.taskId}: expected ${existing.droneId}, received ${admin.droneId}`,
      payload,
    });
    return;
  }

  store.upsertTask({ ...existing, state: 'CANCEL_REQUESTED', updatedAt: Date.now() });
  store.addEvent({ level: 'INFO', message: `TASK_ADMIN CANCEL: ${admin.taskId}`, payload });
}

function dispatchTaskStatus(payload: unknown): void {
  const status = parseTaskStatus(payload);
  const store = useAppStore.getState();
  const existing = store.tasks[status.taskId];

  if (existing) {
    applyTaskStatus(status, payload);
    return;
  }

  purgeUnresolvedTaskStatuses();
  unresolvedTaskStatuses.set(status.taskId, {
    status,
    payload,
    expiresAt: Date.now() + PENDING_TASK_STATUS_TTL_MILLIS,
  });

  if (taskDetailRequests.has(status.taskId)) return;

  store.addEvent({
    level: 'INFO',
    message: `${status.messageType} received for a task not yet known to this UI; loading task details: ${status.taskId}`,
    payload,
  });

  taskDetailRequests.add(status.taskId);
  void resolveUnknownTask(status.taskId);
}

async function resolveUnknownTask(taskId: string): Promise<void> {
  const store = useAppStore.getState();

  try {
    const task = await getStanagTask(store.configuration, taskId);
    if (!task) {
      store.addEvent({
        level: 'WARN',
        message: `Task update received for unknown task ${taskId}; task details are not currently available`,
      });
      return;
    }

    store.upsertTask(withDisplayFields(task));

    const pending = unresolvedTaskStatuses.get(taskId);
    if (pending && pending.expiresAt > Date.now()) {
      unresolvedTaskStatuses.delete(taskId);
      applyTaskStatus(pending.status, pending.payload);
    }

    store.addEvent({
      level: 'INFO',
      message: `Task details loaded for ${taskId}`,
    });
  } catch (error) {
    store.addEvent({
      level: 'WARN',
      message: `Unable to load details for task ${taskId}: ${formatError(error)}`,
    });
  } finally {
    taskDetailRequests.delete(taskId);
  }
}

function applyTaskStatus(status: ParsedTaskStatus, payload: unknown): void {
  const store = useAppStore.getState();
  const existing = store.tasks[status.taskId];
  if (!existing) return;
  if (existing.droneId !== status.droneId) {
    store.addEvent({
      level: 'ERROR',
      message: `${status.messageType} drone mismatch for ${status.taskId}: expected ${existing.droneId}, received ${status.droneId}`,
      payload,
    });
    return;
  }
  if (!shouldApplyTaskState(existing.state, status.state)) {
    store.addEvent({
      level: 'WARN',
      message: `${status.messageType} ignored state regression for ${status.taskId}: ${existing.state} to ${status.state}`,
      payload,
    });
    return;
  }

  store.upsertTask({
    ...existing,
    state: status.state,
    percentComplete: mergePercentComplete(existing.percentComplete, status.percentComplete),
    updatedAt: Date.now(),
    message: status.message ?? existing.message,
  });

  store.addEvent({
    level: taskStatusLevel(status.state),
    message: `${status.messageType}: ${status.taskId} ${status.state}${
        status.percentComplete === undefined ? '' : ` ${status.percentComplete.toFixed(1)}%`
    }${status.message ? `: ${status.message}` : ''}`,
    payload,
  });
}

function purgeUnresolvedTaskStatuses(): void {
  const now = Date.now();
  unresolvedTaskStatuses.forEach((pending, taskId) => {
    if (pending.expiresAt <= now) unresolvedTaskStatuses.delete(taskId);
  });
}

function taskStatusLevel(state: DroneTask['state']): 'INFO' | 'WARN' | 'ERROR' {
  if (state === 'FAILED' || state === 'REJECTED' || state === 'ABORTED' || state === 'LOST') return 'ERROR';
  if (state === 'PREEMPTING' || state === 'PREEMPTED' || state === 'CANCELLED') return 'WARN';
  return 'INFO';
}

function withDisplayFields(task: DroneTask): DroneTask {
  switch (task.geometry.type) {
    case 'POINT': return { ...task, geometryType: 'POINT', point: task.geometry.point };
    case 'CIRCLE': return { ...task, geometryType: 'CIRCLE', point: task.geometry.centre, radiusMeters: task.geometry.radiusMeters };
    case 'LINE':
    case 'RECTANGLE':
    case 'POLYGON': return { ...task, geometryType: task.geometry.type, point: task.geometry.points[0] };
    case 'CORRIDOR': return { ...task, geometryType: 'CORRIDOR', point: task.geometry.centreLine[0] };
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

  const telemetry: DroneTelemetryUpdate = removeUndefinedValues({
    position: buildPosition(geoPosition),
    heading,
    roll: numberValue(orientation?.rollDegrees),
    pitch: numberValue(orientation?.pitchDegrees),
    yaw: numberValue(orientation?.yawDegrees),
    groundSpeed,
    course,
    climbRate,
    lastSeen: Date.now(),
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

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}