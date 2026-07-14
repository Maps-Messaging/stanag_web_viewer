import { Client, type IMessage } from '@stomp/stompjs';
import type { BrokerConfiguration, DroneTask } from '../models/types';
import type { MessageTransport } from './transport';
import { buildCancelCommand, buildTaskCommand, parseNodeMessage, parseTaskStatus } from '../services/stanagAdapter';
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
        store.addEvent({
          level: 'INFO',
          message: 'STOMP transport connected',
        });
      },
      onWebSocketClose: () => {
        store.setConnection(false, 'STOMP disconnected');
      },
      onStompError: (frame) => {
        store.addEvent({
          level: 'ERROR',
          message: frame.headers.message ?? 'STOMP error',
          payload: frame.body,
        });
      },
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
    if (!this.client?.connected) {
      throw new Error('STOMP client is not connected');
    }

    this.client.publish({
      destination,
      body: JSON.stringify(payload),
      headers: {
        'content-type': 'application/json',
      },
    });
  }

  private handleDrone(message: IMessage): void {
    this.parse(message, (payload) => {
      const node = parseNodeMessage(payload);
      const store = useAppStore.getState();

      store.upsertDrone(node.drone);
      store.addEvent({
        level: 'INFO',
        message: `${node.messageType}: ${node.drone.name}`,
        payload,
      });
    });
  }

  private handleTaskStatus(message: IMessage): void {
    this.parse(message, (payload) => {
      const store = useAppStore.getState();
      const status = parseTaskStatus(payload);
      const existing = store.tasks[status.taskId];

      if (existing) {
        store.upsertTask({
          ...existing,
          state: status.state,
          updatedAt: Date.now(),
          message: status.message,
        });
      }
    });
  }

  private parse(message: IMessage, handler: (payload: unknown) => void): void {
    try {
      const json = this.decodeBody(message);
      handler(JSON.parse(json));
    } catch (error) {
      useAppStore.getState().addEvent({
        level: 'ERROR',
        message: `STOMP message rejected: ${String(error)}`,
        payload: {
          headers: message.headers,
          body: message.body,
        },
      });
    }
  }

  private decodeBody(message: IMessage): string {
    const encoding = message.headers.encoding?.toLowerCase();

    if (encoding === 'base64') {
      return this.decodeBase64(message.body);
    }

    const body = message.body.trim();

    if (body.startsWith('{') || body.startsWith('[')) {
      return body;
    }

    try {
      const decoded = this.decodeBase64(body);

      if (decoded.trim().startsWith('{') || decoded.trim().startsWith('[')) {
        return decoded;
      }
    } catch {
      // The body was not Base64. Let JSON.parse report the useful error.
    }

    return body;
  }

  private decodeBase64(value: string): string {
    const binary = globalThis.atob(value);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));

    return new TextDecoder().decode(bytes);
  }
}