import { Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField } from '@mui/material';
import { useEffect, useState } from 'react';
import type { BrokerConfiguration } from '../models/types';
import { useAppStore } from '../state/useAppStore';

interface Props {
  open: boolean;
  onClose: () => void;
  onApply: (configuration: BrokerConfiguration) => Promise<void>;
}

export function SettingsDialog({ open, onClose, onApply }: Props) {
  const current = useAppStore((state) => state.configuration);
  const [configuration, setConfiguration] = useState(current);

  useEffect(() => setConfiguration(current), [current, open]);

  function change<K extends keyof BrokerConfiguration>(field: K, value: BrokerConfiguration[K]): void {
    setConfiguration((previous) => ({ ...previous, [field]: value }));
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Connection settings</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField select label="Transport" value={configuration.transport} onChange={(event) => change('transport', event.target.value as BrokerConfiguration['transport'])}>
            <MenuItem value="mock">Mock</MenuItem>
            <MenuItem value="mqtt">MQTT over WebSockets</MenuItem>
            <MenuItem value="stomp">STOMP over WebSockets</MenuItem>
          </TextField>
          <TextField label="Broker WebSocket URL" value={configuration.brokerUrl} onChange={(event) => change('brokerUrl', event.target.value)} disabled={configuration.transport === 'mock'} />
          <TextField label="Username" value={configuration.username} onChange={(event) => change('username', event.target.value)} disabled={configuration.transport === 'mock'} />
          <TextField label="Password" type="password" value={configuration.password} onChange={(event) => change('password', event.target.value)} disabled={configuration.transport === 'mock'} />
          <TextField label="Drone topic/destination" value={configuration.droneTopic} onChange={(event) => change('droneTopic', event.target.value)} disabled={configuration.transport === 'mock'} />
          <TextField label="Task status topic/destination" value={configuration.taskStatusTopic} onChange={(event) => change('taskStatusTopic', event.target.value)} disabled={configuration.transport === 'mock'} />
          <TextField label="Task command topic/destination" value={configuration.taskCommandTopic} onChange={(event) => change('taskCommandTopic', event.target.value)} disabled={configuration.transport === 'mock'} />
          <TextField label="Task cancel topic/destination" value={configuration.taskCancelTopic} onChange={(event) => change('taskCancelTopic', event.target.value)} disabled={configuration.transport === 'mock'} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
        <Button variant="contained" onClick={() => onApply(configuration)}>Apply and reconnect</Button>
      </DialogActions>
    </Dialog>
  );
}
