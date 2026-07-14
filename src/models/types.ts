export type TransportKind = 'mock' | 'mqtt' | 'stomp';

export interface GeoPoint {
  latitude: number;
  longitude: number;
  altitude?: number;
}

export interface Drone {
  id: string;
  name: string;
  position: GeoPoint;
  heading: number;
  groundSpeed: number;
  batteryPercent?: number;
  lastSeen: number;
  activeTaskId?: string;
}

export type TaskType = 'REPOSITION' | 'NAVIGATE' | 'LOITER';

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

export interface TaskParameters {
  altitude: number;
  speed: number;
  radius?: number;
  clockwise?: boolean;
}

export interface DroneTask {
  id: string;
  droneId: string;
  type: TaskType;
  points: GeoPoint[];
  parameters: TaskParameters;
  state: TaskState;
  createdAt: number;
  updatedAt: number;
  message?: string;
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
  taskCommandTopic: string;
  taskCancelTopic: string;
}
