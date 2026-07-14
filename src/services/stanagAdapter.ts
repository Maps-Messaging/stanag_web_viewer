import type { BrokerConfiguration, Drone, DroneCapability, DroneTask, GeoPoint, TaskState } from '../models/types';

export interface ParsedTaskStatus {
  messageType: 'MessageTypeEnum_TASK_FEEDBACK' | 'MessageTypeEnum_TASK_RESULT';
  taskId: string;
  droneId: string;
  state: TaskState;
  percentComplete?: number;
  message?: string;
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
  return typeof value === 'number' && !Number.isNaN(value) ? value : undefined;
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

  const lla = optionalObject(position.latitude_longitude_altitude);
  if (!lla) return undefined;

  const altitudes = Array.isArray(lla.altitude) ? lla.altitude : [];
  const altitudeEntries = altitudes.map(optionalObject).filter((entry): entry is Record<string, unknown> => Boolean(entry));
  const preferredAltitude = altitudeEntries.find((entry) => entry.type === 'AltitudeTypeEnum_WGS') ?? altitudeEntries[0];

  return {
    latitude: asNumber(lla.latitude, 'body.pose.position.latitude_longitude_altitude.latitude'),
    longitude: asNumber(lla.longitude, 'body.pose.position.latitude_longitude_altitude.longitude'),
    altitude: optionalNumber(preferredAltitude?.value),
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
  if (task.type === 'REPOSITION') {
    return {
      $discriminator: 'TaskTypeEnum_REPOSITION',
      reposition: {
        location: {
          identifier: crypto.randomUUID(),
          timestamp,
          location: {
            $discriminator: 'GeometryTypeEnum_POINT',
            point: buildPosition(task.point),
          },
        },
      },
    };
  }

  if (task.geometryType === 'POINT') {
    return {
      $discriminator: 'TaskTypeEnum_LOITER',
      loiter: {
        pose: {
          identifier: crypto.randomUUID(),
          timestamp,
          pose: {
            position: {
              $discriminator: 'PositionTypeEnum_LATITUDE_LONGITUDE_ALTITUDE',
              latitude_longitude_altitude: {
                latitude: task.point.latitude,
                longitude: task.point.longitude,
              },
            },
          },
        },
      },
    };
  }

  return {
    $discriminator: 'TaskTypeEnum_LOITER',
    loiter: {
      volume: {
        identifier: crypto.randomUUID(),
        timestamp,
        volume: {
          region: {
            $discriminator: 'RegionTypeEnum_CIRCLE',
            circle: {
              centre: buildPosition(task.point),
              radius: task.radiusMeters,
            },
          },
        },
      },
    },
  };
}

function buildPosition(point: GeoPoint): unknown {
  return {
    latitude: point.latitude,
    longitude: point.longitude,
    altitude: point.altitude ?? 0,
  };
}

function stanagTimestamp(): string {
  return new Date().toISOString();
}

export function getStanagMessageType(payload: unknown): string {
  const envelope = asObject(payload, 'message');
  const header = asObject(envelope.header, 'header');
  return asString(header.message_type, 'header.message_type');
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

  return {
    messageType,
    taskId: asString(body.identifier, 'body.identifier'),
    droneId: asString(body.node ?? header.source, 'body.node'),
    state: mapTaskState(stanagState),
    percentComplete: optionalNumber(body.percent_complete),
    message: optionalString(body.message),
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
