# STANAG Drone Demo

React/TypeScript demonstration UI for MapsMessaging CATL/STANAG node events and task administration.

## Supported node messages

- `MessageTypeEnum_NODE_DESCRIPTION`
- `MessageTypeEnum_NODE_STATUS`

The node description supplies the drone identity, advertised task capabilities, and authority GUIDs. The UI currently enables:

- `REPOSITION` to a selected map point
- `LOITER` at a selected point
- `LOITER` within a circular region, shown as Orbit / circle in the UI
- `CANCEL` for the latest submitted task

## TASK_ADMIN output

Push and cancel use `MessageTypeEnum_TASK_ADMIN` and publish to the configured per-drone destination. The default is:

```text
4817/catl/maps/json/{droneId}/MessageTypeEnum_TASK_ADMIN
```

The command source UUID is generated once and stored in browser local storage unless `VITE_SOURCE_UUID` is configured.

## Browser broker defaults

Unless a broker URL is supplied through the environment, the UI uses the hostname from the page that loaded it.

| Transport | HTTP page | HTTPS page |
| --- | --- | --- |
| STOMP over WebSockets | `ws://<page-host>:8674/stomp` | `wss://<page-host>:8695/stomp` |
| MQTT over WebSockets | `ws://<page-host>:1883/mqtt` | `wss://<page-host>:1892/mqtt` |

Broker URL configuration is resolved in this order:

1. `VITE_STOMP_BROKER_URL` or `VITE_MQTT_BROKER_URL` for the selected transport
2. `VITE_BROKER_URL` as a transport-independent override
3. The browser-derived default above

Changing transport in the connection settings also changes the URL when the current URL is still the generated default. Manually entered or environment-supplied URLs are preserved.

## Run

```bash
npm install
npm run dev
```

No `package-lock.json` is included in the ZIP.

## Map task display

Selecting a drone marker opens a live telemetry popup. Submitted reposition and loiter targets remain visible on the map while the task is active. Completed and cancelled task geometry is removed automatically when the corresponding task result is received.
