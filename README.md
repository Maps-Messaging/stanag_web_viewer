# STANAG Web Viewer

React and TypeScript demonstration UI for MapsMessaging CATL/STANAG node events, MAVLink-backed vehicle state, detections, and task administration.

The application connects to MapsMessaging through either STOMP over WebSockets or MQTT over WebSockets. It displays vehicle state on a MapLibre map and publishes STANAG `TASK_ADMIN` commands to vehicles using the capabilities and authority GUIDs advertised by each node.

## Main features

- Displays CATL/STANAG nodes and live digital-twin telemetry.
- Shows vehicle position, heading, attitude, speed, history track, and projected movement.
- Displays MAVLink sequence health where a system ID can be matched to one vehicle.
- Shows active task geometry and map-drafted task geometry.
- Displays dynamic track detections with metadata and optional RTSP URLs.
- Removes detections two minutes after their most recent update.
- Warns when positioned vehicles are within the configured collision distance.
- Provides metric map scale and navigation controls.
- Publishes a short MAVLink `NAMED_VALUE_FLOAT` detection assertion from the vehicle list.

## Consumed messages

The viewer currently handles:

- `MessageTypeEnum_NODE_DESCRIPTION`
- `MessageTypeEnum_NODE_STATUS`
- `MessageTypeEnum_DYNAMIC_UPDATE` with `ValueTypeEnum_TRACK`
- `MessageTypeEnum_TASK_ADMIN`
- `MessageTypeEnum_TASK_FEEDBACK`
- `MessageTypeEnum_TASK_RESULT`

Node descriptions provide identity, task capabilities, and authority GUIDs. Node status and digital-twin messages update the live vehicle state.

## Supported task creation

Task buttons are enabled only when the selected node advertises the corresponding capability and an authority GUID.

| Task | Supported geometry | Behaviour |
| --- | --- | --- |
| `REPOSITION` | Point | Move to one selected position. |
| `NAVIGATE` | Point, line | Navigate to one point or follow an ordered route. |
| `PATROL` | Line, circle, rectangle, polygon, corridor | Patrol an ordered route or an area/volume. |
| `LOITER` | Point, circle | Hold at a point or within a circular area. |
| `STANDBY` | Circle, rectangle, polygon, corridor | Submit a standby volume. |
| `DETECT` | Circle, rectangle, polygon, corridor | Submit a passive detection volume. |
| `SURVEY` | Circle, rectangle, polygon, corridor | Submit a passive survey volume. |
| `SCREEN` | Circle, rectangle, polygon, corridor | Submit a screening volume. |

The latest active task for a vehicle can be cancelled from the task panel.

## TASK_ADMIN publishing

Push and cancel messages use `MessageTypeEnum_TASK_ADMIN` and publish to the configured per-vehicle destination.

Default destination template:

```text
4817/catl/maps/json/{droneId}/MessageTypeEnum_TASK_ADMIN
```

Both `{droneId}` and `{droneUuid}` placeholders are accepted by the destination resolver.

The command source UUID is generated once and stored in browser local storage unless `VITE_SOURCE_UUID` is configured.

## Map display

The map includes:

- selectable vehicle markers rotated to heading;
- up to 100 recent track points per vehicle;
- movement projection based on ground speed and course;
- active and draft task points, routes, polygons, circles, and corridors;
- dynamic detection points and labels;
- collision-warning regions around conflicting vehicles;
- readable dark-themed popups for tasks and detections;
- metric scale and zoom/rotation controls.

Completed and cancelled task geometry is removed from the active map display.

### Collision distance

The default collision-warning distance is 200 metres. Override it at build time with:

```text
VITE_COLLISION_WARNING_DISTANCE_METERS=50
```

A warning region is drawn only when at least two positioned vehicles are within the configured distance.

## Dynamic detections

`DYNAMIC_UPDATE` track messages are displayed as detection markers. Each received update refreshes the marker and its two-minute local expiry time.

The viewer also preserves the source-provided `time_of_validity` separately when present. Detection details can include identity, organisation, nationality, track phase, position, timestamps, and an RTSP/video URL.

## MAVLink detection event

The Detect action in the vehicle list is separate from a STANAG `DETECT` task. It publishes a MAVLink named-value event:

```text
name: DETECT
value: 1
```

After five seconds, the viewer publishes the same event with value `0`.

## Browser broker defaults

Unless a broker URL is supplied through the environment, the application uses the hostname of the page that loaded it.

| Transport | HTTP page | HTTPS page |
| --- | --- | --- |
| STOMP over WebSockets | `ws://<page-host>:8674/stomp` | `wss://<page-host>:8695/stomp` |
| MQTT over WebSockets | `ws://<page-host>:1883/mqtt` | `wss://<page-host>:1892/mqtt` |

Broker URL configuration is resolved in this order:

1. `VITE_STOMP_BROKER_URL` or `VITE_MQTT_BROKER_URL` for the selected transport.
2. `VITE_BROKER_URL` as a transport-independent override.
3. The browser-derived default above.

Changing transport in the settings dialog changes the URL when the current value is still a generated default. Manually entered or environment-supplied URLs are preserved.

## Configuration

Common build-time environment variables:

| Variable | Purpose |
| --- | --- |
| `VITE_TRANSPORT` | `stomp` or `mqtt`; defaults to `stomp`. |
| `VITE_STOMP_BROKER_URL` | STOMP WebSocket broker URL. |
| `VITE_MQTT_BROKER_URL` | MQTT WebSocket broker URL. |
| `VITE_BROKER_URL` | Transport-independent broker URL fallback. |
| `VITE_USERNAME` | Broker username. |
| `VITE_PASSWORD` | Broker password. |
| `VITE_DRONE_TOPIC` | CATL/STANAG subscription topic. |
| `VITE_TASK_STATUS_TOPIC` | Optional separate task-status topic. |
| `VITE_TASK_ADMIN_TOPIC` | Per-vehicle task-admin destination template. |
| `VITE_SOURCE_UUID` | Source UUID placed in outgoing STANAG headers. |
| `VITE_STANAG_VERSION` | STANAG version written to outgoing headers. |
| `VITE_COLLISION_WARNING_DISTANCE_METERS` | Collision-warning threshold in metres. |

Current defaults include:

```text
VITE_DRONE_TOPIC=4817/catl/maps/json/+/+
VITE_TASK_ADMIN_TOPIC=4817/catl/maps/json/{droneId}/MessageTypeEnum_TASK_ADMIN
VITE_STANAG_VERSION=0.3.0
```

## Development

Requirements:

- Node.js suitable for Vite 7
- npm

Install and run:

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
```

Preview the production build:

```bash
npm run preview
```

The build command performs a TypeScript project build before generating the Vite bundle.

## Technology

- React 19
- TypeScript
- Vite
- Material UI
- MapLibre GL
- Zustand
- STOMP.js
- MQTT.js
