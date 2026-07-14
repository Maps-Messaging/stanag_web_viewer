import type { Drone, DroneTask } from '../models/types';
import type { MessageTransport } from './transport';
import { useAppStore } from '../state/useAppStore';

const seedDrones: Drone[] = [
  {
    id: 'drone-1',
    name: 'Falcon 1',
    position: { latitude: -33.8688, longitude: 151.2093, altitude: 82 },
    heading: 45,
    groundSpeed: 0,
    batteryPercent: 88,
    lastSeen: Date.now(),
  },
  {
    id: 'drone-2',
    name: 'Kestrel 2',
    position: { latitude: -33.8565, longitude: 151.2152, altitude: 64 },
    heading: 210,
    groundSpeed: 3.2,
    batteryPercent: 72,
    lastSeen: Date.now(),
  },
  {
    id: 'drone-10',
    name: 'Stickleback',
    position: { latitude: -33.878, longitude: 151.198, altitude: 0 },
    heading: 120,
    groundSpeed: 1.1,
    batteryPercent: 94,
    lastSeen: Date.now(),
  },
];

export class MockTransport implements MessageTransport {
  private movementTimer?: number;

  async connect(): Promise<void> {
    const store = useAppStore.getState();
    seedDrones.forEach(store.upsertDrone);
    store.setConnection(true, 'Connected to mock transport');
    store.addEvent({ level: 'INFO', message: 'Mock transport connected' });
    this.movementTimer = window.setInterval(() => this.updateDrones(), 1500);
  }

  async disconnect(): Promise<void> {
    if (this.movementTimer) window.clearInterval(this.movementTimer);
    useAppStore.getState().setConnection(false, 'Disconnected');
  }

  async publishTask(task: DroneTask): Promise<void> {
    const store = useAppStore.getState();
    store.addEvent({ level: 'INFO', message: `Task ${task.id} submitted`, payload: task });
    window.setTimeout(() => this.setState(task.id, 'ACCEPTED', 'Task accepted'), 500);
    window.setTimeout(() => this.setState(task.id, 'EXECUTING', 'Task executing'), 1200);
    window.setTimeout(() => this.completeTask(task.id), 7000);
  }

  async cancelTask(task: DroneTask): Promise<void> {
    this.setState(task.id, 'CANCEL_REQUESTED', 'Cancellation requested');
    window.setTimeout(() => this.setState(task.id, 'CANCELLED', 'Task cancelled'), 800);
  }

  private setState(taskId: string, state: DroneTask['state'], message: string): void {
    const store = useAppStore.getState();
    const task = store.tasks[taskId];
    if (!task || task.state === 'CANCELLED') return;
    store.upsertTask({ ...task, state, updatedAt: Date.now(), message });
    store.addEvent({ level: 'INFO', message: `${taskId}: ${message}` });
  }

  private completeTask(taskId: string): void {
    const store = useAppStore.getState();
    const task = store.tasks[taskId];
    if (!task || ['CANCELLED', 'FAILED', 'REJECTED'].includes(task.state)) return;
    this.setState(taskId, 'COMPLETED', 'Task completed');
  }

  private updateDrones(): void {
    const store = useAppStore.getState();
    Object.values(store.drones).forEach((drone, index) => {
      const activeTask = Object.values(store.tasks).find((task) => task.droneId === drone.id && task.state === 'EXECUTING');
      if (!activeTask) {
        store.upsertDrone({ ...drone, heading: (drone.heading + 2 + index) % 360, lastSeen: Date.now() });
        return;
      }
      const target = activeTask.points.at(-1);
      if (!target) return;
      const ratio = 0.08;
      store.upsertDrone({
        ...drone,
        position: {
          latitude: drone.position.latitude + (target.latitude - drone.position.latitude) * ratio,
          longitude: drone.position.longitude + (target.longitude - drone.position.longitude) * ratio,
          altitude: activeTask.parameters.altitude,
        },
        groundSpeed: activeTask.parameters.speed,
        activeTaskId: activeTask.id,
        lastSeen: Date.now(),
      });
    });
  }
}
