export type TransportKind = 'mqtt' | 'stomp';

export interface GeoPoint {
  latitude: number;
  longitude: number;
  altitude?: number;
  altitudeType?: string;
}

export interface DroneCapability {
  taskType: string;
  taskSpecialization: string;
  authorities: string[];
}

export interface Drone {
  id: string;
  name: string;
  description?: string;
  organization?: string;
  nationality?: string;
  contextType?: string;
  standardIdentity?: string;
  symbolSet?: string;
  entityStatus?: string;
  entity?: string;
  entityType?: string;
  entitySubtype?: string;
  sector1?: string;
  sector2?: string;
  position?: GeoPoint;
  heading: number;
  roll?: number;
  pitch?: number;
  groundSpeed: number;
  course?: number;
  climbRate?: number;
  capabilities: DroneCapability[];
  stateTimestamp?: number;
  validUntil?: number;
  initiatedAt?: number;
  lastSeen: number;
  activeTaskId?: string;
}

export type TaskType = 'REPOSITION' | 'LOITER';
export type TaskGeometryType = 'POINT' | 'CIRCLE';

export type TaskState =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'ACCEPTED'
  | 'EXECUTING'
  | 'CANCEL_REQUESTED'
  | 'CANCELLED'
  | 'COMPLETED'
  | 'FAILED'
  | 'REJECTED';

export interface DroneTask {
  id: string;
  droneId: string;
  authorityGuid: string;
  type: TaskType;
  geometryType: TaskGeometryType;
  point: GeoPoint;
  radiusMeters?: number;
  state: TaskState;
  createdAt: number;
  updatedAt: number;
  message?: string;
  percentComplete?: number;
}

export interface EventLogEntry {
  id: string;
  timestamp: number;
  level: 'INFO' | 'WARN' | 'ERROR';
  message: string;
  payload?: unknown;
}

export interface BrokerConfiguration {
  transport: TransportKind;
  brokerUrl: string;
  username: string;
  password: string;
  droneTopic: string;
  taskStatusTopic: string;
  taskAdminTopic: string;
  sourceUuid: string;
  stanagVersion: string;
}
