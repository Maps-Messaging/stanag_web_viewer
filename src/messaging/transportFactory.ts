import type { BrokerConfiguration } from '../models/types';
import type { MessageTransport } from './transport';
import { MockTransport } from './mockTransport';
import { MqttTransport } from './mqttTransport';
import { StompTransport } from './stompTransport';

export function createTransport(configuration: BrokerConfiguration): MessageTransport {
  switch (configuration.transport) {
    case 'mqtt':
      return new MqttTransport(configuration);
    case 'stomp':
      return new StompTransport(configuration);
    case 'mock':
      return new MockTransport();
  }
}
