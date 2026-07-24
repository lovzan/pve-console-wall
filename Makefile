# Proxmox Console Wall - build & install helper

PACKAGE = pve-console-wall
VERSION = 1.0.2

SRC_JS = src/www/console-wall-tile.js \
         src/www/console-wall-selector.js \
         src/www/console-wall.js \
         src/www/console-wall-register.js

.PHONY: help
help:
	@echo "Targets:"
	@echo "  make deb        - build the installable .deb package (needs dpkg-buildpackage)"
	@echo "  make install    - install directly onto this Proxmox node (needs root)"
	@echo "  make uninstall  - remove the plugin from this node (needs root)"
	@echo "  make check      - lint Perl modules and check JS/CSS presence"
	@echo "  make test       - run the test suite"
	@echo "  make clean      - remove build artefacts"

.PHONY: deb
deb:
	dpkg-buildpackage -us -uc -b
	@echo "Built ../$(PACKAGE)_$(VERSION)_all.deb"

.PHONY: install
install:
	./scripts/install.sh

.PHONY: uninstall
uninstall:
	./scripts/uninstall.sh

.PHONY: check
check:
	@echo "== perl -c backend modules =="
	perl -I src -c src/PVE/ConsoleWall/Config.pm
	perl -I src -c src/PVE/API2/ConsoleWall.pm
	@echo "== JS files present =="
	@for f in $(SRC_JS); do test -f $$f && echo "ok  $$f" || (echo "MISSING $$f"; exit 1); done
	@test -f src/www/console-wall.css && echo "ok  src/www/console-wall.css"

.PHONY: test
test:
	./test/run-tests.sh

.PHONY: clean
clean:
	rm -f ../$(PACKAGE)_*.deb ../$(PACKAGE)_*.changes ../$(PACKAGE)_*.buildinfo
	rm -rf debian/$(PACKAGE) debian/.debhelper debian/files debian/debhelper-build-stamp
