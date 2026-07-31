import type {
  BrokerConfiguration,
  Drone,
  DroneCapability,
  DroneTask,
  GeoPoint,
  TaskGeometry,
  TaskGeometryType,
  TaskState,
  TaskType,
} from '../models/types';
import { createUuid } from './uuid';

const DEFAULT_POINT_VOLUME_RADIUS_METERS = 25;

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
  if (!isObject(value)) throw new Error(`Expected JSON object: ${field}`);
  return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalObject(value: unknown): Record<string, unknown> | undefined {
  return isObject(value) ? value : undefined;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Expected string field: ${field}`);
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
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
  const position = parsePosePosition(pose);
  const orientation = parseOrientation(pose);
  const movement = parseVelocity(velocity);

  return {
    messageType,
    drone: {
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
    },
  };
}

function parsePosePosition(pose: Record<string, unknown> | undefined): GeoPoint | undefined {
  const position = optionalObject(pose?.position);
  if (!position || position.$discriminator !== 'PositionTypeEnum_LATITUDE_LONGITUDE_ALTITUDE') return undefined;
  return parsePoint(position.latitude_longitude_altitude);
}

function parseOrientation(pose: Record<string, unknown> | undefined): { roll?: number; pitch?: number; yaw?: number } | undefined {
  const orientation = optionalObject(pose?.orientation);
  if (!orientation || orientation.$discriminator !== 'OrientationTypeEnum_EULER_ANGLES') return undefined;
  const angles = optionalObject(orientation.euler_angles);
  if (!angles) return undefined;
  return { roll: optionalNumber(angles.roll), pitch: optionalNumber(angles.pitch), yaw: optionalNumber(angles.yaw) };
}

function parseVelocity(velocity: Record<string, unknown> | undefined): { speed?: number; course?: number; climbRate?: number } | undefined {
  if (!velocity || velocity.$discriminator !== 'VelocityTypeEnum_SPEED_COURSE_CLIMB_RATE') return undefined;
  const values = optionalObject(velocity.speed_course_climb_rate);
  if (!values) return undefined;
  return { speed: optionalNumber(values.speed), course: optionalNumber(values.course), climbRate: optionalNumber(values.climb_rate) };
}

function parseCapabilities(value: unknown): DroneCapability[] {
  const capabilities = optionalObject(value);
  if (!capabilities || !Array.isArray(capabilities.task_capabilities)) return [];

  return capabilities.task_capabilities.flatMap((candidate) => {
    const capability = optionalObject(candidate);
    const taskType = optionalString(capability?.task_type);
    if (!capability || !taskType) return [];
    const authorities = Array.isArray(capability.authorities)
      ? capability.authorities.flatMap((authority) => {
          const guid = optionalString(optionalObject(authority)?.guid);
          return guid ? [guid] : [];
        })
      : [];
    return [{ taskType, taskSpecialization: optionalString(capability.task_specialization) ?? 'NONE', authorities }];
  });
}

function isNullIsland(position: GeoPoint | undefined): boolean {
  return position?.latitude === 0 && position.longitude === 0;
}

function normaliseHeading(value: number | undefined): number {
  return value === undefined ? 0 : (value % 360 + 360) % 360;
}

export function buildTaskAdminPush(configuration: BrokerConfiguration, task: DroneTask): unknown {
  const timestamp = new Date().toISOString();
  return {
    header: buildHeader(configuration, timestamp),
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
  const timestamp = new Date().toISOString();
  return {
    header: buildHeader(configuration, timestamp),
    body: {
      action: 'TaskAdminActionEnum_CANCEL',
      identifier: task.id,
      node: task.droneId,
      authority: buildAuthority(task.authorityGuid),
    },
  };
}

export function resolveTaskAdminDestination(template: string, droneId: string): string {
  return template.replaceAll('{droneUuid}', droneId).replaceAll('{droneId}', droneId);
}

function buildHeader(configuration: BrokerConfiguration, timestamp: string): unknown {
  return {
    message_type: 'MessageTypeEnum_TASK_ADMIN',
    source: configuration.sourceUuid,
    time_sent: timestamp,
    version: configuration.stanagVersion,
  };
}

function buildAuthority(guid: string): unknown {
  return { $discriminator: 'AuthorityTypeEnum_GUID', guid };
}

function buildTaskDescription(task: DroneTask, timestamp: string): unknown {
  const discriminator = `TaskTypeEnum_${task.type}`;

  switch (task.type) {
    case 'REPOSITION':
      if (task.geometry.type !== 'POINT') throw new Error(`REPOSITION does not support ${task.geometry.type} geometry`);
      return {
        $discriminator: discriminator,
        reposition: {
          location: {
            identifier: createUuid(),
            timestamp,
            location: buildLocationGeometry(task.geometry),
          },
        },
      };

    case 'NAVIGATE': {
      const points = task.geometry.type === 'POINT'
        ? [task.geometry.point]
        : task.geometry.type === 'LINE'
          ? task.geometry.points
          : undefined;
      if (!points) throw new Error(`NAVIGATE does not support ${task.geometry.type} geometry`);
      return { $discriminator: discriminator, navigate: { route: { points: points.map(buildGeometryPoint) } } };
    }

    case 'PATROL':
      return {
        $discriminator: discriminator,
        patrol: { geometry: buildPatrolGeometry(task.geometry), pattern: 'LADDER' },
      };

    case 'LOITER':
      if (task.geometry.type === 'POINT') {
        return {
          $discriminator: discriminator,
          loiter: {
            pose: {
              $discriminator: 'ValueTypeEnum_POSE',
              pose: { position: buildPositionUnion(task.geometry.point) },
            },
          },
        };
      }
      return { $discriminator: discriminator, loiter: { volume: buildLabeledVolume(task.geometry, timestamp) } };

    case 'STANDBY':
      return { $discriminator: discriminator, standby: buildVolumeTask(task.geometry, timestamp) };

    case 'DETECT':
      return { $discriminator: discriminator, detect: buildSensingVolumeTask(task.geometry, timestamp) };

    case 'SURVEY':
      return { $discriminator: discriminator, survey: buildSensingVolumeTask(task.geometry, timestamp) };

    case 'SCREEN':
      return { $discriminator: discriminator, screen: buildVolumeTask(task.geometry, timestamp) };
  }
}

function buildVolumeTask(geometry: TaskGeometry, timestamp: string): unknown {
  return { volume: buildLabeledVolume(geometry, timestamp) };
}

function buildSensingVolumeTask(geometry: TaskGeometry, timestamp: string): unknown {
  return { sensor_type: 'SensingModeEnum_PASSIVE', volume: buildLabeledVolume(geometry, timestamp) };
}

function buildLabeledVolume(geometry: TaskGeometry, timestamp: string): unknown {
  return {
    identifier: createUuid(),
    timestamp,
    volume: { region: buildRegionGeometry(geometry) },
  };
}

function buildRegionGeometry(geometry: TaskGeometry): unknown {
  switch (geometry.type) {
    case 'POINT':
      return {
        $discriminator: 'RegionTypeEnum_CIRCLE',
        circle: { centre: buildGeometryPoint(geometry.point), radius: DEFAULT_POINT_VOLUME_RADIUS_METERS },
      };
    case 'CIRCLE':
      return {
        $discriminator: 'RegionTypeEnum_CIRCLE',
        circle: { centre: buildGeometryPoint(geometry.centre), radius: geometry.radiusMeters },
      };
    case 'RECTANGLE':
      return {
        $discriminator: 'RegionTypeEnum_POLYGON_AREA',
        polygon_area: { points: closeRing(geometry.points).map(buildGeometryPoint) },
      };
    case 'POLYGON':
      return {
        $discriminator: 'RegionTypeEnum_POLYGON_AREA',
        polygon_area: { points: closeRing(geometry.points).map(buildGeometryPoint) },
      };
    case 'CORRIDOR':
      return {
        $discriminator: 'RegionTypeEnum_CORRIDOR_AREA',
        corridor_area: {
          center_line: geometry.centreLine.map(buildGeometryPoint),
          width: geometry.widthMeters,
        },
      };
    case 'LINE':
      throw new Error('Volume tasks do not support LINE geometry; use CORRIDOR');
  }
}

function buildPositionUnion(point: GeoPoint): unknown {
  return {
    $discriminator: 'PositionTypeEnum_LATITUDE_LONGITUDE_ALTITUDE',
    latitude_longitude_altitude: buildPositionValue(point),
  };
}

function buildLocationGeometry(geometry: TaskGeometry): unknown {
  switch (geometry.type) {
    case 'POINT': return { $discriminator: 'GeometryTypeEnum_POINT', point: buildGeometryPoint(geometry.point) };
    case 'CIRCLE': return { $discriminator: 'GeometryTypeEnum_CIRCLE', circle: { centre: buildGeometryPoint(geometry.centre), radius: geometry.radiusMeters } };
    case 'LINE': return { $discriminator: 'GeometryTypeEnum_LINE', line: { points: geometry.points.map(buildGeometryPoint) } };
    case 'RECTANGLE': return { $discriminator: 'GeometryTypeEnum_RECTANGLE', rectangle: { points: geometry.points.map(buildGeometryPoint) } };
    case 'POLYGON': return { $discriminator: 'GeometryTypeEnum_POLYGON_AREA', polygon: { points: closeRing(geometry.points).map(buildGeometryPoint) } };
    case 'CORRIDOR':
      return {
        $discriminator: 'GeometryTypeEnum_CORRIDOR_AREA',
        corridor_area: {
          center_line: geometry.centreLine.map(buildGeometryPoint),
          width: buildDistance(geometry.widthMeters),
        },
      };
  }
}

function buildPatrolGeometry(geometry: TaskGeometry): unknown {
  switch (geometry.type) {
    case 'CIRCLE':
      return {
        $discriminator: 'GeometryTypeEnum_CIRCLE',
        circle: { centre: buildGeometryPoint(geometry.centre), radius: buildDistance(geometry.radiusMeters) },
      };
    case 'RECTANGLE':
      return { $discriminator: 'GeometryTypeEnum_RECTANGLE', rectangle: { points: geometry.points.map(buildGeometryPoint) } };
    case 'POLYGON':
      return { $discriminator: 'GeometryTypeEnum_POLYGON_AREA', polygon: { points: closeRing(geometry.points).map(buildGeometryPoint) } };
    case 'CORRIDOR':
      return {
        $discriminator: 'GeometryTypeEnum_CORRIDOR_AREA',
        corridor_area: {
          center_line: geometry.centreLine.map(buildGeometryPoint),
          width: buildDistance(geometry.widthMeters),
        },
      };
    default:
      throw new Error(`PATROL does not support ${geometry.type} geometry`);
  }
}

function buildGeometryPoint(point: GeoPoint): unknown {
  return { latitude: point.latitude, longitude: point.longitude, altitude: point.altitude ?? 0 };
}

function buildPositionValue(point: GeoPoint): unknown {
  return {
    latitude: point.latitude,
    longitude: point.longitude,
    altitude: [{ type: point.altitudeType ?? 'AltitudeTypeEnum_WGS', value: point.altitude ?? 0 }],
  };
}

function buildDistance(value: number): unknown {
  return { value, unit: 'M' };
}

function closeRing(points: GeoPoint[]): GeoPoint[] {
  if (points.length === 0) return points;
  const first = points[0];
  const last = points[points.length - 1];
  return samePoint(first, last) ? points : [...points, first];
}

export function getStanagMessageType(payload: unknown): string {
  const envelope = asObject(payload, 'message');
  return asString(asObject(envelope.header, 'header').message_type, 'header.message_type');
}

export function parseTaskAdmin(payload: unknown): ParsedTaskAdmin {
  const envelope = asObject(payload, 'message');
  const header = asObject(envelope.header, 'header');
  const body = asObject(envelope.body, 'body');
  if (asString(header.message_type, 'header.message_type') !== 'MessageTypeEnum_TASK_ADMIN') {
    throw new Error('Expected TASK_ADMIN message');
  }

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
  const summary = geometrySummary(geometry);
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
      geometryType: geometry.type,
      point: summary.point,
      radiusMeters: summary.radiusMeters,
      state: 'SUBMITTED',
      createdAt,
      updatedAt: Date.now(),
      sourceNode,
    },
  };
}

function parseTaskType(value: string): TaskType {
  const type = value.replace('TaskTypeEnum_', '');
  switch (type) {
    case 'REPOSITION':
    case 'NAVIGATE':
    case 'PATROL':
    case 'LOITER':
    case 'STANDBY':
    case 'DETECT':
    case 'SURVEY':
    case 'SCREEN':
      return type;
    default:
      throw new Error(`Unsupported task type: ${value}`);
  }
}

function parseTaskGeometry(description: Record<string, unknown>): TaskGeometry {
  const geometry = findDiscriminator(description, (value) => value.startsWith('GeometryTypeEnum_'));
  if (geometry) return parseGeometry(geometry);

  const region = findDiscriminator(description, (value) => value.startsWith('RegionTypeEnum_'));
  if (region) return parseRegionGeometry(region);

  const position = findDiscriminator(description, (value) => value === 'PositionTypeEnum_LATITUDE_LONGITUDE_ALTITUDE');
  if (position) return { type: 'POINT', point: parsePoint(position.latitude_longitude_altitude) };

  const route = findRoutePoints(description);
  if (route) return route.length === 1 ? { type: 'POINT', point: route[0] } : { type: 'LINE', points: route };

  throw new Error('Task description does not contain a supported geometry');
}

function findRoutePoints(description: Record<string, unknown>): GeoPoint[] | undefined {
  const navigate = optionalObject(description.navigate);
  const route = optionalObject(navigate?.route);
  if (!route || !Array.isArray(route.points)) return undefined;
  return parsePoints(route.points, 1, 'navigate.route.points');
}

function parseRegionGeometry(value: Record<string, unknown>): TaskGeometry {
  switch (value.$discriminator) {
    case 'RegionTypeEnum_CIRCLE': {
      const circle = asObject(value.circle, 'circle');
      return { type: 'CIRCLE', centre: parsePoint(circle.centre), radiusMeters: parseDistance(circle.radius, 'circle.radius') };
    }
    case 'RegionTypeEnum_POLYGON_AREA': {
      const polygon = asObject(value.polygon_area, 'polygon_area');
      return {
        type: 'POLYGON',
        points: removeClosingPoint(parsePoints(polygon.points ?? polygon.positions, 3, 'polygon_area.points')),
      };
    }
    case 'RegionTypeEnum_CORRIDOR_AREA': {
      const corridor = asObject(value.corridor_area, 'corridor_area');
      const centreLine = optionalObject(corridor.center_line)?.points ?? corridor.center_line;
      return {
        type: 'CORRIDOR',
        centreLine: parsePoints(centreLine, 2, 'corridor_area.center_line'),
        widthMeters: parseDistance(corridor.width, 'corridor_area.width'),
      };
    }
    default:
      throw new Error(`Unsupported region discriminator: ${String(value.$discriminator)}`);
  }
}

function parseGeometry(value: Record<string, unknown>): TaskGeometry {
  switch (value.$discriminator) {
    case 'GeometryTypeEnum_POINT': return { type: 'POINT', point: parsePoint(value.point) };
    case 'GeometryTypeEnum_CIRCLE': {
      const circle = asObject(value.circle, 'circle');
      return { type: 'CIRCLE', centre: parsePoint(circle.centre), radiusMeters: parseDistance(circle.radius, 'circle.radius') };
    }
    case 'GeometryTypeEnum_LINE': return { type: 'LINE', points: parsePoints(asObject(value.line, 'line').points, 2, 'line.points') };
    case 'GeometryTypeEnum_RECTANGLE': return { type: 'RECTANGLE', points: removeClosingPoint(parsePoints(asObject(value.rectangle, 'rectangle').points, 4, 'rectangle.points')) };
    case 'GeometryTypeEnum_POLYGON':
    case 'GeometryTypeEnum_POLYGON_AREA': {
      const polygon = optionalObject(value.polygon) ?? asObject(value.polygon_area, 'polygon_area');
      return { type: 'POLYGON', points: removeClosingPoint(parsePoints(polygon.points ?? polygon.positions, 3, 'polygon.points')) };
    }
    case 'GeometryTypeEnum_CORRIDOR':
    case 'GeometryTypeEnum_CORRIDOR_AREA': {
      const corridor = asObject(value.corridor_area, 'corridor_area');
      const centreLine = optionalObject(corridor.center_line)?.points ?? corridor.center_line;
      return {
        type: 'CORRIDOR',
        centreLine: parsePoints(centreLine, 2, 'corridor_area.center_line'),
        widthMeters: parseDistance(corridor.width, 'corridor_area.width'),
      };
    }
    default: throw new Error(`Unsupported geometry discriminator: ${String(value.$discriminator)}`);
  }
}

function parsePoint(value: unknown): GeoPoint {
  const object = asObject(value, 'point');
  const nested = optionalObject(object.latitude_longitude_altitude);
  const source = nested ?? object;
  const latitude = optionalNumber(source.latitude) ?? optionalNumber(source.y);
  const longitude = optionalNumber(source.longitude) ?? optionalNumber(source.x);
  if (latitude === undefined || longitude === undefined) throw new Error('Point requires latitude and longitude');

  const altitudeEntries = Array.isArray(source.altitude)
    ? source.altitude.map(optionalObject).filter((entry): entry is Record<string, unknown> => Boolean(entry))
    : [];
  const preferredAltitude = altitudeEntries.find((entry) => entry.type === 'AltitudeTypeEnum_WGS') ?? altitudeEntries[0];
  return {
    latitude,
    longitude,
    altitude: optionalNumber(preferredAltitude?.value) ?? optionalNumber(source.altitude) ?? optionalNumber(source.z),
    altitudeType: optionalString(preferredAltitude?.type),
  };
}

function parsePoints(value: unknown, minimum: number, field: string): GeoPoint[] {
  if (!Array.isArray(value)) throw new Error(`Expected point array: ${field}`);
  const points = value.map(parsePoint);
  if (points.length < minimum) throw new Error(`${field} requires at least ${minimum} points`);
  return points;
}

function parseDistance(value: unknown, field: string): number {
  const distance = optionalNumber(value) ?? optionalNumber(optionalObject(value)?.value);
  if (distance === undefined || distance <= 0) throw new Error(`${field} must be a positive distance`);
  return distance;
}

function removeClosingPoint(points: GeoPoint[]): GeoPoint[] {
  return points.length > 1 && samePoint(points[0], points[points.length - 1]) ? points.slice(0, -1) : points;
}

function samePoint(left: GeoPoint, right: GeoPoint): boolean {
  return left.latitude === right.latitude && left.longitude === right.longitude;
}

function geometrySummary(geometry: TaskGeometry): { point: GeoPoint; radiusMeters?: number; geometryType: TaskGeometryType } {
  switch (geometry.type) {
    case 'POINT': return { point: geometry.point, geometryType: geometry.type };
    case 'CIRCLE': return { point: geometry.centre, radiusMeters: geometry.radiusMeters, geometryType: geometry.type };
    case 'LINE':
    case 'RECTANGLE':
    case 'POLYGON': return { point: geometry.points[0], geometryType: geometry.type };
    case 'CORRIDOR': return { point: geometry.centreLine[0], geometryType: geometry.type };
  }
}

function findDiscriminator(value: unknown, predicate: (value: string) => boolean): Record<string, unknown> | undefined {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findDiscriminator(entry, predicate);
      if (found) return found;
    }
    return undefined;
  }
  const object = optionalObject(value);
  if (!object) return undefined;
  const discriminator = optionalString(object.$discriminator);
  if (discriminator && predicate(discriminator)) return object;
  for (const entry of Object.values(object)) {
    const found = findDiscriminator(entry, predicate);
    if (found) return found;
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
  const resultReason = optionalObject(body.result_reason);
  return {
    messageType,
    taskId: asString(body.identifier, 'body.identifier'),
    droneId: asString(body.node ?? header.source, 'body.node'),
    state: mapTaskState(asString(body.state, 'body.state')),
    percentComplete: optionalNumber(body.percent_complete),
    message: optionalString(resultReason?.name) ?? optionalString(body.message),
  };
}

function mapTaskState(state: string): TaskState {
  switch (state) {
    case 'TaskStateEnum_PENDING':
    case 'TaskStateEnum_ACCEPTED': return 'ACCEPTED';
    case 'TaskStateEnum_ACTIVE': return 'EXECUTING';
    case 'TaskStateEnum_SUCCEEDED': return 'COMPLETED';
    case 'TaskStateEnum_CANCELLED':
    case 'TaskStateEnum_CANCELED': return 'CANCELLED';
    case 'TaskStateEnum_REJECTED': return 'REJECTED';
    case 'TaskStateEnum_FAILED':
    case 'TaskStateEnum_ABORTED': return 'FAILED';
    default: throw new Error(`Unsupported STANAG task state: ${state}`);
  }
}
