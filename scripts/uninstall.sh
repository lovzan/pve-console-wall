#!/bin/bash
#
# Proxmox Console Wall - uninstaller
#
# Reverses install.sh: removes the UI injection, deregisters the API, deletes
# the backend modules and the upgrade hook. Saved layouts under
# /etc/pve/console-wall are left in place unless --purge is given.
#
# Part of the pve-console-wall plugin. Distributed under AGPL-3.0.

set -euo pipefail

PERL_DIR="/usr/share/perl5"
PVEMANAGER_JS="/usr/share/pve-manager/js/pvemanagerlib.js"
CLUSTER_PM="${PERL_DIR}/PVE/API2/Cluster.pm"
MARK_BEGIN="/* ==== BEGIN pve-console-wall ==== */"
MARK_END="/* ==== END pve-console-wall ==== */"
BACKUP_DIR="/var/lib/pve-console-wall/backups"

log()  { echo -e "\033[1;34m[console-wall]\033[0m $*"; }
warn() { echo -e "\033[1;33m[console-wall]\033[0m $*" >&2; }
die()  { echo -e "\033[1;31m[console-wall]\033[0m $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "must run as root"

PURGE=0
[ "${1:-}" = "--purge" ] && PURGE=1

# --- 1. remove UI injection ------------------------------------------------
if [ -f "$PVEMANAGER_JS" ] && grep -qF "$MARK_BEGIN" "$PVEMANAGER_JS"; then
    log "removing UI injection from pve-manager"
    cp -a "$PVEMANAGER_JS" "${BACKUP_DIR}/pvemanagerlib.js.uninstall.$(date +%s).bak" 2>/dev/null || true
    perl -0777 -i -pe 's{\n?\Q'"$MARK_BEGIN"'\E.*?\Q'"$MARK_END"'\E\n?}{}s' "$PVEMANAGER_JS"
fi

# --- 2. deregister API -----------------------------------------------------
if [ -f "$CLUSTER_PM" ] && grep -q "PVE::API2::ConsoleWall" "$CLUSTER_PM"; then
    log "deregistering API from Cluster.pm"
    cp -a "$CLUSTER_PM" "${BACKUP_DIR}/Cluster.pm.uninstall.$(date +%s).bak" 2>/dev/null || true
    perl -0777 -i -pe 's/\nuse PVE::API2::ConsoleWall;\n//' "$CLUSTER_PM"
    perl -0777 -i -pe 's/__PACKAGE__->register_method\(\{\s*\n\s*subclass => "PVE::API2::ConsoleWall",\s*\n\s*path => '"'"'console-wall'"'"',\s*\n\}\);\n\n?//s' "$CLUSTER_PM"
    if ! perl -c "$CLUSTER_PM" >/dev/null 2>&1; then
        warn "Cluster.pm failed to compile after deregister - restoring latest backup"
        latest="$(ls -t ${BACKUP_DIR}/Cluster.pm.*.bak 2>/dev/null | head -1 || true)"
        [ -n "$latest" ] && cp -a "$latest" "$CLUSTER_PM"
    fi
fi

# --- 3. remove backend modules + hook -------------------------------------
log "removing backend modules and upgrade hook"
rm -f "${PERL_DIR}/PVE/API2/ConsoleWall.pm"
rm -f "${PERL_DIR}/PVE/ConsoleWall/Config.pm"
rmdir "${PERL_DIR}/PVE/ConsoleWall" 2>/dev/null || true
rm -f /etc/apt/apt.conf.d/99-pve-console-wall
rm -rf /var/lib/pve-console-wall/src /var/lib/pve-console-wall/reapply.sh

# --- 4. optional purge of saved layouts -----------------------------------
if [ "$PURGE" -eq 1 ]; then
    log "purging saved layouts"
    rm -rf /etc/pve/console-wall
fi

if command -v systemctl >/dev/null 2>&1; then
    systemctl reload-or-restart pveproxy pvedaemon || warn "restart services manually"
fi

log "uninstalled. Reload the web UI (Ctrl+Shift+R)."
