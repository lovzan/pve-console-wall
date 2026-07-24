# Console Wall — Upgrade Guide

Proxmox VE ships its web UI as a single generated bundle
(`/usr/share/pve-manager/js/pvemanagerlib.js`) and its cluster API router as
`/usr/share/perl5/PVE/API2/Cluster.pm`. This plugin modifies both. This guide
explains how those modifications behave across upgrades and how to recover if
anything goes wrong.

## What the installer changes

1. **Backend modules** copied to:
   - `/usr/share/perl5/PVE/API2/ConsoleWall.pm`
   - `/usr/share/perl5/PVE/ConsoleWall/Config.pm`
2. **API registration** in `PVE/API2/Cluster.pm` — a `use` line and a
   `register_method({ subclass => 'PVE::API2::ConsoleWall', path => 'console-wall' })`
   block. Inserted idempotently; verified with `perl -c`; original backed up.
3. **UI injection** appended to `pvemanagerlib.js`, wrapped in
   `/* ==== BEGIN pve-console-wall ==== */ … /* ==== END pve-console-wall ==== */`.
4. **APT hook** `/etc/apt/apt.conf.d/99-pve-console-wall`.
5. A **cached copy of the source** under `/var/lib/pve-console-wall/`.

Backups of every patched file are kept in
`/var/lib/pve-console-wall/backups/` with timestamps.

## Behaviour on `pve-manager` (and related) upgrades

When you `apt upgrade`, Debian may replace `pvemanagerlib.js` and `Cluster.pm`
with fresh package versions, removing our changes. The installed APT hook runs
**after** each dpkg invocation and re-applies the plugin automatically:

```
DPkg::Post-Invoke { ".../reapply.sh --from-hook" }
```

The re-apply is idempotent: it strips any previous injection between the markers
before re-adding it, and skips the API registration if it is already present.

### If you installed from source (no .deb)

The `install.sh` run also drops the same APT hook, so upgrades are still
re-applied. If you moved or deleted the repo, the hook uses the cached source in
`/var/lib/pve-console-wall/src`, so it keeps working.

## Manual re-apply

If the UI ever disappears after an upgrade (e.g. the hook was removed):

```bash
sudo /var/lib/pve-console-wall/reapply.sh    # uses the cached source
# or, from the repo:
sudo ./scripts/install.sh
```

Then hard-reload the browser (`Ctrl+Shift+R`).

## Recovery / rollback

Every patched file is backed up before modification. To restore the stock
files:

```bash
ls -t /var/lib/pve-console-wall/backups/
sudo cp /var/lib/pve-console-wall/backups/pvemanagerlib.js.<ts>.bak \
        /usr/share/pve-manager/js/pvemanagerlib.js
sudo cp /var/lib/pve-console-wall/backups/Cluster.pm.<ts>.bak \
        /usr/share/perl5/PVE/API2/Cluster.pm
sudo systemctl reload-or-restart pveproxy pvedaemon
```

Or simply run the uninstaller, which removes the injection between the markers
and deregisters the API cleanly:

```bash
sudo ./scripts/uninstall.sh
```

## Cluster considerations

The web UI is served independently by each node's `pveproxy`, so **install the
plugin on every node** you might browse to. Saved layouts live on the shared
`/etc/pve` filesystem and therefore only need to be created once — they are
visible from every node.

## Version compatibility

Tested against the Proxmox VE 7.x / 8.x manager structure (ExtJS 6/7,
`PVE.dc.Config`, `PVE.panel.Config`, noVNC under `/novnc/`). If a future
Proxmox release renames these, the injection markers make it easy to locate and
adjust the integration points in `console-wall-register.js` (nav entry) and
`scripts/install.sh` (API registration anchor).
