import CancelIcon from '@mui/icons-material/Cancel';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import SendIcon from '@mui/icons-material/Send';
import { Alert, Box, Button, Divider, LinearProgress, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';
import { useMemo, useState } from 'react';
import type { DroneTask, TaskGeometryType, TaskType } from '../models/types';
import type { MessageTransport } from '../messaging/transport';
import { createUuid } from '../services/uuid';
import { useAppStore } from '../state/useAppStore';

interface Props {
  transport?: MessageTransport;
}

const TASK_TYPES: TaskType[] = ['REPOSITION', 'LOITER'];

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
  const [geometryType, setGeometryType] = useState<TaskGeometryType>('POINT');
  const [altitude, setAltitude] = useState(100);
  const [radius, setRadius] = useState(50);

  const activeTask = useMemo(() => Object.values(tasks)
    .filter((task) => task.droneId === selectedDroneId)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0], [tasks, selectedDroneId]);

  const supportedTaskTypes = selectedDrone?.capabilities.map((capability) => capability.taskType) ?? [];
  const capability = selectedDrone?.capabilities.find((candidate) => candidate.taskType === taskType);
  const authorityGuid = capability?.authorities[0];
  const canSubmit = Boolean(selectedDrone && taskType && draftPoints.length >= 1 && authorityGuid && transport);
  const taskGridColumns = getTaskGridColumnCount(TASK_TYPES.length);

  function chooseTask(type: TaskType): void {
    selectTaskType(type);
    setGeometryType('POINT');
  }

  async function submit(): Promise<void> {
    if (!selectedDrone || !taskType || !authorityGuid || !transport || draftPoints.length === 0) return;

    const point = { ...draftPoints[0], altitude };
    const task: DroneTask = {
      id: createUuid(),
      droneId: selectedDrone.id,
      authorityGuid,
      type: taskType,
      geometryType: taskType === 'REPOSITION' ? 'POINT' : geometryType,
      point,
      radiusMeters: taskType === 'LOITER' && geometryType === 'CIRCLE' ? radius : undefined,
      state: 'SUBMITTED',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    upsertTask(task);
    clearDraftPoints();

    try {
      await transport.publishTask(task);
      addEvent({ level: 'INFO', message: `Submitted ${task.type} task ${task.id}`, payload: task });
    } catch (error) {
      upsertTask({ ...task, state: 'FAILED', updatedAt: Date.now(), message: String(error) });
      addEvent({ level: 'ERROR', message: `Task submission failed: ${String(error)}` });
    }
  }

  async function cancel(): Promise<void> {
    if (!activeTask || !transport) return;
    const cancellingTask = { ...activeTask, state: 'CANCEL_REQUESTED' as const, updatedAt: Date.now() };
    upsertTask(cancellingTask);

    try {
      await transport.cancelTask(cancellingTask);
      addEvent({ level: 'INFO', message: `Cancellation submitted for task ${activeTask.id}` });
    } catch (error) {
      upsertTask({ ...activeTask, updatedAt: Date.now(), message: String(error) });
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
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: `repeat(${taskGridColumns}, minmax(0, 1fr))`,
          gap: 1,
          mb: 2,
        }}
      >
        {TASK_TYPES.map((type) => (
          <Button
            key={type}
            fullWidth
            variant={taskType === type ? 'contained' : 'outlined'}
            disabled={Boolean(selectedDrone) && !supportedTaskTypes.includes(type)}
            onClick={() => chooseTask(type)}
            sx={{ minWidth: 0 }}
          >
            {type}
          </Button>
        ))}
      </Box>

      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {taskType ? 'Click the destination or loiter centre on the map.' : 'Choose a task type.'}
      </Typography>

      <Stack spacing={2}>
        {taskType === 'LOITER' && (
          <TextField select label="Loiter geometry" value={geometryType} onChange={(event) => setGeometryType(event.target.value as TaskGeometryType)}>
            <MenuItem value="POINT">Point</MenuItem>
            <MenuItem value="CIRCLE">Orbit / circle</MenuItem>
          </TextField>
        )}

        <TextField label="Altitude (m)" type="number" value={altitude} onChange={(event) => setAltitude(Number(event.target.value))} />

        {taskType === 'LOITER' && geometryType === 'CIRCLE' && (
          <TextField label="Orbit radius (m)" type="number" value={radius} onChange={(event) => setRadius(Number(event.target.value))} inputProps={{ min: 1 }} />
        )}

        <Typography variant="body2">Selected map point: {draftPoints.length > 0 ? `${draftPoints[0].latitude.toFixed(6)}, ${draftPoints[0].longitude.toFixed(6)}` : 'None'}</Typography>

        {taskType && !authorityGuid && selectedDrone && (
          <Alert severity="warning">The node description does not advertise an authority GUID for {taskType}.</Alert>
        )}

        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button fullWidth startIcon={<DeleteSweepIcon />} onClick={clearDraftPoints}>Clear</Button>
          <Button fullWidth variant="contained" startIcon={<SendIcon />} disabled={!canSubmit} onClick={submit}>Submit</Button>
        </Box>
      </Stack>

      <Divider sx={{ my: 2 }} />
      <Typography variant="overline">Latest task</Typography>
      {activeTask ? (
        <Stack spacing={1}>
          <Typography variant="subtitle2">{activeTask.type} · {activeTask.geometryType}</Typography>
          <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{activeTask.id}</Typography>
          <Alert severity={taskSeverity(activeTask.state)}>{activeTask.state}{activeTask.message ? ` · ${activeTask.message}` : ''}</Alert>
          {activeTask.percentComplete !== undefined && (
            <Stack spacing={0.5}>
              <LinearProgress variant="determinate" value={Math.max(0, Math.min(100, activeTask.percentComplete))} />
              <Typography variant="caption" color="text.secondary">{activeTask.percentComplete.toFixed(1)}% complete</Typography>
            </Stack>
          )}
          <Button color="error" variant="outlined" startIcon={<CancelIcon />} disabled={!['SUBMITTED', 'ACCEPTED', 'EXECUTING'].includes(activeTask.state)} onClick={cancel}>Cancel task</Button>
        </Stack>
      ) : (
        <Typography variant="body2" color="text.secondary">No task for this drone.</Typography>
      )}
    </Paper>
  );
}

function getTaskGridColumnCount(taskCount: number): number {
  if (taskCount <= 0) return 1;
  if (taskCount <= 3) return taskCount;
  if (taskCount === 4) return 2;
  return 3;
}

function taskSeverity(state: DroneTask['state']): 'success' | 'info' | 'warning' | 'error' {
  if (state === 'COMPLETED') return 'success';
  if (state === 'FAILED' || state === 'REJECTED') return 'error';
  if (state === 'CANCEL_REQUESTED' || state === 'CANCELLED') return 'warning';
  return 'info';
}
