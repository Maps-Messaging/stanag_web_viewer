import { Client, type IMessage } from '@stomp/stompjs';
import type { BrokerConfiguration, DroneTask } from '../models/types';
import type { MessageTransport } from './transport';
import { buildCancelCommand, buildTaskCommand, parseDroneState, parseTaskStatus } from '../services/stanagAdapter';
import { useAppStore } from '../state/useAppStore';

export class StompTransport implements MessageTransport {
  private client?: Client;

  constructor(private readonly configuration: BrokerConfiguration) {}

  async connect(): Promise<void> {
    const store = useAppStore.getState();
    this.client = new Client({
      brokerURL: this.configuration.brokerUrl,
      connectHeaders: {
        login: this.configuration.username,
        passcode: this.configuration.password,
      },
      reconnectDelay: 2000,
      onConnect: () => {
        this.client?.subscribe(this.configuration.droneTopic, (message) => this.handleDrone(message));
        this.client?.subscribe(this.configuration.taskStatusTopic, (message) => this.handleTaskStatus(message));
        store.setConnection(true, 'Connected with STOMP');
        store.addEvent({ level: 'INFO', message: 'STOMP transport connected' });
      },
      onWebSocketClose: () => store.setConnection(false, 'STOMP disconnected'),
      onStompError: (frame) => store.addEvent({ level: 'ERROR', message: frame.headers.message ?? 'STOMP error', payload: frame.body }),
    });

    this.client.activate();
  }

  async disconnect(): Promise<void> {
    await this.client?.deactivate();
    this.client = undefined;
    useAppStore.getState().setConnection(false, 'Disconnected');
  }

  async publishTask(task: DroneTask): Promise<void> {
    this.publish(this.configuration.taskCommandTopic, buildTaskCommand(task));
  }

  async cancelTask(task: DroneTask): Promise<void> {
    this.publish(this.configuration.taskCancelTopic, buildCancelCommand(task));
  }

  private publish(destination: string, payload: unknown): void {
    if (!this.client?.connected) throw new Error('STOMP client is not connected');
    this.client.publish({ destination, body: JSON.stringify(payload) });
  }

  private handleDrone(message: IMessage): void {
    this.parse(message, (payload) => useAppStore.getState().upsertDrone(parseDroneState(payload)));
  }

  private handleTaskStatus(message: IMessage): void {
    this.parse(message, (payload) => {
      const store = useAppStore.getState();
      const status = parseTaskStatus(payload);
      const existing = store.tasks[status.taskId];
      if (existing) {
        store.upsertTask({ ...existing, state: status.state, updatedAt: Date.now(), message: status.message });
      }
    });
  }

  private parse(message: IMessage, handler: (payload: unknown) => void): void {
    try {
      handler(JSON.parse(message.body));
    } catch (error) {
      useAppStore.getState().addEvent({ level: 'ERROR', message: `STOMP message rejected: ${String(error)}`, payload: message.body });
    }
  }
}
