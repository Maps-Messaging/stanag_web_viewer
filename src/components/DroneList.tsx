import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import {
  Box,
  Button,
  Chip,
  IconButton,
  List,
  ListItemButton,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { memo, useCallback, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../state/useAppStore';
import { AttitudeIndicator } from './AttitudeIndicator';
import { DroneDetailsDialog } from './DroneDetailsDialog';

interface DroneListProps {
  onDetect: (droneId: string) => Promise<void>;
}

export function DroneList({ onDetect }: DroneListProps) {
  const droneIds = useAppStore(
    useShallow((state) => Object.keys(state.drones)),
  );
  const [dialogDroneId, setDialogDroneId] = useState<string>();
  const dialogDrone = useAppStore((state) => (
    dialogDroneId ? state.drones[dialogDroneId] : undefined
  ));
  const showDetails = useCallback((droneId: string) => {
    setDialogDroneId(droneId);
  }, []);

  return (
    <>
      <Paper square sx={{ height: '100%', overflow: 'auto' }}>
        <Box sx={{ px: 2, py: 1.5 }}>
          <Typography variant="overline">Drones</Typography>
        </Box>

        <List disablePadding>
          {droneIds.map((droneId) => (
            <DroneListItem
              key={droneId}
              droneId={droneId}
              onShowDetails={showDetails}
              onDetect={onDetect}
            />
          ))}
        </List>
      </Paper>

      <DroneDetailsDialog
        drone={dialogDrone}
        open={dialogDrone !== undefined}
        onClose={() => setDialogDroneId(undefined)}
      />
    </>
  );
}

interface DroneListItemProps {
  droneId: string;
  onShowDetails: (droneId: string) => void;
  onDetect: (droneId: string) => Promise<void>;
}

const DroneListItem = memo(function DroneListItem({
  droneId,
  onShowDetails,
  onDetect,
}: DroneListItemProps) {
  const row = useAppStore(useShallow((state) => {
    const drone = state.drones[droneId];
    const activeTask = drone?.activeTaskId ? state.tasks[drone.activeTaskId] : undefined;

    return drone ? {
      id: drone.id,
      name: drone.name,
      symbolSet: drone.symbolSet,
      hasPosition: drone.position !== undefined,
      systemId: drone.twin?.systemId,
      streamStatus: drone.mavlinkStreamStatus?.status,
      hasStreamStatus: drone.mavlinkStreamStatus !== undefined,
      activeTaskLabel: activeTask ? `TASK ${activeTask.type} · ${activeTask.geometry.type}` : undefined,
      selected: state.selectedDroneId === droneId,
      connected: state.connected,
    } : undefined;
  }));
  const selectDrone = useAppStore((state) => state.selectDrone);
  const addEvent = useAppStore((state) => state.addEvent);
  const [detecting, setDetecting] = useState(false);

  if (!row) return null;

  const detectDisabled = detecting || !row.connected || row.systemId === undefined;
  const detectTooltip = row.systemId === undefined
    ? 'MAVLink system ID unavailable'
    : !row.connected
      ? 'Broker is disconnected'
      : 'Publish the detect MAVLink event';

  async function detect(): Promise<void> {
    setDetecting(true);
    try {
      await onDetect(row.id);
    } catch (error) {
      addEvent({ level: 'ERROR', message: `Detect failed for ${row.name}: ${String(error)}` });
    } finally {
      setDetecting(false);
    }
  }

  return (
    <ListItemButton
      selected={row.selected}
      onClick={() => selectDrone(row.id)}
      sx={{ alignItems: 'center', gap: 1.25, py: 1.25 }}
    >
      <DroneLiveTelemetry droneId={droneId} />

      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Stack direction="row" spacing={0.5} alignItems="center">
          <Typography variant="body2" noWrap sx={{ minWidth: 0, flex: 1 }}>
            {row.name}
          </Typography>

          <Tooltip title="Drone details">
            <IconButton
              size="small"
              aria-label={`Show details for ${row.name}`}
              onClick={(event) => {
                event.stopPropagation();
                onShowDetails(row.id);
              }}
            >
              <InfoOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>

        <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap" sx={{ mt: 0.75 }}>
          {row.activeTaskLabel && <Chip size="small" color="primary" label={row.activeTaskLabel} />}
          {row.symbolSet && <Chip size="small" label={shortEnum(row.symbolSet)} />}
          <Chip size="small" label={row.hasPosition ? 'LIVE' : 'KNOWN'} color={row.hasPosition ? 'success' : 'default'} />
          <Chip
            size="small"
            label={streamStatusLabel(row.streamStatus)}
            color={streamStatusColor(row.streamStatus)}
            variant={row.hasStreamStatus ? 'filled' : 'outlined'}
          />
        </Stack>

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
              sx={{ mt: 0.75 }}
            >
              {detecting ? 'Detecting…' : 'Detect'}
            </Button>
          </span>
        </Tooltip>
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
      <AttitudeIndicator
        rollDegrees={telemetry.roll}
        pitchDegrees={telemetry.pitch}
        altitudeMeters={telemetry.altitude}
      />
      <div className="drone-heading">
        <span className="drone-heading__arrow" style={{ transform: `rotate(${telemetry.heading}deg)` }}>▲</span>
        <span>{formatHeading(telemetry.heading)}</span>
      </div>
    </div>
  );
});

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
