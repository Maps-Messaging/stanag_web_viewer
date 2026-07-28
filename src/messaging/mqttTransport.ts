import mqtt, { type MqttClient } from 'mqtt';
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
const MAVLINK_STATUS_TOPIC_PATTERN = /^\/mavlink\/(\d+)\/status$/;

export class MqttTransport implements MessageTransport {
  private client?: MqttClient;
  private readonly lastTwinProcessedAt = new Map<string, number>();

  constructor(private readonly configuration: BrokerConfiguration) {}

  async connect(): Promise<void> {
    const store = useAppStore.getState();

    this.client = mqtt.connect(this.configuration.brokerUrl, {
      username: this.configuration.username || undefined,
      password: this.configuration.password || undefined,
      reconnectPeriod: 2000,
      clean: true,
    });

    await new Promise<void>((resolve, reject) => {
      const client = this.client!;

      client.once('connect', () => {
        const subscriptions = [
          this.configuration.droneTopic,
          this.configuration.taskStatusTopic,
          TWIN_TOPIC,
          MAVLINK_STATUS_TOPIC,
        ].filter(Boolean);

        client.subscribe(subscriptions, (error) => {
          if (error) {
            reject(error);
            return;
          }

          store.setConnection(true, 'Connected with MQTT');
          store.addEvent({
            level: 'INFO',
            message: 'MQTT transport connected',
          });
          resolve();
        });
      });

      client.once('error', reject);
      client.on('close', () => store.setConnection(false, 'MQTT disconnected'));
      client.on('message', (topic, message) => this.handleMessage(topic, message.toString('utf8')));
    });
  }

  async disconnect(): Promise<void> {
    if (!this.client) {
      return;
    }

    await this.client.endAsync();
    this.client = undefined;
    this.lastTwinProcessedAt.clear();

    useAppStore.getState().setConnection(false, 'Disconnected');
  }

  async publishTask(task: DroneTask): Promise<void> {
    await this.publishTaskPayload(task, buildTaskAdminPush(this.configuration, task));
  }

  async cancelTask(task: DroneTask): Promise<void> {
    await this.publishTaskPayload(task, buildTaskAdminCancel(this.configuration, task));
  }

  async publishEvent(destination: string, payload: unknown): Promise<void> {
    await this.publishJson(destination, payload);
  }

  private async publishTaskPayload(task: DroneTask, payload: unknown): Promise<void> {
    const drone = useAppStore.getState().drones[task.droneId];

    if (!drone) {
      throw new Error(`Unknown drone ${task.droneId}`);
    }

    const topic = resolveTaskAdminDestination(
      this.configuration.taskAdminTopic,
      drone.name,
    );

    await this.publishJson(topic, payload);
  }

  private async publishJson(topic: string, payload: unknown): Promise<void> {
    if (!this.client?.connected) {
      throw new Error('MQTT client is not connected');
    }

    await this.client.publishAsync(
      topic,
      JSON.stringify(payload),
      {
        qos: 1,
        retain: false,
      },
    );
  }

  private handleMessage(topic: string, body: string): void {
    const store = useAppStore.getState();

    try {
      if (topicMatches(TWIN_TOPIC, topic)) {
        if (!this.shouldProcessTwin(topic)) {
          return;
        }

        dispatchTwinMessage(JSON.parse(body));
        return;
      }

      const systemId = parseMavlinkSystemId(topic);

      if (systemId !== undefined) {
        if (!hasExactlyOneDroneForSystemId(systemId)) {
          return;
        }

        dispatchMavlinkStreamStatus(systemId, JSON.parse(body));
        return;
      }

      if (
        topicMatches(this.configuration.droneTopic, topic)
        || (
          this.configuration.taskStatusTopic
          && topicMatches(this.configuration.taskStatusTopic, topic)
        )
      ) {
        dispatchStanagMessage(JSON.parse(body));
      }
    } catch (error) {
      store.addEvent({
        level: 'ERROR',
        message: `MQTT message rejected on ${topic}: ${String(error)}`,
        payload: body,
      });
    }
  }

  private shouldProcessTwin(topic: string): boolean {
    const now = Date.now();
    const previous = this.lastTwinProcessedAt.get(topic);

    if (
      previous !== undefined
      && now - previous < TWIN_UPDATE_MINIMUM_INTERVAL_MILLIS
    ) {
      return false;
    }

    this.lastTwinProcessedAt.set(topic, now);
    return true;
  }
}

function parseMavlinkSystemId(topic: string): number | undefined {
  const match = MAVLINK_STATUS_TOPIC_PATTERN.exec(topic);

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

function topicMatches(filter: string, topic: string): boolean {
  const filterParts = filter.split('/');
  const topicParts = topic.split('/');

  for (let index = 0; index < filterParts.length; index += 1) {
    const part = filterParts[index];

    if (part === '#') {
      return true;
    }

    if (part !== '+' && part !== topicParts[index]) {
      return false;
    }
  }

  return filterParts.length === topicParts.length;
}
