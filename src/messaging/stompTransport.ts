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
const TWIN_UPDATE_MINIMUM_INTERVAL_MILLIS = 100;
const MAVLINK_STATUS_DESTINATION_PATTERN = /^\/mavlink\/(\d+)\/status$/;

export class StompTransport implements MessageTransport {
  private client?: Client;
  private twinSubscription?: StompSubscription;
  private mavlinkStatusSubscription?: StompSubscription;
  private readonly lastTwinProcessedAt = new Map<string, number>();

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
    this.twinSubscription?.unsubscribe();
    this.twinSubscription = undefined;

    this.mavlinkStatusSubscription?.unsubscribe();
    this.mavlinkStatusSubscription = undefined;

    this.lastTwinProcessedAt.clear();

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

  private subscribeToStanag(): void {
    if (!this.client?.connected) {
      return;
    }

    this.client.subscribe(
      this.configuration.droneTopic,
      (message) => this.handleStanagMessage(message),
    );

    if (this.configuration.taskStatusTopic) {
      this.client.subscribe(
        this.configuration.taskStatusTopic,
        (message) => this.handleStanagMessage(message),
      );
    }
  }

  private subscribeToTwins(): void {
    if (!this.client?.connected) {
      return;
    }

    this.twinSubscription?.unsubscribe();
    this.twinSubscription = this.client.subscribe(
      TWIN_TOPIC,
      (message) => this.handleTwinMessage(message),
    );
  }

  private subscribeToMavlinkStatus(): void {
    if (!this.client?.connected) {
      return;
    }

    this.mavlinkStatusSubscription?.unsubscribe();
    this.mavlinkStatusSubscription = this.client.subscribe(
      MAVLINK_STATUS_TOPIC,
      (message) => this.handleMavlinkStatus(message),
    );
  }

  private publish(task: DroneTask, payload: unknown): void {
    if (!this.client?.connected) {
      throw new Error('STOMP client is not connected');
    }

    const destination = resolveTaskAdminDestination(
      this.configuration.taskAdminTopic,
      task.droneId,
    );

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

    if (!this.shouldProcessTwin(destination)) {
      return;
    }

    this.parse(message, dispatchTwinMessage);
  }

  private handleMavlinkStatus(message: IMessage): void {
    const destination = message.headers.destination;
    const systemId = destination ? parseMavlinkSystemId(destination) : undefined;

    if (systemId === undefined || !hasExactlyOneDroneForSystemId(systemId)) {
      return;
    }

    this.parse(
      message,
      (payload) => dispatchMavlinkStreamStatus(systemId, payload),
    );
  }

  private shouldProcessTwin(destination: string): boolean {
    const now = Date.now();
    const previous = this.lastTwinProcessedAt.get(destination);

    if (
      previous !== undefined
      && now - previous < TWIN_UPDATE_MINIMUM_INTERVAL_MILLIS
    ) {
      return false;
    }

    this.lastTwinProcessedAt.set(destination, now);
    return true;
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

function hasExactlyOneDroneForSystemId(systemId: number): boolean {
  const matches = Object.values(useAppStore.getState().drones).filter(
    (drone) => drone.twin?.systemId === systemId,
  );

  return matches.length === 1;
}
