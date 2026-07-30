import { Paper, Typography } from '@mui/material';
import { memo } from 'react';
import type { EventLogEntry } from '../models/types';
import { useAppStore } from '../state/useAppStore';

export function EventLog() {
  const events = useAppStore((state) => state.events);

  return (
    <Paper square sx={{ height: '100%', overflow: 'auto', p: 1.5 }}>
      <Typography variant="overline">Events</Typography>
      <div className="event-log-entries">
        {events.slice(0, 30).map((event) => (
          <EventLogRow key={event.id} event={event} />
        ))}
      </div>
    </Paper>
  );
}

const EventLogRow = memo(function EventLogRow({ event }: { event: EventLogEntry }) {
  return (
    <div className="event-log-entry">
      <time className="event-log-entry__time" dateTime={new Date(event.timestamp).toISOString()}>
        {new Date(event.timestamp).toLocaleTimeString()}
      </time>
      <span className={`event-log-entry__level event-log-entry__level--${event.level.toLowerCase()}`}>
        {event.level}
      </span>
      <span className="event-log-entry__message">{event.message}</span>
    </div>
  );
});
