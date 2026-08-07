import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ReplayIcon from '@mui/icons-material/Replay';
import {
    Alert,
    Box,
    Button,
    Chip,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Divider,
    Grid,
    Stack,
    Tab,
    Tabs,
    Typography,
} from '@mui/material';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Drone, DroneTask, TaskDuration, TwinState } from '../models/types';
import { deleteStanagTask, resendStanagTask } from '../services/stanagTaskRestClient';
import { useAppStore } from '../state/useAppStore';
import { AttitudeIndicator } from './AttitudeIndicator';

interface DroneDetailsDialogProps {
    drone?: Drone;
    open: boolean;
    onClose: () => void;
}

export function DroneDetailsDialog({
                                       drone,
                                       open,
                                       onClose,
                                   }: DroneDetailsDialogProps) {
    const [tab, setTab] = useState(0);
    const [copyMessage, setCopyMessage] = useState<string>();
    const [taskError, setTaskError] = useState<string>();
    const [deletingTaskId, setDeletingTaskId] = useState<string>();
    const [resendingTaskId, setResendingTaskId] = useState<string>();
    const tasks = useAppStore((state) => state.tasks);
    const configuration = useAppStore((state) => state.configuration);
    const upsertTask = useAppStore((state) => state.upsertTask);
    const addEvent = useAppStore((state) => state.addEvent);

    useEffect(() => {
        if (open) {
            setTab(0);
            setCopyMessage(undefined);
            setTaskError(undefined);
            setDeletingTaskId(undefined);
            setResendingTaskId(undefined);
        }
    }, [open, drone?.id]);

    const rawJson = useMemo(
        () => JSON.stringify(drone?.twin ?? {}, null, 2),
        [drone?.twin],
    );
    const droneTasks = useMemo(
        () => Object.values(tasks)
            .filter((task) => task.droneId === drone?.id && isCurrentOrFutureTask(task))
            .sort(compareTasks),
        [drone?.id, tasks],
    );

    if (!drone) {
        return null;
    }

    const twin = drone.twin;

    async function copyRawJson(): Promise<void> {
        try {
            await copyText(rawJson);
            setCopyMessage('Twin JSON copied.');
        } catch (error) {
            setCopyMessage(`Copy failed: ${String(error)}`);
        }
    }

    async function deleteTask(task: DroneTask): Promise<void> {
        setDeletingTaskId(task.id);
        setTaskError(undefined);
        try {
            await deleteStanagTask(configuration, task.id);
            const updatedTask = { ...task, state: 'CANCEL_REQUESTED' as const, updatedAt: Date.now() };
            upsertTask(updatedTask);
            addEvent({ level: 'INFO', message: `REST cancellation requested for task ${task.id}`, payload: task });
        } catch (error) {
            const message = String(error);
            setTaskError(message);
            addEvent({ level: 'ERROR', message: `REST task cancellation failed: ${message}`, payload: task });
        } finally {
            setDeletingTaskId(undefined);
        }
    }

    async function resendTask(task: DroneTask): Promise<void> {
        setResendingTaskId(task.id);
        setTaskError(undefined);
        try {
            await resendStanagTask(configuration, task.id, drone.id);
            addEvent({ level: 'WARN', message: `REST resend requested for active task ${task.id}; the complete task plan is being resent from the beginning`, payload: task });
        } catch (error) {
            const message = String(error);
            setTaskError(message);
            addEvent({ level: 'ERROR', message: `REST task resend failed: ${message}`, payload: task });
        } finally {
            setResendingTaskId(undefined);
        }
    }

    return (
        <Dialog
            open={open}
            onClose={onClose}
            fullWidth
            maxWidth="md"
        >
            <DialogTitle>
                <Stack
                    direction="row"
                    spacing={1}
                    alignItems="center"
                    justifyContent="space-between"
                >
                    <Box>
                        <Typography variant="h6">
                            {drone.name}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                            {drone.description ?? drone.id}
                        </Typography>
                    </Box>

                    <Stack direction="row" spacing={0.75}>
                        <Chip
                            size="small"
                            label={twin?.linkState?.connected ? 'CONNECTED' : 'DISCONNECTED'}
                            color={twin?.linkState?.connected ? 'success' : 'default'}
                        />
                        <Chip
                            size="small"
                            label={twin?.armed ? 'ARMED' : 'DISARMED'}
                            color={twin?.armed ? 'warning' : 'default'}
                        />
                    </Stack>
                </Stack>
            </DialogTitle>

            <Tabs
                value={tab}
                onChange={(_, value: number) => setTab(value)}
                variant="scrollable"
                scrollButtons="auto"
                sx={{ px: 3, borderBottom: 1, borderColor: 'divider' }}
            >
                <Tab label="General" />
                <Tab label="Navigation" />
                <Tab label="Health & power" />
                <Tab label="Capabilities" />
                <Tab label={`Tasks (${droneTasks.length})`} />
                <Tab label="Raw JSON" />
            </Tabs>

            <DialogContent dividers sx={{ minHeight: 420 }}>
                {!twin && (
                    <Alert severity="info">
                        Waiting for the selected drone twin update.
                    </Alert>
                )}

                {tab === 0 && (
                    <GeneralTab drone={drone} twin={twin} />
                )}

                {tab === 1 && (
                    <NavigationTab drone={drone} twin={twin} />
                )}

                {tab === 2 && (
                    <HealthTab drone={drone} twin={twin} />
                )}

                {tab === 3 && (
                    <CapabilitiesTab drone={drone} twin={twin} />
                )}

                {tab === 4 && (
                    <TasksTab
                        tasks={droneTasks}
                        deletingTaskId={deletingTaskId}
                        resendingTaskId={resendingTaskId}
                        error={taskError}
                        onDelete={(task) => void deleteTask(task)}
                        onResend={(task) => void resendTask(task)}
                    />
                )}

                {tab === 5 && (
                    <Stack spacing={2}>
                        <Stack direction="row" justifyContent="flex-end">
                            <Button
                                startIcon={<ContentCopyIcon />}
                                onClick={copyRawJson}
                                disabled={!twin}
                            >
                                Copy JSON
                            </Button>
                        </Stack>

                        {copyMessage && (
                            <Alert severity={copyMessage.startsWith('Copy failed') ? 'error' : 'success'}>
                                {copyMessage}
                            </Alert>
                        )}

                        <Box
                            component="pre"
                            sx={{
                                m: 0,
                                p: 2,
                                maxHeight: 520,
                                overflow: 'auto',
                                borderRadius: 1,
                                bgcolor: 'background.default',
                                fontSize: 12,
                                whiteSpace: 'pre-wrap',
                                overflowWrap: 'anywhere',
                            }}
                        >
                            {twin ? rawJson : 'No twin payload received.'}
                        </Box>
                    </Stack>
                )}
            </DialogContent>

            <DialogActions>
                <Button onClick={onClose}>
                    Close
                </Button>
            </DialogActions>
        </Dialog>
    );
}

function GeneralTab({
                        drone,
                        twin,
                    }: {
    drone: Drone;
    twin?: TwinState;
}) {
    return (
        <Stack spacing={3}>
            <Section title="Identity">
                <DetailGrid
                    values={[
                        ['UUID', drone.id],
                        ['Twin ID', twin?.twinId],
                        ['Display name', twin?.displayName ?? drone.name],
                        ['Call sign', twin?.callSign],
                        ['Model', twin?.modelName],
                        ['Vehicle class', twin?.vehicleClass],
                        ['System ID', twin?.systemId],
                        ['Component ID', twin?.componentId],
                        ['MMSI', twin?.mmsi],
                        ['Organisation', drone.organization],
                        ['Nationality', drone.nationality],
                    ]}
                />
            </Section>

            <Section title="Operational state">
                <DetailGrid
                    values={[
                        ['Autopilot', twin?.autopilotState?.autopilotType],
                        ['MAVLink version', twin?.autopilotState?.mavlinkVersion],
                        ['Flight mode', twin?.flightMode],
                        ['Mission state', twin?.missionState],
                        ['Landed state', twin?.landedState],
                        ['Lifecycle', twin?.lifecycleStatus],
                        ['Readiness', twin?.readinessState],
                        ['Registration ready', booleanText(twin?.registrationReady)],
                        ['Command ready', booleanText(twin?.commandReady)],
                        ['Stop action', twin?.stopAction],
                        ['Last seen', formatTimestamp(twin?.lastSeenAt)],
                        ['Valid until', formatTimestamp(twin?.validTill)],
                    ]}
                />
            </Section>
        </Stack>
    );
}

function NavigationTab({
                           drone,
                           twin,
                       }: {
    drone: Drone;
    twin?: TwinState;
}) {
    const roll = twin?.orientation?.rollDegrees ?? drone.roll;
    const pitch = twin?.orientation?.pitchDegrees ?? drone.pitch;
    const yaw = twin?.orientation?.yawDegrees ?? drone.yaw;

    return (
        <Stack spacing={3}>
            <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={3}
                alignItems="center"
            >
                <AttitudeIndicator
                    rollDegrees={roll}
                    pitchDegrees={pitch}
                    size={150}
                />

                <Box sx={{ flex: 1, width: '100%' }}>
                    <Section title="Attitude">
                        <DetailGrid
                            values={[
                                ['Roll', formatDegrees(roll)],
                                ['Pitch', formatDegrees(pitch)],
                                ['Yaw', formatDegrees(yaw)],
                                ['Heading', formatDegrees(twin?.headingDegrees ?? drone.heading)],
                                ['Course', formatDegrees(drone.course)],
                            ]}
                        />
                    </Section>
                </Box>
            </Stack>

            <Section title="Position and motion">
                <DetailGrid
                    values={[
                        ['Latitude', formatCoordinate(twin?.geoPosition?.latitude ?? drone.position?.latitude)],
                        ['Longitude', formatCoordinate(twin?.geoPosition?.longitude ?? drone.position?.longitude)],
                        ['Altitude MSL', formatMeasurement(twin?.geoPosition?.altitudeMslMeters ?? drone.position?.altitude, 'm')],
                        ['Ground speed', formatMeasurement(twin?.groundSpeedMetersPerSecond ?? drone.groundSpeed, 'm/s')],
                        ['Vertical speed', formatMeasurement(twin?.verticalSpeedMetersPerSecond ?? drone.climbRate, 'm/s')],
                        ['North velocity', formatMeasurement(twin?.velocityVector?.northMetersPerSecond, 'm/s')],
                        ['East velocity', formatMeasurement(twin?.velocityVector?.eastMetersPerSecond, 'm/s')],
                        ['Down velocity', formatMeasurement(twin?.velocityVector?.downMetersPerSecond, 'm/s')],
                    ]}
                />
            </Section>

            <Section title="Home position">
                <DetailGrid
                    values={[
                        ['Latitude', formatCoordinate(twin?.homePosition?.latitude)],
                        ['Longitude', formatCoordinate(twin?.homePosition?.longitude)],
                        ['Altitude MSL', formatMeasurement(twin?.homePosition?.altitudeMslMeters, 'm')],
                    ]}
                />
            </Section>

            <Section title="GPS">
                <DetailGrid
                    values={[
                        ['Valid', booleanText(twin?.gpsValid)],
                        ['Fix', cleanEnum(twin?.fixInfo?.fixType)],
                        ['Satellites', twin?.fixInfo?.satelliteCount],
                        ['HDOP', formatNumber(twin?.fixInfo?.hdop, 2)],
                        ['VDOP', formatNumber(twin?.fixInfo?.vdop, 2)],
                    ]}
                />
            </Section>
        </Stack>
    );
}

function HealthTab({ drone, twin }: { drone: Drone; twin?: TwinState }) {
    return (
        <Stack spacing={3}>
            <Section title="MAVLink UDP stream">
                <DetailGrid
                    values={[
                        ['Status', drone.mavlinkStreamStatus?.status],
                        ['Previous sequence', drone.mavlinkStreamStatus?.previousSequenceNumber],
                        ['Current sequence', drone.mavlinkStreamStatus?.currentSequenceNumber],
                        ['Expected sequence', drone.mavlinkStreamStatus?.expectedSequenceNumber],
                        ['Delta', drone.mavlinkStreamStatus?.delta],
                        ['Lost packets', drone.mavlinkStreamStatus?.lostPackets],
                        ['Updated', formatEpochMillis(drone.mavlinkStreamStatus?.timestamp)],
                    ]}
                />
            </Section>

            <Section title="System health">
                <DetailGrid
                    values={[
                        ['Healthy', booleanText(twin?.systemState?.healthy)],
                        ['Status', twin?.systemState?.statusMessage],
                        ['CPU load', formatMeasurement(twin?.systemState?.cpuLoadPercent, '%')],
                        ['Link state', cleanEnum(twin?.linkState?.state)],
                        ['Connected', booleanText(twin?.linkState?.connected)],
                        ['Operational update', formatTimestamp(twin?.operationalUpdatedAt)],
                        ['Readiness update', formatTimestamp(twin?.readinessUpdatedAt)],
                    ]}
                />
            </Section>

            <Section title="Battery">
                <DetailGrid
                    values={[
                        ['Percentage', formatMeasurement(twin?.batteryState?.percentage, '%')],
                        ['Voltage', formatMeasurement(twin?.batteryState?.voltageVolts, 'V')],
                        ['Current', formatMeasurement(twin?.batteryState?.currentAmps, 'A')],
                        ['Charging', booleanText(twin?.batteryState?.charging)],
                        ['Duration', twin?.batteryState?.duration],
                        ['Capacity', formatMeasurement(twin?.batteryCapacityHours, 'h')],
                    ]}
                />
            </Section>

            <Section title="Readiness details">
                <StringList title="Missing" values={twin?.missingReadinessItems} />
                <StringList title="Degraded" values={twin?.degradedReadinessItems} />
                <StringList title="Blocking" values={twin?.blockingReadinessItems} />
            </Section>
        </Stack>
    );
}

function CapabilitiesTab({
                             drone,
                             twin,
                         }: {
    drone: Drone;
    twin?: TwinState;
}) {
    return (
        <Stack spacing={3}>
            <Section title="STANAG task capabilities">
                {drone.capabilities.length === 0 ? (
                    <Typography color="text.secondary">
                        No task capabilities advertised.
                    </Typography>
                ) : (
                    <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                        {drone.capabilities.map((capability) => (
                            <Chip
                                key={`${capability.taskType}:${capability.taskSpecialization}`}
                                label={`${cleanEnum(capability.taskType)} / ${cleanEnum(capability.taskSpecialization)}`}
                                color="primary"
                                variant="outlined"
                            />
                        ))}
                    </Stack>
                )}
            </Section>

            <Section title="Twin capability payload">
                <Box
                    component="pre"
                    sx={{
                        m: 0,
                        p: 2,
                        maxHeight: 320,
                        overflow: 'auto',
                        borderRadius: 1,
                        bgcolor: 'background.default',
                        fontSize: 12,
                        whiteSpace: 'pre-wrap',
                        overflowWrap: 'anywhere',
                    }}
                >
                    {twin?.capabilities
                        ? JSON.stringify(twin.capabilities, null, 2)
                        : 'No twin capability payload received.'}
                </Box>
            </Section>
        </Stack>
    );
}

function TasksTab({
                      tasks,
                      deletingTaskId,
                      resendingTaskId,
                      error,
                      onDelete,
                      onResend,
                  }: {
    tasks: DroneTask[];
    deletingTaskId?: string;
    resendingTaskId?: string;
    error?: string;
    onDelete: (task: DroneTask) => void;
    onResend: (task: DroneTask) => void;
}) {
    const [resendConfirmationTask, setResendConfirmationTask] = useState<DroneTask>();

    if (tasks.length === 0) {
        return <Alert severity="info">No active or future tasks are registered for this vehicle.</Alert>;
    }

    return (
        <>
            <Stack spacing={2}>
                {error && <Alert severity="error">{error}</Alert>}
                {tasks.map((task) => (
                    <Box key={task.id} sx={{ p: 1.5, border: 1, borderColor: 'divider', borderRadius: 1 }}>
                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} justifyContent="space-between" alignItems={{ sm: 'center' }}>
                            <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
                                <Chip size="small" color="primary" label={task.type} />
                                <Chip size="small" variant="outlined" label={task.state} />
                                {isFutureTask(task) && <Chip size="small" color="info" variant="outlined" label="FUTURE" />}
                            </Stack>
                            <Stack direction="row" spacing={0.75}>
                                {task.state === 'ACTIVE' && (
                                    <Button
                                        size="small"
                                        color="warning"
                                        variant="outlined"
                                        startIcon={<ReplayIcon />}
                                        disabled={resendingTaskId === task.id || deletingTaskId === task.id}
                                        onClick={() => setResendConfirmationTask(task)}
                                    >
                                        {resendingTaskId === task.id ? 'Resending…' : 'Resend'}
                                    </Button>
                                )}
                                <Button
                                    size="small"
                                    color="error"
                                    variant="outlined"
                                    startIcon={<DeleteOutlineIcon />}
                                    disabled={deletingTaskId === task.id || resendingTaskId === task.id || task.state === 'CANCEL_REQUESTED' || task.state === 'PREEMPTING'}
                                    onClick={() => onDelete(task)}
                                >
                                    {deletingTaskId === task.id ? 'Deleting…' : task.state === 'CANCEL_REQUESTED' || task.state === 'PREEMPTING' ? 'Cancelling…' : 'Delete'}
                                </Button>
                            </Stack>
                        </Stack>

                        <Typography variant="subtitle1" sx={{ mt: 1 }}>{task.name ?? task.type}</Typography>
                        {task.description && <Typography variant="body2" color="text.secondary">{task.description}</Typography>}

                        <Box sx={{ mt: 1.25 }}>
                            <DetailGrid
                                values={[
                                    ['Task ID', task.id],
                                    ['Geometry', task.geometryType],
                                    ['Start', task.schedule?.start ? formatTimestamp(task.schedule.start) : 'Immediate'],
                                    ['End', task.schedule?.end ? formatTimestamp(task.schedule.end) : undefined],
                                    ['Duration', formatTaskDuration(task.duration)],
                                    ['Progress', task.percentComplete === undefined ? undefined : `${task.percentComplete.toFixed(1)}%`],
                                ]}
                            />
                        </Box>
                    </Box>
                ))}
            </Stack>

            <Dialog
                open={resendConfirmationTask !== undefined}
                onClose={() => setResendConfirmationTask(undefined)}
                fullWidth
                maxWidth="sm"
            >
                <DialogTitle>Resend the entire task plan?</DialogTitle>
                <DialogContent>
                    <Stack spacing={2} sx={{ pt: 0.5 }}>
                        <Alert severity="warning">
                            This sends the complete task plan to the vehicle again from the beginning, not just the current leg or waypoint.
                        </Alert>
                        <Typography variant="body2">
                            This recovery action is intended for cases such as a drone or autopilot reset. The vehicle may restart navigation from the first waypoint in the task.
                        </Typography>
                        {resendConfirmationTask && (
                            <DetailGrid
                                values={[
                                    ['Task', resendConfirmationTask.name ?? resendConfirmationTask.type],
                                    ['Task ID', resendConfirmationTask.id],
                                    ['Progress', resendConfirmationTask.percentComplete === undefined ? undefined : `${resendConfirmationTask.percentComplete.toFixed(1)}%`],
                                ]}
                            />
                        )}
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setResendConfirmationTask(undefined)}>Cancel</Button>
                    <Button
                        color="warning"
                        variant="contained"
                        onClick={() => {
                            const task = resendConfirmationTask;
                            setResendConfirmationTask(undefined);
                            if (task) onResend(task);
                        }}
                    >
                        Resend entire plan
                    </Button>
                </DialogActions>
            </Dialog>
        </>
    );
}

function isCurrentOrFutureTask(task: DroneTask): boolean {
    return !['PREEMPTED', 'CANCELLED', 'COMPLETED', 'ABORTED', 'LOST', 'FAILED', 'REJECTED'].includes(task.state);
}

function isFutureTask(task: DroneTask): boolean {
    return Boolean(task.schedule?.start && Date.parse(task.schedule.start) > Date.now());
}

function compareTasks(left: DroneTask, right: DroneTask): number {
    const leftTime = left.schedule?.start ? Date.parse(left.schedule.start) : left.createdAt;
    const rightTime = right.schedule?.start ? Date.parse(right.schedule.start) : right.createdAt;
    return leftTime - rightTime;
}

function formatTaskDuration(duration: TaskDuration | undefined): string | undefined {
    if (!duration) return undefined;
    const parts = [
        duration.hours > 0 ? `${duration.hours} h` : '',
        duration.minutes > 0 ? `${duration.minutes} min` : '',
        duration.seconds > 0 ? `${duration.seconds} s` : '',
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(' ') : undefined;
}

function Section({
                     title,
                     children,
                 }: {
    title: string;
    children: ReactNode;
}) {
    return (
        <Box>
            <Typography variant="subtitle1" sx={{ mb: 1 }}>
                {title}
            </Typography>
            <Divider sx={{ mb: 1.5 }} />
            {children}
        </Box>
    );
}

function DetailGrid({
                        values,
                    }: {
    values: Array<[string, unknown]>;
}) {
    return (
        <Grid container spacing={1.25}>
            {values.map(([label, value]) => (
                <Grid key={label} size={{ xs: 12, sm: 6 }}>
                    <Stack
                        direction="row"
                        spacing={1}
                        justifyContent="space-between"
                        sx={{
                            px: 1.25,
                            py: 0.9,
                            borderRadius: 1,
                            bgcolor: 'action.hover',
                        }}
                    >
                        <Typography variant="body2" color="text.secondary">
                            {label}
                        </Typography>
                        <Typography
                            variant="body2"
                            sx={{
                                textAlign: 'right',
                                overflowWrap: 'anywhere',
                            }}
                        >
                            {displayValue(value)}
                        </Typography>
                    </Stack>
                </Grid>
            ))}
        </Grid>
    );
}

function StringList({
                        title,
                        values,
                    }: {
    title: string;
    values?: string[];
}) {
    return (
        <Stack spacing={0.75} sx={{ mb: 1.5 }}>
            <Typography variant="body2" color="text.secondary">
                {title}
            </Typography>
            <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
                {values && values.length > 0 ? (
                    values.map((value) => (
                        <Chip
                            key={value}
                            size="small"
                            label={cleanEnum(value)}
                            variant="outlined"
                        />
                    ))
                ) : (
                    <Typography variant="body2">
                        None
                    </Typography>
                )}
            </Stack>
        </Stack>
    );
}

function displayValue(value: unknown): string {
    if (value === undefined || value === null || value === '') {
        return 'Unknown';
    }

    return String(value);
}

function booleanText(value: boolean | undefined): string {
    if (value === undefined) {
        return 'Unknown';
    }

    return value ? 'Yes' : 'No';
}

function formatCoordinate(value: number | undefined): string {
    return value === undefined ? 'Unknown' : value.toFixed(7);
}

function formatDegrees(value: number | undefined): string {
    return value === undefined ? 'Unknown' : `${value.toFixed(1)}°`;
}

function formatMeasurement(
    value: number | undefined,
    unit: string,
): string {
    return value === undefined ? 'Unknown' : `${value.toFixed(2)} ${unit}`;
}

function formatNumber(
    value: number | undefined,
    decimals: number,
): string {
    return value === undefined ? 'Unknown' : value.toFixed(decimals);
}

function formatEpochMillis(value: number | undefined): string {
    return value === undefined ? 'Unknown' : new Date(value).toLocaleString();
}

function formatTimestamp(value: string | undefined): string {
    if (!value) {
        return 'Unknown';
    }

    const timestamp = Date.parse(value);

    return Number.isNaN(timestamp)
        ? value
        : new Date(timestamp).toLocaleString();
}

function cleanEnum(value: string | undefined): string {
    if (!value) {
        return 'Unknown';
    }

    return value
        .replace(/^.*Enum_/, '')
        .replaceAll('_', ' ');
}

async function copyText(value: string): Promise<void> {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();

    const copied = document.execCommand('copy');
    textarea.remove();

    if (!copied) {
        throw new Error('Browser clipboard access is unavailable');
    }
}