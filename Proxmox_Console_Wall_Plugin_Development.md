# Proxmox Console Wall Plugin

## Overview

A native Proxmox VE plugin that adds a **Console Wall** dashboard for
monitoring multiple VM consoles in a single view.

## Goals

-   Monitor many VMs simultaneously.
-   Embed live noVNC consoles.
-   Integrate seamlessly with the existing Proxmox UI.
-   Preserve compatibility across upgrades.

## Features

-   New **Console Wall** menu under Datacenter.
-   Multi-console grid (2x2, 3x3, 4x4, custom).
-   Live noVNC consoles with auto reconnect.
-   VM search, filtering by node and tags.
-   Read-only or interactive console mode.
-   Full-screen console on click.
-   Live CPU, RAM, disk, and network overlays.
-   Console border health colors.
-   Saved layouts and favorites.
-   Multi-monitor friendly.
-   Auto-rotation through selected VMs.
-   Quick actions: Start, Stop, Reset, Shutdown, Snapshot, Backup.

## UI

    Datacenter
     ├─ Summary
     ├─ Nodes
     ├─ Storage
     └─ Console Wall

    +-----------+-----------+-----------+
    | FW        | AD        | SQL       |
    | noVNC     | noVNC     | noVNC     |
    +-----------+-----------+-----------+
    | WEB       | FILE      | WSUS      |
    +-----------+-----------+-----------+

## Architecture

### Backend

-   Proxmox VE Plugin API
-   Perl integration
-   Proxmox REST API
-   WebSocket VNC proxy
-   Ticket-based authentication

### Frontend

-   ExtJS
-   Embedded noVNC
-   Responsive CSS Grid
-   WebSocket updates

## Security

-   Uses existing Proxmox authentication.
-   Honors ACLs and RBAC.
-   Optional read-only mode.
-   Session isolation.

## Performance

-   Lazy loading.
-   Adaptive refresh.
-   GPU/browser acceleration where available.
-   Efficient WebSocket streaming.

## Future Enhancements

-   SPICE support.
-   Console recording.
-   Alerts and notifications.
-   VM grouping.
-   Shared layouts.
-   Plugin settings page.
-   API for external NOC displays.

## Deliverables

-   Installable Proxmox plugin package.
-   Source code.
-   Documentation.
-   User guide.
-   Configuration guide.
-   Test suite.
-   Upgrade guide.
