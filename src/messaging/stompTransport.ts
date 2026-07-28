import { Client, type IMessage, type StompSubscription } from '@stomp/stompjs';
import type { BrokerConfiguration, DroneTask } from '../models/types';
import {
  buildTaskAdminCancel,
  buildTaskAdminPush,
  resolveTaskAdminDestination,
} from '../services/stanagAdapter';
import { useAppStore } from '../state/useAppStore';
import {
  dispatchMavlinkStreamStatus,
  dispatchStanagMessage,
  dispatchTwinMessage,
} from './messageDispatcher';
import type { MessageTransport } from './transport';

const TWIN_TOPIC = '/state/twins/+';
const MAVLINK_STATUS_TOPIC = '/mavlink/+/status';
const MAVLINK_STATUS_DESTINATION_PATTERN = /^\/mavlink\/(\d+)\/status$/;

export class StompTransport implements MessageTransport {
  private client?: Client;
  private subscriptions: StompSubscription[] = [];
  private readonly pendingTwinMessages = new Map<string, IMessage>();
  private twinFlushFrame?: number;

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
          this.subscriptions = [];
          this.subscribeToStanag();
          this.subscribeToTwins();
          this.subscribeToMavlinkStatus();

          store.setConnection(true, 'Connected with STOMP');
          store.addEvent({
            level: 'INFO',
            message: 'STOMP transport connected',
          });
          resolve();
        },

        onWebSocketClose: () => {
          this.subscriptions = [];
          this.clearPendingTwinMessages();
          store.setConnection(false, 'STOMP disconnected');
        },

        onWebSocketError: (event) => {
          reject(event);
        },

        onStompError: (frame) => {
          store.addEvent({
            level: 'ERROR',
            message: frame.headers.message ?? 'STOMP error',
            payload: frame.body,
          });
          reject(new Error(frame.headers.message ?? 'STOMP error'));
        },
      });

      this.client.activate();
    });
  }

  async disconnect(): Promise<void> {
    this.unsubscribeAll();
    this.clearPendingTwinMessages();

    await this.client?.deactivate();
    this.client = undefined;

    useAppStore.getState().setConnection(false, 'Disconnected');
  }

  async publishTask(task: DroneTask): Promise<void> {
    this.publishTaskPayload(task, buildTaskAdminPush(this.configuration, task));
  }

  async cancelTask(task: DroneTask): Promise<void> {
    this.publishTaskPayload(task, buildTaskAdminCancel(this.configuration, task));
  }

  async publishEvent(destination: string, payload: unknown): Promise<void> {
    this.publishJson(destination, payload);
  }

  private subscribeToStanag(): void {
    this.subscribe(
      this.configuration.droneTopic,
      (message) => this.handleStanagMessage(message),
    );

    if (this.configuration.taskStatusTopic) {
      this.subscribe(
        this.configuration.taskStatusTopic,
        (message) => this.handleStanagMessage(message),
      );
    }
  }

  private subscribeToTwins(): void {
    this.subscribe(
      TWIN_TOPIC,
      (message) => this.handleTwinMessage(message),
    );
  }

  private subscribeToMavlinkStatus(): void {
    this.subscribe(
      MAVLINK_STATUS_TOPIC,
      (message) => this.handleMavlinkStatus(message),
    );
  }

  private subscribe(destination: string, handler: (message: IMessage) => void): void {
    if (!this.client?.connected) {
      return;
    }

    this.subscriptions.push(this.client.subscribe(destination, handler));
  }

  private unsubscribeAll(): void {
    if (this.client?.connected) {
      this.subscriptions.forEach((subscription) => subscription.unsubscribe());
    }

    this.subscriptions = [];
  }

  private publishTaskPayload(task: DroneTask, payload: unknown): void {
    const drone = useAppStore.getState().drones[task.droneId];

    if (!drone) {
      throw new Error(`Unknown drone ${task.droneId}`);
    }

    const destination = resolveTaskAdminDestination(
      this.configuration.taskAdminTopic,
      drone.name,
    );

    this.publishJson(destination, payload);
  }

  private publishJson(destination: string, payload: unknown): void {
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

  private handleStanagMessage(message: IMessage): void {
    this.parse(message, dispatchStanagMessage);
  }

  private handleTwinMessage(message: IMessage): void {
    const destination = message.headers.destination ?? TWIN_TOPIC;
    this.pendingTwinMessages.set(destination, message);

    if (this.twinFlushFrame !== undefined) {
      return;
    }

    this.twinFlushFrame = globalThis.requestAnimationFrame(
      () => this.flushPendingTwinMessages(),
    );
  }

  private flushPendingTwinMessages(): void {
    this.twinFlushFrame = undefined;

    const messages = Array.from(this.pendingTwinMessages.values());
    this.pendingTwinMessages.clear();

    messages.forEach((message) => this.parse(message, dispatchTwinMessage));
  }

  private clearPendingTwinMessages(): void {
    if (this.twinFlushFrame !== undefined) {
      globalThis.cancelAnimationFrame(this.twinFlushFrame);
      this.twinFlushFrame = undefined;
    }

    this.pendingTwinMessages.clear();
  }

  private handleMavlinkStatus(message: IMessage): void {
    const destination = message.headers.destination;
    const systemId = destination ? parseMavlinkSystemId(destination) : undefined;

    if (systemId === undefined) {
      return;
    }

    this.parse(
      message,
      (payload) => dispatchMavlinkStreamStatus(systemId, payload),
    );
  }

  private parse(
    message: IMessage,
    handler: (payload: unknown) => void,
  ): void {
    try {
      handler(JSON.parse(this.decodeBody(message)));
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
      const trimmed = decoded.trim();

      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        return decoded;
      }
    } catch {
      // JSON.parse reports the original body error below.
    }

    return body;
  }

  private decodeBase64(value: string): string {
    const binary = globalThis.atob(value);
    const bytes = Uint8Array.from(
      binary,
      (character) => character.charCodeAt(0),
    );

    return new TextDecoder().decode(bytes);
  }
}

function parseMavlinkSystemId(destination: string): number | undefined {
  const match = MAVLINK_STATUS_DESTINATION_PATTERN.exec(destination);

  if (!match) {
    return undefined;
  }

  const systemId = Number(match[1]);

  return Number.isInteger(systemId) && systemId >= 1 && systemId <= 255
    ? systemId
    : undefined;
}
