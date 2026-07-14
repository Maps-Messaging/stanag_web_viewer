import { Client, type IMessage } from '@stomp/stompjs';
import type { BrokerConfiguration, DroneTask } from '../models/types';
import { buildTaskAdminCancel, buildTaskAdminPush, resolveTaskAdminDestination } from '../services/stanagAdapter';
import { useAppStore } from '../state/useAppStore';
import { dispatchStanagMessage } from './messageDispatcher';
import type { MessageTransport } from './transport';

export class StompTransport implements MessageTransport {
  private client?: Client;

  constructor(private readonly configuration: BrokerConfiguration) {}

  async connect(): Promise<void> {
    const store = useAppStore.getState();

    await new Promise<void>((resolve, reject) => {
      this.client = new Client({
        brokerURL: this.configuration.brokerUrl,
        connectHeaders: {
          login: this.configuration.username,
          passcode: this.configuration.password,
        },
        reconnectDelay: 2000,
        onConnect: () => {
          this.client?.subscribe(this.configuration.droneTopic, (message) => this.handleMessage(message));
          if (this.configuration.taskStatusTopic) {
            this.client?.subscribe(this.configuration.taskStatusTopic, (message) => this.handleMessage(message));
          }
          store.setConnection(true, 'Connected with STOMP');
          store.addEvent({ level: 'INFO', message: 'STOMP transport connected' });
          resolve();
        },
        onWebSocketClose: () => store.setConnection(false, 'STOMP disconnected'),
        onWebSocketError: (event) => reject(event),
        onStompError: (frame) => {
          store.addEvent({ level: 'ERROR', message: frame.headers.message ?? 'STOMP error', payload: frame.body });
          reject(new Error(frame.headers.message ?? 'STOMP error'));
        },
      });

      this.client.activate();
    });
  }

  async disconnect(): Promise<void> {
    await this.client?.deactivate();
    this.client = undefined;
    useAppStore.getState().setConnection(false, 'Disconnected');
  }

  async publishTask(task: DroneTask): Promise<void> {
    this.publish(task, buildTaskAdminPush(this.configuration, task));
  }

  async cancelTask(task: DroneTask): Promise<void> {
    this.publish(task, buildTaskAdminCancel(this.configuration, task));
  }

  private publish(task: DroneTask, payload: unknown): void {
    if (!this.client?.connected) throw new Error('STOMP client is not connected');
    const destination = resolveTaskAdminDestination(this.configuration.taskAdminTopic, task.droneId);
    this.client.publish({
      destination,
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
    });
  }

  private handleMessage(message: IMessage): void {
    this.parse(message, dispatchStanagMessage);
  }

  private parse(message: IMessage, handler: (payload: unknown) => void): void {
    try {
      handler(JSON.parse(this.decodeBody(message)));
    } catch (error) {
      useAppStore.getState().addEvent({
        level: 'ERROR',
        message: `STOMP message rejected: ${String(error)}`,
        payload: { headers: message.headers, body: message.body },
      });
    }
  }

  private decodeBody(message: IMessage): string {
    const encoding = message.headers.encoding?.toLowerCase();
    if (encoding === 'base64') return this.decodeBase64(message.body);

    const body = message.body.trim();
    if (body.startsWith('{') || body.startsWith('[')) return body;

    try {
      const decoded = this.decodeBase64(body);
      if (decoded.trim().startsWith('{') || decoded.trim().startsWith('[')) return decoded;
    } catch {
      // JSON.parse below will report the original body error.
    }

    return body;
  }

  private decodeBase64(value: string): string {
    const binary = globalThis.atob(value);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }
}
