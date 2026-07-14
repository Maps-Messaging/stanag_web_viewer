import FlightIcon from '@mui/icons-material/Flight';
import { Box, Chip, List, ListItemButton, ListItemIcon, ListItemText, Paper, Typography } from '@mui/material';
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
              secondary={`${drone.position.altitude?.toFixed(0) ?? 0} m · ${drone.groundSpeed.toFixed(1)} m/s`}
            />
            <Chip size="small" label={`${drone.batteryPercent ?? '?'}%`} />
          </ListItemButton>
        ))}
      </List>
    </Paper>
  );
}
