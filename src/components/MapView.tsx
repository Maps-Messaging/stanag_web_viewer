import { useEffect, useRef, type MutableRefObject } from 'react';
import maplibregl, { type GeoJSONSource, type Map as MapLibreMap } from 'maplibre-gl';
import type { Drone, DroneTask, GeoPoint } from '../models/types';
import { useAppStore } from '../state/useAppStore';

const TASK_GEOMETRY_SOURCE = 'task-geometry';
const DRONE_TRACK_SOURCE = 'drone-track';
const DRONE_MOVEMENT_SOURCE = 'drone-movement';

const MAX_TRACK_POINTS = 100;
const MOVEMENT_LINE_METRES_PER_METRE_PER_SECOND = 100;
const MIN_MOVEMENT_LINE_METRES = 10;
const MAX_MOVEMENT_LINE_METRES = 1_000;
const MIN_VISIBLE_SPEED_METRES_PER_SECOND = 0.01;

export function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | undefined>(undefined);
  const markersRef = useRef<globalThis.Map<string, maplibregl.Marker>>(new globalThis.Map());
  const droneTracksRef = useRef<globalThis.Map<string, GeoPoint[]>>(new globalThis.Map());
  const taskPopupRef = useRef<maplibregl.Popup | undefined>(undefined);
  const drones = useAppStore((state) => state.drones);
  const tasks = useAppStore((state) => state.tasks);
  const selectedDroneId = useAppStore((state) => state.selectedDroneId);
  const selectDrone = useAppStore((state) => state.selectDrone);
  const taskType = useAppStore((state) => state.taskType);
  const draftPoints = useAppStore((state) => state.draftPoints);
  const addDraftPoint = useAppStore((state) => state.addDraftPoint);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return;
    }

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
            attribution: 'Â© OpenStreetMap contributors',
          },
        },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
      },
    });

    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.on('load', () => {
      map.addSource(DRONE_TRACK_SOURCE, {
        type: 'geojson',
        data: emptyFeatureCollection(),
      });

      map.addSource(DRONE_MOVEMENT_SOURCE, {
        type: 'geojson',
        data: emptyFeatureCollection(),
      });

      map.addSource(TASK_GEOMETRY_SOURCE, {
        type: 'geojson',
        data: emptyFeatureCollection(),
      });

      map.addLayer({
        id: 'drone-tracks',
        type: 'line',
        source: DRONE_TRACK_SOURCE,
        paint: {
          'line-width': 3,
          'line-opacity': 0.65,
          'line-color': '#1976d2',
        },
      });

      map.addLayer({
        id: 'drone-movement-lines',
        type: 'line',
        source: DRONE_MOVEMENT_SOURCE,
        paint: {
          'line-width': 3,
          'line-opacity': 0.9,
          'line-color': '#00c853',
        },
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

      map.on('click', 'task-points', (event) => {
        const feature = event.features?.[0];
        if (!feature) {
          return;
        }

        event.originalEvent.stopPropagation();
        showTaskPopup(map, event.lngLat, feature.properties ?? {}, taskPopupRef);
      });

      map.on('click', 'task-volume-fill', (event) => {
        const feature = event.features?.[0];
        if (!feature) {
          return;
        }

        event.originalEvent.stopPropagation();
        showTaskPopup(map, event.lngLat, feature.properties ?? {}, taskPopupRef);
      });

      map.on('mouseenter', 'task-points', () => {
        map.getCanvas().style.cursor = 'pointer';
      });

      map.on('mouseleave', 'task-points', () => {
        map.getCanvas().style.cursor = '';
      });

      map.on('mouseenter', 'task-volume-fill', () => {
        map.getCanvas().style.cursor = 'pointer';
      });

      map.on('mouseleave', 'task-volume-fill', () => {
        map.getCanvas().style.cursor = '';
      });

      map.on('click', (event) => {
        const clickedTask = map.queryRenderedFeatures(event.point, {
          layers: ['task-points', 'task-volume-fill'],
        }).length > 0;

        if (clickedTask || !useAppStore.getState().taskType) {
          return;
        }

        addDraftPoint({ latitude: event.lngLat.lat, longitude: event.lngLat.lng });
      });

    });

    mapRef.current = map;

    return () => {
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current.clear();
      taskPopupRef.current?.remove();
      taskPopupRef.current = undefined;
      droneTracksRef.current.clear();
      map.remove();
      mapRef.current = undefined;
    };
  }, [addDraftPoint]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    const visibleDroneIds = new Set(Object.values(drones).filter((drone) => drone.position).map((drone) => drone.id));

    markersRef.current.forEach((marker, droneId) => {
      if (!visibleDroneIds.has(droneId)) {
        marker.remove();
        markersRef.current.delete(droneId);
      }
    });

    Object.values(drones).forEach((drone) => {
      if (!drone.position) {
        return;
      }

      appendTrackPoint(droneTracksRef.current, drone.id, drone.position);

      const existing = markersRef.current.get(drone.id);
      const popupContent = buildDronePopup(drone);

      if (existing) {
        existing.setLngLat([drone.position.longitude, drone.position.latitude]);
        existing.setRotation(drone.heading);
        existing.getElement().dataset.selected = String(drone.id === selectedDroneId);
        existing.getPopup()?.setDOMContent(popupContent);
        return;
      }

      const element = document.createElement('button');
      element.className = 'drone-marker';
      element.type = 'button';
      element.title = drone.name;
      element.dataset.selected = String(drone.id === selectedDroneId);
      element.innerHTML = '▲';
      const popup = new maplibregl.Popup({ offset: 20, closeButton: true, maxWidth: '340px' }).setDOMContent(popupContent);

      const marker = new maplibregl.Marker({ element, rotationAlignment: 'map', rotation: drone.heading })
          .setLngLat([drone.position.longitude, drone.position.latitude])
          .setPopup(popup)
          .addTo(map);

      element.addEventListener('click', (event) => {
        event.stopImmediatePropagation();
        selectDrone(drone.id);
        marker.togglePopup();
      });

      markersRef.current.set(drone.id, marker);
    });

    updateDroneTrackSource(map, droneTracksRef.current);
    updateDroneMovementSource(map, Object.values(drones));
  }, [drones, selectedDroneId, selectDrone]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    const updateGeometry = () => {
      const source = map.getSource(TASK_GEOMETRY_SOURCE) as GeoJSONSource | undefined;
      if (!source) {
        return;
      }

      source.setData({
        type: 'FeatureCollection',
        features: buildTaskFeatures(Object.values(tasks), draftPoints, taskType),
      });
    };

    if (map.isStyleLoaded()) {
      updateGeometry();
    } else {
      map.once('load', updateGeometry);
    }
  }, [draftPoints, taskType, tasks]);

  return <div ref={containerRef} className="map-container" />;
}


function appendTrackPoint(
    tracks: globalThis.Map<string, GeoPoint[]>,
    droneId: string,
    point: GeoPoint,
): void {
  const existing = tracks.get(droneId) ?? [];
  const previous = existing.at(-1);

  if (
      previous
      && previous.latitude === point.latitude
      && previous.longitude === point.longitude
  ) {
    return;
  }

  tracks.set(
      droneId,
      [
        ...existing,
        {
          latitude: point.latitude,
          longitude: point.longitude,
          altitude: point.altitude,
        },
      ].slice(-MAX_TRACK_POINTS),
  );
}

function updateDroneTrackSource(
    map: MapLibreMap,
    tracks: globalThis.Map<string, GeoPoint[]>,
): void {
  const update = () => {
    const source = map.getSource(DRONE_TRACK_SOURCE) as GeoJSONSource | undefined;

    if (!source) {
      return;
    }

    const features: GeoJSON.Feature<GeoJSON.LineString>[] = [];

    tracks.forEach((points, droneId) => {
      if (points.length < 2) {
        return;
      }

      features.push({
        type: 'Feature',
        properties: {
          droneId,
          pointCount: points.length,
        },
        geometry: {
          type: 'LineString',
          coordinates: points.map((point) => [
            point.longitude,
            point.latitude,
          ]),
        },
      });
    });

    source.setData({
      type: 'FeatureCollection',
      features,
    });
  };

  if (map.isStyleLoaded()) {
    update();
  } else {
    map.once('load', update);
  }
}

function updateDroneMovementSource(
    map: MapLibreMap,
    drones: Drone[],
): void {
  const update = () => {
    const source = map.getSource(DRONE_MOVEMENT_SOURCE) as GeoJSONSource | undefined;

    if (!source) {
      return;
    }

    source.setData({
      type: 'FeatureCollection',
      features: buildDroneMovementFeatures(drones),
    });
  };

  if (map.isStyleLoaded()) {
    update();
  } else {
    map.once('load', update);
  }
}

function buildDroneMovementFeatures(
    drones: Drone[],
): GeoJSON.Feature<GeoJSON.LineString>[] {
  return drones
      .filter(
          (drone) =>
              drone.position
              && drone.groundSpeed >= MIN_VISIBLE_SPEED_METRES_PER_SECOND,
      )
      .map((drone) => {
        const distanceMeters = Math.min(
            MAX_MOVEMENT_LINE_METRES,
            Math.max(
                MIN_MOVEMENT_LINE_METRES,
                drone.groundSpeed * MOVEMENT_LINE_METRES_PER_METRE_PER_SECOND,
            ),
        );

        const course = drone.course ?? drone.heading;
        const destination = destinationPoint(
            drone.position!,
            course,
            distanceMeters,
        );

        return {
          type: 'Feature',
          properties: {
            droneId: drone.id,
            speed: drone.groundSpeed,
            course,
            distanceMeters,
          },
          geometry: {
            type: 'LineString',
            coordinates: [
              [
                drone.position!.longitude,
                drone.position!.latitude,
              ],
              [
                destination.longitude,
                destination.latitude,
              ],
            ],
          },
        };
      });
}

function destinationPoint(
    start: GeoPoint,
    bearingDegrees: number,
    distanceMeters: number,
): GeoPoint {
  const earthRadiusMeters = 6_371_008.8;
  const angularDistance = distanceMeters / earthRadiusMeters;
  const bearing = bearingDegrees * Math.PI / 180;
  const latitude = start.latitude * Math.PI / 180;
  const longitude = start.longitude * Math.PI / 180;

  const destinationLatitude = Math.asin(
      Math.sin(latitude) * Math.cos(angularDistance)
      + Math.cos(latitude)
      * Math.sin(angularDistance)
      * Math.cos(bearing),
  );

  const destinationLongitude = longitude + Math.atan2(
      Math.sin(bearing)
      * Math.sin(angularDistance)
      * Math.cos(latitude),
      Math.cos(angularDistance)
      - Math.sin(latitude)
      * Math.sin(destinationLatitude),
  );

  return {
    latitude: destinationLatitude * 180 / Math.PI,
    longitude: destinationLongitude * 180 / Math.PI,
    altitude: start.altitude,
  };
}

function showTaskPopup(
    map: MapLibreMap,
    lngLat: maplibregl.LngLat,
    properties: Record<string, unknown>,
    popupRef: MutableRefObject<maplibregl.Popup | undefined>,
): void {
  popupRef.current?.remove();

  const root = document.createElement('div');
  root.className = 'task-popup';

  const title = document.createElement('strong');
  title.textContent = String(properties.label ?? 'Task target');
  root.appendChild(title);

  const table = document.createElement('table');
  const latitude = Number(properties.latitude ?? lngLat.lat);
  const longitude = Number(properties.longitude ?? lngLat.lng);
  addPopupRow(table, 'Latitude', latitude.toFixed(7));
  addPopupRow(table, 'Longitude', longitude.toFixed(7));

  if (properties.altitude !== undefined && properties.altitude !== null) {
    addPopupRow(table, 'Altitude', `${Number(properties.altitude).toFixed(2)} m`);
  }

  if (properties.radiusMeters !== undefined && properties.radiusMeters !== null) {
    addPopupRow(table, 'Radius', `${Number(properties.radiusMeters).toFixed(1)} m`);
  }

  if (properties.state) {
    addPopupRow(table, 'State', String(properties.state));
  }

  if (properties.percentComplete !== undefined && properties.percentComplete !== null) {
    addPopupRow(table, 'Progress', `${Number(properties.percentComplete).toFixed(1)}%`);
  }

  root.appendChild(table);

  popupRef.current = new maplibregl.Popup({ closeButton: true, maxWidth: '320px' })
      .setLngLat(lngLat)
      .setDOMContent(root)
      .addTo(map);
}

function buildDronePopup(drone: Drone): HTMLElement {
  const root = document.createElement('div');
  root.className = 'drone-popup';

  const title = document.createElement('strong');
  title.textContent = drone.name;
  root.appendChild(title);

  const subtitle = document.createElement('div');
  subtitle.className = 'drone-popup-description';
  subtitle.textContent = drone.description ?? drone.id;
  root.appendChild(subtitle);

  const table = document.createElement('table');
  addPopupRow(table, 'Latitude', drone.position?.latitude.toFixed(7) ?? 'Unknown');
  addPopupRow(table, 'Longitude', drone.position?.longitude.toFixed(7) ?? 'Unknown');
  addPopupRow(table, 'Altitude', formatMeasurement(drone.position?.altitude, 'm'));
  addPopupRow(table, 'Heading', `${drone.heading.toFixed(1)}Â°`);
  addPopupRow(table, 'Speed', formatMeasurement(drone.groundSpeed, 'm/s'));
  addPopupRow(table, 'Climb rate', formatMeasurement(drone.climbRate, 'm/s'));
  addPopupRow(table, 'Organisation', drone.organization ?? 'Unknown');
  addPopupRow(table, 'Status', drone.entityStatus?.replace('EntityStatusEnum_', '') ?? 'Unknown');
  addPopupRow(table, 'Last update', new Date(drone.lastSeen).toLocaleTimeString());
  root.appendChild(table);

  return root;
}

function addPopupRow(table: HTMLTableElement, label: string, value: string): void {
  const row = table.insertRow();
  const labelCell = row.insertCell();
  const valueCell = row.insertCell();
  labelCell.textContent = label;
  valueCell.textContent = value;
}

function formatMeasurement(value: number | undefined, unit: string): string {
  return value === undefined ? 'Unknown' : `${value.toFixed(2)} ${unit}`;
}

function buildTaskFeatures(tasks: DroneTask[], draftPoints: GeoPoint[], taskType: string | undefined): GeoJSON.Feature[] {
  const features: GeoJSON.Feature[] = [];

  if (taskType && draftPoints.length > 0) {
    features.push(pointFeature(draftPoints[0], 'draft', 'Draft target', undefined, taskType));
  }

  tasks
      .filter((task) => task.state !== 'COMPLETED' && task.state !== 'CANCELLED')
      .forEach((task) => {
        features.push(pointFeature(task.point, 'task', `${task.type} target`, task.id, task.type, task.state, task.percentComplete, task.radiusMeters));

        if (task.geometryType === 'CIRCLE' && task.radiusMeters && task.radiusMeters > 0) {
          features.push(circleFeature(task.point, task.radiusMeters, task));
        }
      });

  return features;
}

function pointFeature(
    point: GeoPoint,
    kind: 'draft' | 'task',
    label: string,
    taskId?: string,
    taskType?: string,
    state?: string,
    percentComplete?: number,
    radiusMeters?: number,
): GeoJSON.Feature<GeoJSON.Point> {
  return {
    type: 'Feature',
    properties: {
      kind,
      label,
      taskId,
      taskType,
      state,
      percentComplete,
      radiusMeters,
      latitude: point.latitude,
      longitude: point.longitude,
      altitude: point.altitude,
    },
    geometry: {
      type: 'Point',
      coordinates: [point.longitude, point.latitude],
    },
  };
}

function circleFeature(centre: GeoPoint, radiusMeters: number, task: DroneTask): GeoJSON.Feature<GeoJSON.Polygon> {
  const earthRadiusMeters = 6_371_008.8;
  const latitudeRadians = centre.latitude * Math.PI / 180;
  const longitudeRadians = centre.longitude * Math.PI / 180;
  const angularDistance = radiusMeters / earthRadiusMeters;
  const coordinates: [number, number][] = [];

  for (let index = 0; index <= 64; index += 1) {
    const bearing = index / 64 * Math.PI * 2;
    const latitude = Math.asin(
        Math.sin(latitudeRadians) * Math.cos(angularDistance)
        + Math.cos(latitudeRadians) * Math.sin(angularDistance) * Math.cos(bearing),
    );
    const longitude = longitudeRadians + Math.atan2(
        Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitudeRadians),
        Math.cos(angularDistance) - Math.sin(latitudeRadians) * Math.sin(latitude),
    );

    coordinates.push([longitude * 180 / Math.PI, latitude * 180 / Math.PI]);
  }

  return {
    type: 'Feature',
    properties: {
      kind: 'task',
      label: `${task.type} orbit`,
      taskId: task.id,
      taskType: task.type,
      state: task.state,
      percentComplete: task.percentComplete,
      radiusMeters,
      latitude: centre.latitude,
      longitude: centre.longitude,
      altitude: centre.altitude,
    },
    geometry: {
      type: 'Polygon',
      coordinates: [coordinates],
    },
  };
}

function emptyFeatureCollection(): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}
