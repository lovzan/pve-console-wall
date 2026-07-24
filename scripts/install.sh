#!/bin/bash
#
# Proxmox Console Wall - installer
#
# Installs the plugin into a running Proxmox VE node:
#   1. copies the Perl backend modules
#   2. registers the API under /cluster/console-wall
#   3. injects the ExtJS UI + CSS into the web manager bundle
#   4. installs an APT hook so the UI survives pve-manager upgrades
#
# Re-running this script is safe and idempotent. Run as root on each node.
#
# Part of the pve-console-wall plugin. Distributed under AGPL-3.0.

set -euo pipefail

# --- locations -------------------------------------------------------------
PERL_DIR="/usr/share/perl5"
PVEMANAGER_JS="/usr/share/pve-manager/js/pvemanagerlib.js"
CLUSTER_PM="${PERL_DIR}/PVE/API2/Cluster.pm"
MARK_BEGIN="/* ==== BEGIN pve-console-wall ==== */"
MARK_END="/* ==== END pve-console-wall ==== */"
BACKUP_DIR="/var/lib/pve-console-wall/backups"

# Resolve the plugin source root (parent of this script's dir).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# SRC may be overridden by the APT upgrade hook, which points it at the
# cached source tree in /var/lib/pve-console-wall/src.
SRC="${SRC:-${SRC_ROOT}/src}"

log()  { echo -e "\033[1;34m[console-wall]\033[0m $*"; }
warn() { echo -e "\033[1;33m[console-wall]\033[0m $*" >&2; }
die()  { echo -e "\033[1;31m[console-wall]\033[0m $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "must run as root"
[ -f "$PVEMANAGER_JS" ] || die "pve-manager not found at $PVEMANAGER_JS - is this a Proxmox VE node?"

mkdir -p "$BACKUP_DIR"

# --- 1. backend modules ----------------------------------------------------
log "installing Perl backend modules"
install -D -m 0644 "${SRC}/PVE/API2/ConsoleWall.pm"      "${PERL_DIR}/PVE/API2/ConsoleWall.pm"
install -D -m 0644 "${SRC}/PVE/ConsoleWall/Config.pm"    "${PERL_DIR}/PVE/ConsoleWall/Config.pm"

# --- 2. register API under /cluster ---------------------------------------
register_api() {
    if grep -q "PVE::API2::ConsoleWall" "$CLUSTER_PM"; then
        log "API already registered in Cluster.pm"
        return
    fi
    log "registering API in Cluster.pm"
    cp -a "$CLUSTER_PM" "${BACKUP_DIR}/Cluster.pm.$(date +%s).bak"

    # Add the 'use' line after the package declaration.
    perl -0777 -i -pe \
        's/(package PVE::API2::Cluster;\s*\n)/$1\nuse PVE::API2::ConsoleWall;\n/ unless /use PVE::API2::ConsoleWall;/' \
        "$CLUSTER_PM"

    # Register the subclass. Insert before the first existing register_method
    # subclass block so it is picked up by the REST router.
    perl -0777 -i -pe '
        my $reg = "__PACKAGE__->register_method({\n".
                  "    subclass => \"PVE::API2::ConsoleWall\",\n".
                  "    path => '"'"'console-wall'"'"',\n".
                  "});\n\n";
        s/(__PACKAGE__->register_method\(\{\s*\n\s*subclass =>)/$reg$1/ unless /path => '"'"'console-wall'"'"'/;
    ' "$CLUSTER_PM"

    # Verify the module still compiles.
    if ! perl -c "$CLUSTER_PM" >/dev/null 2>&1; then
        warn "Cluster.pm failed to compile after patch - restoring backup"
        cp -a "$(ls -t ${BACKUP_DIR}/Cluster.pm.*.bak | head -1)" "$CLUSTER_PM"
        die "API registration failed; UI-only install will still work"
    fi
}
register_api

# --- 3. inject UI into pve-manager bundle ---------------------------------
log "injecting web UI into pve-manager"
cp -a "$PVEMANAGER_JS" "${BACKUP_DIR}/pvemanagerlib.js.$(date +%s).bak"

# Strip any previous injection so we can cleanly re-apply.
if grep -qF "$MARK_BEGIN" "$PVEMANAGER_JS"; then
    perl -0777 -i -pe 's{\Q'"$MARK_BEGIN"'\E.*?\Q'"$MARK_END"'\E\n?}{}s' "$PVEMANAGER_JS"
fi

# Build the combined blob: components first, override last, CSS via base64.
CSS_B64="$(base64 -w0 "${SRC}/www/console-wall.css")"
{
    echo ""
    echo "$MARK_BEGIN"
    cat "${SRC}/www/console-wall-tile.js"
    cat "${SRC}/www/console-wall-selector.js"
    cat "${SRC}/www/console-wall.js"
    cat "${SRC}/www/console-wall-register.js"
    echo "(function(){"
    echo "  try {"
    echo "    var s = document.createElement('style');"
    echo "    s.setAttribute('data-pcw','1');"
    echo "    s.textContent = atob('${CSS_B64}');"
    echo "    document.head.appendChild(s);"
    echo "  } catch (e) { if (window.console) console.error('console-wall css inject failed', e); }"
    echo "})();"
    echo "$MARK_END"
} >> "$PVEMANAGER_JS"

# --- 4. keep the source around + APT hook for upgrade survival ------------
log "installing upgrade hook"
INSTALL_LIB="/var/lib/pve-console-wall/src"
rm -rf "$INSTALL_LIB"
mkdir -p "$INSTALL_LIB"
cp -a "${SRC}/." "$INSTALL_LIB/"
cp -a "${SCRIPT_DIR}/install.sh" "/var/lib/pve-console-wall/reapply.sh"
chmod +x "/var/lib/pve-console-wall/reapply.sh"

cat > /etc/apt/apt.conf.d/99-pve-console-wall <<'HOOK'
// Re-apply the Console Wall UI after pve-manager package changes.
DPkg::Post-Invoke { "if [ -x /var/lib/pve-console-wall/reapply.sh ] && dpkg -s pve-manager >/dev/null 2>&1; then SRC=/var/lib/pve-console-wall/src /var/lib/pve-console-wall/reapply.sh --from-hook || true; fi"; };
HOOK

# When invoked from the APT hook, the source tree lives in $INSTALL_LIB.
# (The re-apply copy of this script points SRC there via the env var above;
#  a normal run uses the repo path resolved at the top.)

log "restarting pveproxy to clear the JS cache"
if command -v systemctl >/dev/null 2>&1; then
    systemctl reload-or-restart pveproxy pvedaemon || warn "could not restart services; do it manually"
fi

log "done. Reload the Proxmox web UI (Ctrl+Shift+R) and open Datacenter -> Console Wall."
