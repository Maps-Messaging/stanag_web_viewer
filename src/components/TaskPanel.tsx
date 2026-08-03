import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import SendIcon from '@mui/icons-material/Send';
import UndoIcon from '@mui/icons-material/Undo';
import {
  Alert,
  Box,
  Button,
  Divider,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { MessageTransport } from '../messaging/transport';
import type { DroneTask, GeoPoint, TaskDuration, TaskGeometry, TaskGeometryType, TaskType } from '../models/types';
import { supportsDuration, validateTaskDuration } from '../services/taskDuration';
import { createUuid } from '../services/uuid';
import { useAppStore } from '../state/useAppStore';

interface Props {
  onClose: () => void;
  transport?: MessageTransport;
}

const TASK_TYPES: TaskType[] = ['REPOSITION', 'NAVIGATE', 'PATROL', 'LOITER', 'STANDBY', 'DETECT', 'SURVEY', 'SCREEN'];
const VOLUME_TASK_GEOMETRIES: TaskGeometryType[] = ['CIRCLE', 'RECTANGLE', 'POLYGON', 'CORRIDOR'];
const TASK_GEOMETRIES: Record<TaskType, TaskGeometryType[]> = {
  REPOSITION: ['POINT'],
  NAVIGATE: ['POINT', 'LINE'],
  PATROL: ['LINE', 'CIRCLE', 'RECTANGLE', 'POLYGON', 'CORRIDOR'],
  LOITER: ['POINT', 'CIRCLE'],
  STANDBY: VOLUME_TASK_GEOMETRIES,
  DETECT: VOLUME_TASK_GEOMETRIES,
  SURVEY: VOLUME_TASK_GEOMETRIES,
  SCREEN: VOLUME_TASK_GEOMETRIES,
};

export function TaskPanel({ onClose, transport }: Props) {
  const selectedDroneId = useAppStore((state) => state.selectedDroneId);
  const selectedDrone = useAppStore(useShallow((state) => {
    const drone = selectedDroneId ? state.drones[selectedDroneId] : undefined;
    return drone ? { id: drone.id, name: drone.name, capabilities: drone.capabilities } : undefined;
  }));
  const taskType = useAppStore((state) => state.taskType);
  const draftPoints = useAppStore((state) => state.draftPoints);
  const selectTaskType = useAppStore((state) => state.selectTaskType);
  const clearDraftPoints = useAppStore((state) => state.clearDraftPoints);
  const undoDraftPoint = useAppStore((state) => state.undoDraftPoint);
  const addEvent = useAppStore((state) => state.addEvent);
  const [geometryType, setGeometryType] = useState<TaskGeometryType>('POINT');
  const [altitude, setAltitude] = useState(100);
  const [radius, setRadius] = useState(50);
  const [corridorWidth, setCorridorWidth] = useState(100);
  const [durationHours, setDurationHours] = useState('0');
  const [durationMinutes, setDurationMinutes] = useState('0');
  const [durationSeconds, setDurationSeconds] = useState('0');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setDurationHours('0');
    setDurationMinutes('0');
    setDurationSeconds('0');
  }, [selectedDroneId]);

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
  const allowedGeometries = taskType ? TASK_GEOMETRIES[taskType] : [];
  const effectiveGeometryType = taskType && allowedGeometries.includes(geometryType) ? geometryType : allowedGeometries[0];
  const geometryError = effectiveGeometryType
    ? validateDraftGeometry(effectiveGeometryType, draftPoints.length, radius, corridorWidth)
    : 'Choose a supported task type.';
  const durationFieldErrors = durationErrors(durationHours, durationMinutes, durationSeconds);
  const durationError = Object.values(durationFieldErrors).find(Boolean);
  const canSubmit = Boolean(
    selectedDrone && taskType && authorityGuid && transport && effectiveGeometryType && !geometryError && !submitting
      && (!supportsDuration(taskType) || !durationError),
  );

  function chooseTask(type: TaskType): void {
    selectTaskType(type);
    setGeometryType(TASK_GEOMETRIES[type][0]);
    clearDraftPoints();
  }

  function close(): void {
    clearDraftPoints();
    selectTaskType(undefined);
    onClose();
  }

  async function submit(): Promise<void> {
    if (!selectedDrone || !taskType || !authorityGuid || !transport || !effectiveGeometryType || geometryError) return;
    if (supportsDuration(taskType) && durationError) return;

    const geometry = buildGeometry(effectiveGeometryType, draftPoints, altitude, radius, corridorWidth);
    const summary = geometrySummary(geometry);
    const duration = supportsDuration(taskType) ? parseTaskDuration(durationHours, durationMinutes, durationSeconds) : undefined;
    const task: DroneTask = {
      id: createUuid(),
      droneId: selectedDrone.id,
      authorityGuid,
      type: taskType,
      geometry,
      geometryType: geometry.type,
      point: summary.point,
      radiusMeters: summary.radiusMeters,
      ...(duration && totalDurationSeconds(duration) > 0 ? { duration } : {}),
      state: 'SUBMITTED',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    setSubmitting(true);
    try {
      await transport.publishTask(task);
      addEvent({ level: 'INFO', message: `Published ${task.type} task ${task.id}; awaiting TASK_ADMIN`, payload: task });
      close();
    } catch (error) {
      addEvent({ level: 'ERROR', message: `Task submission failed: ${String(error)}`, payload: task });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Paper square sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Box sx={{ px: 1.5, py: 1.25, display: 'flex', alignItems: 'center', gap: 1 }}>
        <Tooltip title="Back to vehicles">
          <IconButton size="small" onClick={close} aria-label="Back to vehicles">
            <ArrowBackIcon />
          </IconButton>
        </Tooltip>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="overline">Create task</Typography>
          <Typography variant="subtitle1" noWrap>{selectedDrone?.name ?? 'No vehicle selected'}</Typography>
        </Box>
      </Box>

      <Divider />

      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', p: 1.5 }}>
        {!selectedDrone && <Alert severity="info">Select a vehicle before creating a task.</Alert>}
        {selectedDrone && supportedTaskTypes.length === 0 && <Alert severity="info">This vehicle does not advertise any supported task capabilities.</Alert>}

        {supportedTaskTypes.length > 0 && (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 0.75, mb: 1.5 }}>
            {supportedTaskTypes.map((type) => (
              <Button
                key={type}
                size="small"
                fullWidth
                variant={taskType === type ? 'contained' : 'outlined'}
                onClick={() => chooseTask(type)}
                sx={{ minWidth: 0, px: 0.5 }}
              >
                {type}
              </Button>
            ))}
          </Box>
        )}

        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {taskType && effectiveGeometryType ? geometryInstruction(effectiveGeometryType) : 'Choose an advertised task type, then select points on the map.'}
        </Typography>

        <Stack spacing={1.5}>
          {taskType && allowedGeometries.length > 1 && effectiveGeometryType && (
            <TextField
              size="small"
              select
              fullWidth
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

          {taskType && <TextField size="small" fullWidth label="Altitude (m)" type="number" value={altitude} onChange={(event) => setAltitude(Number(event.target.value))} />}
          {effectiveGeometryType === 'CIRCLE' && <TextField size="small" fullWidth label="Radius (m)" type="number" value={radius} onChange={(event) => setRadius(Number(event.target.value))} inputProps={{ min: 1 }} />}
          {effectiveGeometryType === 'CORRIDOR' && <TextField size="small" fullWidth label="Corridor width (m)" type="number" value={corridorWidth} onChange={(event) => setCorridorWidth(Number(event.target.value))} inputProps={{ min: 1 }} />}

          {supportsDuration(taskType) && (
            <Box>
              <Typography variant="overline">Optional duration</Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 0.75 }}>
                <DurationField label="Hours" value={durationHours} error={durationFieldErrors.hours} onChange={setDurationHours} />
                <DurationField label="Minutes" value={durationMinutes} error={durationFieldErrors.minutes} onChange={setDurationMinutes} max={59} />
                <DurationField label="Seconds" value={durationSeconds} error={durationFieldErrors.seconds} onChange={setDurationSeconds} max={59} />
              </Box>
              <Typography variant="caption" color="text.secondary">Leave all values at zero to omit duration.</Typography>
            </Box>
          )}

          {taskType && (
            <Box>
              <Typography variant="body2">Selected map points: {draftPoints.length}</Typography>
              {draftPoints.length > 0 && (
                <Typography variant="caption" color="text.secondary">
                  Use Undo to remove the last point or Clear to restart the geometry.
                </Typography>
              )}
            </Box>
          )}

          {taskType && !authorityGuid && selectedDrone && <Alert severity="warning">No authority GUID is advertised for {taskType}.</Alert>}
          {taskType && geometryError && draftPoints.length > 0 && <Alert severity="info">{geometryError}</Alert>}
        </Stack>
      </Box>

      <Divider />
      <Box sx={{ p: 1.25, display: 'grid', gridTemplateColumns: 'auto auto minmax(0, 1fr)', gap: 0.75 }}>
        <Button size="small" startIcon={<UndoIcon />} onClick={undoDraftPoint} disabled={draftPoints.length === 0}>Undo</Button>
        <Button size="small" startIcon={<DeleteSweepIcon />} onClick={clearDraftPoints} disabled={draftPoints.length === 0}>Clear</Button>
        <Button size="small" fullWidth variant="contained" startIcon={<SendIcon />} disabled={!canSubmit} onClick={() => void submit()}>
          {submitting ? 'Publishing…' : 'Submit'}
        </Button>
      </Box>
    </Paper>
  );
}

interface DurationFieldProps {
  label: string;
  value: string;
  error?: string;
  max?: number;
  onChange: (value: string) => void;
}

function DurationField({ label, value, error, max, onChange }: DurationFieldProps) {
  return (
    <TextField
      size="small"
      label={label}
      type="number"
      value={value}
      error={Boolean(error)}
      helperText={error}
      onChange={(event) => onChange(event.target.value)}
      inputProps={{ min: 0, max, step: 1, inputMode: 'numeric' }}
    />
  );
}

function durationErrors(hours: string, minutes: string, seconds: string): Partial<Record<keyof TaskDuration, string>> {
  const values = { hours, minutes, seconds };
  const errors: Partial<Record<keyof TaskDuration, string>> = {};
  (Object.keys(values) as Array<keyof TaskDuration>).forEach((field) => {
    const raw = values[field].trim();
    if (!/^\d+$/.test(raw)) {
      errors[field] = `${capitalise(field)} must be a non-negative whole number.`;
      return;
    }
    const value = Number(raw);
    if ((field === 'minutes' || field === 'seconds') && value > 59) errors[field] = `${capitalise(field)} must be between 0 and 59.`;
  });
  if (Object.keys(errors).length === 0) {
    const validationError = validateTaskDuration(parseTaskDuration(hours, minutes, seconds));
    if (validationError) errors.hours = validationError;
  }
  return errors;
}

function parseTaskDuration(hours: string, minutes: string, seconds: string): TaskDuration {
  return { hours: Number(hours), minutes: Number(minutes), seconds: Number(seconds) };
}

function totalDurationSeconds(duration: TaskDuration): number {
  return duration.hours * 3600 + duration.minutes * 60 + duration.seconds;
}

function capitalise(value: string): string { return value.charAt(0).toUpperCase() + value.slice(1); }
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
  return type === 'CIRCLE' ? 'Circle' : type.charAt(0) + type.slice(1).toLowerCase();
}
