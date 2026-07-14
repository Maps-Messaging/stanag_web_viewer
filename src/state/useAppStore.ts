import { create } from 'zustand';
import type { BrokerConfiguration, Drone, DroneTask, EventLogEntry, GeoPoint, TaskType } from '../models/types';

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

const initialConfiguration: BrokerConfiguration = {
  transport: (env.VITE_TRANSPORT ?? 'mock') as BrokerConfiguration['transport'],
  brokerUrl: env.VITE_BROKER_URL ?? 'ws://localhost:8083/mqtt',
  username: env.VITE_USERNAME ?? '',
  password: env.VITE_PASSWORD ?? '',
  droneTopic: env.VITE_DRONE_TOPIC ?? 'stanag/drone/+/state',
  taskStatusTopic: env.VITE_TASK_STATUS_TOPIC ?? 'stanag/task/+/status',
  taskCommandTopic: env.VITE_TASK_COMMAND_TOPIC ?? 'stanag/task/command',
  taskCancelTopic: env.VITE_TASK_CANCEL_TOPIC ?? 'stanag/task/cancel',
};

export const useAppStore = create<AppState>((set) => ({
  drones: {},
  tasks: {},
  events: [],
  draftPoints: [],
  connected: false,
  connectionMessage: 'Disconnected',
  configuration: initialConfiguration,
  upsertDrone: (drone) => set((state) => ({ drones: { ...state.drones, [drone.id]: drone } })),
  upsertTask: (task) => set((state) => ({ tasks: { ...state.tasks, [task.id]: task } })),
  addEvent: (entry) =>
    set((state) => ({
      events: [
        {
          ...entry,
          id: crypto.randomUUID(),
          timestamp: Date.now(),
        },
        ...state.events,
      ].slice(0, 100),
    })),
  selectDrone: (selectedDroneId) => set({ selectedDroneId, draftPoints: [] }),
  selectTaskType: (taskType) => set({ taskType, draftPoints: [] }),
  addDraftPoint: (point) => set((state) => ({ draftPoints: [...state.draftPoints, point] })),
  clearDraftPoints: () => set({ draftPoints: [] }),
  setConnection: (connected, connectionMessage) => set({ connected, connectionMessage }),
  updateConfiguration: (configuration) => set({ configuration }),
}));
