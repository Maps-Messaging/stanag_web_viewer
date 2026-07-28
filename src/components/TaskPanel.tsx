import CancelIcon from '@mui/icons-material/Cancel';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import SendIcon from '@mui/icons-material/Send';
import { Alert, Box, Button, ButtonGroup, Divider, LinearProgress, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';
import { useMemo, useState } from 'react';
import type { DroneTask, GeoPoint, TaskGeometry, TaskGeometryType, TaskType } from '../models/types';
import type { MessageTransport } from '../messaging/transport';
import { createUuid } from '../services/uuid';
import { useAppStore } from '../state/useAppStore';

interface Props { transport?: MessageTransport; }

const TASK_TYPES: TaskType[] = ['REPOSITION', 'LOITER', 'NAVIGATE'];
const GEOMETRIES: TaskGeometryType[] = ['POINT', 'CIRCLE', 'LINE', 'RECTANGLE', 'POLYGON', 'CORRIDOR'];

export function TaskPanel({ transport }: Props) {
  const selectedDroneId = useAppStore((state) => state.selectedDroneId);
  const selectedDrone = useAppStore((state) => selectedDroneId ? state.drones[selectedDroneId] : undefined);
  const taskType = useAppStore((state) => state.taskType);
  const draftPoints = useAppStore((state) => state.draftPoints);
  const tasks = useAppStore((state) => state.tasks);
  const selectTaskType = useAppStore((state) => state.selectTaskType);
  const clearDraftPoints = useAppStore((state) => state.clearDraftPoints);
  const addEvent = useAppStore((state) => state.addEvent);
  const [geometryType, setGeometryType] = useState<TaskGeometryType>('POINT');
  const [altitude, setAltitude] = useState(100);
  const [radius, setRadius] = useState(50);
  const [corridorWidth, setCorridorWidth] = useState(100);

  const latestTask = useMemo(() => Object.values(tasks)
    .filter((task) => task.droneId === selectedDroneId)
    .sort((left, right) => right.updatedAt - left.updatedAt)[0], [tasks, selectedDroneId]);

  const supportedTaskTypes = selectedDrone?.capabilities.map((capability) => normaliseTaskType(capability.taskType)) ?? [];
  const capability = selectedDrone?.capabilities.find((candidate) => normaliseTaskType(candidate.taskType) === taskType);
  const authorityGuid = capability?.authorities[0];
  const effectiveGeometryType = taskType === 'REPOSITION' ? 'POINT' : geometryType;
  const geometryError = validateDraftGeometry(effectiveGeometryType, draftPoints.length, radius, corridorWidth);
  const canSubmit = Boolean(selectedDrone && taskType && authorityGuid && transport && !geometryError);

  function chooseTask(type: TaskType): void {
    selectTaskType(type);
    setGeometryType('POINT');
  }

  async function submit(): Promise<void> {
    if (!selectedDrone || !taskType || !authorityGuid || !transport || geometryError) return;

    const geometry = buildGeometry(effectiveGeometryType, draftPoints, altitude, radius, corridorWidth);
    const summary = geometrySummary(geometry);
    const task: DroneTask = {
      id: createUuid(),
      droneId: selectedDrone.id,
      authorityGuid,
      type: taskType,
      geometry,
      geometryType: geometry.type,
      point: summary.point,
      radiusMeters: summary.radiusMeters,
      state: 'SUBMITTED',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    try {
      await transport.publishTask(task);
      clearDraftPoints();
      addEvent({ level: 'INFO', message: `Published ${task.type} task ${task.id}; awaiting TASK_ADMIN`, payload: task });
    } catch (error) {
      addEvent({ level: 'ERROR', message: `Task submission failed: ${String(error)}`, payload: task });
    }
  }

  async function cancel(): Promise<void> {
    if (!latestTask || !transport) return;
    try {
      await transport.cancelTask(latestTask);
      addEvent({ level: 'INFO', message: `Published cancellation for task ${latestTask.id}; awaiting TASK_ADMIN` });
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
        {TASK_TYPES.map((type) => (
          <Button key={type} variant={taskType === type ? 'contained' : 'outlined'} disabled={Boolean(selectedDrone) && !supportedTaskTypes.includes(type)} onClick={() => chooseTask(type)}>
            {type}
          </Button>
        ))}
      </ButtonGroup>

      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {taskType ? geometryInstruction(effectiveGeometryType) : 'Choose a task type.'}
      </Typography>

      <Stack spacing={2}>
        {taskType && taskType !== 'REPOSITION' && (
          <TextField select label="Geometry" value={geometryType} onChange={(event) => { setGeometryType(event.target.value as TaskGeometryType); clearDraftPoints(); }}>
            {GEOMETRIES.map((type) => <MenuItem key={type} value={type}>{geometryLabel(type)}</MenuItem>)}
          </TextField>
        )}

        <TextField label="Altitude (m)" type="number" value={altitude} onChange={(event) => setAltitude(Number(event.target.value))} />
        {effectiveGeometryType === 'CIRCLE' && <TextField label="Radius (m)" type="number" value={radius} onChange={(event) => setRadius(Number(event.target.value))} inputProps={{ min: 1 }} />}
        {effectiveGeometryType === 'CORRIDOR' && <TextField label="Corridor width (m)" type="number" value={corridorWidth} onChange={(event) => setCorridorWidth(Number(event.target.value))} inputProps={{ min: 1 }} />}

        <Typography variant="body2">Selected map points: {draftPoints.length}</Typography>
        {draftPoints.map((point, index) => (
          <Typography key={`${point.latitude}-${point.longitude}-${index}`} variant="caption" color="text.secondary">
            {index + 1}. {point.latitude.toFixed(6)}, {point.longitude.toFixed(6)}
          </Typography>
        ))}

        {taskType && !authorityGuid && selectedDrone && <Alert severity="warning">The node description does not advertise an authority GUID for {taskType}.</Alert>}
        {taskType && geometryError && draftPoints.length > 0 && <Alert severity="info">{geometryError}</Alert>}

        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button fullWidth startIcon={<DeleteSweepIcon />} onClick={clearDraftPoints}>Clear</Button>
          <Button fullWidth variant="contained" startIcon={<SendIcon />} disabled={!canSubmit} onClick={submit}>Submit</Button>
        </Box>
      </Stack>

      <Divider sx={{ my: 2 }} />
      <Typography variant="overline">Latest task</Typography>
      {latestTask ? (
        <Stack spacing={1}>
          <Typography variant="subtitle2">{latestTask.type} · {latestTask.geometry.type}</Typography>
          <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{latestTask.id}</Typography>
          <Alert severity={taskSeverity(latestTask.state)}>{latestTask.state}{latestTask.message ? ` · ${latestTask.message}` : ''}</Alert>
          {latestTask.percentComplete !== undefined && (
            <Stack spacing={0.5}>
              <LinearProgress variant="determinate" value={Math.max(0, Math.min(100, latestTask.percentComplete))} />
              <Typography variant="caption" color="text.secondary">{latestTask.percentComplete.toFixed(1)}% complete</Typography>
            </Stack>
          )}
          <Button color="error" variant="outlined" startIcon={<CancelIcon />} disabled={!['SUBMITTED', 'ACCEPTED', 'EXECUTING'].includes(latestTask.state)} onClick={cancel}>Cancel task</Button>
        </Stack>
      ) : <Typography variant="body2" color="text.secondary">No task for this drone.</Typography>}
    </Paper>
  );
}

function normaliseTaskType(value: string): string { return value.replace('TaskTypeEnum_', ''); }

function buildGeometry(type: TaskGeometryType, points: GeoPoint[], altitude: number, radius: number, corridorWidth: number): TaskGeometry {
  const elevated = points.map((point) => ({ ...point, altitude }));
  switch (type) {
    case 'POINT': return { type, point: elevated[0] };
    case 'CIRCLE': return { type, centre: elevated[0], radiusMeters: radius };
    case 'LINE': return { type, points: elevated };
    case 'RECTANGLE': return { type, points: elevated };
    case 'POLYGON': return { type, points: elevated };
    case 'CORRIDOR': return { type, centreLine: elevated, widthMeters: corridorWidth };
  }
}

function geometrySummary(geometry: TaskGeometry): { point: GeoPoint; radiusMeters?: number } {
  switch (geometry.type) {
    case 'POINT': return { point: geometry.point };
    case 'CIRCLE': return { point: geometry.centre, radiusMeters: geometry.radiusMeters };
    case 'LINE':
    case 'RECTANGLE':
    case 'POLYGON': return { point: geometry.points[0] };
    case 'CORRIDOR': return { point: geometry.centreLine[0] };
  }
}

function validateDraftGeometry(type: TaskGeometryType, pointCount: number, radius: number, corridorWidth: number): string | undefined {
  if ((type === 'POINT' || type === 'CIRCLE') && pointCount !== 1) return 'Select exactly one map point.';
  if ((type === 'LINE' || type === 'CORRIDOR') && pointCount < 2) return 'Select at least two map points.';
  if (type === 'RECTANGLE' && pointCount !== 4) return 'Select exactly four rectangle corners.';
  if (type === 'POLYGON' && pointCount < 3) return 'Select at least three polygon vertices.';
  if (type === 'CIRCLE' && radius <= 0) return 'Radius must be greater than zero.';
  if (type === 'CORRIDOR' && corridorWidth <= 0) return 'Corridor width must be greater than zero.';
  return undefined;
}

function geometryInstruction(type: TaskGeometryType): string {
  switch (type) {
    case 'POINT': return 'Click one destination point on the map.';
    case 'CIRCLE': return 'Click the circle centre on the map.';
    case 'LINE': return 'Click two or more ordered path points.';
    case 'RECTANGLE': return 'Click four rectangle corners in order.';
    case 'POLYGON': return 'Click three or more polygon vertices in order.';
    case 'CORRIDOR': return 'Click two or more centre-line points in order.';
  }
}

function geometryLabel(type: TaskGeometryType): string { return type === 'CIRCLE' ? 'Circle / orbit' : type.charAt(0) + type.slice(1).toLowerCase(); }

function taskSeverity(state: DroneTask['state']): 'success' | 'info' | 'warning' | 'error' {
  if (state === 'COMPLETED') return 'success';
  if (state === 'FAILED' || state === 'REJECTED') return 'error';
  if (state === 'CANCEL_REQUESTED' || state === 'CANCELLED') return 'warning';
  return 'info';
}
