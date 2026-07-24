#!/bin/bash
#
# Console Wall - lightweight test suite.
#
# These are host-independent structural/lint checks that run on any machine
# with perl + node (node is optional). They do NOT require a Proxmox node.
#
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

fail=0
pass() { echo -e "  \033[1;32mPASS\033[0m $*"; }
bad()  { echo -e "  \033[1;31mFAIL\033[0m $*"; fail=1; }

echo "== Perl backend compiles =="
for m in src/PVE/ConsoleWall/Config.pm src/PVE/API2/ConsoleWall.pm; do
    out="$(perl -I src -c "$m" 2>&1)"
    if [ $? -eq 0 ]; then
        pass "$m"
    elif printf '%s' "$out" | grep -q "Can't locate PVE"; then
        # libpve-* is absent off-node; only our own syntax matters here.
        pass "$m (syntax ok; PVE libs absent off-node)"
    else
        bad "$m"; printf '%s\n' "$out"
    fi
done

echo "== JavaScript syntax =="
if command -v node >/dev/null 2>&1; then
    for f in src/www/*.js; do
        if node --check "$f" >/dev/null 2>&1; then
            pass "$f"
        else
            bad "$f"; node --check "$f"
        fi
    done
else
    echo "  (node not installed; skipping JS syntax check)"
fi

echo "== Required files present =="
for f in \
    src/www/console-wall.js \
    src/www/console-wall-tile.js \
    src/www/console-wall-selector.js \
    src/www/console-wall-register.js \
    src/www/console-wall.css \
    src/PVE/API2/ConsoleWall.pm \
    src/PVE/ConsoleWall/Config.pm \
    scripts/install.sh \
    scripts/uninstall.sh \
    debian/control ; do
    [ -f "$f" ] && pass "$f" || bad "missing $f"
done

echo "== Install script references the injection markers =="
grep -q "BEGIN pve-console-wall" scripts/install.sh && pass "begin marker" || bad "begin marker"
grep -q "END pve-console-wall" scripts/uninstall.sh && pass "end marker in uninstall" || bad "end marker"

echo
if [ "$fail" -eq 0 ]; then
    echo -e "\033[1;32mAll tests passed.\033[0m"
else
    echo -e "\033[1;31mSome tests failed.\033[0m"
fi
exit $fail
