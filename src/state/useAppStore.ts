import { create } from 'zustand';
import type {
  BrokerConfiguration,
  Detection,
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
  detections: Record<string, Detection>;
  tasks: Record<string, DroneTask>;
  latestTaskIdByDrone: Record<string, string>;
  events: EventLogEntry[];
  selectedDroneId?: string;
  selectedDetectionId?: string;
  taskType?: TaskType;
  draftPoints: GeoPoint[];
  connected: boolean;
  connectionMessage: string;
  configuration: BrokerConfiguration;
  upsertDrone: (drone: Drone) => void;
  upsertDetection: (detection: Detection) => void;
  removeDetection: (detectionId: string) => void;
  purgeExpiredDetections: (now?: number) => void;
  updateDroneTelemetry: (droneId: string, telemetry: DroneTelemetryUpdate) => void;
  updateMavlinkStreamStatus: (systemId: number, status: MavlinkStreamStatus) => void;
  upsertTask: (task: DroneTask) => void;
  addEvent: (entry: Omit<EventLogEntry, 'id' | 'timestamp'>) => void;
  selectDrone: (droneId?: string) => void;
  selectDetection: (detectionId?: string) => void;
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
  'PENDING',
  'ACCEPTED',
  'ACTIVE',
  'EXECUTING',
  'CANCEL_REQUESTED',
  'PREEMPTING',
];

const MAX_TASK_HISTORY_PER_DRONE = 100;

export const useAppStore = create<AppState>((set) => ({
  drones: {},
  detections: {},
  tasks: {},
  latestTaskIdByDrone: {},
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

  upsertDetection: (detection) =>
    set((state) => ({
      detections: {
        ...Object.fromEntries(Object.entries(state.detections).filter(([, candidate]) => candidate.expiresAt > Date.now())),
        [detection.id]: { ...state.detections[detection.id], ...detection },
      },
    })),

  removeDetection: (detectionId) =>
    set((state) => {
      if (!state.detections[detectionId]) return state;
      const detections = { ...state.detections };
      delete detections[detectionId];
      return {
        detections,
        selectedDetectionId: state.selectedDetectionId === detectionId ? undefined : state.selectedDetectionId,
      };
    }),

  purgeExpiredDetections: (now = Date.now()) =>
    set((state) => {
      const detections = Object.fromEntries(
        Object.entries(state.detections).filter(([, detection]) => detection.expiresAt > now),
      );
      if (Object.keys(detections).length === Object.keys(state.detections).length) return state;
      return {
        detections,
        selectedDetectionId: state.selectedDetectionId && detections[state.selectedDetectionId]
          ? state.selectedDetectionId
          : undefined,
      };
    }),

  updateDroneTelemetry: (droneId, telemetry) =>
    set((state) => {
      const existing = state.drones[droneId];
      if (!existing) return state;

      return {
        drones: {
          ...state.drones,
          [droneId]: {
            ...existing,
            ...telemetry,
            position: telemetry.position
              ? { ...existing.position, ...telemetry.position }
              : existing.position,
          },
        },
      };
    }),

  updateMavlinkStreamStatus: (systemId, status) =>
    set((state) => {
      const matches = Object.values(state.drones).filter((drone) => drone.twin?.systemId === systemId);
      if (matches.length !== 1) return state;
      const drone = matches[0];

      return {
        drones: {
          ...state.drones,
          [drone.id]: { ...drone, mavlinkStreamStatus: status },
        },
      };
    }),

  upsertTask: (task) =>
    set((state) => {
      const tasks: Record<string, DroneTask> = { ...state.tasks, [task.id]: task };
      const droneTasks = Object.values(tasks)
        .filter((candidate) => candidate.droneId === task.droneId)
        .sort((left, right) => right.updatedAt - left.updatedAt);
      const retainedTaskIds = new Set(
        droneTasks
          .filter((candidate, index) => index < MAX_TASK_HISTORY_PER_DRONE || ACTIVE_TASK_STATES.includes(candidate.state))
          .map((candidate) => candidate.id),
      );

      droneTasks.forEach((candidate) => {
        if (!retainedTaskIds.has(candidate.id)) delete tasks[candidate.id];
      });

      const retainedDroneTasks = droneTasks.filter((candidate) => retainedTaskIds.has(candidate.id));
      const latestTask = retainedDroneTasks[0];
      const activeTask = retainedDroneTasks.find((candidate) => ACTIVE_TASK_STATES.includes(candidate.state));
      const latestTaskIdByDrone = { ...state.latestTaskIdByDrone };

      if (latestTask) latestTaskIdByDrone[task.droneId] = latestTask.id;
      else delete latestTaskIdByDrone[task.droneId];

      const drone = state.drones[task.droneId];
      if (!drone) return { tasks, latestTaskIdByDrone };

      return {
        tasks,
        latestTaskIdByDrone,
        drones: {
          ...state.drones,
          [drone.id]: { ...drone, activeTaskId: activeTask?.id },
        },
      };
    }),

  addEvent: (entry) =>
    set((state) => ({
      events: [{ ...entry, id: createUuid(), timestamp: Date.now() }, ...state.events].slice(0, 100),
    })),

  selectDrone: (selectedDroneId) =>
    set({ selectedDroneId, selectedDetectionId: undefined, draftPoints: [] }),

  selectDetection: (selectedDetectionId) =>
    set({ selectedDetectionId, selectedDroneId: undefined, draftPoints: [] }),

  selectTaskType: (taskType) =>
    set({ taskType, draftPoints: [] }),

  addDraftPoint: (point) =>
    set((state) => ({ draftPoints: [...state.draftPoints, point] })),

  clearDraftPoints: () => set({ draftPoints: [] }),

  setConnection: (connected, connectionMessage) => set({ connected, connectionMessage }),

  updateConfiguration: (configuration) => set({ configuration }),
}));
