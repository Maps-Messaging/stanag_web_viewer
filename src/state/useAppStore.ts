import { create } from 'zustand';
import type {
  BrokerConfiguration,
  Drone,
  DroneTask,
  DroneTelemetryUpdate,
  EventLogEntry,
  GeoPoint,
  MavlinkStreamStatus,
  TaskType,
} from '../models/types';
import { defaultBrokerUrl } from '../services/brokerDefaults';
import { createUuid } from '../services/uuid';

interface AppState {
  drones: Record<string, Drone>;
  tasks: Record<string, DroneTask>;
  events: EventLogEntry[];
  selectedDroneId?: string;
  taskType?: TaskType;
  draftPoints: GeoPoint[];
  connected: boolean;
  connectionMessage: string;
  configuration: BrokerConfiguration;
  upsertDrone: (drone: Drone) => void;
  updateDroneTelemetry: (droneId: string, telemetry: DroneTelemetryUpdate) => void;
  updateMavlinkStreamStatus: (systemId: number, status: MavlinkStreamStatus) => void;
  upsertTask: (task: DroneTask) => void;
  addEvent: (entry: Omit<EventLogEntry, 'id' | 'timestamp'>) => void;
  selectDrone: (droneId?: string) => void;
  selectTaskType: (taskType?: TaskType) => void;
  addDraftPoint: (point: GeoPoint) => void;
  clearDraftPoints: () => void;
  setConnection: (connected: boolean, message: string) => void;
  updateConfiguration: (configuration: BrokerConfiguration) => void;
}

const env = import.meta.env;
const storedSourceUuid = localStorage.getItem('stanag-demo-source-uuid') ?? createUuid();
const configuredTransport = (env.VITE_TRANSPORT ?? 'stomp') as BrokerConfiguration['transport'];
const transportBrokerUrl = configuredTransport === 'mqtt'
  ? env.VITE_MQTT_BROKER_URL
  : env.VITE_STOMP_BROKER_URL;

localStorage.setItem('stanag-demo-source-uuid', storedSourceUuid);

const initialConfiguration: BrokerConfiguration = {
  transport: configuredTransport,
  brokerUrl: transportBrokerUrl ?? env.VITE_BROKER_URL ?? defaultBrokerUrl(configuredTransport),
  username: env.VITE_USERNAME ?? '',
  password: env.VITE_PASSWORD ?? '',
  droneTopic: env.VITE_DRONE_TOPIC ?? '4817/catl/maps/json/+/+',
  taskStatusTopic: env.VITE_TASK_STATUS_TOPIC ?? '',
  taskAdminTopic: env.VITE_TASK_ADMIN_TOPIC ?? '4817/catl/maps/json/{droneId}/MessageTypeEnum_TASK_ADMIN',
  sourceUuid: env.VITE_SOURCE_UUID ?? storedSourceUuid,
  stanagVersion: env.VITE_STANAG_VERSION ?? '0.3.0',
};

const ACTIVE_TASK_STATES: DroneTask['state'][] = [
  'SUBMITTED',
  'ACCEPTED',
  'EXECUTING',
  'CANCEL_REQUESTED',
];

export const useAppStore = create<AppState>((set) => ({
  drones: {},
  tasks: {},
  events: [],
  draftPoints: [],
  connected: false,
  connectionMessage: 'Disconnected',
  configuration: initialConfiguration,

  upsertDrone: (drone) =>
    set((state) => {
      const existing = state.drones[drone.id];

      return {
        drones: {
          ...state.drones,
          [drone.id]: {
            ...existing,
            ...drone,
            position: drone.position ?? existing?.position,
            capabilities: drone.capabilities.length > 0 ? drone.capabilities : existing?.capabilities ?? [],
            activeTaskId: existing?.activeTaskId,
          },
        },
      };
    }),

  updateDroneTelemetry: (droneId, telemetry) =>
    set((state) => {
      const existing = state.drones[droneId];

      if (!existing) {
        return state;
      }

      return {
        drones: {
          ...state.drones,
          [droneId]: {
            ...existing,
            ...telemetry,
            position: telemetry.position
              ? {
                  ...existing.position,
                  ...telemetry.position,
                }
              : existing.position,
          },
        },
      };
    }),

  updateMavlinkStreamStatus: (systemId, status) =>
    set((state) => {
      const matches = Object.values(state.drones).filter(
        (drone) => drone.twin?.systemId === systemId,
      );

      if (matches.length !== 1) {
        return state;
      }

      const drone = matches[0];

      return {
        drones: {
          ...state.drones,
          [drone.id]: {
            ...drone,
            mavlinkStreamStatus: status,
          },
        },
      };
    }),

  upsertTask: (task) =>
    set((state) => {
      const tasks = {
        ...state.tasks,
        [task.id]: task,
      };
      const drone = state.drones[task.droneId];

      if (!drone) {
        return { tasks };
      }

      const activeTask = Object.values(tasks)
        .filter((candidate) => candidate.droneId === task.droneId && ACTIVE_TASK_STATES.includes(candidate.state))
        .sort((left, right) => right.updatedAt - left.updatedAt)[0];

      return {
        tasks,
        drones: {
          ...state.drones,
          [drone.id]: {
            ...drone,
            activeTaskId: activeTask?.id,
          },
        },
      };
    }),

  addEvent: (entry) =>
    set((state) => ({
      events: [
        {
          ...entry,
          id: createUuid(),
          timestamp: Date.now(),
        },
        ...state.events,
      ].slice(0, 100),
    })),

  selectDrone: (selectedDroneId) =>
    set({
      selectedDroneId,
      draftPoints: [],
    }),

  selectTaskType: (taskType) =>
    set({
      taskType,
      draftPoints: [],
    }),

  addDraftPoint: (point) =>
    set((state) => ({
      draftPoints: [...state.draftPoints, point],
    })),

  clearDraftPoints: () =>
    set({
      draftPoints: [],
    }),

  setConnection: (connected, connectionMessage) =>
    set({
      connected,
      connectionMessage,
    }),

  updateConfiguration: (configuration) =>
    set({
      configuration,
    }),
}));
