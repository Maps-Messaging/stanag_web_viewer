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
import {
  buildNamedValueFloatEvent,
  namedValueFloatTopic,
} from './services/mavlinkEvents';
import { useAppStore } from './state/useAppStore';

const DETECTION_NAME = 'DETECT';
const DETECTION_DURATION_MILLIS = 5_000;

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

  async function connect(nextConfiguration: BrokerConfiguration): Promise<void> {
    try {
      await transportRef.current?.disconnect();
      const nextTransport = createTransport(nextConfiguration);
      transportRef.current = nextTransport;
      setTransport(nextTransport);
      await nextTransport.connect();
    } catch (error) {
      useAppStore.getState().setConnection(false, 'Connection failed');
      addEvent({ level: 'ERROR', message: `Connection failed: ${String(error)}` });
    }
  }

  useEffect(() => {
    void connect(configuration);
    return () => { void transportRef.current?.disconnect(); };
  }, []);

  async function applySettings(nextConfiguration: BrokerConfiguration): Promise<void> {
    updateConfiguration(nextConfiguration);
    setSettingsOpen(false);
    await connect(nextConfiguration);
  }

  async function detectDrone(droneId: string): Promise<void> {
    const drone = useAppStore.getState().drones[droneId];
    const currentTransport = transportRef.current;

    if (!drone) {
      throw new Error(`Unknown drone ${droneId}`);
    }

    if (!currentTransport) {
      throw new Error('Message transport is not connected');
    }

    const systemId = drone.twin?.systemId;
    const componentId = drone.twin?.componentId ?? 1;

    if (systemId === undefined) {
      throw new Error(`MAVLink system ID is unavailable for ${drone.name}`);
    }

    const destination = namedValueFloatTopic(systemId);

    await currentTransport.publishEvent(
      destination,
      buildNamedValueFloatEvent(
        systemId,
        componentId,
        DETECTION_NAME,
        1,
      ),
    );

    addEvent({
      level: 'INFO',
      message: `Detection asserted for ${drone.name}`,
    });

    await delay(DETECTION_DURATION_MILLIS);

    await currentTransport.publishEvent(
      destination,
      buildNamedValueFloatEvent(
        systemId,
        componentId,
        DETECTION_NAME,
        0,
      ),
    );

    addEvent({
      level: 'INFO',
      message: `Detection cleared for ${drone.name}`,
    });
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <div className="app-shell">
        <ConnectionBar onOpenSettings={() => setSettingsOpen(true)} />
        <main className="workspace">
          <aside className="drone-list">
            <DroneList onDetect={detectDrone} />
          </aside>
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
