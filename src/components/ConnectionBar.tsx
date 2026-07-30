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
      <Toolbar
        variant="dense"
        sx={{
          gap: 1,
          flexWrap: { xs: 'wrap', sm: 'nowrap' },
          py: { xs: 0.5, sm: 0 },
        }}
      >
        <Typography variant="h6" sx={{ flexGrow: 1, minWidth: { xs: '100%', sm: 0 } }}>
          STANAG Drone Demo
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
          <CircleIcon color={connected ? 'success' : 'error'} sx={{ fontSize: 14, flex: '0 0 auto' }} />
          <Typography variant="body2" noWrap sx={{ minWidth: 0 }}>{message}</Typography>
          <IconButton color="inherit" onClick={onOpenSettings} aria-label="Open settings">
            <SettingsIcon />
          </IconButton>
        </Box>
      </Toolbar>
    </AppBar>
  );
}
