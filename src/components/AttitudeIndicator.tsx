import { Box } from '@mui/material';

interface AttitudeIndicatorProps {
  rollDegrees?: number;
  pitchDegrees?: number;
  size?: number;
}

export function AttitudeIndicator({
  rollDegrees = 0,
  pitchDegrees = 0,
  size = 58,
}: AttitudeIndicatorProps) {
  const roll = normaliseRoll(rollDegrees);
  const pitch = clamp(pitchDegrees, -30, 30);
  const pitchOffset = pitch / 30 * size * 0.28;

  return (
    <Box
      aria-label={`Roll ${roll.toFixed(1)} degrees, pitch ${pitchDegrees.toFixed(1)} degrees`}
      sx={{
        position: 'relative',
        width: size,
        height: size,
        flex: `0 0 ${size}px`,
        overflow: 'hidden',
        borderRadius: '50%',
        border: '2px solid',
        borderColor: 'grey.400',
        bgcolor: 'grey.900',
        boxShadow: 'inset 0 0 8px rgb(0 0 0 / 75%)',
      }}
    >
      <Box
        sx={{
          position: 'absolute',
          left: '-50%',
          top: '-50%',
          width: '200%',
          height: '200%',
          transform: `translateY(${pitchOffset}px) rotate(${-roll}deg)`,
          transformOrigin: 'center',
        }}
      >
        <Box
          sx={{
            position: 'absolute',
            inset: '0 0 50%',
            bgcolor: '#1976d2',
          }}
        />
        <Box
          sx={{
            position: 'absolute',
            inset: '50% 0 0',
            bgcolor: '#7b4f2c',
          }}
        />
        <Box
          sx={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: '50%',
            height: 2,
            bgcolor: 'white',
            transform: 'translateY(-1px)',
          }}
        />
      </Box>

      <Box
        sx={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: size * 0.52,
          height: 2,
          bgcolor: '#ffca28',
          transform: 'translate(-50%, -50%)',
          boxShadow: '0 0 2px rgb(0 0 0 / 80%)',
        }}
      />

      <Box
        sx={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: 4,
          height: 4,
          borderRadius: '50%',
          bgcolor: '#ffca28',
          transform: 'translate(-50%, -50%)',
        }}
      />

      <Box
        sx={{
          position: 'absolute',
          left: '50%',
          top: 2,
          width: 0,
          height: 0,
          borderLeft: '4px solid transparent',
          borderRight: '4px solid transparent',
          borderTop: '7px solid #ffca28',
          transform: 'translateX(-50%)',
        }}
      />
    </Box>
  );
}

function normaliseRoll(value: number): number {
  const normalised = (value % 360 + 360) % 360;
  return normalised > 180 ? normalised - 360 : normalised;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
