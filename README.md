# Proxmox Console Wall

A native Proxmox VE plugin that adds a **Console Wall** dashboard under
Datacenter for monitoring many VM/CT consoles live, in a single grid.

```
Datacenter
 ├─ Summary
 ├─ Nodes
 ├─ Storage
 └─ Console Wall      <-- added by this plugin

 +-----------+-----------+-----------+
 | FW        | AD        | SQL       |
 | noVNC     | noVNC     | noVNC     |
 +-----------+-----------+-----------+
 | WEB       | FILE      | WSUS      |
 +-----------+-----------+-----------+
```

## Features

- **Console Wall** menu item under Datacenter.
- **Predefined camera-wall layouts**: Single, `2×2`, `1+5`, `1+7`, `3×3`,
  `1+12`, `4×4`, `5×5`, and `auto` — the `1+N` styles enlarge one **hero** tile
  with the rest packed around it, NVR-style.
- **Arrange console positions**: drag any tile by its handle to reposition,
  move back/forward, or **Set as main** to promote a guest to the hero cell.
- Live **noVNC** consoles with automatic reconnect (exponential backoff).
- VM/CT search and filtering by node and by tag.
- **Interactive** or **read-only** console mode (global toggle).
- Per-tile full-screen (reuses Proxmox's viewer) **and** whole-wall fullscreen.
- Live **CPU / RAM / network** overlays per console.
- **Name / ID / tags label overlay** per console (toggleable).
- **Health-coloured borders** (ok / warning / critical / off).
- **Auto-save**: every action (selection, order, layout, mode, overlays) is
  saved automatically — **server-side per user**, replicated across the cluster,
  so reconnecting from any browser or node restores the wall exactly as you left
  it. Browser-local storage is used as an offline fallback.
- Named **saved layouts** in addition to the running autosave.
- Auto-rotation through the selected guests when they exceed the layout capacity.
- Per-guest quick actions: Start, Shutdown, Stop, Reset, Snapshot.

Everything reuses the **native Proxmox VE APIs** — authentication, ACLs/RBAC,
VNC WebSocket proxy and ticket-based auth are all Proxmox's own. This plugin
adds one small read/write API for layout persistence and an ExtJS UI.

## How it works

| Concern            | Mechanism |
|--------------------|-----------|
| VM/CT list         | `GET /cluster/resources?type=vm` |
| Live console       | `POST /nodes/{node}/{qemu,lxc}/{vmid}/vncproxy` then a `wss://` connection to `.../vncwebsocket`, rendered by the bundled noVNC RFB module |
| Metrics overlay    | `GET /nodes/{node}/{qemu,lxc}/{vmid}/status/current` (polled) |
| Quick actions      | `POST /nodes/{node}/{qemu,lxc}/{vmid}/status/{start,stop,reset,shutdown}` and `/snapshot` |
| Saved layouts      | `GET/POST/DELETE /cluster/console-wall/layouts` (this plugin) |

Because consoles use Proxmox's ticket-authenticated VNC WebSocket proxy, a user
only ever sees consoles they are permitted to see, and read-only mode is
enforced client-side via noVNC `viewOnly` in addition to any server ACLs.

## Repository layout

```
src/www/                 ExtJS UI (tile, selector, wall, datacenter registration) + CSS
src/PVE/API2/ConsoleWall.pm      REST API for saved layouts
src/PVE/ConsoleWall/Config.pm    layout persistence on /etc/pve (pmxcfs)
scripts/install.sh       idempotent installer (patches the manager + registers the API)
scripts/uninstall.sh     clean removal
debian/                  packaging for a real .deb
docs/                    user guide, configuration guide, upgrade guide
test/                    host-independent lint/structure tests
```

## Install

### Option A — from source (any Proxmox VE 7.x / 8.x node)

```bash
git clone <this-repo> pve-console-wall
cd pve-console-wall
sudo ./scripts/install.sh
```

Then hard-reload the web UI (`Ctrl+Shift+R`) and open **Datacenter → Console Wall**.
Repeat on each node in a cluster (the UI is served per node).

### Option B — build and install a .deb

```bash
sudo apt-get install -y devscripts debhelper
make deb
sudo apt-get install ../pve-console-wall_1.0.0_all.deb
```

The package installs an APT hook so the UI injection is **re-applied
automatically** whenever `pve-manager` is upgraded.

## Uninstall

```bash
sudo ./scripts/uninstall.sh          # keep saved layouts
sudo ./scripts/uninstall.sh --purge  # also delete saved layouts
# or, if installed as a package:
sudo apt-get remove pve-console-wall
```

## Compatibility & upgrades

The web UI is injected into `pvemanagerlib.js` between clearly marked
`BEGIN/END pve-console-wall` guards, and the API is registered into
`PVE/API2/Cluster.pm` idempotently with automatic `perl -c` verification and a
backup/rollback. See [`docs/upgrade.md`](docs/upgrade.md) for details on how the
plugin survives `pve-manager` upgrades.

## Documentation

- [User guide](docs/user-guide.md)
- [Configuration guide](docs/configuration.md)
- [Upgrade guide](docs/upgrade.md)

## Security

- Uses existing Proxmox authentication and per-guest ACLs — no separate auth.
- Console streams are the standard ticket-authenticated VNC WebSocket proxy.
- Optional global read-only mode disables input and power actions.
- Saved layouts are per-user and stored on the cluster filesystem.

## License

AGPL-3.0-or-later, matching Proxmox VE. See [LICENSE](LICENSE).

> Not affiliated with or endorsed by Proxmox Server Solutions GmbH.
