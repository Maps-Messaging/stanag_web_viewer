import type { BrokerConfiguration } from '../models/types';
import { MqttTransport } from './mqttTransport';
import { StompTransport } from './stompTransport';
import type { MessageTransport } from './transport';

export function createTransport(configuration: BrokerConfiguration): MessageTransport {
  switch (configuration.transport) {
    case 'mqtt':
      return new MqttTransport(configuration);
    case 'stomp':
      return new StompTransport(configuration);
  }
}
