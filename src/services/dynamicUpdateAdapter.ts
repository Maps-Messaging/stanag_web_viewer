import type { Detection, GeoPoint } from '../models/types';

export const DETECTION_TTL_MILLISECONDS = 2 * 60 * 1000;

export interface ParsedDataProduct {
  id: string;
  sourceId: string;
  description?: string;
  timestamp: number;
  trackIds: string[];
  urls: string[];
  raw: unknown;
}

export function getDynamicUpdateValueType(payload: unknown): string {
  const envelope = asObject(payload, 'message');
  const body = asObject(envelope.body, 'body');
  const operation = asObject(body.operation, 'body.operation');

  if (operation.$discriminator !== 'DynamicUpdateOperationTypeEnum_PUT_VALUE') {
    throw new Error(`Unsupported dynamic update operation: ${String(operation.$discriminator)}`);
  }

  return asString(asObject(operation.put_value, 'body.operation.put_value').$discriminator, 'body.operation.put_value.$discriminator');
}

export function parseDynamicTrack(payload: unknown, receivedAt = Date.now()): Detection {
  const envelope = asObject(payload, 'message');
  const header = asObject(envelope.header, 'header');
  const putValue = parsePutValue(envelope);

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

export function parseDynamicDataProduct(payload: unknown, receivedAt = Date.now()): ParsedDataProduct {
  const envelope = asObject(payload, 'message');
  const header = asObject(envelope.header, 'header');
  const putValue = parsePutValue(envelope);

  if (putValue.$discriminator !== 'ValueTypeEnum_DATA_PRODUCT') {
    throw new Error(`Unsupported dynamic update value: ${String(putValue.$discriminator)}`);
  }

  const dataProduct = asObject(putValue.data_product, 'body.operation.put_value.data_product');
  const description = optionalObject(dataProduct.description);
  const references = Array.isArray(dataProduct.references) ? dataProduct.references : [];
  const products = Array.isArray(dataProduct.products) ? dataProduct.products : [];

  const trackIds = references.flatMap((value, index) => {
    const reference = optionalObject(value);
    if (!reference || reference.value_type !== 'ValueTypeEnum_TRACK') return [];
    const identifier = optionalString(reference.identifier);
    if (!identifier) throw new Error(`Expected track reference identifier: data_product.references[${index}].identifier`);
    return [identifier];
  });

  const urls = products.flatMap((value) => {
    const product = optionalObject(value);
    if (!product || product.$discriminator !== 'ProductTypeEnum_URI') return [];
    const uriProduct = optionalObject(product.uri);
    const uri = optionalString(uriProduct?.uri);
    return uri ? [uri] : [];
  });

  return {
    id: asString(dataProduct.identifier, 'data_product.identifier'),
    sourceId: asString(header.source, 'header.source'),
    description: optionalString(description?.description) ?? optionalString(description?.name),
    timestamp: parseTimestamp(dataProduct.timestamp) ?? parseTimestamp(header.time_sent) ?? receivedAt,
    trackIds: [...new Set(trackIds)],
    urls: [...new Set(urls)],
    raw: payload,
  };
}

function parsePutValue(envelope: Record<string, unknown>): Record<string, unknown> {
  const body = asObject(envelope.body, 'body');
  const operation = asObject(body.operation, 'body.operation');
  if (operation.$discriminator !== 'DynamicUpdateOperationTypeEnum_PUT_VALUE') {
    throw new Error(`Unsupported dynamic update operation: ${String(operation.$discriminator)}`);
  }
  return asObject(operation.put_value, 'body.operation.put_value');
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
