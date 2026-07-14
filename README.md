# STANAG Drone Demo

A React + TypeScript demo application for displaying drones on a map, creating simple STANAG task commands, cancelling active tasks, and monitoring task state over MQTT or STOMP.

## Features

- MapLibre map using OpenStreetMap tiles
- Mock mode that runs without a broker
- Live drone markers with heading, speed, altitude, and last-seen state
- Reposition task by clicking a point
- Navigate task by adding two or more route points
- Loiter task by clicking a centre and entering a radius
- Task cancellation
- Task state panel and event log
- MQTT over WebSockets transport
- STOMP over WebSockets transport
- Centralised STANAG JSON adapter layer for replacing the example payloads

## Run

```bash
npm install
npm run dev
```

The project starts in mock mode. Open `http://localhost:5173`.

## Configure a broker

Copy `.env.example` to `.env.local` and set:

```text
VITE_TRANSPORT=mqtt
```

or:

```text
VITE_TRANSPORT=stomp
```

Then configure the WebSocket URL, credentials, and topics.

## Important integration point

The example JSON mapping is in:

```text
src/services/stanagAdapter.ts
```

Replace the example command builders and incoming-event parsers there with the exact MapsMessaging/STANAG payloads and topic conventions.

## Demo workflow

1. Select a drone in the left panel or click a marker.
2. Select Reposition, Navigate, or Loiter.
3. Click the map to define task geometry.
4. Enter altitude, speed, and loiter radius where applicable.
5. Submit the task.
6. Watch task status updates in the right panel.
7. Cancel an executing task with the Cancel button.

## Implemented CATL node messages

The application now decodes these MapsMessaging CATL/STANAG JSON messages directly:

- `MessageTypeEnum_NODE_DESCRIPTION`
- `MessageTypeEnum_NODE_STATUS`

Default MQTT subscription:

```text
4817/catl/maps/json/+/+
```

`NODE_DESCRIPTION` updates identity, display metadata, symbol information, and task capabilities. `NODE_STATUS` updates live position, Euler orientation, speed/course/climb rate, and validity timestamps. Capabilities are preserved when later status messages omit them. A `0,0` description pose is not rendered on the map.
