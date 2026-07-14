import FlightIcon from '@mui/icons-material/Flight';
import { Box, Chip, List, ListItemButton, ListItemIcon, ListItemText, Paper, Stack, Typography } from '@mui/material';
import { useAppStore } from '../state/useAppStore';

export function DroneList() {
  const droneMap = useAppStore((state) => state.drones);
  const drones = Object.values(droneMap);
  const selectedDroneId = useAppStore((state) => state.selectedDroneId);
  const selectDrone = useAppStore((state) => state.selectDrone);

  return (
    <Paper square sx={{ height: '100%', overflow: 'auto' }}>
      <Box sx={{ px: 2, py: 1.5 }}>
        <Typography variant="overline">Drones</Typography>
      </Box>
      <List dense disablePadding>
        {drones.map((drone) => (
          <ListItemButton key={drone.id} selected={drone.id === selectedDroneId} onClick={() => selectDrone(drone.id)}>
            <ListItemIcon><FlightIcon sx={{ transform: `rotate(${drone.heading}deg)` }} /></ListItemIcon>
            <ListItemText
              primary={drone.name}
              secondary={drone.position
                ? `${drone.position.altitude?.toFixed(1) ?? 0} m · ${drone.groundSpeed.toFixed(2)} m/s`
                : 'Waiting for node status'}
            />
            <Stack direction="row" spacing={0.5}>
              {drone.symbolSet && <Chip size="small" label={shortEnum(drone.symbolSet)} />}
              <Chip size="small" label={drone.position ? 'LIVE' : 'KNOWN'} color={drone.position ? 'success' : 'default'} />
            </Stack>
          </ListItemButton>
        ))}
      </List>
    </Paper>
  );
}

function shortEnum(value: string): string {
  return value.replace(/^.*Enum_/, '').replaceAll('_', ' ');
}
