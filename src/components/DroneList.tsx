import AddTaskIcon from '@mui/icons-material/AddTask';
import CancelIcon from '@mui/icons-material/Cancel';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import {
  Box,
  Button,
  Chip,
  IconButton,
  LinearProgress,
  List,
  ListItemButton,
  Paper,
  Stack,
  Tooltip,
  TextField,
  Typography,
} from '@mui/material';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { MessageTransport } from '../messaging/transport';
import { CANCELLABLE_TASK_STATES, telemetryLabel } from '../services/operationalState';
import { useAppStore } from '../state/useAppStore';
import { AttitudeIndicator } from './AttitudeIndicator';
import { DroneDetailsDialog } from './DroneDetailsDialog';

interface DroneListProps {
  onDetect: (droneId: string) => Promise<void>;
  onAddTask: () => void;
  transport?: MessageTransport;
}

export function DroneList({ onDetect, onAddTask, transport }: DroneListProps) {
  const droneIds = useAppStore(useShallow((state) => Object.keys(state.drones)));
  const [dialogDroneId, setDialogDroneId] = useState<string>();
  const [search, setSearch] = useState('');
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = globalThis.setInterval(() => setNow(Date.now()), 1_000);
    return () => globalThis.clearInterval(timer);
  }, []);

  const visibleDroneIds = useMemo(() => {
    const state = useAppStore.getState();
    const query = search.trim().toLowerCase();
    return droneIds
      .filter((id) => {
        const drone = state.drones[id];
        return !query || id.toLowerCase().includes(query) || drone?.name.toLowerCase().includes(query) || drone?.twin?.callSign?.toLowerCase().includes(query);
      })
      .sort((leftId, rightId) => {
        const left = state.drones[leftId];
        const right = state.drones[rightId];
        const leftPriority = left?.stale ? 1 : left?.activeTaskId ? 0 : 2;
        const rightPriority = right?.stale ? 1 : right?.activeTaskId ? 0 : 2;
        return leftPriority - rightPriority || (left?.name ?? leftId).localeCompare(right?.name ?? rightId);
      });
  }, [droneIds, search, now]);

  const dialogDrone = useAppStore((state) => (dialogDroneId ? state.drones[dialogDroneId] : undefined));
  const showDetails = useCallback((droneId: string) => setDialogDroneId(droneId), []);

  return (
    <>
      <Paper square sx={{ height: '100%', overflow: 'auto' }}>
        <Box sx={{ px: 2, py: 1.5 }}>
          <Typography variant="overline">Vehicles</Typography>
          <TextField size="small" fullWidth placeholder="Search name, UUID or call sign" value={search} onChange={(event) => setSearch(event.target.value)} sx={{ mt: 1 }} />
        </Box>

        <List disablePadding>
          {visibleDroneIds.map((droneId) => (
            <DroneListItem
              key={droneId}
              droneId={droneId}
              onShowDetails={showDetails}
              onDetect={onDetect}
              onAddTask={onAddTask}
              transport={transport}
              now={now}
            />
          ))}
        </List>
      </Paper>

      <DroneDetailsDialog drone={dialogDrone} open={dialogDrone !== undefined} onClose={() => setDialogDroneId(undefined)} />
    </>
  );
}

interface DroneListItemProps {
  droneId: string;
  onShowDetails: (droneId: string) => void;
  onDetect: (droneId: string) => Promise<void>;
  onAddTask: () => void;
  transport?: MessageTransport;
  now: number;
}

const DroneListItem = memo(function DroneListItem({
  droneId,
  onShowDetails,
  onDetect,
  onAddTask,
  transport,
  now,
}: DroneListItemProps) {
  const row = useAppStore(useShallow((state) => {
    const drone = state.drones[droneId];
    const activeTask = drone?.activeTaskId ? state.tasks[drone.activeTaskId] : undefined;
    return drone ? {
      id: drone.id,
      name: drone.name,
      symbolSet: drone.symbolSet,
      lastSeen: drone.lastSeen,
      stale: drone.stale,
      systemId: drone.twin?.systemId,
      streamStatus: drone.mavlinkStreamStatus?.status,
      hasStreamStatus: drone.mavlinkStreamStatus !== undefined,
      capabilities: drone.capabilities.length,
      activeTask,
      selected: state.selectedDroneId === droneId,
      connected: state.connected,
    } : undefined;
  }));
  const selectDrone = useAppStore((state) => state.selectDrone);
  const addEvent = useAppStore((state) => state.addEvent);
  const [detecting, setDetecting] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  if (!row) return null;

  const rowId = row.id;
  const rowName = row.name;
  const activeTask = row.activeTask;
  const liveState = telemetryLabel(row, now);
  const detectDisabled = detecting || !row.connected || row.systemId === undefined;
  const detectTooltip = row.systemId === undefined
    ? 'MAVLink system ID unavailable'
    : !row.connected
      ? 'Broker is disconnected'
      : 'Publish the five-second MAVLink detection assertion';

  async function detect(): Promise<void> {
    setDetecting(true);
    try {
      await onDetect(rowId);
    } catch (error) {
      addEvent({ level: 'ERROR', message: `Detect failed for ${rowName}: ${String(error)}` });
    } finally {
      setDetecting(false);
    }
  }

  function addTask(): void {
    selectDrone(rowId);
    onAddTask();
  }

  async function cancelTask(): Promise<void> {
    if (!activeTask || !transport) return;
    setCancelling(true);
    try {
      await transport.cancelTask(activeTask);
      addEvent({ level: 'INFO', message: `Published cancellation for task ${activeTask.id}; awaiting TASK_ADMIN` });
    } catch (error) {
      addEvent({ level: 'ERROR', message: `Task cancellation failed for ${rowName}: ${String(error)}` });
    } finally {
      setCancelling(false);
    }
  }

  const cancellingState = activeTask?.state === 'CANCEL_REQUESTED' || activeTask?.state === 'PREEMPTING';

  return (
    <ListItemButton selected={row.selected} onClick={() => selectDrone(rowId)} sx={{ alignItems: 'center', gap: 1.25, py: 1.25 }}>
      <DroneLiveTelemetry droneId={droneId} />

      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Stack direction="row" spacing={0.5} alignItems="center">
          <Typography variant="body2" noWrap sx={{ minWidth: 0, flex: 1 }}>{rowName}</Typography>
          <Tooltip title="Drone details">
            <IconButton
              size="small"
              aria-label={`Show details for ${rowName}`}
              onClick={(event) => {
                event.stopPropagation();
                onShowDetails(rowId);
              }}
            >
              <InfoOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>

        <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap" sx={{ mt: 0.75 }}>
          {row.symbolSet && <Chip size="small" label={shortEnum(row.symbolSet)} />}
          <Chip size="small" label={liveState === 'KNOWN' ? liveState : `${liveState} ${formatAge(now - row.lastSeen)}`} color={liveState === 'LIVE' ? 'success' : liveState === 'STALE' ? 'warning' : 'default'} />
          <Chip size="small" label={streamStatusLabel(row.streamStatus)} color={streamStatusColor(row.streamStatus)} variant={row.hasStreamStatus ? 'filled' : 'outlined'} />
        </Stack>

        {activeTask && (
          <Box sx={{ mt: 1 }}>
            <Typography variant="caption" color="text.secondary">
              {activeTask.type} · {activeTask.geometry.type} · {activeTask.state}
            </Typography>
            {activeTask.percentComplete !== undefined && (
              <Stack spacing={0.25} sx={{ mt: 0.5 }}>
                <LinearProgress variant="determinate" value={Math.max(0, Math.min(100, activeTask.percentComplete))} />
                <Typography variant="caption" color="text.secondary">{activeTask.percentComplete.toFixed(1)}% complete</Typography>
              </Stack>
            )}
          </Box>
        )}

        <Stack direction="row" spacing={0.75} sx={{ mt: 0.75 }}>
          {activeTask ? (
            <Button
              size="small"
              color="error"
              variant="outlined"
              startIcon={<CancelIcon />}
              disabled={cancelling || cancellingState || !transport || !CANCELLABLE_TASK_STATES.has(activeTask.state)}
              onClick={(event) => {
                event.stopPropagation();
                void cancelTask();
              }}
            >
              {cancelling || cancellingState ? 'Cancelling…' : 'Cancel task'}
            </Button>
          ) : (
            <Button
              size="small"
              variant="contained"
              startIcon={<AddTaskIcon />}
              disabled={!row.connected || row.capabilities === 0}
              onClick={(event) => {
                event.stopPropagation();
                addTask();
              }}
            >
              Add task
            </Button>
          )}

          <Tooltip title={detectTooltip}>
            <span>
              <Button
                size="small"
                variant="outlined"
                disabled={detectDisabled}
                onClick={(event) => {
                  event.stopPropagation();
                  void detect();
                }}
              >
                {detecting ? 'Asserting…' : 'Assert detect'}
              </Button>
            </span>
          </Tooltip>
        </Stack>
      </Box>
    </ListItemButton>
  );
});

const DroneLiveTelemetry = memo(function DroneLiveTelemetry({ droneId }: { droneId: string }) {
  const telemetry = useAppStore(useShallow((state) => {
    const drone = state.drones[droneId];
    return {
      heading: drone?.heading ?? 0,
      roll: drone?.roll,
      pitch: drone?.pitch,
      altitude: drone?.position?.altitude,
    };
  }));

  return (
    <div className="drone-live-telemetry">
      <AttitudeIndicator rollDegrees={telemetry.roll} pitchDegrees={telemetry.pitch} altitudeMeters={telemetry.altitude} />
      <div className="drone-heading">
        <span className="drone-heading__arrow" style={{ transform: `rotate(${telemetry.heading}deg)` }}>▲</span>
        <span>{formatHeading(telemetry.heading)}</span>
      </div>
    </div>
  );
});

function formatAge(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h`;
}

function formatHeading(value: number): string {
  const heading = (value % 360 + 360) % 360;
  return `${heading.toFixed(1)}°`;
}

function shortEnum(value: string): string {
  return value.replace(/^.*Enum_/, '').replaceAll('_', ' ');
}

function streamStatusLabel(status: string | undefined): string {
  switch (status) {
    case 'OK': return 'UDP OK';
    case 'INITIAL': return 'UDP INITIAL';
    case 'LOSS': return 'UDP LOSS';
    case 'RESET': return 'UDP RESET';
    case 'OUT_OF_ORDER': return 'UDP ORDER';
    default: return 'UDP UNKNOWN';
  }
}

function streamStatusColor(status: string | undefined): 'default' | 'success' | 'warning' | 'error' {
  switch (status) {
    case 'OK': return 'success';
    case 'INITIAL':
    case 'RESET':
    case 'OUT_OF_ORDER': return 'warning';
    case 'LOSS': return 'error';
    default: return 'default';
  }
}
