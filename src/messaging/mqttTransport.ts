import mqtt, { type MqttClient } from 'mqtt';
import type { MessageTransport } from './transport';
import type { BrokerConfiguration, DroneTask } from '../models/types';
import { buildCancelCommand, buildTaskCommand, parseNodeMessage, parseTaskStatus } from '../services/stanagAdapter';
import { useAppStore } from '../state/useAppStore';

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
        client.subscribe([this.configuration.droneTopic, this.configuration.taskStatusTopic], (error) => {
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
    await this.publish(this.configuration.taskCommandTopic, buildTaskCommand(task));
  }

  async cancelTask(task: DroneTask): Promise<void> {
    await this.publish(this.configuration.taskCancelTopic, buildCancelCommand(task));
  }

  private async publish(topic: string, payload: unknown): Promise<void> {
    if (!this.client?.connected) throw new Error('MQTT client is not connected');
    await this.client.publishAsync(topic, JSON.stringify(payload), { qos: 1 });
  }

  private handleMessage(topic: string, body: string): void {
    const store = useAppStore.getState();
    try {
      const payload: unknown = JSON.parse(body);
      if (topicMatches(this.configuration.droneTopic, topic)) {
        const node = parseNodeMessage(payload);
        store.upsertDrone(node.drone);
        store.addEvent({ level: 'INFO', message: `${node.messageType}: ${node.drone.name}`, payload });
      } else if (topicMatches(this.configuration.taskStatusTopic, topic)) {
        const status = parseTaskStatus(payload);
        const existing = store.tasks[status.taskId];
        if (existing) {
          store.upsertTask({ ...existing, state: status.state, updatedAt: Date.now(), message: status.message });
        }
      }
    } catch (error) {
      store.addEvent({ level: 'ERROR', message: `MQTT message rejected on ${topic}: ${String(error)}`, payload: body });
    }
  }
}

function topicMatches(filter: string, topic: string): boolean {
  const filterParts = filter.split('/');
  const topicParts = topic.split('/');
  return filterParts.every((part, index) => part === '#' || part === '+' || part === topicParts[index]);
}
