import CircleIcon from '@mui/icons-material/Circle';
import SettingsIcon from '@mui/icons-material/Settings';
import { AppBar, Box, IconButton, Toolbar, Typography } from '@mui/material';
import { useAppStore } from '../state/useAppStore';

interface Props {
  onOpenSettings: () => void;
}

export function ConnectionBar({ onOpenSettings }: Props) {
  const connected = useAppStore((state) => state.connected);
  const message = useAppStore((state) => state.connectionMessage);

  return (
    <AppBar position="static" elevation={0}>
      <Toolbar variant="dense">
        <Typography variant="h6" sx={{ flexGrow: 1 }}>STANAG Drone Demo</Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <CircleIcon color={connected ? 'success' : 'error'} sx={{ fontSize: 14 }} />
          <Typography variant="body2">{message}</Typography>
          <IconButton color="inherit" onClick={onOpenSettings} aria-label="Open settings">
            <SettingsIcon />
          </IconButton>
        </Box>
      </Toolbar>
    </AppBar>
  );
}
