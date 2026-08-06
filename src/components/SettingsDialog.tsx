import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField } from '@mui/material';
import { useEffect, useState } from 'react';
import type { BrokerConfiguration } from '../models/types';
import { defaultBrokerUrl, isDefaultBrokerUrl } from '../services/brokerDefaults';
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
  const [applyError, setApplyError] = useState<string>();

  useEffect(() => {
    setConfiguration(current);
    setApplyError(undefined);
  }, [current, open]);

  function change<K extends keyof BrokerConfiguration>(field: K, value: BrokerConfiguration[K]): void {
    setConfiguration((previous) => ({ ...previous, [field]: value }));
  }

  function changeTransport(transport: BrokerConfiguration['transport']): void {
    setConfiguration((previous) => ({
      ...previous,
      transport,
      brokerUrl: isDefaultBrokerUrl(previous.brokerUrl, previous.transport)
          ? defaultBrokerUrl(transport)
          : previous.brokerUrl,
    }));
  }

  async function apply(): Promise<void> {
    setApplying(true);
    setApplyError(undefined);
    try {
      await onApply(configuration);
    } catch (error) {
      setApplyError(String(error));
    } finally {
      setApplying(false);
    }
  }

  return (
      <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
        <DialogTitle>Connection settings</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {applyError && <Alert severity="error">{applyError}</Alert>}
            <TextField
                select
                label="Transport"
                value={configuration.transport}
                onChange={(event) => changeTransport(event.target.value as BrokerConfiguration['transport'])}
            >
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
          <Button variant="contained" onClick={apply} disabled={applying || Boolean(configurationError(configuration))}>
            {applying ? 'Connecting…' : 'Apply and reconnect'}
          </Button>
        </DialogActions>
      </Dialog>
  );
}


function configurationError(configuration: BrokerConfiguration): string | undefined {
  try {
    const url = new URL(configuration.brokerUrl);
    if (url.protocol !== 'ws:' && url.protocol !== 'wss:') return 'Broker URL must use ws:// or wss://.';
  } catch {
    return 'Broker WebSocket URL is invalid.';
  }
  try {
    const url = new URL(configuration.restApiUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'REST API URL must use http:// or https://.';
  } catch {
    return 'REST API base URL is invalid.';
  }
  if (!configuration.taskAdminTopic.trim()) return 'TASK_ADMIN destination is required.';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(configuration.sourceUuid.trim())) {
    return 'Command source UUID is invalid.';
  }
  return undefined;
}