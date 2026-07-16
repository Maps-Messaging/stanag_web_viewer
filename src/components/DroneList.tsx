import FlightIcon from '@mui/icons-material/Flight';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import {
    Box,
    Chip,
    IconButton,
    List,
    ListItemButton,
    Paper,
    Stack,
    Tooltip,
    Typography,
} from '@mui/material';
import { useState } from 'react';
import { AttitudeIndicator } from './AttitudeIndicator';
import { DroneDetailsDialog } from './DroneDetailsDialog';
import { useAppStore } from '../state/useAppStore';

export function DroneList() {
    const droneMap = useAppStore((state) => state.drones);
    const drones = Object.values(droneMap);
    const selectedDroneId = useAppStore((state) => state.selectedDroneId);
    const selectDrone = useAppStore((state) => state.selectDrone);
    const [dialogDroneId, setDialogDroneId] = useState<string>();

    const dialogDrone = dialogDroneId
        ? droneMap[dialogDroneId]
        : undefined;

    return (
        <>
            <Paper
                square
                sx={{
                    height: '100%',
                    overflow: 'auto',
                }}
            >
                <Box sx={{ px: 2, py: 1.5 }}>
                    <Typography variant="overline">
                        Drones
                    </Typography>
                </Box>

                <List disablePadding>
                    {drones.map((drone) => (
                        <ListItemButton
                            key={drone.id}
                            selected={drone.id === selectedDroneId}
                            onClick={() => selectDrone(drone.id)}
                            sx={{
                                alignItems: 'center',
                                gap: 1.25,
                                py: 1.25,
                            }}
                        >
                            <AttitudeIndicator
                                rollDegrees={drone.roll}
                                pitchDegrees={drone.pitch}
                                altitudeMeters={drone.position?.altitude}
                            />

                            <Box
                                sx={{
                                    minWidth: 0,
                                    flex: 1,
                                }}
                            >
                                <Stack
                                    direction="row"
                                    spacing={0.5}
                                    alignItems="center"
                                >
                                    <Typography
                                        variant="body2"
                                        noWrap
                                        sx={{
                                            minWidth: 0,
                                            flex: 1,
                                        }}
                                    >
                                        {drone.name}
                                    </Typography>

                                    <Tooltip title="Drone details">
                                        <IconButton
                                            size="small"
                                            aria-label={`Show details for ${drone.name}`}
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                setDialogDroneId(drone.id);
                                            }}
                                        >
                                            <InfoOutlinedIcon fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                </Stack>

                                <Stack
                                    direction="row"
                                    spacing={0.75}
                                    alignItems="center"
                                    sx={{ mt: 0.4 }}
                                >
                                    <FlightIcon
                                        fontSize="small"
                                        sx={{
                                            transform: `rotate(${drone.heading}deg)`,
                                            color: 'text.secondary',
                                        }}
                                    />

                                    <Typography
                                        variant="caption"
                                        color="text.secondary"
                                    >
                                        {formatHeading(drone.heading)}
                                    </Typography>
                                </Stack>

                                <Stack
                                    direction="row"
                                    spacing={0.5}
                                    useFlexGap
                                    flexWrap="wrap"
                                    sx={{ mt: 0.75 }}
                                >
                                    {drone.symbolSet && (
                                        <Chip
                                            size="small"
                                            label={shortEnum(drone.symbolSet)}
                                        />
                                    )}

                                    <Chip
                                        size="small"
                                        label={drone.position ? 'LIVE' : 'KNOWN'}
                                        color={drone.position ? 'success' : 'default'}
                                    />

                                    <Chip
                                        size="small"
                                        label={streamStatusLabel(
                                            drone.mavlinkStreamStatus?.status,
                                        )}
                                        color={streamStatusColor(
                                            drone.mavlinkStreamStatus?.status,
                                        )}
                                        variant={
                                            drone.mavlinkStreamStatus
                                                ? 'filled'
                                                : 'outlined'
                                        }
                                    />
                                </Stack>
                            </Box>
                        </ListItemButton>
                    ))}
                </List>
            </Paper>

            <DroneDetailsDialog
                drone={dialogDrone}
                open={dialogDrone !== undefined}
                onClose={() => setDialogDroneId(undefined)}
            />
        </>
    );
}

function formatHeading(value: number): string {
    const heading = (value % 360 + 360) % 360;
    return `${heading.toFixed(1)}°`;
}

function shortEnum(value: string): string {
    return value
        .replace(/^.*Enum_/, '')
        .replaceAll('_', ' ');
}

function streamStatusLabel(
    status: string | undefined,
): string {
    switch (status) {
        case 'OK':
            return 'UDP OK';

        case 'INITIAL':
            return 'UDP INITIAL';

        case 'LOSS':
            return 'UDP LOSS';

        case 'RESET':
            return 'UDP RESET';

        case 'OUT_OF_ORDER':
            return 'UDP ORDER';

        default:
            return 'UDP UNKNOWN';
    }
}

function streamStatusColor(
    status: string | undefined,
): 'default' | 'success' | 'warning' | 'error' {
    switch (status) {
        case 'OK':
            return 'success';

        case 'INITIAL':
        case 'RESET':
        case 'OUT_OF_ORDER':
            return 'warning';

        case 'LOSS':
            return 'error';

        default:
            return 'default';
    }
}