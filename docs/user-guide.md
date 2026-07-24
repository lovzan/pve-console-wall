# Console Wall — User Guide

## Opening the wall

Log in to the Proxmox web interface and select **Datacenter** in the left tree.
A new **Console Wall** entry appears in the Datacenter panel alongside Summary,
Nodes and Storage. Click it.

The first time, the wall is empty. Use the toolbar to build it.

## Toolbar reference

| Control | What it does |
|---------|--------------|
| **Select VMs** | Opens the picker to choose which guests appear on the wall. |
| **Layout** | Predefined camera-wall style: Single, `2×2 (4)`, `1+5 (6)`, `1+7 (8)`, `3×3 (9)`, `1+12 (13)`, `4×4 (16)`, `5×5 (25)`, or `Auto fit`. The `1+N` styles enlarge one **hero** tile. |
| **Interactive / Read-only** | Switches all consoles between input-enabled and view-only. Read-only also blocks power actions. |
| **CPU/RAM** | Toggles the live CPU/RAM/network overlay on each console. |
| **Labels** | Toggles the name / ID / type / tags label overlay on each console. |
| **Fullscreen** | Puts the whole wall into browser fullscreen. |
| **Auto-rotate** | When you have more guests selected than the layout holds, cycles through them every 15 seconds. |
| **Save Layout** | Saves the current selection + order + settings under a name. |
| **Layouts** | Loads a previously saved layout. |
| **Refresh** (circular arrows) | Reconnects every console. |

Everything you change is **auto-saved** continuously (see *Auto-save* below), so
there is no explicit "save" needed to keep your working wall.

## Arranging console positions

Each console can be positioned like a camera feed:

- Use the **‹ / ›** buttons to nudge a console back or forward one slot.
- Click the **★** button to **Set as main** — promotes the console to the large
  hero cell (in the `1+5`, `1+7`, `1+12` styles).

The order is part of your saved/auto-saved state, so positions persist across
reconnects. Reordering keeps each console's live session — it does not reconnect.

## Selecting guests

In the **Select VMs** window:

- **Search** by name or VMID.
- Filter by **node** or by **tag**.
- Tick the guests you want. The header checkbox selects/deselects all *visible*
  (filtered) rows.
- Click **Apply**.

Both QEMU VMs and LXC containers are supported; the Type column shows `VM` or `CT`.

## Per-console controls

Each tile has a small toolbar:

- **Start / Shutdown / Stop / Reset** — power actions (confirmation is asked for
  the destructive ones). Disabled in read-only mode.
- **Snapshot** — takes a timestamped snapshot (`wall_YYYYMMDDHHMMSS`).
- **Reconnect** — re-establishes just that console.
- **Fullscreen** — opens the guest in Proxmox's full noVNC viewer in a new window.

### Reading the tile

- The **status dot** by the title is green when the console is connected, red when not.
- The **border colour** reflects health:
  - green — running, healthy
  - amber — running, CPU ≥ 70% or RAM ≥ 75%
  - red (pulsing) — running, CPU ≥ 90% or RAM ≥ 90%
  - grey — not running
- The **overlay** at the bottom shows CPU %, RAM %, and network throughput.

When a guest is stopped, its tile shows the guest state instead of a console and
automatically connects once the guest starts running again.

## Auto-save

You never have to manually save your working wall. Every action — selecting
guests, reordering, choosing a layout style, toggling mode/overlays/labels — is
**auto-saved** to the server against your Proxmox user (debounced by ~1 second).
Because it is stored on the cluster filesystem, when you reconnect — from the
same browser, a different browser, or a different cluster node — the wall is
restored exactly as you left it: same consoles, same positions, same layout.

If the server is briefly unreachable, the state is still kept in your browser's
local storage and used as a fallback.

## Saved layouts

Beyond the running auto-save, **Save Layout** stores a *named* snapshot of your
current selection, order, layout style, mode and overlay preferences on the
server, tied to your Proxmox user. Load any of them later from the **Layouts**
menu. Named layouts are handy for switching between, e.g., a "Firewalls" wall and
a "Database servers" wall. If the backend API is unavailable, layouts fall back
to browser-local storage.

## Multi-monitor / NOC use

Open the wall in a dedicated browser window per monitor, choose a fixed grid
size, enable **Read-only** and **Auto-rotate**, and hide the browser chrome
(F11). Each window keeps its own last-used state.
