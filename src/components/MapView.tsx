import { useEffect, useRef, type MutableRefObject } from 'react';
import maplibregl, { type GeoJSONSource, type Map as MapLibreMap } from 'maplibre-gl';
import type { Detection, Drone, DroneTask, GeoPoint, TaskGeometry } from '../models/types';
import { useAppStore } from '../state/useAppStore';

const TASK_GEOMETRY_SOURCE = 'task-geometry';
const DRONE_TRACK_SOURCE = 'drone-track';
const DRONE_MOVEMENT_SOURCE = 'drone-movement';
const COLLISION_WARNING_SOURCE = 'collision-warning';
const DETECTION_SOURCE = 'detections';
const MAX_TRACK_POINTS = 100;
const MOVEMENT_LINE_METRES_PER_METRE_PER_SECOND = 100;
const MIN_MOVEMENT_LINE_METRES = 10;
const MAX_MOVEMENT_LINE_METRES = 1_000;
const MIN_VISIBLE_SPEED_METRES_PER_SECOND = 0.01;
const DEFAULT_COLLISION_WARNING_DISTANCE_METERS = 200;
const configuredCollisionDistance = Number(import.meta.env.VITE_COLLISION_WARNING_DISTANCE_METERS);
const COLLISION_WARNING_DISTANCE_METERS = Number.isFinite(configuredCollisionDistance) && configuredCollisionDistance > 0
  ? configuredCollisionDistance
  : DEFAULT_COLLISION_WARNING_DISTANCE_METERS;
const TASK_LAYERS = ['task-points', 'task-lines', 'task-volume-fill'];
const DETECTION_LAYERS = ['detection-points'];

export function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<globalThis.Map<string, maplibregl.Marker>>(new globalThis.Map());
  const tracksRef = useRef<globalThis.Map<string, GeoPoint[]>>(new globalThis.Map());
  const taskPopupRef = useRef<maplibregl.Popup | null>(null);
  const tasks = useAppStore((state) => state.tasks);
  const taskType = useAppStore((state) => state.taskType);
  const draftPoints = useAppStore((state) => state.draftPoints);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      center: [24.829501, 59.467137],
      zoom: 12,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors',
          },
        },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
      },
    });

    map.addControl(new maplibregl.NavigationControl(), 'top-right');

    let mapLoaded = false;
    let droneRenderFrame: number | undefined;
    let droneSourcesDirty = false;
    let detectionSourceDirty = false;
    const pendingDroneIds = new Set<string>();

    const scheduleDroneRender = () => {
      if (!mapLoaded || droneRenderFrame !== undefined) return;

      droneRenderFrame = globalThis.requestAnimationFrame(() => {
        droneRenderFrame = undefined;
        const state = useAppStore.getState();
        const changedDroneIds = Array.from(pendingDroneIds);
        pendingDroneIds.clear();

        updateDroneMarkers(
          map,
          state.drones,
          state.selectedDroneId,
          changedDroneIds,
          markersRef.current,
          tracksRef.current,
        );

        if (droneSourcesDirty) {
          droneSourcesDirty = false;
          const drones = Object.values(state.drones);
          updateDroneTrackSource(map, tracksRef.current);
          updateDroneMovementSource(map, drones);
          updateCollisionWarningSource(map, drones);
        }

        if (detectionSourceDirty) {
          detectionSourceDirty = false;
          updateDetectionSource(map, Object.values(state.detections));
        }
      });
    };

    const unsubscribe = useAppStore.subscribe((state, previous) => {
      if (state.drones !== previous.drones) {
        const droneIds = new Set([...Object.keys(state.drones), ...Object.keys(previous.drones)]);
        droneIds.forEach((droneId) => {
          if (state.drones[droneId] !== previous.drones[droneId]) pendingDroneIds.add(droneId);
        });
        droneSourcesDirty = true;
      }

      if (state.detections !== previous.detections) detectionSourceDirty = true;

      if (state.selectedDroneId !== previous.selectedDroneId) {
        if (previous.selectedDroneId) pendingDroneIds.add(previous.selectedDroneId);
        if (state.selectedDroneId) pendingDroneIds.add(state.selectedDroneId);
      }

      scheduleDroneRender();
    });

    map.on('load', () => {
      addSourcesAndLayers(map);
      mapLoaded = true;
      Object.keys(useAppStore.getState().drones).forEach((droneId) => pendingDroneIds.add(droneId));
      droneSourcesDirty = true;
      detectionSourceDirty = true;
      scheduleDroneRender();
      updateTaskSource(map, Object.values(useAppStore.getState().tasks), useAppStore.getState().draftPoints, useAppStore.getState().taskType);

      TASK_LAYERS.forEach((layer) => {
        map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
        map.on('click', layer, (event) => {
          const feature = event.features?.[0];
          if (!feature) return;
          event.originalEvent.stopPropagation();
          showPropertiesPopup(map, event.lngLat, feature.properties ?? {}, taskPopupRef, 'Task geometry');
        });
      });

      DETECTION_LAYERS.forEach((layer) => {
        map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
        map.on('click', layer, (event) => {
          const feature = event.features?.[0];
          if (!feature) return;
          event.originalEvent.stopPropagation();
          const detectionId = String(feature.properties?.detectionId ?? '');
          if (detectionId) useAppStore.getState().selectDetection(detectionId);
          showPropertiesPopup(map, event.lngLat, feature.properties ?? {}, taskPopupRef, 'Detection');
        });
      });

      map.on('click', (event) => {
        const state = useAppStore.getState();
        if (!state.taskType) return;
        const clickedTask = map.queryRenderedFeatures(event.point, { layers: TASK_LAYERS }).length > 0;
        const clickedDetection = map.queryRenderedFeatures(event.point, { layers: DETECTION_LAYERS }).length > 0;
        if (clickedTask || clickedDetection) return;
        state.addDraftPoint({ latitude: event.lngLat.lat, longitude: event.lngLat.lng });
      });
    });

    mapRef.current = map;

    return () => {
      unsubscribe();
      if (droneRenderFrame !== undefined) globalThis.cancelAnimationFrame(droneRenderFrame);
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current.clear();
      tracksRef.current.clear();
      taskPopupRef.current?.remove();
      taskPopupRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const update = () => updateTaskSource(map, Object.values(tasks), draftPoints, taskType);
    if (map.isStyleLoaded()) update(); else map.once('load', update);
  }, [draftPoints, taskType, tasks]);

  return <div ref={containerRef} className="map-container" />;
}

function addSourcesAndLayers(map: MapLibreMap): void {
  map.addSource(DRONE_TRACK_SOURCE, { type: 'geojson', data: emptyFeatureCollection() });
  map.addSource(DRONE_MOVEMENT_SOURCE, { type: 'geojson', data: emptyFeatureCollection() });
  map.addSource(COLLISION_WARNING_SOURCE, { type: 'geojson', data: emptyFeatureCollection() });
  map.addSource(DETECTION_SOURCE, { type: 'geojson', data: emptyFeatureCollection() });
  map.addSource(TASK_GEOMETRY_SOURCE, { type: 'geojson', data: emptyFeatureCollection() });

  map.addLayer({
    id: 'collision-warning-fill',
    type: 'fill',
    source: COLLISION_WARNING_SOURCE,
    paint: { 'fill-color': '#ff1744', 'fill-opacity': 0.16 },
  });
  map.addLayer({
    id: 'collision-warning-outline',
    type: 'line',
    source: COLLISION_WARNING_SOURCE,
    paint: { 'line-color': '#d50000', 'line-width': 3, 'line-opacity': 0.9 },
  });
  map.addLayer({
    id: 'drone-tracks',
    type: 'line',
    source: DRONE_TRACK_SOURCE,
    paint: { 'line-width': 3, 'line-opacity': 0.65, 'line-color': '#1976d2' },
  });
  map.addLayer({
    id: 'drone-movement-lines',
    type: 'line',
    source: DRONE_MOVEMENT_SOURCE,
    paint: { 'line-width': 3, 'line-opacity': 0.9, 'line-color': '#00c853' },
  });
  map.addLayer({
    id: 'detection-points',
    type: 'circle',
    source: DETECTION_SOURCE,
    paint: {
      'circle-radius': 9,
      'circle-color': '#8e24aa',
      'circle-stroke-width': 3,
      'circle-stroke-color': '#ffffff',
    },
  });
  map.addLayer({
    id: 'detection-labels',
    type: 'symbol',
    source: DETECTION_SOURCE,
    layout: {
      'text-field': ['get', 'name'],
      'text-offset': [0, 1.4],
      'text-size': 12,
      'text-anchor': 'top',
    },
    paint: { 'text-color': '#4a148c', 'text-halo-color': '#ffffff', 'text-halo-width': 2 },
  });
  map.addLayer({
    id: 'task-volume-fill',
    type: 'fill',
    source: TASK_GEOMETRY_SOURCE,
    paint: {
      'fill-color': ['case', ['==', ['get', 'kind'], 'draft'], '#42a5f5', '#ffb300'],
      'fill-opacity': 0.16,
    },
    filter: ['==', '$type', 'Polygon'],
  });
  map.addLayer({
    id: 'task-volume-outline',
    type: 'line',
    source: TASK_GEOMETRY_SOURCE,
    paint: {
      'line-width': 3,
      'line-color': ['case', ['==', ['get', 'kind'], 'draft'], '#42a5f5', '#ffb300'],
    },
    filter: ['==', '$type', 'Polygon'],
  });
  map.addLayer({
    id: 'task-lines',
    type: 'line',
    source: TASK_GEOMETRY_SOURCE,
    paint: {
      'line-width': 4,
      'line-color': ['case', ['==', ['get', 'kind'], 'draft'], '#42a5f5', '#ffb300'],
      'line-dasharray': ['case', ['==', ['get', 'kind'], 'draft'], ['literal', [2, 1]], ['literal', [1, 0]]],
    },
    filter: ['==', '$type', 'LineString'],
  });
  map.addLayer({
    id: 'task-points',
    type: 'circle',
    source: TASK_GEOMETRY_SOURCE,
    paint: {
      'circle-radius': ['case', ['==', ['get', 'kind'], 'draft'], 7, 9],
      'circle-color': ['case', ['==', ['get', 'kind'], 'draft'], '#42a5f5', '#ffb300'],
      'circle-stroke-width': 2,
      'circle-stroke-color': '#111',
    },
    filter: ['==', '$type', 'Point'],
  });
}

function updateTaskSource(map: MapLibreMap, tasks: DroneTask[], draftPoints: GeoPoint[], taskType: string | undefined): void {
  const source = map.getSource(TASK_GEOMETRY_SOURCE) as GeoJSONSource | undefined;
  source?.setData({ type: 'FeatureCollection', features: buildTaskFeatures(tasks, draftPoints, taskType) });
}

function updateDetectionSource(map: MapLibreMap, detections: Detection[]): void {
  const source = map.getSource(DETECTION_SOURCE) as GeoJSONSource | undefined;
  const now = Date.now();
  const features = detections
    .filter((detection) => detection.validUntil === undefined || detection.validUntil >= now)
    .map((detection) => pointFeature(detection.position, {
      detectionId: detection.id,
      name: detection.name,
      sourceId: detection.sourceId,
      identity: detection.standardIdentity,
      symbolSet: detection.symbolSet,
      organization: detection.organization,
      nationality: detection.nationality,
      trackPhase: detection.trackPhase,
      timestamp: new Date(detection.timestamp).toISOString(),
      validUntil: detection.validUntil === undefined ? undefined : new Date(detection.validUntil).toISOString(),
      rtspUrl: detection.rtspUrl,
    }));
  source?.setData({ type: 'FeatureCollection', features });
}

function updateCollisionWarningSource(map: MapLibreMap, drones: Drone[]): void {
  const source = map.getSource(COLLISION_WARNING_SOURCE) as GeoJSONSource | undefined;
  const positioned = drones.filter((drone): drone is Drone & { position: GeoPoint } => Boolean(drone.position));
  const conflicts = new Map<string, { drone: Drone & { position: GeoPoint }; nearestName: string; nearestDistance: number }>();

  for (let leftIndex = 0; leftIndex < positioned.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < positioned.length; rightIndex += 1) {
      const left = positioned[leftIndex];
      const right = positioned[rightIndex];
      const distance = distanceMeters(left.position, right.position);
      if (distance > COLLISION_WARNING_DISTANCE_METERS) continue;
      recordConflict(conflicts, left, right.name, distance);
      recordConflict(conflicts, right, left.name, distance);
    }
  }

  const features = Array.from(conflicts.values()).map(({ drone, nearestName, nearestDistance }) =>
    circleFeature(drone.position, COLLISION_WARNING_DISTANCE_METERS, {
      droneId: drone.id,
      droneName: drone.name,
      nearestDrone: nearestName,
      nearestDistanceMeters: Math.round(nearestDistance * 10) / 10,
      thresholdMeters: COLLISION_WARNING_DISTANCE_METERS,
    }));
  source?.setData({ type: 'FeatureCollection', features });
}

function recordConflict(
  conflicts: Map<string, { drone: Drone & { position: GeoPoint }; nearestName: string; nearestDistance: number }>,
  drone: Drone & { position: GeoPoint },
  otherName: string,
  distance: number,
): void {
  const existing = conflicts.get(drone.id);
  if (!existing || distance < existing.nearestDistance) conflicts.set(drone.id, { drone, nearestName: otherName, nearestDistance: distance });
}

function updateDroneMarkers(
  map: MapLibreMap,
  drones: Record<string, Drone>,
  selectedDroneId: string | undefined,
  droneIds: Iterable<string>,
  markers: globalThis.Map<string, maplibregl.Marker>,
  tracks: globalThis.Map<string, GeoPoint[]>,
): void {
  for (const droneId of droneIds) {
    const drone = drones[droneId];
    const existing = markers.get(droneId);

    if (!drone?.position) {
      existing?.remove();
      markers.delete(droneId);
      tracks.delete(droneId);
      continue;
    }

    appendTrackPoint(tracks, droneId, drone.position);

    if (existing) {
      existing.setLngLat([drone.position.longitude, drone.position.latitude]);
      existing.setRotation(drone.heading);
      existing.getElement().dataset.selected = String(droneId === selectedDroneId);
      existing.getElement().title = drone.name;
      continue;
    }

    const element = document.createElement('button');
    element.className = 'drone-marker';
    element.type = 'button';
    element.title = drone.name;
    element.dataset.selected = String(droneId === selectedDroneId);
    element.innerHTML = '▲';
    element.addEventListener('click', (event) => {
      event.stopPropagation();
      useAppStore.getState().selectDrone(droneId);
    });

    markers.set(droneId, new maplibregl.Marker({ element, rotationAlignment: 'map', rotation: drone.heading })
      .setLngLat([drone.position.longitude, drone.position.latitude])
      .addTo(map));
  }
}

function appendTrackPoint(tracks: globalThis.Map<string, GeoPoint[]>, droneId: string, point: GeoPoint): void {
  const existing = tracks.get(droneId) ?? [];
  const previous = existing.at(-1);
  if (previous?.latitude === point.latitude && previous.longitude === point.longitude) return;
  tracks.set(droneId, [...existing, point].slice(-MAX_TRACK_POINTS));
}

function updateDroneTrackSource(map: MapLibreMap, tracks: globalThis.Map<string, GeoPoint[]>): void {
  const source = map.getSource(DRONE_TRACK_SOURCE) as GeoJSONSource | undefined;
  const features: GeoJSON.Feature<GeoJSON.LineString>[] = [];
  tracks.forEach((points, droneId) => {
    if (points.length >= 2) features.push(lineFeature(points, { droneId }));
  });
  source?.setData({ type: 'FeatureCollection', features });
}

function updateDroneMovementSource(map: MapLibreMap, drones: Drone[]): void {
  const source = map.getSource(DRONE_MOVEMENT_SOURCE) as GeoJSONSource | undefined;
  const features = drones.flatMap((drone): GeoJSON.Feature<GeoJSON.LineString>[] => {
    if (!drone.position || drone.groundSpeed < MIN_VISIBLE_SPEED_METRES_PER_SECOND) return [];
    const distance = Math.min(MAX_MOVEMENT_LINE_METRES, Math.max(MIN_MOVEMENT_LINE_METRES, drone.groundSpeed * MOVEMENT_LINE_METRES_PER_METRE_PER_SECOND));
    return [lineFeature([drone.position, destinationPoint(drone.position, drone.course ?? drone.heading, distance)], { droneId: drone.id })];
  });
  source?.setData({ type: 'FeatureCollection', features });
}

function buildTaskFeatures(tasks: DroneTask[], draftPoints: GeoPoint[], taskType: string | undefined): GeoJSON.Feature[] {
  const features: GeoJSON.Feature[] = [];

  if (taskType && draftPoints.length > 0) {
    draftPoints.forEach((point, index) => features.push(pointFeature(point, { kind: 'draft', label: `Draft point ${index + 1}`, taskType })));
    if (draftPoints.length >= 2) features.push(lineFeature(draftPoints, { kind: 'draft', label: `${taskType} draft`, taskType }));
  }

  tasks
    .filter((task) => !['COMPLETED', 'CANCELLED'].includes(task.state))
    .forEach((task) => features.push(...geometryFeatures(task.geometry, {
      kind: 'task',
      label: `${task.type} ${task.geometry.type}`,
      taskId: task.id,
      taskType: task.type,
      state: task.state,
      percentComplete: task.percentComplete,
    })));

  return features;
}

function geometryFeatures(geometry: TaskGeometry, properties: Record<string, unknown>): GeoJSON.Feature[] {
  switch (geometry.type) {
    case 'POINT': return [pointFeature(geometry.point, properties)];
    case 'CIRCLE': return [pointFeature(geometry.centre, { ...properties, radiusMeters: geometry.radiusMeters }), circleFeature(geometry.centre, geometry.radiusMeters, properties)];
    case 'LINE': return [...geometry.points.map((point, index) => pointFeature(point, { ...properties, pointIndex: index + 1 })), lineFeature(geometry.points, properties)];
    case 'RECTANGLE':
    case 'POLYGON': return [...geometry.points.map((point, index) => pointFeature(point, { ...properties, pointIndex: index + 1 })), polygonFeature(geometry.points, properties)];
    case 'CORRIDOR': return [...geometry.centreLine.map((point, index) => pointFeature(point, { ...properties, pointIndex: index + 1, widthMeters: geometry.widthMeters })), lineFeature(geometry.centreLine, { ...properties, widthMeters: geometry.widthMeters })];
  }
}

function pointFeature(point: GeoPoint, properties: Record<string, unknown>): GeoJSON.Feature<GeoJSON.Point> {
  return {
    type: 'Feature',
    properties: { ...properties, latitude: point.latitude, longitude: point.longitude, altitude: point.altitude },
    geometry: { type: 'Point', coordinates: [point.longitude, point.latitude] },
  };
}

function lineFeature(points: GeoPoint[], properties: Record<string, unknown>): GeoJSON.Feature<GeoJSON.LineString> {
  return { type: 'Feature', properties, geometry: { type: 'LineString', coordinates: points.map((point) => [point.longitude, point.latitude]) } };
}

function polygonFeature(points: GeoPoint[], properties: Record<string, unknown>): GeoJSON.Feature<GeoJSON.Polygon> {
  const closed = closeRing(points);
  return { type: 'Feature', properties, geometry: { type: 'Polygon', coordinates: [closed.map((point) => [point.longitude, point.latitude])] } };
}

function circleFeature(centre: GeoPoint, radiusMeters: number, properties: Record<string, unknown>): GeoJSON.Feature<GeoJSON.Polygon> {
  const points = Array.from({ length: 65 }, (_, index) => destinationPoint(centre, index / 64 * 360, radiusMeters));
  return polygonFeature(points, { ...properties, radiusMeters, latitude: centre.latitude, longitude: centre.longitude });
}

function closeRing(points: GeoPoint[]): GeoPoint[] {
  if (points.length === 0) return points;
  const first = points[0];
  const last = points.at(-1)!;
  return first.latitude === last.latitude && first.longitude === last.longitude ? points : [...points, first];
}

function destinationPoint(start: GeoPoint, bearingDegrees: number, distanceMeters: number): GeoPoint {
  const earthRadius = 6_371_008.8;
  const angularDistance = distanceMeters / earthRadius;
  const bearing = bearingDegrees * Math.PI / 180;
  const latitude = start.latitude * Math.PI / 180;
  const longitude = start.longitude * Math.PI / 180;
  const destinationLatitude = Math.asin(Math.sin(latitude) * Math.cos(angularDistance) + Math.cos(latitude) * Math.sin(angularDistance) * Math.cos(bearing));
  const destinationLongitude = longitude + Math.atan2(Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitude), Math.cos(angularDistance) - Math.sin(latitude) * Math.sin(destinationLatitude));
  return { latitude: destinationLatitude * 180 / Math.PI, longitude: destinationLongitude * 180 / Math.PI, altitude: start.altitude };
}

function distanceMeters(left: GeoPoint, right: GeoPoint): number {
  const earthRadius = 6_371_008.8;
  const latitudeDelta = (right.latitude - left.latitude) * Math.PI / 180;
  const longitudeDelta = (right.longitude - left.longitude) * Math.PI / 180;
  const leftLatitude = left.latitude * Math.PI / 180;
  const rightLatitude = right.latitude * Math.PI / 180;
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(leftLatitude) * Math.cos(rightLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function showPropertiesPopup(
  map: MapLibreMap,
  lngLat: maplibregl.LngLat,
  properties: Record<string, unknown>,
  popupRef: MutableRefObject<maplibregl.Popup | null>,
  fallbackTitle: string,
): void {
  popupRef.current?.remove();
  const root = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = String(properties.label ?? properties.name ?? fallbackTitle);
  root.appendChild(title);
  const table = document.createElement('table');
  Object.entries(properties).forEach(([key, value]) => {
    if (value === undefined || value === null || key === 'kind' || key === 'label' || key === 'name') return;
    const row = table.insertRow();
    row.insertCell().textContent = key;
    row.insertCell().textContent = String(value);
  });
  root.appendChild(table);
  popupRef.current = new maplibregl.Popup({ closeButton: true, maxWidth: '360px' }).setLngLat(lngLat).setDOMContent(root).addTo(map);
}

function emptyFeatureCollection(): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}
