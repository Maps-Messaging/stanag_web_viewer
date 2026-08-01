import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import maplibregl, { type GeoJSONSource, type Map as MapLibreMap } from 'maplibre-gl';
import type { Detection, Drone, DroneTask, GeoPoint, TaskGeometry } from '../models/types';
import {
  hasImmediateCollisionRisk,
  mobilityDomain,
  predictCollisions,
  type CollisionPredictionConfiguration,
  type PredictedCollision,
} from '../services/collisionPrediction';
import { formatIso8601Duration } from '../services/taskDuration';
import { useAppStore } from '../state/useAppStore';

const TASK_GEOMETRY_SOURCE = 'task-geometry';
const DRONE_TRACK_SOURCE = 'drone-track';
const DRONE_MOVEMENT_SOURCE = 'drone-movement';
const COLLISION_WARNING_SOURCE = 'collision-warning';
const PREDICTED_COLLISION_DRONE_SOURCE = 'predicted-collision-drones';
const PREDICTED_COLLISION_POINT_SOURCE = 'predicted-collision-points';
const DETECTION_SOURCE = 'detections';
const MAX_TRACK_POINTS = 100;
const MOVEMENT_LINE_METRES_PER_METRE_PER_SECOND = 100;
const MIN_MOVEMENT_LINE_METRES = 10;
const MAX_MOVEMENT_LINE_METRES = 1_000;
const MIN_VISIBLE_SPEED_METRES_PER_SECOND = 0.01;
const DEFAULT_COLLISION_WARNING_DISTANCE_METERS = 200;
const DEFAULT_COLLISION_LOOK_AHEAD_SECONDS = 300;
const DEFAULT_COLLISION_VERTICAL_DISTANCE_METERS = 30;
const DEFAULT_SURFACE_INTERACTION_ALTITUDE_METERS = 20;
const configuredCollisionDistance = positiveNumber(import.meta.env.VITE_COLLISION_WARNING_DISTANCE_METERS, DEFAULT_COLLISION_WARNING_DISTANCE_METERS);
const COLLISION_WARNING_DISTANCE_METERS = configuredCollisionDistance;
const COLLISION_PREDICTION_CONFIGURATION: CollisionPredictionConfiguration = {
  lookAheadSeconds: positiveNumber(import.meta.env.VITE_COLLISION_LOOK_AHEAD_SECONDS, DEFAULT_COLLISION_LOOK_AHEAD_SECONDS),
  horizontalThresholdMeters: positiveNumber(import.meta.env.VITE_COLLISION_PREDICTION_DISTANCE_METERS, configuredCollisionDistance),
  verticalThresholdMeters: positiveNumber(import.meta.env.VITE_COLLISION_VERTICAL_DISTANCE_METERS, DEFAULT_COLLISION_VERTICAL_DISTANCE_METERS),
  surfaceInteractionAltitudeMeters: positiveNumber(import.meta.env.VITE_SURFACE_INTERACTION_ALTITUDE_METERS, DEFAULT_SURFACE_INTERACTION_ALTITUDE_METERS),
  minimumSpeedMetersPerSecond: MIN_VISIBLE_SPEED_METRES_PER_SECOND,
};
const TASK_LAYERS = ['task-points', 'task-lines', 'task-volume-fill'];
const DETECTION_LAYERS = ['detection-points'];
const PREDICTED_COLLISION_LAYERS = ['predicted-collision-points', 'predicted-collision-drone-outline'];
const CURRENT_TASK_STATES = new Set([
  'DRAFT',
  'SUBMITTED',
  'PENDING',
  'ACCEPTED',
  'ACTIVE',
  'EXECUTING',
  'CANCEL_REQUESTED',
  'PREEMPTING',
]);

export function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<globalThis.Map<string, maplibregl.Marker>>(new globalThis.Map());
  const tracksRef = useRef<globalThis.Map<string, GeoPoint[]>>(new globalThis.Map());
  const taskPopupRef = useRef<maplibregl.Popup | null>(null);
  const followSelectedRef = useRef(false);
  const initialFitDoneRef = useRef(false);
  const [followSelected, setFollowSelected] = useState(false);
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
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-left');


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

        updateDroneMarkers(map, state.drones, state.selectedDroneId, changedDroneIds, markersRef.current, tracksRef.current);
        if (!initialFitDoneRef.current) {
          initialFitDoneRef.current = fitVehicles(map, Object.values(state.drones));
        }
        if (followSelectedRef.current && state.selectedDroneId) {
          const selected = state.drones[state.selectedDroneId];
          if (selected?.position) map.easeTo({ center: [selected.position.longitude, selected.position.latitude], duration: 250 });
        }

        if (droneSourcesDirty) {
          droneSourcesDirty = false;
          const drones = Object.values(state.drones);
          updateDroneTrackSource(map, tracksRef.current);
          updateDroneMovementSource(map, drones);
          updateCollisionSources(map, drones);
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

      TASK_LAYERS.forEach((layer) => registerPopupLayer(map, layer, taskPopupRef, 'Task geometry'));
      DETECTION_LAYERS.forEach((layer) => registerDetectionLayer(map, layer, taskPopupRef));
      PREDICTED_COLLISION_LAYERS.forEach((layer) => registerPopupLayer(map, layer, taskPopupRef, 'Predicted collision'));

      map.on('click', (event) => {
        const state = useAppStore.getState();
        if (!state.taskType) return;
        const excludedLayers = [...TASK_LAYERS, ...DETECTION_LAYERS, ...PREDICTED_COLLISION_LAYERS];
        if (map.queryRenderedFeatures(event.point, { layers: excludedLayers }).length > 0) return;
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

  function showFleet(): void {
    const map = mapRef.current;
    if (map) fitVehicles(map, Object.values(useAppStore.getState().drones), true);
  }

  function centreSelected(): void {
    const map = mapRef.current;
    const state = useAppStore.getState();
    const selected = state.selectedDroneId ? state.drones[state.selectedDroneId] : undefined;
    if (map && selected?.position) map.easeTo({ center: [selected.position.longitude, selected.position.latitude], zoom: Math.max(map.getZoom(), 14) });
  }

  function toggleFollow(): void {
    const next = !followSelectedRef.current;
    followSelectedRef.current = next;
    setFollowSelected(next);
    if (next) centreSelected();
  }

  return (
    <div className="map-wrapper">
      <div ref={containerRef} className="map-container" />
      <div className="map-toolbar" aria-label="Map navigation">
        <button type="button" onClick={showFleet}>Fit vehicles</button>
        <button type="button" onClick={centreSelected}>Centre selected</button>
        <button type="button" data-active={followSelected} onClick={toggleFollow}>Follow selected</button>
      </div>
      <div className="map-legend">
        <strong>Map</strong>
        <span><i data-kind="vehicle" />Vehicle</span>
        <span><i data-kind="detection" />Detection</span>
        <span><i data-kind="waypoint" />Waypoint</span>
        <span><i data-kind="current-task" />Current task</span>
        <span><i data-kind="previous-task" />Previous task</span>
        <span><i data-kind="movement" />Movement</span>
        <span><i data-kind="immediate" />Immediate conflict</span>
        <span><i data-kind="predicted" />Predicted conflict</span>
      </div>
    </div>
  );
}

function registerPopupLayer(map: MapLibreMap, layer: string, popupRef: MutableRefObject<maplibregl.Popup | null>, fallbackTitle: string): void {
  map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
  map.on('click', layer, (event) => {
    const feature = event.features?.[0];
    if (!feature) return;
    event.originalEvent.stopPropagation();
    showPropertiesPopup(map, event.lngLat, feature.properties ?? {}, popupRef, fallbackTitle);
  });
}

function registerDetectionLayer(map: MapLibreMap, layer: string, popupRef: MutableRefObject<maplibregl.Popup | null>): void {
  map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
  map.on('click', layer, (event) => {
    const feature = event.features?.[0];
    if (!feature) return;
    event.originalEvent.stopPropagation();
    const detectionId = String(feature.properties?.detectionId ?? '');
    if (detectionId) useAppStore.getState().selectDetection(detectionId);
    showPropertiesPopup(map, event.lngLat, feature.properties ?? {}, popupRef, 'Detection');
  });
}

function addSourcesAndLayers(map: MapLibreMap): void {
  map.addSource(DRONE_TRACK_SOURCE, { type: 'geojson', data: emptyFeatureCollection() });
  map.addSource(DRONE_MOVEMENT_SOURCE, { type: 'geojson', data: emptyFeatureCollection() });
  map.addSource(COLLISION_WARNING_SOURCE, { type: 'geojson', data: emptyFeatureCollection() });
  map.addSource(PREDICTED_COLLISION_DRONE_SOURCE, { type: 'geojson', data: emptyFeatureCollection() });
  map.addSource(PREDICTED_COLLISION_POINT_SOURCE, { type: 'geojson', data: emptyFeatureCollection() });
  map.addSource(DETECTION_SOURCE, { type: 'geojson', data: emptyFeatureCollection() });
  map.addSource(TASK_GEOMETRY_SOURCE, { type: 'geojson', data: emptyFeatureCollection() });

  map.addLayer({ id: 'predicted-collision-drone-fill', type: 'fill', source: PREDICTED_COLLISION_DRONE_SOURCE, paint: { 'fill-color': '#ff9800', 'fill-opacity': 0.12 } });
  map.addLayer({ id: 'predicted-collision-drone-outline', type: 'line', source: PREDICTED_COLLISION_DRONE_SOURCE, paint: { 'line-color': '#ff9800', 'line-width': 3, 'line-opacity': 0.95 } });
  map.addLayer({ id: 'collision-warning-fill', type: 'fill', source: COLLISION_WARNING_SOURCE, paint: { 'fill-color': '#ff1744', 'fill-opacity': 0.20 } });
  map.addLayer({ id: 'collision-warning-outline', type: 'line', source: COLLISION_WARNING_SOURCE, paint: { 'line-color': '#d50000', 'line-width': 4, 'line-opacity': 1 } });
  map.addLayer({ id: 'drone-tracks', type: 'line', source: DRONE_TRACK_SOURCE, paint: { 'line-width': 3, 'line-opacity': 0.65, 'line-color': '#1976d2' } });
  map.addLayer({ id: 'drone-movement-lines', type: 'line', source: DRONE_MOVEMENT_SOURCE, paint: { 'line-width': 3, 'line-opacity': 0.9, 'line-color': '#00c853' } });
  map.addLayer({ id: 'predicted-collision-points', type: 'circle', source: PREDICTED_COLLISION_POINT_SOURCE, paint: { 'circle-radius': 10, 'circle-color': '#d50000', 'circle-stroke-width': 3, 'circle-stroke-color': '#ffffff' } });
  map.addLayer({ id: 'detection-points', type: 'circle', source: DETECTION_SOURCE, paint: { 'circle-radius': 9, 'circle-color': '#8e24aa', 'circle-stroke-width': 3, 'circle-stroke-color': '#ffffff' } });
  map.addLayer({ id: 'detection-labels', type: 'symbol', source: DETECTION_SOURCE, layout: { 'text-field': ['get', 'name'], 'text-offset': [0, 1.4], 'text-size': 12, 'text-anchor': 'top' }, paint: { 'text-color': '#4a148c', 'text-halo-color': '#ffffff', 'text-halo-width': 2 } });
  map.addLayer({
    id: 'task-volume-fill',
    type: 'fill',
    source: TASK_GEOMETRY_SOURCE,
    paint: {
      'fill-color': taskColourExpression(),
      'fill-opacity': ['case', ['==', ['get', 'displayState'], 'previous'], 0.08, 0.16],
    },
    filter: ['==', '$type', 'Polygon'],
  });
  map.addLayer({
    id: 'task-volume-outline',
    type: 'line',
    source: TASK_GEOMETRY_SOURCE,
    paint: {
      'line-width': ['case', ['==', ['get', 'displayState'], 'previous'], 2, 3],
      'line-color': taskColourExpression(),
      'line-opacity': ['case', ['==', ['get', 'displayState'], 'previous'], 0.65, 1],
    },
    filter: ['==', '$type', 'Polygon'],
  });
  map.addLayer({
    id: 'task-lines',
    type: 'line',
    source: TASK_GEOMETRY_SOURCE,
    paint: {
      'line-width': ['case', ['==', ['get', 'displayState'], 'previous'], 2, 4],
      'line-color': taskColourExpression(),
      'line-opacity': ['case', ['==', ['get', 'displayState'], 'previous'], 0.65, 1],
      'line-dasharray': [
        'case',
        ['==', ['get', 'kind'], 'draft'],
        ['literal', [2, 1]],
        ['==', ['get', 'displayState'], 'previous'],
        ['literal', [1, 1]],
        ['literal', [1, 0]],
      ],
    },
    filter: ['==', '$type', 'LineString'],
  });
  map.addLayer({
    id: 'task-points',
    type: 'circle',
    source: TASK_GEOMETRY_SOURCE,
    paint: {
      'circle-radius': [
        'case',
        ['==', ['get', 'kind'], 'draft'],
        7,
        ['==', ['get', 'displayState'], 'previous'],
        6,
        9,
      ],
      'circle-color': taskColourExpression(),
      'circle-opacity': ['case', ['==', ['get', 'displayState'], 'previous'], 0.75, 1],
      'circle-stroke-width': 2,
      'circle-stroke-color': '#111',
    },
    filter: ['==', '$type', 'Point'],
  });
}

function taskColourExpression(): maplibregl.ExpressionSpecification {
  return [
    'case',
    ['==', ['get', 'kind'], 'draft'],
    '#42a5f5',
    ['==', ['get', 'displayState'], 'previous'],
    '#78909c',
    '#ffb300',
  ];
}

function updateTaskSource(map: MapLibreMap, tasks: DroneTask[], draftPoints: GeoPoint[], taskType: string | undefined): void {
  const source = map.getSource(TASK_GEOMETRY_SOURCE) as GeoJSONSource | undefined;
  source?.setData({ type: 'FeatureCollection', features: buildTaskFeatures(tasks, draftPoints, taskType) });
}

function updateDetectionSource(map: MapLibreMap, detections: Detection[]): void {
  const source = map.getSource(DETECTION_SOURCE) as GeoJSONSource | undefined;
  const now = Date.now();
  const features = detections.filter((detection) => detection.validUntil === undefined || detection.validUntil >= now).map((detection) => pointFeature(detection.position, {
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

function updateCollisionSources(map: MapLibreMap, drones: Drone[]): void {
  const immediateSource = map.getSource(COLLISION_WARNING_SOURCE) as GeoJSONSource | undefined;
  const predictedDroneSource = map.getSource(PREDICTED_COLLISION_DRONE_SOURCE) as GeoJSONSource | undefined;
  const predictedPointSource = map.getSource(PREDICTED_COLLISION_POINT_SOURCE) as GeoJSONSource | undefined;
  const positioned = drones.filter((drone): drone is Drone & { position: GeoPoint } => Boolean(drone.position) && !drone.stale);
  const immediateConflicts = new Map<string, { drone: Drone & { position: GeoPoint }; nearestName: string; nearestDistance: number }>();

  for (let leftIndex = 0; leftIndex < positioned.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < positioned.length; rightIndex += 1) {
      const left = positioned[leftIndex];
      const right = positioned[rightIndex];
      const distance = distanceMeters(left.position, right.position);
      if (distance > COLLISION_WARNING_DISTANCE_METERS) continue;
      if (!hasImmediateCollisionRisk(left, right, COLLISION_PREDICTION_CONFIGURATION)) continue;
      recordConflict(immediateConflicts, left, right.name, distance);
      recordConflict(immediateConflicts, right, left.name, distance);
    }
  }

  const immediateDroneIds = new Set(immediateConflicts.keys());
  const immediateFeatures = Array.from(immediateConflicts.values()).map(({ drone, nearestName, nearestDistance }) => circleFeature(drone.position, COLLISION_WARNING_DISTANCE_METERS, {
    label: `Immediate collision warning: ${drone.name}`,
    droneId: drone.id,
    droneName: drone.name,
    nearestDrone: nearestName,
    nearestDistanceMeters: round(nearestDistance),
    thresholdMeters: COLLISION_WARNING_DISTANCE_METERS,
    priority: 'IMMEDIATE',
  }));
  immediateSource?.setData({ type: 'FeatureCollection', features: immediateFeatures });

  const predictions = predictCollisions(drones, immediateDroneIds, COLLISION_PREDICTION_CONFIGURATION);
  predictedDroneSource?.setData({ type: 'FeatureCollection', features: predictedDroneFeatures(predictions, positioned) });
  predictedPointSource?.setData({ type: 'FeatureCollection', features: predictions.map(predictedCollisionPointFeature) });
}

function predictedDroneFeatures(predictions: PredictedCollision[], drones: Array<Drone & { position: GeoPoint }>): GeoJSON.Feature[] {
  const byId = new Map(drones.map((drone) => [drone.id, drone]));
  const nearest = new Map<string, PredictedCollision>();

  predictions.forEach((prediction) => {
    storeSoonestPrediction(nearest, prediction.leftDroneId, prediction);
    storeSoonestPrediction(nearest, prediction.rightDroneId, prediction);
  });

  return Array.from(nearest.entries()).flatMap(([droneId, prediction]) => {
    const drone = byId.get(droneId);
    if (!drone) return [];
    const otherName = prediction.leftDroneId === droneId ? prediction.rightDroneName : prediction.leftDroneName;
    return [circleFeature(drone.position, COLLISION_PREDICTION_CONFIGURATION.horizontalThresholdMeters, {
      label: `Predicted collision warning: ${drone.name}`,
      droneId,
      droneName: drone.name,
      otherDrone: otherName,
      timeToClosestApproachSeconds: round(prediction.timeToClosestApproachSeconds),
      horizontalSeparationMeters: round(prediction.horizontalSeparationMeters),
      verticalSeparationMeters: prediction.verticalSeparationMeters === undefined ? undefined : round(prediction.verticalSeparationMeters),
      priority: 'PREDICTED',
    })];
  });
}

function predictedCollisionPointFeature(prediction: PredictedCollision): GeoJSON.Feature<GeoJSON.Point> {
  return pointFeature(prediction.collisionPoint, {
    label: `${prediction.leftDroneName} ↔ ${prediction.rightDroneName}`,
    leftDrone: prediction.leftDroneName,
    leftDomain: prediction.leftDomain,
    rightDrone: prediction.rightDroneName,
    rightDomain: prediction.rightDomain,
    timeToClosestApproachSeconds: round(prediction.timeToClosestApproachSeconds),
    horizontalSeparationMeters: round(prediction.horizontalSeparationMeters),
    verticalSeparationMeters: prediction.verticalSeparationMeters === undefined ? undefined : round(prediction.verticalSeparationMeters),
    lookAheadSeconds: COLLISION_PREDICTION_CONFIGURATION.lookAheadSeconds,
    priority: 'PREDICTED',
  });
}

function storeSoonestPrediction(target: Map<string, PredictedCollision>, droneId: string, candidate: PredictedCollision): void {
  const current = target.get(droneId);
  if (!current || candidate.timeToClosestApproachSeconds < current.timeToClosestApproachSeconds) target.set(droneId, candidate);
}

function recordConflict(conflicts: Map<string, { drone: Drone & { position: GeoPoint }; nearestName: string; nearestDistance: number }>, drone: Drone & { position: GeoPoint }, otherName: string, distance: number): void {
  const existing = conflicts.get(drone.id);
  if (!existing || distance < existing.nearestDistance) conflicts.set(drone.id, { drone, nearestName: otherName, nearestDistance: distance });
}

function updateDroneMarkers(map: MapLibreMap, drones: Record<string, Drone>, selectedDroneId: string | undefined, droneIds: Iterable<string>, markers: globalThis.Map<string, maplibregl.Marker>, tracks: globalThis.Map<string, GeoPoint[]>): void {
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
      existing.getElement().dataset.stale = String(Boolean(drone.stale));
      existing.getElement().dataset.domain = mobilityDomain(drone).toLowerCase();
      existing.getElement().title = drone.name;
      continue;
    }
    const element = document.createElement('button');
    element.className = 'drone-marker';
    element.type = 'button';
    element.title = drone.name;
    element.dataset.selected = String(droneId === selectedDroneId);
    element.dataset.stale = String(Boolean(drone.stale));
    element.dataset.domain = mobilityDomain(drone).toLowerCase();
    element.innerHTML = '▲';
    element.addEventListener('click', (event) => { event.stopPropagation(); useAppStore.getState().selectDrone(droneId); });
    markers.set(droneId, new maplibregl.Marker({ element, rotationAlignment: 'map', rotation: drone.heading }).setLngLat([drone.position.longitude, drone.position.latitude]).addTo(map));
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
  tracks.forEach((points, droneId) => { if (points.length >= 2) features.push(lineFeature(points, { droneId })); });
  source?.setData({ type: 'FeatureCollection', features });
}

function updateDroneMovementSource(map: MapLibreMap, drones: Drone[]): void {
  const source = map.getSource(DRONE_MOVEMENT_SOURCE) as GeoJSONSource | undefined;
  const features = drones.flatMap((drone): GeoJSON.Feature<GeoJSON.LineString>[] => {
    if (!drone.position || drone.stale || drone.groundSpeed < MIN_VISIBLE_SPEED_METRES_PER_SECOND) return [];
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

  visibleTasks(tasks).forEach(({ task, displayState }) => {
    features.push(...geometryFeatures(task.geometry, {
      kind: 'task',
      displayState,
      label: displayState === 'current'
        ? `${task.type} ${task.geometry.type}`
        : `Previous ${task.type} ${task.geometry.type}`,
      taskId: task.id,
      droneId: task.droneId,
      taskType: task.type,
      state: task.state,
      duration: formatIso8601Duration(task.duration),
      percentComplete: task.percentComplete,
      updatedAt: new Date(task.updatedAt).toISOString(),
    }));
  });

  return features;
}

function visibleTasks(tasks: DroneTask[]): Array<{ task: DroneTask; displayState: 'current' | 'previous' }> {
  const byDrone = new Map<string, DroneTask[]>();

  tasks.forEach((task) => {
    if (task.state === 'REJECTED') return;
    const droneTasks = byDrone.get(task.droneId) ?? [];
    droneTasks.push(task);
    byDrone.set(task.droneId, droneTasks);
  });

  const visible: Array<{ task: DroneTask; displayState: 'current' | 'previous' }> = [];
  byDrone.forEach((droneTasks) => {
    const ordered = [...droneTasks].sort(compareTasksNewestFirst);
    const current = ordered.find((task) => CURRENT_TASK_STATES.has(task.state));
    if (current) visible.push({ task: current, displayState: 'current' });

    const previous = ordered.find((task) => task.id !== current?.id);
    if (previous) visible.push({ task: previous, displayState: 'previous' });
  });

  return visible;
}

function compareTasksNewestFirst(left: DroneTask, right: DroneTask): number {
  const updatedDifference = right.updatedAt - left.updatedAt;
  return updatedDifference !== 0 ? updatedDifference : right.createdAt - left.createdAt;
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
  return { type: 'Feature', properties: { ...properties, latitude: point.latitude, longitude: point.longitude, altitude: point.altitude }, geometry: { type: 'Point', coordinates: [point.longitude, point.latitude] } };
}

function lineFeature(points: GeoPoint[], properties: Record<string, unknown>): GeoJSON.Feature<GeoJSON.LineString> {
  return { type: 'Feature', properties, geometry: { type: 'LineString', coordinates: points.map((point) => [point.longitude, point.latitude]) } };
}

function polygonFeature(
  points: GeoPoint[],
  properties: Record<string, unknown>,
): GeoJSON.Feature<GeoJSON.Polygon> {
  const closed = closeRing(points);
  return {
    type: 'Feature',
    properties,
    geometry: {
      type: 'Polygon',
      coordinates: [closed.map((point) => [point.longitude, point.latitude])],
    },
  };
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

function destinationPoint(start: GeoPoint, bearingDegrees: number, distanceMetersValue: number): GeoPoint {
  const earthRadius = 6_371_008.8;
  const angularDistance = distanceMetersValue / earthRadius;
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
  const haversine = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(leftLatitude) * Math.cos(rightLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function showPropertiesPopup(map: MapLibreMap, lngLat: maplibregl.LngLat, properties: Record<string, unknown>, popupRef: MutableRefObject<maplibregl.Popup | null>, fallbackTitle: string): void {
  popupRef.current?.remove();
  const root = document.createElement('div');
  root.className = 'task-popup';
  const title = document.createElement('strong');
  title.textContent = String(properties.label ?? properties.name ?? fallbackTitle);
  root.appendChild(title);
  const table = document.createElement('table');
  Object.entries(properties).forEach(([key, value]) => {
    if (value === undefined || value === null || key === 'kind' || key === 'label' || key === 'name') return;
    const row = table.insertRow();
    row.insertCell().textContent = popupLabel(key);
    row.insertCell().textContent = popupValue(key, value);
  });
  root.appendChild(table);
  popupRef.current = new maplibregl.Popup({ closeButton: true, maxWidth: '360px' }).setLngLat(lngLat).setDOMContent(root).addTo(map);
}

function popupLabel(key: string): string {
  const labels: Record<string, string> = {
    taskId: 'Task ID', droneId: 'Vehicle ID', taskType: 'Task', state: 'State', duration: 'Duration',
    percentComplete: 'Complete', updatedAt: 'Updated', radiusMeters: 'Radius', widthMeters: 'Width',
    nearestDrone: 'Nearest vehicle', nearestDistanceMeters: 'Distance', thresholdMeters: 'Threshold',
    timeToClosestApproachSeconds: 'Closest approach in', horizontalSeparationMeters: 'Horizontal separation',
    verticalSeparationMeters: 'Vertical separation', lookAheadSeconds: 'Look-ahead', sourceId: 'Source',
    symbolSet: 'Symbol set', trackPhase: 'Track phase', validUntil: 'Valid until', rtspUrl: 'Video URL',
    latitude: 'Latitude', longitude: 'Longitude', altitude: 'Altitude', pointIndex: 'Waypoint', priority: 'Priority',
  };
  return labels[key] ?? key.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ');
}

function popupValue(key: string, value: unknown): string {
  if (typeof value === 'number') {
    if (key.endsWith('Meters') || key === 'radiusMeters' || key === 'widthMeters') return `${value} m`;
    if (key.endsWith('Seconds')) return `${value} s`;
    if (key === 'percentComplete') return `${value}%`;
  }
  if (key === 'duration' && typeof value === 'string') return humanDuration(value);
  return String(value);
}

function humanDuration(value: string): string {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value);
  if (!match) return value;
  const parts = [match[1] && `${match[1]} h`, match[2] && `${match[2]} min`, match[3] && `${match[3]} s`].filter(Boolean);
  return parts.join(' ') || '0 s';
}

function fitVehicles(map: MapLibreMap, drones: Drone[], force = false): boolean {
  const positioned = drones.filter((drone): drone is Drone & { position: GeoPoint } => Boolean(drone.position));
  if (positioned.length === 0) return false;
  if (positioned.length === 1) {
    const point = positioned[0].position;
    map.easeTo({ center: [point.longitude, point.latitude], zoom: force ? 14 : map.getZoom() });
    return true;
  }
  const bounds = new maplibregl.LngLatBounds();
  positioned.forEach((drone) => bounds.extend([drone.position.longitude, drone.position.latitude]));
  map.fitBounds(bounds, { padding: 60, maxZoom: 15, duration: force ? 500 : 0 });
  return true;
}

function positiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function emptyFeatureCollection(): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}
