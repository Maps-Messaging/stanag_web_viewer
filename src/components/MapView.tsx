import { useEffect, useRef } from 'react';
import maplibregl, { type GeoJSONSource, type Map as MapLibreMap } from 'maplibre-gl';
import { useAppStore } from '../state/useAppStore';

export function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap>();
  const markersRef = useRef<globalThis.Map<string, maplibregl.Marker>>(new globalThis.Map());

  const drones = useAppStore((state) => state.drones);
  const selectedDroneId = useAppStore((state) => state.selectedDroneId);
  const selectDrone = useAppStore((state) => state.selectDrone);
  const taskType = useAppStore((state) => state.taskType);
  const draftPoints = useAppStore((state) => state.draftPoints);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const map = new maplibregl.Map({
      container,
      center: [151.2093, -33.8688],
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
        layers: [
          {
            id: 'osm',
            type: 'raster',
            source: 'osm',
          },
        ],
      },
    });

    mapRef.current = map;

    map.addControl(new maplibregl.NavigationControl(), 'top-right');

    map.on('load', () => {
      map.addSource('task-geometry', {
        type: 'geojson',
        data: emptyFeatureCollection(),
      });

      map.addLayer({
        id: 'task-line',
        type: 'line',
        source: 'task-geometry',
        paint: {
          'line-width': 4,
          'line-color': '#ffb300',
        },
        filter: ['==', '$type', 'LineString'],
      });

      map.addLayer({
        id: 'task-points',
        type: 'circle',
        source: 'task-geometry',
        paint: {
          'circle-radius': 7,
          'circle-color': '#ffb300',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#111',
        },
        filter: ['==', '$type', 'Point'],
      });
    });

    map.on('click', (event) => {
      const store = useAppStore.getState();

      if (!store.taskType) {
        return;
      }

      store.addDraftPoint({
        latitude: event.lngLat.lat,
        longitude: event.lngLat.lng,
      });
    });

    return () => {
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current.clear();

      map.remove();
      mapRef.current = undefined;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    const droneIds = new Set(Object.keys(drones));

    markersRef.current.forEach((marker, droneId) => {
      if (!droneIds.has(droneId)) {
        marker.remove();
        markersRef.current.delete(droneId);
      }
    });

    Object.values(drones).forEach((drone) => {
      const existing = markersRef.current.get(drone.id);

      if (existing) {
        existing.setLngLat([drone.position.longitude, drone.position.latitude]);
        existing.setRotation(drone.heading);
        existing.getElement().dataset.selected = String(drone.id === selectedDroneId);
        return;
      }

      const element = document.createElement('button');
      element.className = 'drone-marker';
      element.type = 'button';
      element.title = drone.name;
      element.dataset.selected = String(drone.id === selectedDroneId);
      element.innerHTML = '▲';

      element.addEventListener('click', (event) => {
        event.stopPropagation();
        selectDrone(drone.id);
      });

      const marker = new maplibregl.Marker({
        element,
        rotationAlignment: 'map',
        rotation: drone.heading,
      })
          .setLngLat([drone.position.longitude, drone.position.latitude])
          .addTo(map);

      markersRef.current.set(drone.id, marker);
    });
  }, [drones, selectedDroneId, selectDrone]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    const updateGeometry = () => {
      const source = map.getSource('task-geometry') as GeoJSONSource | undefined;
      if (!source) {
        return;
      }

      const coordinates = draftPoints.map((point) => [point.longitude, point.latitude]);

      const features: GeoJSON.Feature[] = draftPoints.map((point) => ({
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Point',
          coordinates: [point.longitude, point.latitude],
        },
      }));

      if (taskType === 'NAVIGATE' && coordinates.length >= 2) {
        features.unshift({
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates,
          },
        });
      }

      source.setData({
        type: 'FeatureCollection',
        features,
      });
    };

    if (map.isStyleLoaded()) {
      updateGeometry();
    } else {
      map.once('load', updateGeometry);
    }
  }, [draftPoints, taskType]);

  return <div ref={containerRef} className="map-container" />;
}

function emptyFeatureCollection(): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [],
  };
}