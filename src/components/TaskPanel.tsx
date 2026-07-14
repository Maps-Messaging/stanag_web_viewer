import CancelIcon from '@mui/icons-material/Cancel';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import SendIcon from '@mui/icons-material/Send';
import { Alert, Box, Button, ButtonGroup, Divider, FormControlLabel, Paper, Stack, Switch, TextField, Typography } from '@mui/material';
import { useMemo, useState } from 'react';
import type { DroneTask, TaskType } from '../models/types';
import type { MessageTransport } from '../messaging/transport';
import { useAppStore } from '../state/useAppStore';

interface Props {
  transport?: MessageTransport;
}

export function TaskPanel({ transport }: Props) {
  const selectedDroneId = useAppStore((state) => state.selectedDroneId);
  const selectedDrone = useAppStore((state) => selectedDroneId ? state.drones[selectedDroneId] : undefined);
  const taskType = useAppStore((state) => state.taskType);
  const draftPoints = useAppStore((state) => state.draftPoints);
  const tasks = useAppStore((state) => state.tasks);
  const selectTaskType = useAppStore((state) => state.selectTaskType);
  const clearDraftPoints = useAppStore((state) => state.clearDraftPoints);
  const upsertTask = useAppStore((state) => state.upsertTask);
  const addEvent = useAppStore((state) => state.addEvent);
  const [altitude, setAltitude] = useState(100);
  const [speed, setSpeed] = useState(8);
  const [radius, setRadius] = useState(50);
  const [clockwise, setClockwise] = useState(true);

  const activeTask = useMemo(() => Object.values(tasks)
    .filter((task) => task.droneId === selectedDroneId)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0], [tasks, selectedDroneId]);

  const requiredPoints = taskType === 'NAVIGATE' ? 2 : 1;
  const canSubmit = Boolean(selectedDrone && taskType && draftPoints.length >= requiredPoints && transport);

  async function submit(): Promise<void> {
    if (!selectedDrone || !taskType || !transport) return;
    const task: DroneTask = {
      id: crypto.randomUUID(),
      droneId: selectedDrone.id,
      type: taskType,
      points: taskType === 'NAVIGATE' ? draftPoints : draftPoints.slice(0, 1),
      parameters: { altitude, speed, radius: taskType === 'LOITER' ? radius : undefined, clockwise: taskType === 'LOITER' ? clockwise : undefined },
      state: 'SUBMITTED',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    upsertTask(task);
    clearDraftPoints();
    try {
      await transport.publishTask(task);
    } catch (error) {
      upsertTask({ ...task, state: 'FAILED', updatedAt: Date.now(), message: String(error) });
      addEvent({ level: 'ERROR', message: `Task submission failed: ${String(error)}` });
    }
  }

  async function cancel(): Promise<void> {
    if (!activeTask || !transport) return;
    try {
      await transport.cancelTask(activeTask);
    } catch (error) {
      addEvent({ level: 'ERROR', message: `Task cancellation failed: ${String(error)}` });
    }
  }

  return (
    <Paper square sx={{ height: '100%', overflow: 'auto', p: 2 }}>
      <Typography variant="overline">Selected drone</Typography>
      <Typography variant="h6">{selectedDrone?.name ?? 'None'}</Typography>
      {!selectedDrone && <Alert severity="info" sx={{ mt: 1 }}>Select a drone before creating a task.</Alert>}
      <Divider sx={{ my: 2 }} />
      <Typography variant="overline">Task</Typography>
      <ButtonGroup fullWidth sx={{ mb: 2 }}>
        {(['REPOSITION', 'NAVIGATE', 'LOITER'] as TaskType[]).map((type) => (
          <Button key={type} variant={taskType === type ? 'contained' : 'outlined'} onClick={() => selectTaskType(type)}>{type}</Button>
        ))}
      </ButtonGroup>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {taskType === 'NAVIGATE' ? 'Click two or more map points.' : taskType ? 'Click one point on the map.' : 'Choose a task type.'}
      </Typography>
      <Stack spacing={2}>
        <TextField label="Altitude (m)" type="number" value={altitude} onChange={(event) => setAltitude(Number(event.target.value))} />
        <TextField label="Speed (m/s)" type="number" value={speed} onChange={(event) => setSpeed(Number(event.target.value))} />
        {taskType === 'LOITER' && (
          <>
            <TextField label="Radius (m)" type="number" value={radius} onChange={(event) => setRadius(Number(event.target.value))} />
            <FormControlLabel control={<Switch checked={clockwise} onChange={(event) => setClockwise(event.target.checked)} />} label="Clockwise" />
          </>
        )}
        <Typography variant="body2">Geometry points: {draftPoints.length}</Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button fullWidth startIcon={<DeleteSweepIcon />} onClick={clearDraftPoints}>Clear</Button>
          <Button fullWidth variant="contained" startIcon={<SendIcon />} disabled={!canSubmit} onClick={submit}>Submit</Button>
        </Box>
      </Stack>
      <Divider sx={{ my: 2 }} />
      <Typography variant="overline">Latest task</Typography>
      {activeTask ? (
        <Stack spacing={1}>
          <Typography variant="subtitle2">{activeTask.type}</Typography>
          <Typography variant="body2">{activeTask.id}</Typography>
          <Alert severity={taskSeverity(activeTask.state)}>{activeTask.state}{activeTask.message ? ` · ${activeTask.message}` : ''}</Alert>
          <Button color="error" variant="outlined" startIcon={<CancelIcon />} disabled={!['SUBMITTED', 'ACCEPTED', 'EXECUTING'].includes(activeTask.state)} onClick={cancel}>Cancel task</Button>
        </Stack>
      ) : (
        <Typography variant="body2" color="text.secondary">No task for this drone.</Typography>
      )}
    </Paper>
  );
}

function taskSeverity(state: DroneTask['state']): 'success' | 'info' | 'warning' | 'error' {
  if (state === 'COMPLETED') return 'success';
  if (state === 'FAILED' || state === 'REJECTED') return 'error';
  if (state === 'CANCEL_REQUESTED' || state === 'CANCELLED') return 'warning';
  return 'info';
}
