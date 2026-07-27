import FlightIcon from '@mui/icons-material/Flight';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import {
  Box,
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

export function DroneList() {
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
      <Paper
        square
        sx={{
          height: '100%',
          overflow: 'auto',
        }}
      >
        <Box sx={{ px: 2, py: 1.5 }}>
          <Typography variant="overline">
            Drones
          </Typography>
        </Box>

        <List disablePadding>
          {droneIds.map((droneId) => (
            <DroneListItem
              key={droneId}
              droneId={droneId}
              onShowDetails={showDetails}
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
}

const DroneListItem = memo(function DroneListItem({
  droneId,
  onShowDetails,
}: DroneListItemProps) {
  const drone = useAppStore((state) => state.drones[droneId]);
  const selected = useAppStore((state) => state.selectedDroneId === droneId);
  const selectDrone = useAppStore((state) => state.selectDrone);

  if (!drone) {
    return null;
  }

  return (
    <ListItemButton
      selected={selected}
      onClick={() => selectDrone(drone.id)}
      sx={{
        alignItems: 'center',
        gap: 1.25,
        py: 1.25,
      }}
    >
      <AttitudeIndicator
        rollDegrees={drone.roll}
        pitchDegrees={drone.pitch}
        altitudeMeters={drone.position?.altitude}
      />

      <Box
        sx={{
          minWidth: 0,
          flex: 1,
        }}
      >
        <Stack
          direction="row"
          spacing={0.5}
          alignItems="center"
        >
          <Typography
            variant="body2"
            noWrap
            sx={{
              minWidth: 0,
              flex: 1,
            }}
          >
            {drone.name}
          </Typography>

          <Tooltip title="Drone details">
            <IconButton
              size="small"
              aria-label={`Show details for ${drone.name}`}
              onClick={(event) => {
                event.stopPropagation();
                onShowDetails(drone.id);
              }}
            >
              <InfoOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>

        <Stack
          direction="row"
          spacing={0.75}
          alignItems="center"
          sx={{ mt: 0.4 }}
        >
          <FlightIcon
            fontSize="small"
            sx={{
              transform: `rotate(${drone.heading}deg)`,
              color: 'text.secondary',
            }}
          />

          <Typography
            variant="caption"
            color="text.secondary"
          >
            {formatHeading(drone.heading)}
          </Typography>
        </Stack>

        <Stack
          direction="row"
          spacing={0.5}
          useFlexGap
          flexWrap="wrap"
          sx={{ mt: 0.75 }}
        >
          {drone.symbolSet && (
            <Chip
              size="small"
              label={shortEnum(drone.symbolSet)}
            />
          )}

          <Chip
            size="small"
            label={drone.position ? 'LIVE' : 'KNOWN'}
            color={drone.position ? 'success' : 'default'}
          />

          <Chip
            size="small"
            label={streamStatusLabel(
              drone.mavlinkStreamStatus?.status,
            )}
            color={streamStatusColor(
              drone.mavlinkStreamStatus?.status,
            )}
            variant={
              drone.mavlinkStreamStatus
                ? 'filled'
                : 'outlined'
            }
          />
        </Stack>
      </Box>
    </ListItemButton>
  );
});

function formatHeading(value: number): string {
  const heading = (value % 360 + 360) % 360;
  return `${heading.toFixed(1)}°`;
}

function shortEnum(value: string): string {
  return value
    .replace(/^.*Enum_/, '')
    .replaceAll('_', ' ');
}

function streamStatusLabel(
  status: string | undefined,
): string {
  switch (status) {
    case 'OK':
      return 'UDP OK';

    case 'INITIAL':
      return 'UDP INITIAL';

    case 'LOSS':
      return 'UDP LOSS';

    case 'RESET':
      return 'UDP RESET';

    case 'OUT_OF_ORDER':
      return 'UDP ORDER';

    default:
      return 'UDP UNKNOWN';
  }
}

function streamStatusColor(
  status: string | undefined,
): 'default' | 'success' | 'warning' | 'error' {
  switch (status) {
    case 'OK':
      return 'success';

    case 'INITIAL':
    case 'RESET':
    case 'OUT_OF_ORDER':
      return 'warning';

    case 'LOSS':
      return 'error';

    default:
      return 'default';
  }
}
