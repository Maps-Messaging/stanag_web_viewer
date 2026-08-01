import type { Drone, GeoPoint } from '../models/types';

export type MobilityDomain = 'AIR' | 'SURFACE' | 'GROUND' | 'SUBSURFACE' | 'UNKNOWN';

export interface CollisionPredictionConfiguration {
  lookAheadSeconds: number;
  horizontalThresholdMeters: number;
  verticalThresholdMeters: number;
  surfaceInteractionAltitudeMeters: number;
  minimumSpeedMetersPerSecond: number;
}

export interface PredictedCollision {
  leftDroneId: string;
  leftDroneName: string;
  leftDomain: MobilityDomain;
  rightDroneId: string;
  rightDroneName: string;
  rightDomain: MobilityDomain;
  timeToClosestApproachSeconds: number;
  horizontalSeparationMeters: number;
  verticalSeparationMeters?: number;
  collisionPoint: GeoPoint;
}

interface MovingDrone extends Drone {
  position: GeoPoint;
}

interface LocalVector {
  east: number;
  north: number;
}

const EARTH_RADIUS_METERS = 6_371_008.8;
const RELATIVE_SPEED_EPSILON = 0.000_001;

export function predictCollisions(
  drones: Drone[],
  immediateConflictDroneIds: ReadonlySet<string>,
  configuration: CollisionPredictionConfiguration,
): PredictedCollision[] {
  const moving = drones.filter((drone): drone is MovingDrone => Boolean(drone.position) && !drone.stale);
  const predictions: PredictedCollision[] = [];

  for (let leftIndex = 0; leftIndex < moving.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < moving.length; rightIndex += 1) {
      const left = moving[leftIndex];
      const right = moving[rightIndex];

      if (immediateConflictDroneIds.has(left.id) || immediateConflictDroneIds.has(right.id)) continue;
      const prediction = predictPair(left, right, configuration);
      if (prediction) predictions.push(prediction);
    }
  }

  return predictions;
}

export function hasImmediateCollisionRisk(
  left: Drone & { position: GeoPoint },
  right: Drone & { position: GeoPoint },
  configuration: CollisionPredictionConfiguration,
): boolean {
  const leftDomain = mobilityDomain(left);
  const rightDomain = mobilityDomain(right);
  return verticalConflict(left.position, right.position, leftDomain, rightDomain, configuration).accepted;
}

export function mobilityDomain(drone: Drone): MobilityDomain {
  const vehicleClass = normaliseClass(drone.twin?.vehicleClass);
  if (vehicleClass) return vehicleClass;

  const symbolSet = drone.symbolSet?.toUpperCase();
  if (symbolSet?.includes('AIR')) return 'AIR';
  if (symbolSet?.includes('SEA_SURFACE') || symbolSet?.includes('SURFACE')) return 'SURFACE';
  if (symbolSet?.includes('LAND') || symbolSet?.includes('GROUND')) return 'GROUND';
  if (symbolSet?.includes('SUBSURFACE') || symbolSet?.includes('UNDERWATER')) return 'SUBSURFACE';
  return 'UNKNOWN';
}

function predictPair(
  left: MovingDrone,
  right: MovingDrone,
  configuration: CollisionPredictionConfiguration,
): PredictedCollision | undefined {
  if (left.groundSpeed < configuration.minimumSpeedMetersPerSecond
      && right.groundSpeed < configuration.minimumSpeedMetersPerSecond) return undefined;

  const relativePosition = localOffset(left.position, right.position);
  const leftVelocity = horizontalVelocity(left);
  const rightVelocity = horizontalVelocity(right);
  const relativeVelocity = {
    east: rightVelocity.east - leftVelocity.east,
    north: rightVelocity.north - leftVelocity.north,
  };
  const relativeSpeedSquared = dot(relativeVelocity, relativeVelocity);
  if (relativeSpeedSquared < RELATIVE_SPEED_EPSILON) return undefined;

  const timeToClosestApproach = -dot(relativePosition, relativeVelocity) / relativeSpeedSquared;
  if (timeToClosestApproach <= 0 || timeToClosestApproach > configuration.lookAheadSeconds) return undefined;

  const leftAtCpa = projectPosition(left, timeToClosestApproach);
  const rightAtCpa = projectPosition(right, timeToClosestApproach);
  const horizontalSeparation = distanceMeters(leftAtCpa, rightAtCpa);
  if (horizontalSeparation > configuration.horizontalThresholdMeters) return undefined;

  const leftDomain = mobilityDomain(left);
  const rightDomain = mobilityDomain(right);
  const vertical = verticalConflict(leftAtCpa, rightAtCpa, leftDomain, rightDomain, configuration);
  if (!vertical.accepted) return undefined;

  return {
    leftDroneId: left.id,
    leftDroneName: left.name,
    leftDomain,
    rightDroneId: right.id,
    rightDroneName: right.name,
    rightDomain,
    timeToClosestApproachSeconds: timeToClosestApproach,
    horizontalSeparationMeters: horizontalSeparation,
    verticalSeparationMeters: vertical.separationMeters,
    collisionPoint: midpoint(leftAtCpa, rightAtCpa),
  };
}

function verticalConflict(
  leftAtCpa: GeoPoint,
  rightAtCpa: GeoPoint,
  leftDomain: MobilityDomain,
  rightDomain: MobilityDomain,
  configuration: CollisionPredictionConfiguration,
): { accepted: boolean; separationMeters?: number } {
  if (leftDomain === rightDomain && leftDomain !== 'AIR') return { accepted: true };

  const leftAltitude = leftAtCpa.altitude;
  const rightAltitude = rightAtCpa.altitude;

  if (leftDomain === 'AIR' && rightDomain === 'AIR') {
    if (leftAltitude === undefined || rightAltitude === undefined) return { accepted: false };
    const separation = Math.abs(leftAltitude - rightAltitude);
    return { accepted: separation <= configuration.verticalThresholdMeters, separationMeters: separation };
  }

  if (leftDomain === 'AIR' || rightDomain === 'AIR') {
    const airAltitude = leftDomain === 'AIR' ? leftAltitude : rightAltitude;
    const otherAltitude = leftDomain === 'AIR' ? rightAltitude : leftAltitude;
    const otherDomain = leftDomain === 'AIR' ? rightDomain : leftDomain;
    if (airAltitude === undefined || otherDomain === 'UNKNOWN') return { accepted: false };

    const clearance = otherAltitude === undefined ? airAltitude : Math.abs(airAltitude - otherAltitude);
    return {
      accepted: clearance <= configuration.surfaceInteractionAltitudeMeters,
      separationMeters: otherAltitude === undefined ? undefined : clearance,
    };
  }

  if (leftDomain === 'UNKNOWN' || rightDomain === 'UNKNOWN') return { accepted: false };

  if ((leftDomain === 'SURFACE' && rightDomain === 'SUBSURFACE')
      || (leftDomain === 'SUBSURFACE' && rightDomain === 'SURFACE')) {
    if (leftAltitude === undefined || rightAltitude === undefined) return { accepted: false };
    const separation = Math.abs(leftAltitude - rightAltitude);
    return { accepted: separation <= configuration.verticalThresholdMeters, separationMeters: separation };
  }

  return { accepted: false };
}

function normaliseClass(value: unknown): MobilityDomain | undefined {
  if (typeof value !== 'string') return undefined;
  switch (value.toUpperCase()) {
    case 'UAV':
    case 'AIR': return 'AIR';
    case 'USV':
    case 'SURFACE': return 'SURFACE';
    case 'UGV':
    case 'GROUND': return 'GROUND';
    case 'UUV':
    case 'SUBSURFACE': return 'SUBSURFACE';
    default: return undefined;
  }
}

function horizontalVelocity(drone: Drone): LocalVector {
  const courseRadians = (drone.course ?? drone.heading) * Math.PI / 180;
  return {
    east: Math.sin(courseRadians) * drone.groundSpeed,
    north: Math.cos(courseRadians) * drone.groundSpeed,
  };
}

function projectPosition(drone: MovingDrone, seconds: number): GeoPoint {
  const velocity = horizontalVelocity(drone);
  const latitudeRadians = drone.position.latitude * Math.PI / 180;
  const latitude = drone.position.latitude + velocity.north * seconds / EARTH_RADIUS_METERS * 180 / Math.PI;
  const longitude = drone.position.longitude
    + velocity.east * seconds / (EARTH_RADIUS_METERS * Math.cos(latitudeRadians)) * 180 / Math.PI;
  const altitude = drone.position.altitude === undefined
    ? undefined
    : drone.position.altitude + (drone.climbRate ?? 0) * seconds;
  return { latitude, longitude, altitude, altitudeType: drone.position.altitudeType };
}

function localOffset(origin: GeoPoint, target: GeoPoint): LocalVector {
  const meanLatitude = (origin.latitude + target.latitude) / 2 * Math.PI / 180;
  return {
    east: (target.longitude - origin.longitude) * Math.PI / 180 * EARTH_RADIUS_METERS * Math.cos(meanLatitude),
    north: (target.latitude - origin.latitude) * Math.PI / 180 * EARTH_RADIUS_METERS,
  };
}

function distanceMeters(left: GeoPoint, right: GeoPoint): number {
  const offset = localOffset(left, right);
  return Math.hypot(offset.east, offset.north);
}

function midpoint(left: GeoPoint, right: GeoPoint): GeoPoint {
  return {
    latitude: (left.latitude + right.latitude) / 2,
    longitude: (left.longitude + right.longitude) / 2,
    altitude: left.altitude === undefined || right.altitude === undefined
      ? left.altitude ?? right.altitude
      : (left.altitude + right.altitude) / 2,
  };
}

function dot(left: LocalVector, right: LocalVector): number {
  return left.east * right.east + left.north * right.north;
}
