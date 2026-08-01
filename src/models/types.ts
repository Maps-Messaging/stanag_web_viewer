export type TransportKind = 'mqtt' | 'stomp';

export interface GeoPoint {
  latitude: number;
  longitude: number;
  altitude?: number;
  altitudeType?: string;
}

export type MavlinkSequenceStatus = 'INITIAL' | 'OK' | 'LOSS' | 'RESET' | 'OUT_OF_ORDER';

export interface MavlinkStreamStatus {
  previousSequenceNumber: number;
  currentSequenceNumber: number;
  expectedSequenceNumber: number;
  delta: number;
  lostPackets: number;
  timestamp: number;
  statusChanged: boolean;
  status: MavlinkSequenceStatus;
}

export interface DroneCapability {
  taskType: string;
  taskSpecialization: string;
  authorities: string[];
}

export interface TwinOrientation { rollDegrees?: number; pitchDegrees?: number; yawDegrees?: number; }
export interface TwinGeoPosition { latitude?: number; longitude?: number; altitudeMslMeters?: number; }
export interface TwinHomePosition { latitude?: number; longitude?: number; altitudeMslMeters?: number; }
export interface TwinVelocityVector { northMetersPerSecond?: number; eastMetersPerSecond?: number; downMetersPerSecond?: number; }
export interface TwinFixInfo { fixType?: string; satelliteCount?: number; hdop?: number; vdop?: number; }
export interface TwinBatteryState { percentage?: number; voltageVolts?: number; currentAmps?: number; charging?: boolean; duration?: string; }
export interface TwinLinkState { state?: string; connected?: boolean; }
export interface TwinSystemState { cpuLoadPercent?: number; healthy?: boolean; statusMessage?: string; }
export interface TwinAutopilotState { modeNumber?: number; autopilotType?: string; baseMode?: number; customMode?: number; systemStatus?: number; mavlinkVersion?: number; }

export interface TwinState {
  uuid?: string; twinId?: string; twinType?: string; displayName?: string; callSign?: string; modelName?: string; vehicleClass?: string;
  systemId?: number; componentId?: number; mmsi?: number; descriptionString?: string; armed?: boolean; flightMode?: string;
  gpsValid?: boolean; missionState?: string; landedState?: string; vtolState?: string; lifecycleStatus?: string; readinessState?: string;
  registrationReady?: boolean; commandReady?: boolean; missingReadinessItems?: string[]; degradedReadinessItems?: string[];
  blockingReadinessItems?: string[]; headingDegrees?: number; groundSpeedMetersPerSecond?: number; verticalSpeedMetersPerSecond?: number;
  batteryCapacityHours?: number; stopAction?: string; operationalUpdatedAt?: string; readinessUpdatedAt?: string; lastSeenAt?: string;
  validTill?: string; geoPosition?: TwinGeoPosition; homePosition?: TwinHomePosition; velocityVector?: TwinVelocityVector;
  orientation?: TwinOrientation; fixInfo?: TwinFixInfo; batteryState?: TwinBatteryState; linkState?: TwinLinkState;
  systemState?: TwinSystemState; autopilotState?: TwinAutopilotState; capabilities?: unknown; description?: unknown;
  relationships?: unknown[]; attributes?: Record<string, unknown>; [key: string]: unknown;
}

export interface Drone {
  id: string; name: string; description?: string; organization?: string; nationality?: string; contextType?: string;
  standardIdentity?: string; symbolSet?: string; entityStatus?: string; entity?: string; entityType?: string; entitySubtype?: string;
  sector1?: string; sector2?: string; position?: GeoPoint; heading: number; roll?: number; pitch?: number; yaw?: number;
  groundSpeed: number; course?: number; climbRate?: number; capabilities: DroneCapability[]; stateTimestamp?: number;
  validUntil?: number; initiatedAt?: number; lastSeen: number; activeTaskId?: string; twin?: TwinState;
  mavlinkStreamStatus?: MavlinkStreamStatus;
}

export interface Detection {
  id: string;
  sourceId: string;
  name: string;
  position: GeoPoint;
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
  trackPhase?: string;
  timestamp: number;
  initiatedAt?: number;
  sourceValidUntil?: number;
  validUntil?: number;
  expiresAt: number;
  rtspUrl?: string;
  raw?: unknown;
}

export interface DroneTelemetryUpdate {
  position?: GeoPoint; heading?: number; roll?: number; pitch?: number; yaw?: number; groundSpeed?: number; course?: number;
  climbRate?: number; lastSeen?: number; twin?: TwinState; mavlinkStreamStatus?: MavlinkStreamStatus;
}

export type TaskType =
  | 'REPOSITION'
  | 'NAVIGATE'
  | 'PATROL'
  | 'LOITER'
  | 'STANDBY'
  | 'DETECT'
  | 'SURVEY'
  | 'SCREEN';

export interface TaskDuration {
  hours: number;
  minutes: number;
  seconds: number;
}

export type TaskGeometryType = 'POINT' | 'CIRCLE' | 'LINE' | 'RECTANGLE' | 'POLYGON' | 'CORRIDOR';
export type TaskGeometry =
  | { type: 'POINT'; point: GeoPoint }
  | { type: 'CIRCLE'; centre: GeoPoint; radiusMeters: number }
  | { type: 'LINE'; points: GeoPoint[] }
  | { type: 'RECTANGLE'; points: GeoPoint[] }
  | { type: 'POLYGON'; points: GeoPoint[] }
  | { type: 'CORRIDOR'; centreLine: GeoPoint[]; widthMeters: number };

export type TaskState =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'PENDING'
  | 'ACCEPTED'
  | 'ACTIVE'
  | 'EXECUTING'
  | 'CANCEL_REQUESTED'
  | 'PREEMPTING'
  | 'PREEMPTED'
  | 'CANCELLED'
  | 'COMPLETED'
  | 'ABORTED'
  | 'LOST'
  | 'FAILED'
  | 'REJECTED';

export interface DroneTask {
  id: string;
  droneId: string;
  authorityGuid: string;
  type: TaskType;
  geometry: TaskGeometry;
  geometryType: TaskGeometryType;
  point: GeoPoint;
  radiusMeters?: number;
  duration?: TaskDuration;
  state: TaskState;
  createdAt: number;
  updatedAt: number;
  sourceNode?: string;
  message?: string;
  percentComplete?: number;
}

export interface EventLogEntry { id: string; timestamp: number; level: 'INFO' | 'WARN' | 'ERROR'; message: string; payload?: unknown; }

export interface BrokerConfiguration {
  transport: TransportKind; brokerUrl: string; username: string; password: string; droneTopic: string; taskStatusTopic: string;
  taskAdminTopic: string; sourceUuid: string; stanagVersion: string;
}
