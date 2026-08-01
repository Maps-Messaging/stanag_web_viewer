import { describe, expect, it } from 'vitest';
import type { Drone } from '../models/types';
import { hasImmediateCollisionRisk, predictCollisions, type CollisionPredictionConfiguration } from './collisionPrediction';

const configuration: CollisionPredictionConfiguration = {
  lookAheadSeconds: 300,
  horizontalThresholdMeters: 200,
  verticalThresholdMeters: 30,
  surfaceInteractionAltitudeMeters: 20,
  minimumSpeedMetersPerSecond: 0.01,
};

function drone(id: string, vehicleClass: string, altitude: number, stale = false): Drone & { position: NonNullable<Drone['position']> } {
  return {
    id,
    name: id,
    heading: 0,
    groundSpeed: 1,
    course: 0,
    capabilities: [],
    lastSeen: Date.now(),
    stale,
    position: { latitude: -33.8, longitude: 151.1, altitude },
    twin: { vehicleClass },
  };
}

describe('collision rules', () => {
  it('suppresses immediate UAV to surface warnings when vertically separated', () => {
    expect(hasImmediateCollisionRisk(drone('air', 'UAV', 100), drone('surface', 'USV', 0), configuration)).toBe(false);
  });

  it('accepts immediate same-domain surface conflicts', () => {
    expect(hasImmediateCollisionRisk(drone('left', 'USV', 0), drone('right', 'USV', 0), configuration)).toBe(true);
  });

  it('excludes stale vehicles from prediction', () => {
    const left = drone('left', 'USV', 0, true);
    const right = drone('right', 'USV', 0);
    right.position = { latitude: -33.799, longitude: 151.1, altitude: 0 };
    right.course = 180;
    expect(predictCollisions([left, right], new Set(), configuration)).toEqual([]);
  });
});
