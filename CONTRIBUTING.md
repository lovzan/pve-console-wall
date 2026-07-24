# Contributing

Thanks for your interest in the Proxmox Console Wall plugin.

## Development

The plugin is a mix of ExtJS (frontend) and Perl (backend). There is no build
step for the source itself — the installer concatenates the assets into the
Proxmox web bundle.

### Layout

```
src/www/                 ExtJS UI + CSS
src/PVE/                 Perl backend (API + config persistence)
scripts/                 install / uninstall
debian/                  packaging
docs/                    guides
test/                    host-independent checks
```

### Before opening a PR

Run the test suite (host-independent — no Proxmox node needed):

```bash
make test        # or: bash test/run-tests.sh
```

It checks Perl syntax, JavaScript syntax (if Node is present), required files,
and the install/uninstall injection markers. CI runs the same checks and builds
the `.deb`.

### Testing on a real node

Copy the repo to a Proxmox VE test node and run `sudo ./scripts/install.sh`,
then hard-reload the web UI. Use a throwaway/lab node — the installer patches
`pvemanagerlib.js` and `PVE/API2/Cluster.pm` (with backups and `perl -c`
verification, but still).

## Coding style

- Match the surrounding code. ExtJS uses 4-space indent; Perl follows the
  Proxmox conventions.
- Keep the UI injection self-contained and reversible (respect the
  `BEGIN/END pve-console-wall` markers).

## Releasing

Tag `vX.Y.Z` on `main`; CI builds the `.deb` and attaches it to the GitHub
Release. Update `debian/changelog` and the version in `Makefile` first.

## License

By contributing you agree your contributions are licensed under AGPL-3.0-or-later.
