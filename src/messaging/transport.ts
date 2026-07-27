import type { DroneTask } from '../models/types';

export interface MessageTransport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  publishTask(task: DroneTask): Promise<void>;
  cancelTask(task: DroneTask): Promise<void>;
  publishEvent(destination: string, payload: unknown): Promise<void>;
}
