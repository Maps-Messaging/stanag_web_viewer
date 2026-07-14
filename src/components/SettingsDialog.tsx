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
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    setConfiguration(current);
  }, [current, open]);

  function change<K extends keyof BrokerConfiguration>(field: K, value: BrokerConfiguration[K]): void {
    setConfiguration((previous) => ({ ...previous, [field]: value }));
  }

  async function apply(): Promise<void> {
    setApplying(true);
    try {
      await onApply(configuration);
      onClose();
    } finally {
      setApplying(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Connection settings</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField select label="Transport" value={configuration.transport} onChange={(event) => change('transport', event.target.value as BrokerConfiguration['transport'])}>
            <MenuItem value="stomp">STOMP over WebSockets</MenuItem>
            <MenuItem value="mqtt">MQTT over WebSockets</MenuItem>
          </TextField>
          <TextField label="Broker WebSocket URL" value={configuration.brokerUrl} onChange={(event) => change('brokerUrl', event.target.value)} />
          <TextField label="Username" value={configuration.username} onChange={(event) => change('username', event.target.value)} />
          <TextField label="Password" type="password" value={configuration.password} onChange={(event) => change('password', event.target.value)} />
          <TextField label="Node topic/destination" value={configuration.droneTopic} onChange={(event) => change('droneTopic', event.target.value)} />
          <TextField label="Task status topic/destination" helperText="May be left blank until task status messages are wired." value={configuration.taskStatusTopic} onChange={(event) => change('taskStatusTopic', event.target.value)} />
          <TextField label="TASK_ADMIN topic/destination" helperText="Use {droneId} or {droneUuid} for the selected node." value={configuration.taskAdminTopic} onChange={(event) => change('taskAdminTopic', event.target.value)} />
          <TextField label="Command source UUID" value={configuration.sourceUuid} onChange={(event) => change('sourceUuid', event.target.value)} />
          <TextField label="STANAG version" value={configuration.stanagVersion} onChange={(event) => change('stanagVersion', event.target.value)} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={applying}>Close</Button>
        <Button variant="contained" onClick={apply} disabled={applying || configuration.brokerUrl.trim().length === 0 || configuration.taskAdminTopic.trim().length === 0 || configuration.sourceUuid.trim().length === 0}>
          {applying ? 'Connecting…' : 'Apply and reconnect'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
