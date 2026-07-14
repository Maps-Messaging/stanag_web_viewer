import mqtt, { type MqttClient } from 'mqtt';
import type { BrokerConfiguration, DroneTask } from '../models/types';
import { buildTaskAdminCancel, buildTaskAdminPush, resolveTaskAdminDestination } from '../services/stanagAdapter';
import { useAppStore } from '../state/useAppStore';
import { dispatchStanagMessage } from './messageDispatcher';
import type { MessageTransport } from './transport';

export class MqttTransport implements MessageTransport {
  private client?: MqttClient;

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
        const subscriptions = [this.configuration.droneTopic, this.configuration.taskStatusTopic].filter(Boolean);
        client.subscribe(subscriptions, (error) => {
          if (error) {
            reject(error);
            return;
          }
          store.setConnection(true, 'Connected with MQTT');
          store.addEvent({ level: 'INFO', message: 'MQTT transport connected' });
          resolve();
        });
      });
      client.once('error', reject);
      client.on('close', () => store.setConnection(false, 'MQTT disconnected'));
      client.on('message', (topic, message) => this.handleMessage(topic, message.toString('utf8')));
    });
  }

  async disconnect(): Promise<void> {
    if (!this.client) return;
    await this.client.endAsync();
    this.client = undefined;
    useAppStore.getState().setConnection(false, 'Disconnected');
  }

  async publishTask(task: DroneTask): Promise<void> {
    await this.publish(task, buildTaskAdminPush(this.configuration, task));
  }

  async cancelTask(task: DroneTask): Promise<void> {
    await this.publish(task, buildTaskAdminCancel(this.configuration, task));
  }

  private async publish(task: DroneTask, payload: unknown): Promise<void> {
    if (!this.client?.connected) throw new Error('MQTT client is not connected');
    const topic = resolveTaskAdminDestination(this.configuration.taskAdminTopic, task.droneId);
    await this.client.publishAsync(topic, JSON.stringify(payload), { qos: 1, retain: false });
  }

  private handleMessage(topic: string, body: string): void {
    const store = useAppStore.getState();
    try {
      const payload: unknown = JSON.parse(body);
      if (topicMatches(this.configuration.droneTopic, topic) || (this.configuration.taskStatusTopic && topicMatches(this.configuration.taskStatusTopic, topic))) {
        dispatchStanagMessage(payload);
      }
    } catch (error) {
      store.addEvent({ level: 'ERROR', message: `MQTT message rejected on ${topic}: ${String(error)}`, payload: body });
    }
  }
}

function topicMatches(filter: string, topic: string): boolean {
  const filterParts = filter.split('/');
  const topicParts = topic.split('/');

  for (let index = 0; index < filterParts.length; index++) {
    const part = filterParts[index];
    if (part === '#') return true;
    if (part !== '+' && part !== topicParts[index]) return false;
  }

  return filterParts.length === topicParts.length;
}
