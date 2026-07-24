/*
 * Proxmox Console Wall - Main Panel
 *
 * Datacenter-level dashboard that lays out many live VM consoles in a grid.
 * Handles VM selection, filtering, layout persistence, read-only mode and
 * auto-rotation. Individual consoles are rendered by PVE.consolewall.ConsoleTile.
 *
 * Part of the pve-console-wall plugin. Distributed under AGPL-3.0.
 */
/* global Ext, Proxmox, PVE, gettext */

Ext.define('PVE.consolewall.ConsoleWall', {
    extend: 'Ext.panel.Panel',
    // alias registers the widget.* so {xtype: 'pveConsoleWall'} can instantiate
    // it by string (xtype alone in the class body is not enough here).
    alias: 'widget.pveConsoleWall',
    xtype: 'pveConsoleWall',

    title: gettext('Console Wall'),
    iconCls: 'fa fa-th',
    cls: 'pcw-wall',
    layout: 'border',

    // runtime state
    tiles: [],
    selection: [],       // ordered array of resource keys "node/type/vmid"
    gridStyle: '9',
    mode: 'interactive',
    showOverlay: true,
    showLabel: true,
    rotate: false,
    rotateTimer: null,
    rotateOffset: 0,
    autosaveTimer: null,

    // Reserved server-side layout that mirrors the live working state, so a
    // reconnect from any browser or node restores everything as last left.
    autosaveName: '__autosave__',

    // Predefined camera-wall styles. `cap` is how many tiles the style shows;
    // `cols`/`rows` are the base grid; `hero` (if set) is the column/row span
    // of the enlarged main tile. Sizing/positioning is done in JS (see
    // relayoutTiles) rather than CSS grid, which does not cooperate with
    // ExtJS's layout manager.
    styles: {
        '1':    { cap: 1,  cols: 1, rows: 1, label: gettext('Single') },
        '4':    { cap: 4,  cols: 2, rows: 2, label: '2 x 2 (4)' },
        '6':    { cap: 6,  cols: 3, rows: 3, hero: 2, label: '1 + 5 (6)' },
        '8':    { cap: 8,  cols: 4, rows: 4, hero: 3, label: '1 + 7 (8)' },
        '9':    { cap: 9,  cols: 3, rows: 3, label: '3 x 3 (9)' },
        '13':   { cap: 13, cols: 4, rows: 4, hero: 2, label: '1 + 12 (13)' },
        '16':   { cap: 16, cols: 4, rows: 4, label: '4 x 4 (16)' },
        '25':   { cap: 25, cols: 5, rows: 5, label: '5 x 5 (25)' },
        'auto': { cap: 0,  cols: 0, rows: 0, label: gettext('Auto fit') },
    },

    // Map legacy persisted values to the new style keys.
    legacyStyleMap: { '2x2': '4', '3x3': '9', '4x4': '16', '5x5': '25' },

    normalizeStyle: function(v) {
        let me = this;
        if (!v) {
            return '9';
        }
        if (me.styles[v]) {
            return v;
        }
        return me.legacyStyleMap[v] || '9';
    },

    initComponent: function() {
        let me = this;

        me.resourceStore = Ext.create('Proxmox.data.UpdateStore', {
            interval: 5000,
            storeid: 'pcw-resources-' + Ext.id(),
            model: 'PVEResources',
            proxy: {
                type: 'proxmox',
                url: '/api2/json/cluster/resources?type=vm',
            },
        });

        me.tbar = me.buildToolbar();

        me.items = [{
            region: 'center',
            xtype: 'container',
            itemId: 'wallGrid',
            cls: 'pcw-grid',
            // Tiles are absolutely positioned; we compute their geometry in
            // relayoutTiles() so ExtJS sizes each console body correctly.
            layout: 'absolute',
            listeners: {
                resize: function() {
                    me.relayoutTiles();
                },
            },
        }];

        me.callParent();

        me.applyGridStyleCls();

        me.on('afterrender', function() {
            me.resourceStore.startUpdate();
            me.loadPersistedState();
        }, me);

        me.on('beforedestroy', function() {
            me.stopRotation();
            me.flushAutosave();
            me.resourceStore.stopUpdate();
            me.clearTiles();
        }, me);
    },

    buildToolbar: function() {
        let me = this;
        return {
            cls: 'pcw-wall-tbar',
            items: [{
                xtype: 'button',
                text: gettext('Select VMs'),
                iconCls: 'fa fa-plus-square-o',
                handler: () => me.openSelector(),
            }, '-', {
                xtype: 'combo',
                fieldLabel: gettext('Layout'),
                labelWidth: 50,
                width: 190,
                editable: false,
                queryMode: 'local',
                displayField: 'label',
                valueField: 'key',
                value: me.gridStyle,
                itemId: 'styleCombo',
                store: {
                    fields: ['key', 'label'],
                    data: Object.keys(me.styles).map((k) => ({ key: k, label: me.styles[k].label })),
                },
                listeners: {
                    change: (f, v) => me.setGridStyle(v),
                },
            }, {
                xtype: 'segmentedbutton',
                itemId: 'modeBtn',
                items: [{
                    text: gettext('Interactive'),
                    pressed: true,
                    value: 'interactive',
                }, {
                    text: gettext('Read-only'),
                    value: 'readonly',
                }],
                listeners: {
                    change: (b, v) => me.setMode(v),
                },
            }, {
                xtype: 'button',
                enableToggle: true,
                pressed: true,
                text: gettext('CPU/RAM'),
                iconCls: 'fa fa-tachometer',
                itemId: 'overlayBtn',
                handler: (b) => me.setOverlay(b.pressed),
            }, {
                xtype: 'button',
                enableToggle: true,
                pressed: true,
                text: gettext('Labels'),
                iconCls: 'fa fa-tags',
                itemId: 'labelBtn',
                handler: (b) => me.setShowLabel(b.pressed),
            }, {
                xtype: 'button',
                text: gettext('Fullscreen'),
                iconCls: 'fa fa-desktop',
                tooltip: gettext('Fullscreen the whole wall'),
                handler: () => me.toggleWallFullscreen(),
            }, '-', {
                xtype: 'button',
                enableToggle: true,
                text: gettext('Auto-rotate'),
                iconCls: 'fa fa-random',
                itemId: 'rotateBtn',
                handler: (b) => me.toggleRotation(b.pressed),
            }, '->', {
                xtype: 'button',
                text: gettext('Save Layout'),
                iconCls: 'fa fa-floppy-o',
                handler: () => me.saveLayoutDialog(),
            }, {
                xtype: 'button',
                text: gettext('Layouts'),
                iconCls: 'fa fa-folder-open-o',
                menu: { items: [] },
                itemId: 'layoutsBtn',
                listeners: {
                    // rebuild the saved-layouts menu each time it opens
                    menushow: (btn) => me.populateLayoutsMenu(btn.menu),
                },
            }, {
                xtype: 'button',
                iconCls: 'fa fa-refresh',
                tooltip: gettext('Refresh all consoles'),
                handler: () => me.reconnectAll(),
            }, '-', {
                xtype: 'tbtext',
                itemId: 'wallStatus',
                cls: 'pcw-wall-status',
            }],
        };
    },

    // ---- VM selection ------------------------------------------------------

    openSelector: function() {
        let me = this;
        let win = Ext.create('PVE.consolewall.VMSelector', {
            resourceStore: me.resourceStore,
            selection: me.selection.slice(),
            callback: function(selected) {
                // Preserve the existing order for kept consoles; append new ones.
                let selSet = {};
                selected.forEach((k) => { selSet[k] = true; });
                let kept = me.selection.filter((k) => selSet[k]);
                let keptSet = {};
                kept.forEach((k) => { keptSet[k] = true; });
                let added = selected.filter((k) => !keptSet[k]);
                me.selection = kept.concat(added);
                me.rotateOffset = 0;
                me.rebuildTiles();
                me.persistState();
            },
        });
        win.show();
    },

    resolveResource: function(key) {
        let me = this;
        let rec = me.resourceStore.getData().findBy(function(r) {
            let d = r.data;
            return (d.node + '/' + (d.type === 'lxc' ? 'lxc' : 'qemu') + '/' + d.vmid) === key;
        });
        if (!rec) {
            return null;
        }
        let d = rec.data;
        return {
            vmid: d.vmid,
            node: d.node,
            name: d.name,
            type: d.type === 'lxc' ? 'lxc' : 'qemu',
            status: d.status,
            tags: d.tags || '',
        };
    },

    // ---- tile grid ---------------------------------------------------------

    rebuildTiles: function() {
        let me = this;
        me.clearTiles();
        let container = me.down('#wallGrid');
        if (!container) {
            return;
        }

        let keys = me.currentPageKeys();

        keys.forEach(function(key) {
            let res = me.resolveResource(key);
            if (!res) {
                return;
            }
            let tile = Ext.create('PVE.consolewall.ConsoleTile', {
                vmResource: res,
                mode: me.mode,
                showOverlay: me.showOverlay,
                showLabel: me.showLabel,
            });
            me.tiles.push(tile);
            container.add(tile);
        });

        if (me.tiles.length === 0) {
            container.add({
                xtype: 'component',
                cls: 'pcw-empty',
                anchor: '100% 100%', // fill the absolute-layout container
                html: '<div class="pcw-empty-inner"><i class="fa fa-th fa-3x"></i><p>' +
                    gettext('No consoles selected. Click "Select VMs" to build your wall.') +
                    '</p></div>',
            });
        }

        me.updateWallStatus();
        // Defer so the container has its final size before we measure it.
        Ext.defer(me.relayoutTiles, 30, me);
    },

    // Keys currently shown, honoring the style capacity and rotation offset.
    currentPageKeys: function() {
        let me = this;
        let cap = me.gridCapacity();
        if (cap <= 0 || me.selection.length <= cap) {
            return me.selection.slice(0, cap > 0 ? cap : me.selection.length);
        }
        let page = [];
        for (let i = 0; i < cap; i++) {
            page.push(me.selection[(me.rotateOffset + i) % me.selection.length]);
        }
        return page;
    },

    // Compute (col, row, colspan, rowspan) placement for each tile, honoring
    // the hero span of "1+N" styles. Returns an array parallel to me.tiles.
    computeCells: function(cols, rows, hero, n) {
        let cells = [];
        // occupancy grid
        let occ = [];
        for (let r = 0; r < rows; r++) {
            occ.push(new Array(cols).fill(false));
        }
        let ti = 0;
        if (hero && n > 0) {
            let span = Math.min(hero, cols, rows);
            for (let r = 0; r < span; r++) {
                for (let c = 0; c < span; c++) {
                    occ[r][c] = true;
                }
            }
            cells[ti++] = { c: 0, r: 0, cs: span, rs: span };
        }
        // fill remaining tiles into free cells, row-major
        for (let r = 0; r < rows && ti < n; r++) {
            for (let c = 0; c < cols && ti < n; c++) {
                if (!occ[r][c]) {
                    occ[r][c] = true;
                    cells[ti++] = { c: c, r: r, cs: 1, rs: 1 };
                }
            }
        }
        return cells;
    },

    // Size and position every tile. This is the core of the wall layout: it
    // replaces CSS Grid (which does not size ExtJS component bodies) with
    // explicit per-tile geometry.
    relayoutTiles: function() {
        let me = this;
        let container = me.down('#wallGrid');
        if (!container || !container.el || me.tiles.length === 0) {
            return;
        }
        let W = container.el.dom.clientWidth;
        let H = container.el.dom.clientHeight;
        if (W <= 0 || H <= 0) {
            return;
        }

        let n = me.tiles.length;
        let style = me.styles[me.gridStyle] || me.styles['9'];
        let cols = style.cols;
        let rows = style.rows;
        let hero = style.hero || 0;

        // "auto" (and any zero-dim style) derives a near-square grid from count.
        if (!cols || !rows) {
            cols = Math.ceil(Math.sqrt(n));
            rows = Math.ceil(n / cols);
            hero = 0;
        }

        let gap = 6;
        let cellW = (W - gap * (cols + 1)) / cols;
        let cellH = (H - gap * (rows + 1)) / rows;

        let cells = me.computeCells(cols, rows, hero, n);

        me.tiles.forEach(function(tile, i) {
            let cell = cells[i];
            if (!cell) {
                return;
            }
            let x = Math.round(gap + cell.c * (cellW + gap));
            let y = Math.round(gap + cell.r * (cellH + gap));
            let w = Math.round(cell.cs * cellW + (cell.cs - 1) * gap);
            let h = Math.round(cell.rs * cellH + (cell.rs - 1) * gap);
            tile.setPosition(x, y);
            tile.setSize(w, h);
        });
    },

    updateWallStatus: function() {
        let me = this;
        let txt = me.down('#wallStatus');
        if (!txt) {
            return;
        }
        let total = me.selection.length;
        let shown = me.tiles.length;
        if (total === 0) {
            txt.setText('');
        } else if (shown < total) {
            txt.setText(Ext.String.format(
                gettext('Showing {0} of {1} — enable Auto-rotate to cycle'), shown, total));
        } else {
            txt.setText(Ext.String.format(gettext('{0} consoles'), total));
        }
    },

    clearTiles: function() {
        let me = this;
        let container = me.down('#wallGrid');
        me.tiles = [];
        if (container) {
            container.removeAll(true);
        }
    },

    reconnectAll: function() {
        let me = this;
        me.tiles.forEach((t) => t.reconnect());
    },

    // ---- grid style --------------------------------------------------------

    setGridStyle: function(style) {
        let me = this;
        me.gridStyle = me.normalizeStyle(style);
        me.rotateOffset = 0;
        me.applyGridStyleCls();
        // capacity changed, so re-page the wall
        me.rebuildTiles();
        me.persistState();
    },

    applyGridStyleCls: function() {
        let me = this;
        // Geometry is computed in relayoutTiles(); just trigger a relayout.
        me.relayoutTiles();
    },

    gridCapacity: function() {
        let me = this;
        let style = me.styles[me.gridStyle] || me.styles['9'];
        return style.cap; // 0 == auto (show everything)
    },

    // ---- mode / overlays ---------------------------------------------------

    setMode: function(mode) {
        let me = this;
        me.mode = mode;
        me.tiles.forEach((t) => t.setMode(mode));
        me.persistState();
    },

    setOverlay: function(show) {
        let me = this;
        me.showOverlay = show;
        me.tiles.forEach((t) => t.setShowOverlay(show));
        me.persistState();
    },

    setShowLabel: function(show) {
        let me = this;
        me.showLabel = show;
        me.tiles.forEach((t) => t.setShowLabel(show));
        me.persistState();
    },

    toggleWallFullscreen: function() {
        let me = this;
        let dom = me.el && me.el.dom;
        if (!dom) {
            return;
        }
        if (document.fullscreenElement) {
            document.exitFullscreen();
        } else if (dom.requestFullscreen) {
            dom.requestFullscreen();
        }
    },

    // ---- console ordering / positions --------------------------------------

    // While a tile is being dragged, disable pointer events on every console
    // iframe so drag/drop events reach the tile divs (iframes otherwise swallow
    // them). Re-enabled on drop/dragend.
    beginTileDrag: function() {
        let me = this;
        let g = me.down('#wallGrid');
        if (g && g.el) {
            g.el.addCls('pcw-dragging-active');
        }
    },

    endTileDrag: function() {
        let me = this;
        let g = me.down('#wallGrid');
        if (g && g.el) {
            g.el.removeCls('pcw-dragging-active');
        }
    },

    // Move `fromKey` to occupy the position currently held by `toKey`.
    reorderTile: function(fromKey, toKey) {
        let me = this;
        let fromIdx = me.selection.indexOf(fromKey);
        let toIdx = me.selection.indexOf(toKey);
        if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) {
            return;
        }
        me.selection.splice(fromIdx, 1);
        let insertAt = me.selection.indexOf(toKey);
        // drop after the target when moving forward, before when moving back
        if (fromIdx < toIdx) {
            insertAt += 1;
        }
        me.selection.splice(insertAt, 0, fromKey);
        me.commitOrderChange();
    },

    // Shift a console one position back (-1) or forward (+1).
    moveTile: function(key, delta) {
        let me = this;
        let idx = me.selection.indexOf(key);
        if (idx === -1) {
            return;
        }
        let target = idx + delta;
        if (target < 0 || target >= me.selection.length) {
            return;
        }
        let tmp = me.selection[target];
        me.selection[target] = me.selection[idx];
        me.selection[idx] = tmp;
        me.commitOrderChange();
    },

    // Promote a console to the first (hero) position.
    setAsMain: function(key) {
        let me = this;
        let idx = me.selection.indexOf(key);
        if (idx <= 0) {
            return;
        }
        me.selection.splice(idx, 1);
        me.selection.unshift(key);
        me.commitOrderChange();
    },

    // Apply a new order. When every selected console is on screen we relocate
    // the live tiles (preserving their noVNC sessions); otherwise we re-page.
    commitOrderChange: function() {
        let me = this;
        me.persistState();

        let container = me.down('#wallGrid');
        let onePage = me.gridCapacity() <= 0 || me.selection.length <= me.gridCapacity();
        if (!container || !onePage || me.tiles.length !== me.selection.length) {
            me.rebuildTiles();
            return;
        }

        // Reorder existing components without destroying their sessions.
        let byKey = {};
        me.tiles.forEach((t) => { byKey[t.key()] = t; });
        me.selection.forEach(function(key, idx) {
            let tile = byKey[key];
            if (tile) {
                container.insert(idx, tile); // moving an existing child just relocates it
            }
        });
        me.tiles = me.selection.map((k) => byKey[k]).filter((t) => t);
        me.relayoutTiles();
    },

    // ---- auto-rotation -----------------------------------------------------

    toggleRotation: function(on) {
        let me = this;
        me.rotate = on;
        me.rotateOffset = 0;
        if (on) {
            me.startRotation();
        } else {
            me.stopRotation();
        }
        me.rebuildTiles();
    },

    startRotation: function() {
        let me = this;
        me.stopRotation();
        me.rotateTimer = Ext.interval(function() {
            let cap = me.gridCapacity();
            if (cap > 0 && me.selection.length > cap) {
                me.rotateOffset = (me.rotateOffset + cap) % me.selection.length;
                me.rebuildTiles();
            }
        }, 15000);
    },

    stopRotation: function() {
        let me = this;
        if (me.rotateTimer) {
            clearInterval(me.rotateTimer);
            me.rotateTimer = null;
        }
    },

    // ---- layout persistence ------------------------------------------------

    currentStateObject: function() {
        let me = this;
        // selection is ordered, so saving it captures console positions too
        return {
            version: 2,
            selection: me.selection,
            gridStyle: me.gridStyle,
            mode: me.mode,
            showOverlay: me.showOverlay,
            showLabel: me.showLabel,
        };
    },

    // Every user action calls this. It writes to localStorage immediately and
    // debounces a server-side autosave so a reconnect restores the same state.
    persistState: function() {
        let me = this;
        let state = me.currentStateObject();
        try {
            localStorage.setItem('pcw-last-state', Ext.encode(state));
        } catch (e) {
            // storage may be unavailable/full; non-fatal
        }
        me.scheduleAutosave(state);
    },

    scheduleAutosave: function(state) {
        let me = this;
        if (me.autosaveTimer) {
            clearTimeout(me.autosaveTimer);
        }
        // Coalesce bursts (e.g. dragging tiles) into one write.
        me.autosaveTimer = Ext.defer(function() {
            me.autosaveTimer = null;
            me.sendAutosave(state);
        }, 800);
    },

    sendAutosave: function(state) {
        let me = this;
        Proxmox.Utils.API2Request({
            url: '/cluster/console-wall/layouts',
            method: 'POST',
            params: { name: me.autosaveName, config: Ext.encode(state) },
            failure: function() {
                // No backend / offline: localStorage already holds the state.
            },
        });
    },

    // Force a pending autosave to fire now (e.g. when leaving the view).
    flushAutosave: function() {
        let me = this;
        if (me.autosaveTimer) {
            clearTimeout(me.autosaveTimer);
            me.autosaveTimer = null;
            me.sendAutosave(me.currentStateObject());
        }
    },

    loadPersistedState: function() {
        let me = this;
        // Prefer the server-side autosave so reconnecting from any browser or
        // cluster node restores everything; fall back to browser-local state.
        Proxmox.Utils.API2Request({
            url: '/cluster/console-wall/layouts',
            method: 'GET',
            success: function(response) {
                let list = response.result.data || [];
                let auto = Ext.Array.findBy(list, (l) => l.name === me.autosaveName);
                if (auto) {
                    let s = null;
                    try {
                        s = Ext.decode(auto.config);
                    } catch (e) {
                        s = null;
                    }
                    if (s) {
                        me.restoreState(s);
                        return;
                    }
                }
                me.loadLocalState();
            },
            failure: function() {
                me.loadLocalState();
            },
        });
    },

    loadLocalState: function() {
        let me = this;
        let raw;
        try {
            raw = localStorage.getItem('pcw-last-state');
        } catch (e) {
            raw = null;
        }
        let s = {};
        if (raw) {
            try {
                s = Ext.decode(raw) || {};
            } catch (e) {
                s = {};
            }
        }
        me.restoreState(s);
    },

    // Apply a saved/auto-saved state object to the live wall.
    restoreState: function(s) {
        let me = this;
        me.selection = s.selection || [];
        // accept both the new gridStyle and the legacy gridSize field
        me.gridStyle = me.normalizeStyle(s.gridStyle || s.gridSize);
        me.mode = s.mode || 'interactive';
        me.showOverlay = s.showOverlay !== false;
        me.showLabel = s.showLabel !== false;
        me.rotateOffset = 0;
        me.syncToolbarFromState();
        me.applyGridStyleCls();
        me.ensureRebuildAfterLoad();
    },

    // Resolving selection keys needs the cluster resource store; rebuild once
    // it has data (immediately if already loaded).
    ensureRebuildAfterLoad: function() {
        let me = this;
        if (me.resourceStore.getData().getCount() > 0) {
            me.rebuildTiles();
        } else {
            me.resourceStore.on('load', function() {
                me.rebuildTiles();
            }, me, { single: true });
        }
    },

    // Reflect the current state in the toolbar controls (without re-firing
    // their change handlers).
    syncToolbarFromState: function() {
        let me = this;
        let combo = me.down('#styleCombo');
        if (combo) {
            combo.suspendEvents();
            combo.setValue(me.gridStyle);
            combo.resumeEvents();
        }
        let mode = me.down('#modeBtn');
        if (mode) {
            mode.suspendEvents();
            mode.setValue(me.mode);
            mode.resumeEvents();
        }
        let ov = me.down('#overlayBtn');
        if (ov) {
            ov.setPressed(me.showOverlay);
        }
        let lb = me.down('#labelBtn');
        if (lb) {
            lb.setPressed(me.showLabel);
        }
    },

    saveLayoutDialog: function() {
        let me = this;
        Ext.Msg.prompt(gettext('Save Layout'), gettext('Layout name:'), function(btn, name) {
            if (btn !== 'ok' || !name) {
                return;
            }
            if (name === me.autosaveName) {
                Ext.Msg.alert(gettext('Error'), gettext('That name is reserved.'));
                return;
            }
            me.saveNamedLayout(name);
        });
    },

    saveNamedLayout: function(name) {
        let me = this;
        // Persist server-side so layouts follow the user across browsers.
        Proxmox.Utils.API2Request({
            url: '/cluster/console-wall/layouts',
            method: 'POST',
            params: {
                name: name,
                config: Ext.encode(me.currentStateObject()),
            },
            success: function() {
                // Saved silently: no confirmation message.
            },
            failure: function(response) {
                // Fall back to browser storage if the backend module is absent.
                me.saveLayoutLocal(name);
            },
        });
    },

    saveLayoutLocal: function(name) {
        let me = this;
        let store = me.readLocalLayouts();
        store[name] = me.currentStateObject();
        try {
            localStorage.setItem('pcw-layouts', Ext.encode(store));
            // Saved silently: no confirmation message.
        } catch (e) {
            // storage unavailable; stay silent (autosave/localStorage best-effort)
        }
    },

    readLocalLayouts: function() {
        try {
            return Ext.decode(localStorage.getItem('pcw-layouts')) || {};
        } catch (e) {
            return {};
        }
    },

    populateLayoutsMenu: function(menu) {
        let me = this;
        menu.removeAll();
        // Try the backend first, then merge local layouts.
        Proxmox.Utils.API2Request({
            url: '/cluster/console-wall/layouts',
            method: 'GET',
            success: function(response) {
                let list = response.result.data || [];
                me.buildLayoutsMenuItems(menu, list.map((l) => ({
                    name: l.name,
                    config: Ext.decode(l.config),
                    remote: true,
                })));
            },
            failure: function() {
                let local = me.readLocalLayouts();
                me.buildLayoutsMenuItems(menu, Object.keys(local).map((k) => ({
                    name: k,
                    config: local[k],
                    remote: false,
                })));
            },
        });
    },

    buildLayoutsMenuItems: function(menu, layouts) {
        let me = this;
        menu.removeAll();
        // Never surface the reserved autosave state as a named layout.
        layouts = layouts.filter((l) => l.name !== me.autosaveName);
        if (!layouts.length) {
            menu.add({ text: gettext('No saved layouts'), disabled: true });
            return;
        }
        layouts.forEach(function(l) {
            menu.add({
                text: l.name,
                iconCls: 'fa fa-th',
                handler: () => me.applyLayout(l.config),
            });
        });
    },

    applyLayout: function(cfg) {
        let me = this;
        if (!cfg) {
            return;
        }
        me.selection = cfg.selection || [];
        me.gridStyle = me.normalizeStyle(cfg.gridStyle || cfg.gridSize);
        me.mode = cfg.mode || me.mode;
        me.showOverlay = cfg.showOverlay !== false;
        me.showLabel = cfg.showLabel !== false;
        me.rotateOffset = 0;
        me.syncToolbarFromState();
        me.applyGridStyleCls();
        me.rebuildTiles();
        me.persistState();
    },
});
