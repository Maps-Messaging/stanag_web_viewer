import maplibregl, { type GeoJSONSourceSpecification, type IControl, type Map as MapLibreMap } from 'maplibre-gl';

interface OperationalAreaDefinition {
  id: string;
  title: string;
  path: string;
  colour: string;
}

const OPERATIONAL_AREAS: OperationalAreaDefinition[] = [
  { id: 'offshore', title: 'Offshore', path: 'layers/offshore.geojson', colour: '#42a5f5' },
  { id: 'rio-1', title: 'Rio 1', path: 'layers/rio_1.geojson', colour: '#26c6da' },
  { id: 'rio-2', title: 'Rio 2', path: 'layers/rio_2.geojson', colour: '#66bb6a' },
];

const installedMaps = new WeakSet<MapLibreMap>();
let supportInstalled = false;

export function installOperationalAreaSupport(): void {
  if (supportInstalled) return;
  supportInstalled = true;

  const originalAddControl = maplibregl.Map.prototype.addControl;
  maplibregl.Map.prototype.addControl = function addControl(control: IControl, position?: maplibregl.ControlPosition): MapLibreMap {
    const result = originalAddControl.call(this, control, position);
    if (!installedMaps.has(this)) {
      installedMaps.add(this);
      originalAddControl.call(this, new OperationalAreaControl(), 'top-right');
    }
    return result;
  };
}

class OperationalAreaControl implements IControl {
  private map?: MapLibreMap;
  private container?: HTMLDivElement;
  private button?: HTMLButtonElement;
  private loaded = false;
  private visible = false;
  private loading = false;

  onAdd(map: MapLibreMap): HTMLElement {
    this.map = map;
    this.container = document.createElement('div');
    this.container.className = 'maplibregl-ctrl maplibregl-ctrl-group operational-area-control';

    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.textContent = 'Show areas';
    this.button.title = 'Load and show Offshore, Rio 1 and Rio 2 operational areas';
    this.button.setAttribute('aria-label', this.button.title);
    this.button.addEventListener('click', () => void this.toggle());

    this.container.appendChild(this.button);
    return this.container;
  }

  onRemove(): void {
    this.container?.remove();
    this.container = undefined;
    this.button = undefined;
    this.map = undefined;
  }

  private async toggle(): Promise<void> {
    if (!this.map || this.loading) return;

    if (!this.loaded) {
      await this.load();
      return;
    }

    this.setVisible(!this.visible);
  }

  private async load(): Promise<void> {
    if (!this.map || !this.button) return;
    this.loading = true;
    this.button.disabled = true;
    this.button.textContent = 'Loading areas…';

    try {
      const collections = await Promise.all(OPERATIONAL_AREAS.map(async (area) => {
        const url = new URL(area.path, `${globalThis.location.origin}${import.meta.env.BASE_URL}`).toString();
        const response = await fetch(url);
        if (!response.ok) throw new Error(`${area.title}: HTTP ${response.status} loading ${url}`);
        const contentType = response.headers.get('content-type') ?? '';
        if (!contentType.includes('json') && !contentType.includes('geo+json')) {
          throw new Error(`${area.title}: expected GeoJSON but received ${contentType || 'unknown content type'} from ${url}`);
        }
        const data = await response.json() as GeoJSON.FeatureCollection;
        if (data.type !== 'FeatureCollection') throw new Error(`${area.title}: expected a GeoJSON FeatureCollection`);
        return { area, data };
      }));

      collections.forEach(({ area, data }) => this.addArea(area, data));
      this.loaded = true;
      this.setVisible(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.button.textContent = 'Area load failed';
      this.button.title = message;
      useAppStoreError(message);
      console.error('Operational area load failed', error);
    } finally {
      this.loading = false;
      this.button.disabled = false;
    }
  }

  private addArea(area: OperationalAreaDefinition, data: GeoJSON.FeatureCollection): void {
    if (!this.map) return;

    const sourceId = `operational-area-${area.id}`;
    if (!this.map.getSource(sourceId)) {
      const source: GeoJSONSourceSpecification = { type: 'geojson', data };
      this.map.addSource(sourceId, source);
    }

    const fillLayerId = `${sourceId}-fill`;
    const outlineLayerId = `${sourceId}-outline`;
    const lineLayerId = `${sourceId}-line`;
    const pointLayerId = `${sourceId}-point`;

    if (!this.map.getLayer(fillLayerId)) {
      this.map.addLayer({
        id: fillLayerId,
        type: 'fill',
        source: sourceId,
        filter: ['==', '$type', 'Polygon'],
        paint: { 'fill-color': area.colour, 'fill-opacity': 0.18 },
      });
    }
    if (!this.map.getLayer(outlineLayerId)) {
      this.map.addLayer({
        id: outlineLayerId,
        type: 'line',
        source: sourceId,
        filter: ['==', '$type', 'Polygon'],
        paint: { 'line-color': area.colour, 'line-width': 2, 'line-opacity': 0.9 },
      });
    }
    if (!this.map.getLayer(lineLayerId)) {
      this.map.addLayer({
        id: lineLayerId,
        type: 'line',
        source: sourceId,
        filter: ['==', '$type', 'LineString'],
        paint: { 'line-color': area.colour, 'line-width': 3, 'line-opacity': 0.9 },
      });
    }
    if (!this.map.getLayer(pointLayerId)) {
      this.map.addLayer({
        id: pointLayerId,
        type: 'circle',
        source: sourceId,
        filter: ['==', '$type', 'Point'],
        paint: {
          'circle-radius': 6,
          'circle-color': area.colour,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      });
    }

    [fillLayerId, outlineLayerId, lineLayerId, pointLayerId].forEach((layerId) => this.registerPopup(layerId, area.title));
  }

  private registerPopup(layerId: string, title: string): void {
    if (!this.map) return;

    this.map.on('mouseenter', layerId, () => {
      if (this.map) this.map.getCanvas().style.cursor = 'pointer';
    });
    this.map.on('mouseleave', layerId, () => {
      if (this.map) this.map.getCanvas().style.cursor = '';
    });
    this.map.on('click', layerId, (event) => {
      const feature = event.features?.[0];
      if (!feature || !this.map) return;
      event.originalEvent.stopPropagation();

      const root = document.createElement('div');
      root.className = 'task-popup';
      const heading = document.createElement('strong');
      heading.textContent = title;
      root.appendChild(heading);

      const table = document.createElement('table');
      Object.entries(feature.properties ?? {}).forEach(([key, value]) => {
        if (value === undefined || value === null) return;
        const row = table.insertRow();
        row.insertCell().textContent = key.replaceAll('_', ' ');
        row.insertCell().textContent = String(value);
      });
      root.appendChild(table);
    });
  }

  private setVisible(visible: boolean): void {
    if (!this.map || !this.button) return;
    this.visible = visible;
    const visibility = visible ? 'visible' : 'none';

    OPERATIONAL_AREAS.forEach((area) => {
      const sourceId = `operational-area-${area.id}`;
      [`${sourceId}-fill`, `${sourceId}-outline`, `${sourceId}-line`, `${sourceId}-point`].forEach((layerId) => {
        if (this.map?.getLayer(layerId)) this.map.setLayoutProperty(layerId, 'visibility', visibility);
      });
    });

    this.button.textContent = visible ? 'Hide areas' : 'Show areas';
    this.button.dataset.active = String(visible);
  }
}

function useAppStoreError(message: string): void {
  globalThis.dispatchEvent(new CustomEvent('operational-area-error', { detail: message }));
}
