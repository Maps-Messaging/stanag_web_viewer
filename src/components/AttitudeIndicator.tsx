import type { CSSProperties } from 'react';

interface AttitudeIndicatorProps {
  rollDegrees?: number;
  pitchDegrees?: number;
  altitudeMeters?: number;
  size?: number;
}

export function AttitudeIndicator({
  rollDegrees = 0,
  pitchDegrees = 0,
  altitudeMeters,
  size = 58,
}: AttitudeIndicatorProps) {
  const roll = normaliseRoll(rollDegrees);
  const pitch = clamp(pitchDegrees, -30, 30);
  const pitchOffset = pitch / 30 * size * 0.28;
  const containerStyle: CSSProperties = {
    width: size,
    flexBasis: size,
  };
  const dialStyle: CSSProperties = {
    width: size,
    height: size,
  };
  const horizonStyle: CSSProperties = {
    transform: `translateY(${pitchOffset}px) rotate(${-roll}deg)`,
  };
  const aircraftStyle: CSSProperties = {
    width: size * 0.52,
  };

  return (
    <div className="attitude-indicator" style={containerStyle}>
      <div
        className="attitude-indicator__dial"
        aria-label={`Roll ${roll.toFixed(1)} degrees, pitch ${pitchDegrees.toFixed(1)} degrees`}
        style={dialStyle}
      >
        <div className="attitude-indicator__horizon" style={horizonStyle}>
          <div className="attitude-indicator__sky" />
          <div className="attitude-indicator__ground" />
          <div className="attitude-indicator__horizon-line" />
        </div>
        <div className="attitude-indicator__aircraft" style={aircraftStyle} />
        <div className="attitude-indicator__centre" />
        <div className="attitude-indicator__roll-marker" />
      </div>
      <span className="attitude-indicator__altitude">{formatAltitude(altitudeMeters)}</span>
    </div>
  );
}

function formatAltitude(value: number | undefined): string {
  return value === undefined
    ? '-- m'
    : `${value.toFixed(1)} m`;
}

function normaliseRoll(value: number): number {
  const normalised = (value % 360 + 360) % 360;
  return normalised > 180 ? normalised - 360 : normalised;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
