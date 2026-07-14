import { create } from 'zustand';
import type { BrokerConfiguration, Drone, DroneTask, EventLogEntry, GeoPoint, TaskType } from '../models/types';
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

localStorage.setItem('stanag-demo-source-uuid', storedSourceUuid);

const initialConfiguration: BrokerConfiguration = {
  transport: (env.VITE_TRANSPORT ?? 'stomp') as BrokerConfiguration['transport'],
  brokerUrl: env.VITE_BROKER_URL ?? 'ws://localhost:8674/stomp',
  username: env.VITE_USERNAME ?? '',
  password: env.VITE_PASSWORD ?? '',
  droneTopic: env.VITE_DRONE_TOPIC ?? '4817/catl/maps/json/+/+',
  taskStatusTopic: env.VITE_TASK_STATUS_TOPIC ?? '',
  taskAdminTopic: env.VITE_TASK_ADMIN_TOPIC ?? '4817/catl/maps/json/{droneId}/MessageTypeEnum_TASK_ADMIN',
  sourceUuid: env.VITE_SOURCE_UUID ?? storedSourceUuid,
  stanagVersion: env.VITE_STANAG_VERSION ?? '0.3.0',
};

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
            },
          },
        };
      }),

  upsertTask: (task) =>
      set((state) => ({
        tasks: {
          ...state.tasks,
          [task.id]: task,
        },
      })),

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
      set({
        draftPoints: [point],
      }),

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