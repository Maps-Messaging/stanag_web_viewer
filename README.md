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

## Run

```bash
npm install
npm run dev
```

No `package-lock.json` is included in the ZIP.
