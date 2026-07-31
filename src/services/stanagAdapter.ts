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

const WGS_ALTITUDE_TYPE = 'AltitudeTypeEnum_WGS';

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
          const authorityValue = optionalObject(authority);
          if (authorityValue?.$discriminator !== 'AuthorityTypeEnum_GUID') return [];
          const guid = optionalString(authorityValue.guid);
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
            location: {
              $discriminator: 'GeometryTypeEnum_POINT',
              point: buildGeometryPoint(task.geometry.point),
            },
          },
        },
      };

    case 'NAVIGATE': {
      const points = routePoints(task.geometry, 'NAVIGATE');
      return { $discriminator: discriminator, navigate: { route: buildLabeledRoute(points, timestamp) } };
    }

    case 'PATROL':
      if (task.geometry.type === 'LINE' || task.geometry.type === 'POINT') {
        return {
          $discriminator: discriminator,
          patrol: { route: buildLabeledRoute(routePoints(task.geometry, 'PATROL'), timestamp) },
        };
      }
      return {
        $discriminator: discriminator,
        patrol: { volume: buildLabeledVolume(task.geometry, timestamp) },
      };

    case 'LOITER':
      if (task.geometry.type === 'POINT') {
        return {
          $discriminator: discriminator,
          loiter: {
            pose: {
              identifier: createUuid(),
              timestamp,
              pose: { position: buildPositionUnion(task.geometry.point) },
            },
          },
        };
      }
      return { $discriminator: discriminator, loiter: { volume: buildLabeledVolume(task.geometry, timestamp) } };

    case 'STANDBY':
      return { $discriminator: discriminator, standby: buildVolumeTask(task.geometry, timestamp) };

    case 'DETECT':
      return {
        $discriminator: discriminator,
        detect: {
          sensor_type: 'SensingModeEnum_PASSIVE',
          ...buildVolumeTask(task.geometry, timestamp),
        },
      };

    case 'SURVEY':
      return {
        $discriminator: discriminator,
        survey: {
          sensor_type: 'SensingModeEnum_PASSIVE',
          ...buildVolumeTask(task.geometry, timestamp),
        },
      };

    case 'SCREEN':
      return { $discriminator: discriminator, screen: buildVolumeTask(task.geometry, timestamp) };
  }
}

function routePoints(geometry: TaskGeometry, taskType: string): GeoPoint[] {
  if (geometry.type === 'POINT') return [geometry.point];
  if (geometry.type === 'LINE') return geometry.points;
  throw new Error(`${taskType} does not support ${geometry.type} route geometry`);
}

function buildLabeledRoute(points: GeoPoint[], timestamp: string): unknown {
  return {
    identifier: createUuid(),
    timestamp,
    waypoints: points.map((point) => ({
      identifier: createUuid(),
      timestamp,
      point: buildGeometryPoint(point),
    })),
  };
}

function buildVolumeTask(geometry: TaskGeometry, timestamp: string): { volume: unknown } {
  return { volume: buildLabeledVolume(geometry, timestamp) };
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
      throw new Error('Volume tasks do not support POINT geometry; use CIRCLE');
    case 'CIRCLE':
      return {
        $discriminator: 'RegionTypeEnum_CIRCLE',
        circle: { centre: buildGeometryPoint(geometry.centre), radius: geometry.radiusMeters },
      };
    case 'RECTANGLE':
    case 'POLYGON':
      return {
        $discriminator: 'RegionTypeEnum_POLYGON_AREA',
        polygon_area: { points: geometry.points.map(buildGeometryPoint) },
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

function buildGeometryPoint(point: GeoPoint): unknown {
  return point.altitude === undefined
    ? { latitude: point.latitude, longitude: point.longitude }
    : { latitude: point.latitude, longitude: point.longitude, altitude: point.altitude };
}

function buildPositionValue(point: GeoPoint): unknown {
  return point.altitude === undefined
    ? { latitude: point.latitude, longitude: point.longitude }
    : {
        latitude: point.latitude,
        longitude: point.longitude,
        altitude: [{ type: WGS_ALTITUDE_TYPE, value: point.altitude }],
      };
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
  const authority = optionalObject(body.authority);
  const authorityGuid = authority?.$discriminator === 'AuthorityTypeEnum_GUID'
    ? optionalString(authority.guid)
    : undefined;
  if (action === 'CANCEL') return { action, taskId, droneId, sourceNode, authorityGuid };

  const description = asObject(body.description, 'body.description');
  const type = parseTaskType(asString(description.$discriminator, 'body.description.$discriminator'));
  const geometry = parseTaskGeometry(type, description);
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

function parseTaskGeometry(type: TaskType, description: Record<string, unknown>): TaskGeometry {
  const taskValue = asObject(description[type.toLowerCase()], `body.description.${type.toLowerCase()}`);

  switch (type) {
    case 'REPOSITION': {
      const labeledLocation = asObject(taskValue.location, 'reposition.location');
      const location = asObject(labeledLocation.location, 'reposition.location.location');
      if (location.$discriminator !== 'GeometryTypeEnum_POINT') {
        throw new Error('REPOSITION requires GeometryTypeEnum_POINT');
      }
      return { type: 'POINT', point: parsePoint(location.point) };
    }
    case 'NAVIGATE':
      return parseLabeledRoute(taskValue.route, 'navigate.route');
    case 'PATROL':
      if (taskValue.route !== undefined) return parseLabeledRoute(taskValue.route, 'patrol.route');
      if (taskValue.volume !== undefined) return parseLabeledVolume(taskValue.volume, 'patrol.volume');
      throw new Error('PATROL requires a route or volume');
    case 'LOITER':
      if (taskValue.pose !== undefined) return parseLabeledPose(taskValue.pose);
      if (taskValue.volume !== undefined) return parseLabeledVolume(taskValue.volume, 'loiter.volume');
      throw new Error('LOITER requires a pose or volume');
    case 'STANDBY':
    case 'DETECT':
    case 'SURVEY':
    case 'SCREEN':
      return parseLabeledVolume(taskValue.volume, `${type.toLowerCase()}.volume`);
  }
}

function parseLabeledRoute(value: unknown, field: string): TaskGeometry {
  const route = asObject(value, field);
  if (!Array.isArray(route.waypoints)) throw new Error(`${field}.waypoints must be an array`);
  const points = route.waypoints.map((entry, index) => {
    const waypoint = asObject(entry, `${field}.waypoints[${index}]`);
    return parsePoint(waypoint.point);
  });
  if (points.length < 1) throw new Error(`${field}.waypoints requires at least one item`);
  return points.length === 1 ? { type: 'POINT', point: points[0] } : { type: 'LINE', points };
}

function parseLabeledPose(value: unknown): TaskGeometry {
  const labeledPose = asObject(value, 'loiter.pose');
  const pose = asObject(labeledPose.pose, 'loiter.pose.pose');
  const position = asObject(pose.position, 'loiter.pose.pose.position');
  if (position.$discriminator !== 'PositionTypeEnum_LATITUDE_LONGITUDE_ALTITUDE') {
    throw new Error('Only PositionTypeEnum_LATITUDE_LONGITUDE_ALTITUDE is supported');
  }
  return { type: 'POINT', point: parsePoint(position.latitude_longitude_altitude) };
}

function parseLabeledVolume(value: unknown, field: string): TaskGeometry {
  const labeledVolume = asObject(value, field);
  const volume = asObject(labeledVolume.volume, `${field}.volume`);
  return parseRegionGeometry(asObject(volume.region, `${field}.volume.region`));
}

function parseRegionGeometry(value: Record<string, unknown>): TaskGeometry {
  switch (value.$discriminator) {
    case 'RegionTypeEnum_CIRCLE': {
      const circle = asObject(value.circle, 'circle');
      return { type: 'CIRCLE', centre: parsePoint(circle.centre), radiusMeters: parsePositiveNumber(circle.radius, 'circle.radius') };
    }
    case 'RegionTypeEnum_POLYGON_AREA': {
      const polygon = asObject(value.polygon_area, 'polygon_area');
      return { type: 'POLYGON', points: removeClosingPoint(parsePoints(polygon.points, 3, 'polygon_area.points')) };
    }
    case 'RegionTypeEnum_CORRIDOR_AREA': {
      const corridor = asObject(value.corridor_area, 'corridor_area');
      return {
        type: 'CORRIDOR',
        centreLine: parsePoints(corridor.center_line, 2, 'corridor_area.center_line'),
        widthMeters: parsePositiveNumber(corridor.width, 'corridor_area.width'),
      };
    }
    case 'RegionTypeEnum_RECTANGLE_BY_CENTRE': {
      const rectangle = asObject(value.rectangle_by_centre, 'rectangle_by_centre');
      const centre = parsePoint(rectangle.centre);
      const side1 = parsePositiveNumber(rectangle.length_side_1, 'rectangle_by_centre.length_side_1');
      const side2 = parsePositiveNumber(rectangle.length_side_2, 'rectangle_by_centre.length_side_2');
      const bearing = parseAngle(rectangle.bearing_side_1, 'rectangle_by_centre.bearing_side_1');
      return { type: 'RECTANGLE', points: rectangleCorners(centre, side1, side2, bearing) };
    }
    default:
      throw new Error(`Unsupported region discriminator: ${String(value.$discriminator)}`);
  }
}

function parsePoint(value: unknown): GeoPoint {
  const object = asObject(value, 'point');
  const latitude = optionalNumber(object.latitude);
  const longitude = optionalNumber(object.longitude);
  if (latitude === undefined || longitude === undefined) throw new Error('Point requires latitude and longitude');
  if (latitude < -90 || latitude > 90) throw new Error('Latitude must be between -90 and 90 degrees');
  if (longitude < -180 || longitude > 180) throw new Error('Longitude must be between -180 and 180 degrees');

  if (Array.isArray(object.altitude)) {
    const entries = object.altitude.map(optionalObject).filter((entry): entry is Record<string, unknown> => Boolean(entry));
    const wgs = entries.find((entry) => entry.type === WGS_ALTITUDE_TYPE);
    return {
      latitude,
      longitude,
      altitude: optionalNumber(wgs?.value),
      altitudeType: wgs ? WGS_ALTITUDE_TYPE : undefined,
    };
  }

  return { latitude, longitude, altitude: optionalNumber(object.altitude) };
}

function parsePoints(value: unknown, minimum: number, field: string): GeoPoint[] {
  if (!Array.isArray(value)) throw new Error(`Expected point array: ${field}`);
  const points = value.map(parsePoint);
  if (points.length < minimum) throw new Error(`${field} requires at least ${minimum} points`);
  return points;
}

function parsePositiveNumber(value: unknown, field: string): number {
  const number = optionalNumber(value);
  if (number === undefined || number <= 0) throw new Error(`${field} must be a positive number`);
  return number;
}

function parseAngle(value: unknown, field: string): number {
  const angle = optionalNumber(value);
  if (angle === undefined || angle < 0 || angle >= 360) throw new Error(`${field} must be between 0 and 360 degrees`);
  return angle;
}

function rectangleCorners(centre: GeoPoint, side1Meters: number, side2Meters: number, bearingDegrees: number): GeoPoint[] {
  const half1 = side1Meters / 2;
  const half2 = side2Meters / 2;
  const bearing = bearingDegrees * Math.PI / 180;
  const perpendicular = bearing + Math.PI / 2;
  const firstNorth = Math.cos(bearing) * half1;
  const firstEast = Math.sin(bearing) * half1;
  const secondNorth = Math.cos(perpendicular) * half2;
  const secondEast = Math.sin(perpendicular) * half2;

  return [
    offsetPoint(centre, firstNorth + secondNorth, firstEast + secondEast),
    offsetPoint(centre, firstNorth - secondNorth, firstEast - secondEast),
    offsetPoint(centre, -firstNorth - secondNorth, -firstEast - secondEast),
    offsetPoint(centre, -firstNorth + secondNorth, -firstEast + secondEast),
  ];
}

function offsetPoint(origin: GeoPoint, northMeters: number, eastMeters: number): GeoPoint {
  const earthRadiusMeters = 6_378_137;
  const latitudeRadians = origin.latitude * Math.PI / 180;
  return {
    ...origin,
    latitude: origin.latitude + northMeters / earthRadiusMeters * 180 / Math.PI,
    longitude: origin.longitude + eastMeters / (earthRadiusMeters * Math.cos(latitudeRadians)) * 180 / Math.PI,
  };
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
