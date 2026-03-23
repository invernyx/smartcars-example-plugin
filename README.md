# Example Plugin

A reference plugin for smartCARS demonstrating both background (server-side) and UI (client-side) modules.

## Structure

```
/
  plugin.json          — plugin manifest (id, version, metadata)
  background/          — background module (runs in the main process as a worker thread)
  ui/                  — UI module (rendered inside the app as an iframe)
```

## Plugin Manifest

Every plugin has a `plugin.json` at its root:

```json
{
    "id": "com.tfdidesign.example",
    "name": "Example Plugin",
    "version": "1.0.0",
    "type": "user",
    "description": "An example plugin for smartCARS Pro",
    "availableSettings": {}
}
```

## Background Module

The background module runs in a dedicated Node.js worker thread inside the Electron main process. It exposes HTTP endpoints through the smartCARS API server and can connect to the real-time event bus.

### How It Works

1. The plugin exports a `PluginDefinition` (from `shared/interfaces/plugin.ts`) as a CommonJS2 module.
2. On load, smartCARS calls `onStart(identity)` with the user's identity/credentials.
3. Route handlers are registered under `/api/:pluginId/:handlerName`.
4. When a request arrives, the dispatcher looks up the plugin by ID and calls the matching handler with Express-style `(req, res)` arguments.
5. Optionally, `onEnd()` is called when the plugin is unloaded (e.g. on logout or shutdown).
6. `onSettingsUpdate(settings)` is called whenever the user changes a plugin setting.

### Handler Contract

Handlers are Express-style functions — receive `req` and `res`, call `res.json(...)` to respond:

```ts
import type { PluginDefinition, RawIdentity } from './sdk';

const plugin: PluginDefinition = {
    onStart: (_identity: RawIdentity) => {
        // Called once when the plugin loads
    },
    onEnd: () => {
        // Called when the plugin is unloaded
    },
    onSettingsUpdate: (_settings) => {
        // Called when plugin settings change
    },
    routes: {
        get: {
            something: {
                description: 'Get some data',
                handler: (req, res) => {
                    res.json({ data: 'some data' });
                },
            },
        },
        post: {
            something: {
                description: 'Post some data',
                handler: (req, res) => {
                    res.json({ received: req.body });
                },
            },
        },
    },
};

export = plugin;
```

### Event Bus

Plugins running in a worker thread can connect to the smartCARS event bus via WebSocket on `ws://localhost:7173`. Node.js 22 (Electron 39) exposes `WebSocket` as a global — no extra import needed. See `background/index.ts` for a full example with reconnection handling.

### Building

From `background/`:

```sh
npm run build
```

This runs webpack (producing `build/index.js`).

### Key Details

- **Webpack** bundles the plugin as CommonJS2 (`target: 'node'`).
- **`axios` is externalized** — the host app provides them at runtime, avoiding version mismatches and reducing bundle size. Add them as `devDependencies` for type checking only.

### SDK

`background/sdk/index.ts` contains all the types and constants you need to build a background plugin:

- `PluginDefinition` — the export contract your plugin must satisfy
- `RawIdentity` (and nested types) — the identity object passed to `onStart`
- `PluginRouteRequest` / `PluginRouteResponse` / `PluginRouteDefinition` — route handler types
- `AppEvent` / `JsonValue` — event bus wire format
- `LOCAL_HTTP_URL` / `LOCAL_WS_URL` — addresses for the smartCARS HTTP API and event bus

Copy this file into your own plugin as-is — it has no runtime dependencies.

## UI Module

The UI module is a standalone React application that renders inside the smartCARS app as an iframe. It is built with Vite and can use its own dependencies independently from the host app.

### Building

From `ui/`:

```sh
npm run build
```

This produces a static bundle in `dist/` via Vite.

### Key Details

- Standard React + Vite + TypeScript setup with SWC for fast refresh.
- The UI module runs in a sandboxed iframe — it does not have direct access to Electron APIs or the main process.
- To communicate with background handlers, make HTTP requests to `http://localhost:7172/api/:pluginId/:handlerName`.
- To subscribe to real-time events, connect to the event bus WebSocket at `ws://localhost:7173`.
