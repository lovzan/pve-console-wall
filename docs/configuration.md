# Console Wall — Configuration Guide

Console Wall is designed to work with **zero configuration** — it reuses
Proxmox's own authentication, ACLs and console proxy. This guide covers the few
things you can tune and where state lives.

## Where state is stored

| State | Location | Scope |
|-------|----------|-------|
| Named layouts | `/etc/pve/console-wall/<user>.json` | Per user, replicated across the cluster (pmxcfs) |
| Auto-saved working state | same file, reserved layout name `__autosave__` | Per user, cluster-wide — restored on reconnect from any browser/node |
| Last-used state (fallback) | Browser `localStorage` key `pcw-last-state` | Per browser, used when the server is unreachable |
| Local layout fallback | Browser `localStorage` key `pcw-layouts` | Per browser (only used if the API is unreachable) |

The auto-saved state is written (debounced ~1s) on every user action and read
first on load, which is what makes the wall reappear exactly as left after a
reconnect. It is hidden from the **Layouts** menu and cannot be overwritten by a
manually named layout (the name `__autosave__` is reserved).

Because saved layouts live on `/etc/pve`, they are automatically synced to every
node and survive node failure.

## Permissions (RBAC)

No new privileges are introduced. What a user can do on the wall is exactly what
they can already do in Proxmox:

- A guest only appears in **Select VMs** if the user can see it in
  `/cluster/resources` (i.e. has `VM.Audit` or higher on it).
- Opening a console requires `VM.Console`.
- Power actions require `VM.PowerMgmt`; snapshots require `VM.Snapshot`.
- If a user lacks a privilege, the corresponding Proxmox API call fails and the
  tile shows the error — the plugin does not bypass any check.

The saved-layouts API is available to all authenticated users (`user => 'all'`)
and only ever reads/writes that user's own layout file.

## Read-only mode

The **Read-only** toolbar toggle sets noVNC `viewOnly` on every console and
blocks the power/snapshot buttons in the UI. For a hard guarantee, also restrict
the user's Proxmox role so they only hold `VM.Console` / `VM.Audit`.

## Tuning intervals

These are defined in the frontend (`src/www`) and can be adjusted before
install:

| Setting | File | Default |
|---------|------|---------|
| Per-console status poll | `console-wall-tile.js` → `statusInterval` | `3000` ms |
| Cluster resource refresh | `console-wall.js` → `UpdateStore.interval` | `5000` ms |
| Auto-rotation dwell | `console-wall.js` → `startRotation()` | `15000` ms |
| Reconnect backoff cap | `console-wall-tile.js` → `scheduleReconnect()` | `30000` ms |

After editing, re-run `./scripts/install.sh` to re-inject the UI.

## Grid sizing

The grid uses CSS Grid. `2x2`…`5x5` are fixed column counts; `auto` uses
`repeat(auto-fill, minmax(320px, 1fr))` so it packs as many ~320px-wide tiles as
fit. To change the minimum tile width, edit `.pcw-grid-auto` in
`src/www/console-wall.css`.

## Disabling server-side layouts

If you prefer layouts to stay browser-local only, you can skip the API
registration: the UI automatically falls back to `localStorage` whenever
`GET /cluster/console-wall/layouts` returns an error. To remove just the API
while keeping the UI, delete `PVE/API2/ConsoleWall.pm` and re-run the installer,
or run the uninstaller and reinstall only the `www` assets.
