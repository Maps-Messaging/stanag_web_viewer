import type {
  BrokerConfiguration,
  Drone,
  DroneCapability,
  DroneTask,
  GeoPoint,
  TaskGeometry,
  TaskState,
  TaskType,
} from '../models/types';
import { createUuid } from './uuid';

export interface ParsedTaskStatus {
  messageType: 'MessageTypeEnum_TASK_FEEDBACK' | 'MessageTypeEnum_TASK_RESULT';
  taskId: string;
  droneId: string;
  state: TaskState;
  percentComplete?: number;
  message?: string;
}

export interface ParsedTaskAdmin {
  action: 'PUSH' | 'CANCEL';
  taskId: string;
  droneId: string;
  sourceNode: string;
  authorityGuid?: string;
  task?: DroneTask;
}

export interface ParsedNodeMessage {
  messageType: 'MessageTypeEnum_NODE_DESCRIPTION' | 'MessageTypeEnum_NODE_STATUS';
  drone: Drone;
}

function asObject(value: unknown, field = 'value'): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Expected JSON object: ${field}`);
  }
  return value as Record<string, unknown>;
}

function optionalObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function asNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new Error(`Expected numeric field: ${field}`);
  }
  return value;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Expected string field: ${field}`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function parseTimestamp(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : timestamp;
}

export function parseNodeMessage(payload: unknown): ParsedNodeMessage {
  const envelope = asObject(payload, 'message');
  const header = asObject(envelope.header, 'header');
  const body = asObject(envelope.body, 'body');
  const messageType = asString(header.message_type, 'header.message_type');

  if (messageType !== 'MessageTypeEnum_NODE_DESCRIPTION' && messageType !== 'MessageTypeEnum_NODE_STATUS') {
    throw new Error(`Unsupported node message type: ${messageType}`);
  }

  const identifier = asString(body.identifier ?? header.source, 'body.identifier');
  const description = optionalObject(body.description);
  const pose = optionalObject(body.pose);
  const velocity = optionalObject(body.velocity);
  const position = parsePosition(pose);
  const orientation = parseOrientation(pose);
  const movement = parseVelocity(velocity);

  const drone: Drone = {
    id: identifier,
    name: optionalString(description?.name) ?? optionalString(description?.description) ?? identifier,
    description: optionalString(description?.description),
    organization: optionalString(description?.organization),
    nationality: optionalString(description?.nationality),
    contextType: optionalString(description?.context_type),
    standardIdentity: optionalString(description?.standard_identity),
    symbolSet: optionalString(description?.symbol_set),
    entityStatus: optionalString(description?.status),
    entity: optionalString(description?.entity),
    entityType: optionalString(description?.entity_type),
    entitySubtype: optionalString(description?.entity_subtype),
    sector1: optionalString(description?.sector_1),
    sector2: optionalString(description?.sector_2),
    position: messageType === 'MessageTypeEnum_NODE_DESCRIPTION' && isNullIsland(position) ? undefined : position,
    heading: normaliseHeading(orientation?.yaw),
    roll: orientation?.roll,
    pitch: orientation?.pitch,
    groundSpeed: movement?.speed ?? 0,
    course: movement?.course,
    climbRate: movement?.climbRate,
    capabilities: parseCapabilities(body.capabilities),
    stateTimestamp: parseTimestamp(body.timestamp),
    validUntil: parseTimestamp(body.time_of_validity),
    initiatedAt: parseTimestamp(body.time_of_initiation),
    lastSeen: Date.now(),
  };

  return { messageType, drone };
}

function parsePosition(pose: Record<string, unknown> | undefined): GeoPoint | undefined {
  const position = optionalObject(pose?.position);
  if (!position || position.$discriminator !== 'PositionTypeEnum_LATITUDE_LONGITUDE_ALTITUDE') return undefined;
  return parseLatitudeLongitudeAltitude(optionalObject(position.latitude_longitude_altitude));
}

function parseLatitudeLongitudeAltitude(value: Record<string, unknown> | undefined): GeoPoint | undefined {
  if (!value) return undefined;
  const latitude = optionalNumber(value.latitude) ?? optionalNumber(value.y);
  const longitude = optionalNumber(value.longitude) ?? optionalNumber(value.x);
  if (latitude === undefined || longitude === undefined) return undefined;

  const altitudes = Array.isArray(value.altitude) ? value.altitude : [];
  const altitudeEntries = altitudes.map(optionalObject).filter((entry): entry is Record<string, unknown> => Boolean(entry));
  const preferredAltitude = altitudeEntries.find((entry) => entry.type === 'AltitudeTypeEnum_WGS') ?? altitudeEntries[0];

  return {
    latitude,
    longitude,
    altitude: optionalNumber(preferredAltitude?.value) ?? optionalNumber(value.altitude) ?? optionalNumber(value.z),
    altitudeType: optionalString(preferredAltitude?.type),
  };
}

function parseOrientation(pose: Record<string, unknown> | undefined): { roll?: number; pitch?: number; yaw?: number } | undefined {
  const orientation = optionalObject(pose?.orientation);
  if (!orientation || orientation.$discriminator !== 'OrientationTypeEnum_EULER_ANGLES') return undefined;
  const angles = optionalObject(orientation.euler_angles);
  if (!angles) return undefined;
  return {
    roll: optionalNumber(angles.roll),
    pitch: optionalNumber(angles.pitch),
    yaw: optionalNumber(angles.yaw),
  };
}

function parseVelocity(velocity: Record<string, unknown> | undefined): { speed?: number; course?: number; climbRate?: number } | undefined {
  if (!velocity || velocity.$discriminator !== 'VelocityTypeEnum_SPEED_COURSE_CLIMB_RATE') return undefined;
  const values = optionalObject(velocity.speed_course_climb_rate);
  if (!values) return undefined;
  return {
    speed: optionalNumber(values.speed),
    course: optionalNumber(values.course),
    climbRate: optionalNumber(values.climb_rate),
  };
}

function parseCapabilities(value: unknown): DroneCapability[] {
  const capabilities = optionalObject(value);
  if (!capabilities || !Array.isArray(capabilities.task_capabilities)) return [];

  return capabilities.task_capabilities.flatMap((candidate) => {
    const capability = optionalObject(candidate);
    if (!capability) return [];
    const taskType = optionalString(capability.task_type);
    if (!taskType) return [];

    const authorities = Array.isArray(capability.authorities)
      ? capability.authorities.flatMap((authority) => {
          const authorityObject = optionalObject(authority);
          const guid = optionalString(authorityObject?.guid);
          return guid ? [guid] : [];
        })
      : [];

    return [{
      taskType,
      taskSpecialization: optionalString(capability.task_specialization) ?? 'NONE',
      authorities,
    }];
  });
}

function isNullIsland(position: GeoPoint | undefined): boolean {
  return position?.latitude === 0 && position.longitude === 0;
}

function normaliseHeading(yaw: number | undefined): number {
  if (yaw === undefined) return 0;
  return (yaw % 360 + 360) % 360;
}

export function buildTaskAdminPush(configuration: BrokerConfiguration, task: DroneTask): unknown {
  const timestamp = stanagTimestamp();
  return {
    header: buildTaskAdminHeader(configuration, timestamp),
    body: {
      action: 'TaskAdminActionEnum_PUSH',
      identifier: task.id,
      node: task.droneId,
      authority: buildAuthority(task.authorityGuid),
      description: buildTaskDescription(task, timestamp),
    },
  };
}

export function buildTaskAdminCancel(configuration: BrokerConfiguration, task: DroneTask): unknown {
  const timestamp = stanagTimestamp();
  return {
    header: buildTaskAdminHeader(configuration, timestamp),
    body: {
      action: 'TaskAdminActionEnum_CANCEL',
      identifier: task.id,
      node: task.droneId,
      authority: buildAuthority(task.authorityGuid),
    },
  };
}

export function resolveTaskAdminDestination(template: string, droneId: string): string {
  return template
    .replaceAll('{droneUuid}', droneId)
    .replaceAll('{droneId}', droneId);
}

function buildTaskAdminHeader(configuration: BrokerConfiguration, timestamp: string): unknown {
  return {
    message_type: 'MessageTypeEnum_TASK_ADMIN',
    source: configuration.sourceUuid,
    time_sent: timestamp,
    version: configuration.stanagVersion,
  };
}

function buildAuthority(authorityGuid: string): unknown {
  return {
    $discriminator: 'AuthorityTypeEnum_GUID',
    guid: authorityGuid,
  };
}

function buildTaskDescription(task: DroneTask, timestamp: string): unknown {
  const discriminator = `TaskTypeEnum_${task.type}`;
  const taskKey = task.type.toLowerCase();

  if (task.type === 'REPOSITION') {
    return {
      $discriminator: discriminator,
      [taskKey]: {
        location: buildTimestampedLocation(task.geometry, timestamp),
      },
    };
  }

  if (task.type === 'LOITER' && task.geometry.type === 'POINT') {
    return {
      $discriminator: discriminator,
      loiter: {
        pose: {
          identifier: createUuid(),
          timestamp,
          pose: {
            position: buildPositionUnion(task.geometry.point),
          },
        },
      },
    };
  }

  if (task.type === 'LOITER' && task.geometry.type === 'CIRCLE') {
    return {
      $discriminator: discriminator,
      loiter: {
        volume: {
          identifier: createUuid(),
          timestamp,
          volume: {
            region: {
              $discriminator: 'RegionTypeEnum_CIRCLE',
              circle: {
                centre: buildPosition(task.geometry.centre),
                radius: task.geometry.radiusMeters,
              },
            },
          },
        },
      },
    };
  }

  return {
    $discriminator: discriminator,
    [taskKey]: {
      location: buildTimestampedLocation(task.geometry, timestamp),
    },
  };
}

function buildTimestampedLocation(geometry: TaskGeometry, timestamp: string): unknown {
  return {
    identifier: createUuid(),
    timestamp,
    location: buildGeometry(geometry),
  };
}

function buildGeometry(geometry: TaskGeometry): unknown {
  switch (geometry.type) {
    case 'POINT':
      return { $discriminator: 'GeometryTypeEnum_POINT', point: buildPosition(geometry.point) };
    case 'CIRCLE':
      return {
        $discriminator: 'GeometryTypeEnum_CIRCLE',
        circle: { centre: buildPosition(geometry.centre), radius: geometry.radiusMeters },
      };
    case 'LINE':
      return { $discriminator: 'GeometryTypeEnum_LINE', line: { points: geometry.points.map(buildPosition) } };
    case 'RECTANGLE':
      return { $discriminator: 'GeometryTypeEnum_RECTANGLE', rectangle: { points: closeRing(geometry.points).map(buildPosition) } };
    case 'POLYGON':
      return { $discriminator: 'GeometryTypeEnum_POLYGON', polygon: { points: closeRing(geometry.points).map(buildPosition) } };
    case 'CORRIDOR':
      return {
        $discriminator: 'GeometryTypeEnum_CORRIDOR',
        corridor_area: {
          center_line: geometry.centreLine.map(buildPosition),
          width: geometry.widthMeters,
        },
      };
  }
}

function buildPositionUnion(point: GeoPoint): unknown {
  return {
    $discriminator: 'PositionTypeEnum_LATITUDE_LONGITUDE_ALTITUDE',
    latitude_longitude_altitude: buildPosition(point),
  };
}

function buildPosition(point: GeoPoint): unknown {
  return {
    latitude: point.latitude,
    longitude: point.longitude,
    altitude: point.altitude ?? 0,
  };
}

function closeRing(points: GeoPoint[]): GeoPoint[] {
  if (points.length === 0) return [];
  const first = points[0];
  const last = points[points.length - 1];
  return first.latitude === last.latitude && first.longitude === last.longitude ? points : [...points, first];
}

function stanagTimestamp(): string {
  return new Date().toISOString();
}

export function getStanagMessageType(payload: unknown): string {
  const envelope = asObject(payload, 'message');
  const header = asObject(envelope.header, 'header');
  return asString(header.message_type, 'header.message_type');
}

export function parseTaskAdmin(payload: unknown): ParsedTaskAdmin {
  const envelope = asObject(payload, 'message');
  const header = asObject(envelope.header, 'header');
  const body = asObject(envelope.body, 'body');
  const messageType = asString(header.message_type, 'header.message_type');
  if (messageType !== 'MessageTypeEnum_TASK_ADMIN') throw new Error(`Unsupported task message type: ${messageType}`);

  const actionValue = asString(body.action, 'body.action');
  const action = actionValue === 'TaskAdminActionEnum_PUSH'
    ? 'PUSH'
    : actionValue === 'TaskAdminActionEnum_CANCEL'
      ? 'CANCEL'
      : undefined;
  if (!action) throw new Error(`Unsupported task admin action: ${actionValue}`);

  const taskId = asString(body.identifier, 'body.identifier');
  const droneId = asString(body.node, 'body.node');
  const sourceNode = asString(header.source, 'header.source');
  const authorityGuid = optionalString(optionalObject(body.authority)?.guid);

  if (action === 'CANCEL') return { action, taskId, droneId, sourceNode, authorityGuid };

  const description = asObject(body.description, 'body.description');
  const type = parseTaskType(asString(description.$discriminator, 'body.description.$discriminator'));
  const geometry = parseTaskGeometry(description);
  const createdAt = parseTimestamp(header.time_sent) ?? Date.now();

  return {
    action,
    taskId,
    droneId,
    sourceNode,
    authorityGuid,
    task: {
      id: taskId,
      droneId,
      authorityGuid: authorityGuid ?? '',
      type,
      geometry,
      state: 'SUBMITTED',
      createdAt,
      updatedAt: Date.now(),
      sourceNode,
    },
  };
}

function parseTaskType(discriminator: string): TaskType {
  const value = discriminator.replace('TaskTypeEnum_', '');
  if (value === 'REPOSITION' || value === 'LOITER' || value === 'NAVIGATE') return value;
  throw new Error(`Unsupported task type: ${discriminator}`);
}

function parseTaskGeometry(description: Record<string, unknown>): TaskGeometry {
  const geometry = findDiscriminatedObject(description, (value) => value.startsWith('GeometryTypeEnum_'));
  if (geometry) return parseGeometryObject(geometry);

  const region = findDiscriminatedObject(description, (value) => value === 'RegionTypeEnum_CIRCLE');
  if (region) {
    const circle = asObject(region.circle, 'circle');
    const centre = parsePoint(circle.centre);
    const radiusMeters = parseDistance(circle.radius, 'circle.radius');
    return { type: 'CIRCLE', centre, radiusMeters };
  }

  const position = findDiscriminatedObject(description, (value) => value === 'PositionTypeEnum_LATITUDE_LONGITUDE_ALTITUDE');
  if (position) {
    const point = parseLatitudeLongitudeAltitude(optionalObject(position.latitude_longitude_altitude));
    if (point) return { type: 'POINT', point };
  }

  throw new Error('Task description does not contain a supported geometry');
}

function parseGeometryObject(value: Record<string, unknown>): TaskGeometry {
  switch (value.$discriminator) {
    case 'GeometryTypeEnum_POINT':
      return { type: 'POINT', point: parsePoint(value.point) };
    case 'GeometryTypeEnum_CIRCLE': {
      const circle = asObject(value.circle, 'circle');
      return { type: 'CIRCLE', centre: parsePoint(circle.centre), radiusMeters: parseDistance(circle.radius, 'circle.radius') };
    }
    case 'GeometryTypeEnum_LINE':
      return { type: 'LINE', points: parsePointList(asObject(value.line, 'line').points, 2, 'line.points') };
    case 'GeometryTypeEnum_RECTANGLE':
      return { type: 'RECTANGLE', points: removeClosingPoint(parsePointList(asObject(value.rectangle, 'rectangle').points, 4, 'rectangle.points')) };
    case 'GeometryTypeEnum_POLYGON':
      return { type: 'POLYGON', points: removeClosingPoint(parsePointList(asObject(value.polygon, 'polygon').points, 3, 'polygon.points')) };
    case 'GeometryTypeEnum_CORRIDOR': {
      const corridor = asObject(value.corridor_area, 'corridor_area');
      const centreLineValue = optionalObject(corridor.center_line)?.points ?? corridor.center_line;
      return {
        type: 'CORRIDOR',
        centreLine: parsePointList(centreLineValue, 2, 'corridor_area.center_line'),
        widthMeters: parseDistance(corridor.width, 'corridor_area.width'),
      };
    }
    default:
      throw new Error(`Unsupported geometry discriminator: ${String(value.$discriminator)}`);
  }
}

function parsePoint(value: unknown): GeoPoint {
  const object = asObject(value, 'point');
  const point = parseLatitudeLongitudeAltitude(object)
    ?? parseLatitudeLongitudeAltitude(optionalObject(object.latitude_longitude_altitude));
  if (!point) throw new Error('Point does not contain latitude and longitude');
  return point;
}

function parsePointList(value: unknown, minimum: number, field: string): GeoPoint[] {
  if (!Array.isArray(value)) throw new Error(`Expected point array: ${field}`);
  const points = value.map(parsePoint);
  if (points.length < minimum) throw new Error(`${field} requires at least ${minimum} points`);
  return points;
}

function parseDistance(value: unknown, field: string): number {
  const direct = optionalNumber(value);
  const wrapped = optionalNumber(optionalObject(value)?.value);
  const result = direct ?? wrapped;
  if (result === undefined || result <= 0) throw new Error(`${field} must be a positive distance`);
  return result;
}

function removeClosingPoint(points: GeoPoint[]): GeoPoint[] {
  if (points.length < 2) return points;
  const first = points[0];
  const last = points[points.length - 1];
  return first.latitude === last.latitude && first.longitude === last.longitude ? points.slice(0, -1) : points;
}

function findDiscriminatedObject(
  value: unknown,
  predicate: (discriminator: string) => boolean,
): Record<string, unknown> | undefined {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const match = findDiscriminatedObject(entry, predicate);
      if (match) return match;
    }
    return undefined;
  }
  const object = optionalObject(value);
  if (!object) return undefined;
  const discriminator = optionalString(object.$discriminator);
  if (discriminator && predicate(discriminator)) return object;
  for (const entry of Object.values(object)) {
    const match = findDiscriminatedObject(entry, predicate);
    if (match) return match;
  }
  return undefined;
}

export function parseTaskStatus(payload: unknown): ParsedTaskStatus {
  const envelope = asObject(payload, 'message');
  const header = asObject(envelope.header, 'header');
  const body = asObject(envelope.body, 'body');
  const messageType = asString(header.message_type, 'header.message_type');

  if (messageType !== 'MessageTypeEnum_TASK_FEEDBACK' && messageType !== 'MessageTypeEnum_TASK_RESULT') {
    throw new Error(`Unsupported task message type: ${messageType}`);
  }

  const stanagState = asString(body.state, 'body.state');
  const resultReason = optionalObject(body.result_reason);

  return {
    messageType,
    taskId: asString(body.identifier, 'body.identifier'),
    droneId: asString(body.node ?? header.source, 'body.node'),
    state: mapTaskState(stanagState),
    percentComplete: optionalNumber(body.percent_complete),
    message: optionalString(resultReason?.name) ?? optionalString(body.message),
  };
}

function mapTaskState(state: string): TaskState {
  switch (state) {
    case 'TaskStateEnum_PENDING':
    case 'TaskStateEnum_ACCEPTED':
      return 'ACCEPTED';
    case 'TaskStateEnum_ACTIVE':
      return 'EXECUTING';
    case 'TaskStateEnum_SUCCEEDED':
      return 'COMPLETED';
    case 'TaskStateEnum_CANCELLED':
    case 'TaskStateEnum_CANCELED':
      return 'CANCELLED';
    case 'TaskStateEnum_REJECTED':
      return 'REJECTED';
    case 'TaskStateEnum_FAILED':
    case 'TaskStateEnum_ABORTED':
      return 'FAILED';
    default:
      throw new Error(`Unsupported STANAG task state: ${state}`);
  }
}
