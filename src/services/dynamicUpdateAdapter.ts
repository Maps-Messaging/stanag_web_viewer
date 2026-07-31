import type { Detection, GeoPoint } from '../models/types';

export const DETECTION_TTL_MILLISECONDS = 2 * 60 * 1000;

export function parseDynamicTrack(payload: unknown, receivedAt = Date.now()): Detection {
  const envelope = asObject(payload, 'message');
  const header = asObject(envelope.header, 'header');
  const body = asObject(envelope.body, 'body');
  const operation = asObject(body.operation, 'body.operation');

  if (operation.$discriminator !== 'DynamicUpdateOperationTypeEnum_PUT_VALUE') {
    throw new Error(`Unsupported dynamic update operation: ${String(operation.$discriminator)}`);
  }

  const putValue = asObject(operation.put_value, 'body.operation.put_value');
  if (putValue.$discriminator !== 'ValueTypeEnum_TRACK') {
    throw new Error(`Unsupported dynamic update value: ${String(putValue.$discriminator)}`);
  }

  const track = asObject(putValue.track, 'body.operation.put_value.track');
  const description = optionalObject(track.description);
  const pose = asObject(track.pose, 'track.pose');
  const position = asObject(pose.position, 'track.pose.position');
  if (position.$discriminator !== 'PositionTypeEnum_LATITUDE_LONGITUDE_ALTITUDE') {
    throw new Error(`Unsupported track position: ${String(position.$discriminator)}`);
  }

  const coordinates = asObject(position.latitude_longitude_altitude, 'track.pose.position.latitude_longitude_altitude');
  const timestamp = parseTimestamp(track.timestamp) ?? parseTimestamp(header.time_sent) ?? receivedAt;

  return {
    id: asString(track.identifier, 'track.identifier'),
    sourceId: asString(header.source, 'header.source'),
    name: optionalString(description?.name) ?? 'Detection',
    position: parseGeoPoint(coordinates),
    description: optionalString(description?.description),
    organization: optionalString(description?.organization),
    nationality: optionalString(description?.nationality),
    contextType: optionalString(description?.context_type),
    standardIdentity: optionalString(description?.standard_identity),
    symbolSet: optionalString(description?.symbol_set),
    entityStatus: optionalString(description?.status),
    entity: optionalString(description?.entity),
    entityType: optionalString(description?.entity_type),
    entitySubtype: optionalString(description?.entity_subtype),
    sector1: optionalString(description?.sector_1),
    sector2: optionalString(description?.sector_2),
    trackPhase: optionalString(track.track_phase),
    timestamp,
    initiatedAt: parseTimestamp(track.time_of_initiation),
    sourceValidUntil: parseTimestamp(track.time_of_validity),
    expiresAt: receivedAt + DETECTION_TTL_MILLISECONDS,
    rtspUrl: findRtspUrl(track),
    raw: payload,
  };
}

function parseGeoPoint(value: Record<string, unknown>): GeoPoint {
  const latitude = asNumber(value.latitude, 'latitude');
  const longitude = asNumber(value.longitude, 'longitude');
  const altitudeEntries = Array.isArray(value.altitude)
    ? value.altitude.map(optionalObject).filter((entry): entry is Record<string, unknown> => Boolean(entry))
    : [];
  const preferred = altitudeEntries.find((entry) => entry.type === 'AltitudeTypeEnum_WGS') ?? altitudeEntries[0];
  return {
    latitude,
    longitude,
    altitude: optionalNumber(preferred?.value),
    altitudeType: optionalString(preferred?.type),
  };
}

function findRtspUrl(track: Record<string, unknown>): string | undefined {
  const direct = optionalString(track.rtsp_url) ?? optionalString(track.rtspUrl);
  if (direct) return direct;
  const extra = optionalObject(track.extra);
  if (!extra) return undefined;
  return optionalString(extra.rtsp_url) ?? optionalString(extra.rtspUrl) ?? optionalString(extra.video_url);
}

function asObject(value: unknown, field: string): Record<string, unknown> {
  if (!isObject(value)) throw new Error(`Expected JSON object: ${field}`);
  return value;
}

function optionalObject(value: unknown): Record<string, unknown> | undefined {
  return isObject(value) ? value : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Expected string field: ${field}`);
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Expected number field: ${field}`);
  return value;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function parseTimestamp(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : timestamp;
}
