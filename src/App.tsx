import { CssBaseline, ThemeProvider, createTheme } from '@mui/material';
import { useEffect, useRef, useState } from 'react';
import { ConnectionBar } from './components/ConnectionBar';
import { DroneList } from './components/DroneList';
import { EventLog } from './components/EventLog';
import { MapView } from './components/MapView';
import { SettingsDialog } from './components/SettingsDialog';
import { TaskPanel } from './components/TaskPanel';
import { createTransport } from './messaging/transportFactory';
import type { MessageTransport } from './messaging/transport';
import type { BrokerConfiguration } from './models/types';
import { buildNamedValueFloatEvent, namedValueFloatTopic } from './services/mavlinkEvents';
import { TELEMETRY_STALE_MILLIS } from './services/operationalState';
import { useAppStore } from './state/useAppStore';

const DETECTION_NAME = 'DETECT';
const DETECTION_DURATION_MILLIS = 5_000;
const DETECTION_EXPIRY_CHECK_MILLIS = 1_000;
const CONNECTION_TIMEOUT_MILLIS = 15_000;

const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#42a5f5' },
    background: { default: '#0f1419', paper: '#17212b' },
  },
  shape: { borderRadius: 6 },
});

export default function App() {
  const configuration = useAppStore((state) => state.configuration);
  const updateConfiguration = useAppStore((state) => state.updateConfiguration);
  const addEvent = useAppStore((state) => state.addEvent);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [transport, setTransport] = useState<MessageTransport>();
  const transportRef = useRef<MessageTransport | undefined>(undefined);
  const connectionGenerationRef = useRef(0);
  const activeDetectionPulsesRef = useRef(new Set<string>());

  async function connect(nextConfiguration: BrokerConfiguration): Promise<void> {
    const generation = ++connectionGenerationRef.current;
    const previousTransport = transportRef.current;
    transportRef.current = undefined;
    setTransport(undefined);
    useAppStore.getState().setConnection(false, 'Connecting…');

    try {
      await previousTransport?.disconnect();
    } catch (error) {
      addEvent({ level: 'WARN', message: `Previous transport disconnect failed: ${String(error)}` });
    }

    if (generation !== connectionGenerationRef.current) {
      throw new Error('Connection attempt was superseded');
    }

    const nextTransport = createTransport(nextConfiguration);
    try {
      await withTimeout(
        nextTransport.connect(),
        CONNECTION_TIMEOUT_MILLIS,
        `Connection timed out after ${CONNECTION_TIMEOUT_MILLIS / 1_000} seconds`,
      );

      if (generation !== connectionGenerationRef.current) {
        await nextTransport.disconnect().catch(() => undefined);
        throw new Error('Connection attempt was superseded');
      }

      transportRef.current = nextTransport;
      setTransport(nextTransport);
    } catch (error) {
      await nextTransport.disconnect().catch(() => undefined);
      if (generation === connectionGenerationRef.current) {
        useAppStore.getState().setConnection(false, 'Connection failed');
        addEvent({ level: 'ERROR', message: `Connection failed: ${String(error)}` });
      }
      throw error;
    }
  }

  useEffect(() => {
    void connect(configuration).catch(() => undefined);
    return () => {
      connectionGenerationRef.current += 1;
      void transportRef.current?.disconnect();
    };
  }, []);

  useEffect(() => {
    const timer = globalThis.setInterval(() => {
      const store = useAppStore.getState();
      store.purgeExpiredDetections();
      store.refreshTelemetryFreshness(Date.now(), TELEMETRY_STALE_MILLIS);
    }, DETECTION_EXPIRY_CHECK_MILLIS);
    return () => globalThis.clearInterval(timer);
  }, []);

  async function applySettings(nextConfiguration: BrokerConfiguration): Promise<void> {
    await connect(nextConfiguration);
    updateConfiguration(nextConfiguration);
    setSettingsOpen(false);
  }

  async function detectDrone(droneId: string): Promise<void> {
    const drone = useAppStore.getState().drones[droneId];
    if (!drone) throw new Error(`Unknown drone ${droneId}`);
    if (activeDetectionPulsesRef.current.has(droneId)) throw new Error(`Detection is already active for ${drone.name}`);

    const systemId = drone.twin?.systemId;
    const componentId = drone.twin?.componentId ?? 1;
    if (systemId === undefined) throw new Error(`MAVLink system ID is unavailable for ${drone.name}`);

    const destination = namedValueFloatTopic(systemId);
    activeDetectionPulsesRef.current.add(droneId);
    try {
      const currentTransport = transportRef.current;
      if (!currentTransport) throw new Error('Message transport is not connected');
      await currentTransport.publishEvent(destination, buildNamedValueFloatEvent(systemId, componentId, DETECTION_NAME, 1));
      addEvent({ level: 'INFO', message: `Detection asserted for ${drone.name}` });
      await delay(DETECTION_DURATION_MILLIS);
    } finally {
      activeDetectionPulsesRef.current.delete(droneId);
      const currentTransport = transportRef.current;
      if (currentTransport) {
        try {
          await currentTransport.publishEvent(destination, buildNamedValueFloatEvent(systemId, componentId, DETECTION_NAME, 0));
          addEvent({ level: 'INFO', message: `Detection cleared for ${drone.name}` });
        } catch (error) {
          addEvent({ level: 'ERROR', message: `Detection clear failed for ${drone.name}: ${String(error)}` });
        }
      }
    }
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <div className="app-shell">
        <ConnectionBar onOpenSettings={() => setSettingsOpen(true)} />
        <main className="workspace">
          <aside className="drone-list"><DroneList onDetect={detectDrone} /></aside>
          <section className="map-panel"><MapView /></section>
          <aside className="task-panel"><TaskPanel transport={transport} /></aside>
          <section className="event-log"><EventLog /></section>
        </main>
      </div>
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} onApply={applySettings} />
    </ThemeProvider>
  );
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, milliseconds);
  });
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = globalThis.setTimeout(() => reject(new Error(message)), milliseconds);
    promise.then(
      (value) => {
        globalThis.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        globalThis.clearTimeout(timer);
        reject(error);
      },
    );
  });
}
