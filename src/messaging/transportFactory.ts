import type { BrokerConfiguration } from '../models/types';
import type { MessageTransport } from './transport';

export async function createTransport(configuration: BrokerConfiguration): Promise<MessageTransport> {
  switch (configuration.transport) {
    case 'mqtt': {
      const { MqttTransport } = await import('./mqttTransport');
      return new MqttTransport(configuration);
    }
    case 'stomp': {
      const { StompTransport } = await import('./stompTransport');
      return new StompTransport(configuration);
    }
  }
}
