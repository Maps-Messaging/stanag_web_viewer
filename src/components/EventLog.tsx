import { Box, Chip, Paper, Stack, Typography } from '@mui/material';
import { useAppStore } from '../state/useAppStore';

export function EventLog() {
  const events = useAppStore((state) => state.events);
  return (
    <Paper square sx={{ height: '100%', overflow: 'auto', p: 1.5 }}>
      <Typography variant="overline">Events</Typography>
      <Stack spacing={0.5}>
        {events.slice(0, 30).map((event) => (
          <Box key={event.id} sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
            <Typography variant="caption" color="text.secondary">{new Date(event.timestamp).toLocaleTimeString()}</Typography>
            <Chip size="small" label={event.level} color={event.level === 'ERROR' ? 'error' : event.level === 'WARN' ? 'warning' : 'default'} />
            <Typography variant="body2">{event.message}</Typography>
          </Box>
        ))}
      </Stack>
    </Paper>
  );
}
