import CancelIcon from '@mui/icons-material/Cancel';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import SendIcon from '@mui/icons-material/Send';
import { Alert, Box, Button, ButtonGroup, Divider, LinearProgress, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';
import { useEffect, useMemo, useState } from 'react';
import type { DroneTask, GeoPoint, TaskGeometry, TaskGeometryType, TaskType } from '../models/types';
import type { MessageTransport } from '../messaging/transport';
import { createUuid } from '../services/uuid';
import { useAppStore } from '../state/useAppStore';

interface Props { transport?: MessageTransport; }

const TASK_TYPES: TaskType[] = ['REPOSITION', 'LOITER', 'NAVIGATE', 'PATROL'];

const TASK_GEOMETRIES: Record<TaskType, TaskGeometryType[]> = {
  REPOSITION: ['POINT'],
  NAVIGATE: ['POINT'],
  LOITER: ['POINT', 'CIRCLE'],
  PATROL: ['CIRCLE', 'RECTANGLE', 'POLYGON', 'CORRIDOR'],
};

const TASK_TYPES: TaskType[] = ['REPOSITION', 'LOITER'];

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

  const supportedTaskTypes = useMemo(() => {
    if (!selectedDrone) return [];
    const advertised = new Set(selectedDrone.capabilities.map((capability) => normaliseTaskType(capability.taskType)));
    return TASK_TYPES.filter((type) => advertised.has(type));
  }, [selectedDrone]);

  useEffect(() => {
    if (taskType && !supportedTaskTypes.includes(taskType)) {
      selectTaskType(undefined);
      clearDraftPoints();
      setGeometryType('POINT');
    }
  }, [clearDraftPoints, selectTaskType, supportedTaskTypes, taskType]);

  const capability = selectedDrone?.capabilities.find((candidate) => normaliseTaskType(candidate.taskType) === taskType);
  const authorityGuid = capability?.authorities[0];
  const taskGridColumns = getTaskGridColumnCount(TASK_TYPES.length);
  const allowedGeometries = taskType ? TASK_GEOMETRIES[taskType] : [];
  const effectiveGeometryType = taskType && allowedGeometries.includes(geometryType)
    ? geometryType
    : allowedGeometries[0];
  const geometryError = effectiveGeometryType
    ? validateDraftGeometry(effectiveGeometryType, draftPoints.length, radius, corridorWidth)
    : 'Choose a supported task type.';
  const canSubmit = Boolean(selectedDrone && taskType && authorityGuid && transport && effectiveGeometryType && !geometryError);

  function chooseTask(type: TaskType): void {
    const defaultGeometry = TASK_GEOMETRIES[type][0];
    selectTaskType(type);
    setGeometryType(defaultGeometry);
    clearDraftPoints();
  }

  async function submit(): Promise<void> {
    if (!selectedDrone || !taskType || !authorityGuid || !transport || !effectiveGeometryType || geometryError) return;

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
      {selectedDrone && supportedTaskTypes.length === 0 && (
        <Alert severity="info" sx={{ mt: 1 }}>This drone does not advertise any supported task capabilities.</Alert>
      )}

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
        {taskType && effectiveGeometryType ? geometryInstruction(effectiveGeometryType) : 'Choose an advertised task type.'}
      </Typography>

      <Stack spacing={2}>
        {taskType && allowedGeometries.length > 1 && effectiveGeometryType && (
          <TextField
            select
            label="Geometry"
            value={effectiveGeometryType}
            onChange={(event) => {
              setGeometryType(event.target.value as TaskGeometryType);
              clearDraftPoints();
            }}
          >
            {allowedGeometries.map((type) => <MenuItem key={type} value={type}>{geometryLabel(type)}</MenuItem>)}
          </TextField>
        )}

        {taskType && <TextField label="Altitude (m)" type="number" value={altitude} onChange={(event) => setAltitude(Number(event.target.value))} />}
        {effectiveGeometryType === 'CIRCLE' && <TextField label="Radius (m)" type="number" value={radius} onChange={(event) => setRadius(Number(event.target.value))} inputProps={{ min: 1 }} />}
        {effectiveGeometryType === 'CORRIDOR' && <TextField label="Corridor width (m)" type="number" value={corridorWidth} onChange={(event) => setCorridorWidth(Number(event.target.value))} inputProps={{ min: 1 }} />}

        {taskType && <Typography variant="body2">Selected map points: {draftPoints.length}</Typography>}
        {taskType && draftPoints.map((point, index) => (
          <Typography key={`${point.latitude}-${point.longitude}-${index}`} variant="caption" color="text.secondary">
            {index + 1}. {point.latitude.toFixed(6)}, {point.longitude.toFixed(6)}
          </Typography>
        ))}

        {taskType && !authorityGuid && selectedDrone && <Alert severity="warning">The node description does not advertise an authority GUID for {taskType}.</Alert>}
        {taskType && geometryError && draftPoints.length > 0 && <Alert severity="info">{geometryError}</Alert>}

        {taskType && (
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button fullWidth startIcon={<DeleteSweepIcon />} onClick={clearDraftPoints}>Clear</Button>
            <Button fullWidth variant="contained" startIcon={<SendIcon />} disabled={!canSubmit} onClick={submit}>Submit</Button>
          </Box>
        )}
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

function getTaskGridColumnCount(taskCount: number): number {
  if (taskCount <= 0) return 1;
  if (taskCount <= 3) return taskCount;
  if (taskCount === 4) return 2;
  return 3;
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

function geometryLabel(type: TaskGeometryType): string {
  if (type === 'CIRCLE') return 'Circle';
  return type.charAt(0) + type.slice(1).toLowerCase();
}

function taskSeverity(state: DroneTask['state']): 'success' | 'info' | 'warning' | 'error' {
  if (state === 'COMPLETED') return 'success';
  if (state === 'FAILED' || state === 'REJECTED') return 'error';
  if (state === 'CANCEL_REQUESTED' || state === 'CANCELLED') return 'warning';
  return 'info';
}
