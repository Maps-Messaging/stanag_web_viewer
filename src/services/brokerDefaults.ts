import type { TransportKind } from '../models/types';

interface BrowserLocation {
  protocol: string;
  hostname: string;
}

interface BrokerEndpoint {
  port: number;
  path: string;
}

const ENDPOINTS: Record<TransportKind, Record<'ws' | 'wss', BrokerEndpoint>> = {
  stomp: {
    ws: { port: 8674, path: '/stomp' },
    wss: { port: 8695, path: '/stomp' },
  },
  mqtt: {
    ws: { port: 1883, path: '/mqtt' },
    wss: { port: 1892, path: '/mqtt' },
  },
};

export function defaultBrokerUrl(
  transport: TransportKind,
  location: BrowserLocation = globalThis.location,
): string {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  const endpoint = ENDPOINTS[transport][scheme];
  const hostname = formatHostname(location.hostname);

  return `${scheme}://${hostname}:${endpoint.port}${endpoint.path}`;
}

export function isDefaultBrokerUrl(
  brokerUrl: string,
  transport: TransportKind,
  location: BrowserLocation = globalThis.location,
): boolean {
  return brokerUrl === defaultBrokerUrl(transport, location);
}

function formatHostname(hostname: string): string {
  if (hostname.includes(':') && !hostname.startsWith('[')) {
    return `[${hostname}]`;
  }

  return hostname;
}
