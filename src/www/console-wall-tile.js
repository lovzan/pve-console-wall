/*
 * Proxmox Console Wall - Console Tile
 *
 * A single VM console tile. Establishes a live noVNC session against an
 * existing Proxmox VNC WebSocket proxy, renders live status overlays and
 * exposes quick VM power actions.
 *
 * Part of the pve-console-wall plugin. Distributed under AGPL-3.0.
 */
/* global Ext, Proxmox, PVE, gettext */

Ext.define('PVE.consolewall.ConsoleTile', {
    extend: 'Ext.panel.Panel',
    alias: 'widget.pveConsoleWallTile',
    xtype: 'pveConsoleWallTile',

    cls: 'pcw-tile',
    bodyCls: 'pcw-tile-body',
    layout: 'fit',
    border: false,

    config: {
        // { vmid, node, name, type ('qemu'|'lxc'), status }
        vmResource: null,
        // 'interactive' | 'readonly'
        mode: 'interactive',
        // poll interval for the status overlay, in ms
        statusInterval: 3000,
        // whether the CPU/RAM/net metrics overlay is visible
        showOverlay: true,
        // whether the name/ID/tags label overlay is visible
        showLabel: true,
    },

    // runtime state
    statusTimer: null,
    connected: false,
    consoleLoaded: false,
    destroyed_: false,

    initComponent: function() {
        let me = this;
        let res = me.getVmResource() || {};

        me.title = undefined; // we render our own header bar

        me.tbar = me.buildToolbar();

        me.consoleId = 'pcw-console-' + res.node + '-' + res.vmid + '-' + Ext.id();

        // We embed Proxmox's own noVNC console page in an iframe rather than
        // importing a noVNC module: novnc-pve ships only a bundled app.js (no
        // core/rfb.js), and the iframe reuses Proxmox's auth/ticket flow and
        // works across PVE versions.
        me.items = [{
            xtype: 'container',
            layout: 'fit',
            items: [{
                xtype: 'component',
                cls: 'pcw-console-holder',
                html: '<iframe id="' + me.consoleId + '" class="pcw-console-frame" ' +
                          'frameborder="0" scrolling="no" allowfullscreen></iframe>' +
                      '<div class="pcw-overlay pcw-overlay-label"></div>' +
                      '<div class="pcw-overlay pcw-overlay-metrics"></div>' +
                      '<div class="pcw-overlay pcw-overlay-status"></div>',
            }],
        }];

        me.callParent();

        me.on('afterrender', function() {
            me.renderLabel();
            me.setupDragDrop();
            me.startConsole();
        }, me);
        me.on('beforedestroy', me.shutdownTile, me);
    },

    // Stable identifier used for ordering/selection: "node/type/vmid".
    key: function() {
        let res = this.getVmResource() || {};
        return res.node + '/' + (res.type === 'lxc' ? 'lxc' : 'qemu') + '/' + res.vmid;
    },

    getWall: function() {
        return this.up('pveConsoleWall');
    },

    buildToolbar: function() {
        let me = this;
        let res = me.getVmResource() || {};
        let label = res.name ? (res.name + ' (' + res.vmid + ')') : ('VM ' + res.vmid);

        return {
            cls: 'pcw-tile-tbar',
            items: [{
                xtype: 'button',
                iconCls: 'fa fa-arrows',
                cls: 'pcw-drag-handle',
                itemId: 'dragHandle',
                tooltip: gettext('Drag to reposition'),
            }, {
                xtype: 'tbtext',
                cls: 'pcw-tile-title',
                html: '<span class="pcw-status-dot" data-role="dot"></span>' +
                      Ext.String.htmlEncode(label) +
                      ' <span class="pcw-node-label">' +
                      Ext.String.htmlEncode(res.node || '') + '</span>',
                itemId: 'titleText',
            }, '->', {
                xtype: 'button',
                iconCls: 'fa fa-star',
                tooltip: gettext('Set as main (hero) tile'),
                handler: () => { let w = me.getWall(); if (w) { w.setAsMain(me.key()); } },
            }, {
                xtype: 'button',
                iconCls: 'fa fa-chevron-left',
                tooltip: gettext('Move back'),
                handler: () => { let w = me.getWall(); if (w) { w.moveTile(me.key(), -1); } },
            }, {
                xtype: 'button',
                iconCls: 'fa fa-chevron-right',
                tooltip: gettext('Move forward'),
                handler: () => { let w = me.getWall(); if (w) { w.moveTile(me.key(), 1); } },
            }, '-', {
                xtype: 'button',
                iconCls: 'fa fa-play',
                tooltip: gettext('Start'),
                handler: () => me.vmAction('start'),
            }, {
                xtype: 'button',
                iconCls: 'fa fa-power-off',
                tooltip: gettext('Shutdown'),
                handler: () => me.vmAction('shutdown'),
            }, {
                xtype: 'button',
                iconCls: 'fa fa-stop',
                tooltip: gettext('Stop'),
                handler: () => me.vmAction('stop', true),
            }, {
                xtype: 'button',
                iconCls: 'fa fa-refresh',
                tooltip: gettext('Reset'),
                handler: () => me.vmAction('reset', true),
            }, {
                xtype: 'button',
                iconCls: 'fa fa-camera',
                tooltip: gettext('Snapshot'),
                handler: () => me.snapshot(),
            }, '-', {
                xtype: 'button',
                iconCls: 'fa fa-plug',
                tooltip: gettext('Reconnect'),
                handler: () => me.reconnect(),
            }, {
                xtype: 'button',
                iconCls: 'fa fa-expand',
                tooltip: gettext('Fullscreen'),
                handler: () => me.openFullscreen(),
            }],
        };
    },

    // ---- console lifecycle -------------------------------------------------

    startConsole: function() {
        let me = this;
        if (me.destroyed_) {
            return;
        }
        me.startStatusPolling();

        let res = me.getVmResource();
        if (!res) {
            me.setStatusMessage(gettext('No VM assigned'));
            return;
        }

        // Only connect a console when the guest is actually running.
        if (res.status && res.status !== 'running') {
            me.setStatusMessage(Ext.String.format(gettext('Guest is {0}'), res.status));
            return;
        }

        me.connectConsole();
    },

    // Build the URL of Proxmox's own noVNC console page for this guest.
    consoleUrl: function() {
        let me = this;
        let res = me.getVmResource();
        let consoleType = res.type === 'lxc' ? 'lxc' : 'kvm';
        let params = {
            console: consoleType,
            novnc: 1,
            vmid: res.vmid,
            vmname: res.name || '',
            node: res.node,
            resize: 'scale',
        };
        // Cache-bust so reconnect always reloads a fresh console.
        params._dc = Date.now();
        return '/?' + Ext.Object.toQueryString(params);
    },

    connectConsole: function() {
        let me = this;
        let res = me.getVmResource();
        if (!res || me.destroyed_) {
            return;
        }
        let frame = document.getElementById(me.consoleId);
        if (!frame) {
            return;
        }

        me.setStatusMessage(gettext('Connecting...'));
        me.consoleLoaded = false;

        // The console page authenticates via the session cookie and obtains its
        // own VNC ticket, so we just point the iframe at it.
        frame.onload = function() {
            if (me.destroyed_) {
                return;
            }
            me.consoleLoaded = true;
            me.connected = true;
            me.setStatusMessage(null);
            me.setConnectedState(true);
            me.applyReadonly();
        };
        frame.src = me.consoleUrl();
    },

    reconnect: function() {
        let me = this;
        me.teardownConsole();
        let res = me.getVmResource();
        if (res && (!res.status || res.status === 'running')) {
            me.connectConsole();
        }
    },

    teardownConsole: function() {
        let me = this;
        me.connected = false;
        me.consoleLoaded = false;
        me.setConnectedState(false);
        let frame = document.getElementById(me.consoleId);
        if (frame) {
            frame.onload = null;
            try {
                frame.src = 'about:blank';
            } catch (e) {
                // ignore
            }
        }
    },

    // Read-only mode blocks all input by disabling pointer events on the
    // iframe (keyboard focus cannot reach it without a click).
    applyReadonly: function() {
        let me = this;
        let frame = document.getElementById(me.consoleId);
        if (frame) {
            frame.style.pointerEvents = me.getMode() === 'readonly' ? 'none' : 'auto';
        }
    },

    // ---- status polling & overlays ----------------------------------------

    startStatusPolling: function() {
        let me = this;
        me.pollStatus();
        me.statusTimer = Ext.interval(() => me.pollStatus(), me.getStatusInterval());
    },

    pollStatus: function() {
        let me = this;
        let res = me.getVmResource();
        if (!res || me.destroyed_) {
            return;
        }
        let vmtype = res.type === 'lxc' ? 'lxc' : 'qemu';
        Proxmox.Utils.API2Request({
            url: '/nodes/' + res.node + '/' + vmtype + '/' + res.vmid + '/status/current',
            method: 'GET',
            success: function(response) {
                if (me.destroyed_) {
                    return;
                }
                me.updateMetrics(response.result.data);
            },
            failure: function() {
                // Non-fatal: keep the last known metrics.
            },
        });
    },

    updateMetrics: function(data) {
        let me = this;
        let prevStatus = (me.getVmResource() || {}).status;

        // keep our cached resource status current for reconnect decisions
        let res = me.getVmResource();
        if (res) {
            res.status = data.status;
        }

        let cpu = (data.cpu || 0) * 100;
        let cpus = data.cpus || 1;
        let mem = data.mem || 0;
        let maxmem = data.maxmem || 1;
        let memPct = (mem / maxmem) * 100;
        let netin = data.netin || 0;
        let netout = data.netout || 0;

        let overlay = me.el && me.el.dom.querySelector('.pcw-overlay-metrics');
        if (overlay && me.getShowOverlay() && data.status === 'running') {
            overlay.style.display = '';
            overlay.innerHTML =
                '<span class="pcw-metric"><i class="fa fa-microchip"></i> ' +
                    cpu.toFixed(0) + '% <small>' + cpus + ' cpu</small></span>' +
                '<span class="pcw-metric"><i class="fa fa-memory"></i> ' +
                    memPct.toFixed(0) + '% <small>' + PVE.Utils.render_size(mem) + '</small></span>' +
                '<span class="pcw-metric"><i class="fa fa-exchange"></i> ' +
                    '&darr;' + PVE.Utils.render_size(netin) + ' &uarr;' + PVE.Utils.render_size(netout) + '</span>';
        } else if (overlay) {
            overlay.style.display = 'none';
        }

        me.applyHealthBorder(data.status, cpu, memPct);

        // If the guest just transitioned to running, (re)connect the console.
        if (data.status === 'running' && prevStatus !== 'running' && !me.connected) {
            me.reconnect();
        }
        // If it stopped, tear the console down and show status.
        if (data.status !== 'running') {
            me.teardownConsole();
            me.setStatusMessage(Ext.String.format(gettext('Guest is {0}'), data.status));
        }
    },

    applyHealthBorder: function(status, cpu, memPct) {
        let me = this;
        if (!me.el) {
            return;
        }
        me.el.removeCls(['pcw-health-ok', 'pcw-health-warn', 'pcw-health-crit', 'pcw-health-off']);
        let cls;
        if (status !== 'running') {
            cls = 'pcw-health-off';
        } else if (cpu >= 90 || memPct >= 90) {
            cls = 'pcw-health-crit';
        } else if (cpu >= 70 || memPct >= 75) {
            cls = 'pcw-health-warn';
        } else {
            cls = 'pcw-health-ok';
        }
        me.el.addCls(cls);
    },

    setConnectedState: function(isConnected) {
        let me = this;
        let dot = me.el && me.el.dom.querySelector('[data-role="dot"]');
        if (dot) {
            dot.className = 'pcw-status-dot ' + (isConnected ? 'pcw-dot-on' : 'pcw-dot-off');
        }
    },

    setStatusMessage: function(msg) {
        let me = this;
        let el = me.el && me.el.dom.querySelector('.pcw-overlay-status');
        if (!el) {
            return;
        }
        if (msg) {
            el.style.display = '';
            el.innerHTML = '<span>' + Ext.String.htmlEncode(msg) + '</span>';
        } else {
            el.style.display = 'none';
            el.innerHTML = '';
        }
    },

    // ---- VM actions --------------------------------------------------------

    vmAction: function(action, confirm) {
        let me = this;
        let res = me.getVmResource();
        if (!res) {
            return;
        }
        if (me.getMode() === 'readonly') {
            Ext.Msg.alert(gettext('Read-only'), gettext('Console Wall is in read-only mode.'));
            return;
        }
        let vmtype = res.type === 'lxc' ? 'lxc' : 'qemu';
        let doIt = function() {
            Proxmox.Utils.API2Request({
                url: '/nodes/' + res.node + '/' + vmtype + '/' + res.vmid + '/status/' + action,
                method: 'POST',
                success: function() {
                    Ext.toast(Ext.String.format(gettext('Task {0} started on {1}'),
                        action, res.vmid));
                },
                failure: function(response) {
                    Ext.Msg.alert(gettext('Error'), response.htmlStatus || response.result?.message);
                },
            });
        };
        if (confirm) {
            Ext.Msg.confirm(gettext('Confirm'),
                Ext.String.format(gettext('Really {0} guest {1}?'), action, res.vmid),
                (btn) => { if (btn === 'yes') { doIt(); } });
        } else {
            doIt();
        }
    },

    snapshot: function() {
        let me = this;
        let res = me.getVmResource();
        if (!res || me.getMode() === 'readonly') {
            return;
        }
        let vmtype = res.type === 'lxc' ? 'lxc' : 'qemu';
        let snapname = 'wall_' + Ext.Date.format(new Date(), 'YmdHis');
        Proxmox.Utils.API2Request({
            url: '/nodes/' + res.node + '/' + vmtype + '/' + res.vmid + '/snapshot',
            method: 'POST',
            params: { snapname: snapname },
            success: function() {
                Ext.toast(Ext.String.format(gettext('Snapshot {0} created'), snapname));
            },
            failure: function(response) {
                Ext.Msg.alert(gettext('Error'), response.htmlStatus || response.result?.message);
            },
        });
    },

    openFullscreen: function() {
        let me = this;
        let res = me.getVmResource();
        if (!res) {
            return;
        }
        // Reuse Proxmox's own full console viewer window. Passing no console
        // capability object lets PVE pick its default viewer (noVNC).
        let consoleType = res.type === 'lxc' ? 'lxc' : 'kvm';
        PVE.Utils.openDefaultConsoleWindow(undefined, consoleType, res.vmid, res.node, res.name);
    },

    // ---- config setters used by the wall ----------------------------------

    updateMode: function(mode) {
        let me = this;
        me.applyReadonly();
    },

    updateShowOverlay: function(show) {
        let me = this;
        let overlay = me.el && me.el.dom.querySelector('.pcw-overlay-metrics');
        if (overlay) {
            overlay.style.display = show ? '' : 'none';
        }
    },

    updateShowLabel: function(show) {
        let me = this;
        let overlay = me.el && me.el.dom.querySelector('.pcw-overlay-label');
        if (overlay) {
            overlay.style.display = show ? '' : 'none';
        }
    },

    // ---- name / ID / tags label overlay -----------------------------------

    renderLabel: function() {
        let me = this;
        let res = me.getVmResource() || {};
        let el = me.el && me.el.dom.querySelector('.pcw-overlay-label');
        if (!el) {
            return;
        }
        let typeLabel = res.type === 'lxc' ? 'CT' : 'VM';
        let tagsHtml = '';
        if (res.tags) {
            let tags = res.tags.split(/[;,\s]+/).filter((t) => t);
            tagsHtml = '<span class="pcw-lbl-tags">' +
                tags.map((t) => '<span class="pcw-tag">' + Ext.String.htmlEncode(t) + '</span>').join('') +
                '</span>';
        }
        el.innerHTML =
            '<span class="pcw-lbl-type">' + typeLabel + '</span>' +
            '<span class="pcw-lbl-id">' + Ext.String.htmlEncode('' + res.vmid) + '</span>' +
            '<span class="pcw-lbl-name">' + Ext.String.htmlEncode(res.name || '') + '</span>' +
            tagsHtml;
        el.style.display = me.getShowLabel() ? '' : 'none';
    },

    // ---- drag-and-drop reordering -----------------------------------------

    setupDragDrop: function() {
        let me = this;
        let handle = me.down('#dragHandle');
        if (!handle || !handle.el) {
            return;
        }
        let hdom = handle.el.dom;
        hdom.setAttribute('draggable', 'true');

        hdom.addEventListener('dragstart', function(e) {
            e.dataTransfer.setData('text/pcw-key', me.key());
            e.dataTransfer.effectAllowed = 'move';
            me.el.addCls('pcw-dragging');
        });
        hdom.addEventListener('dragend', function() {
            me.el.removeCls('pcw-dragging');
        });

        let root = me.el.dom;
        root.addEventListener('dragover', function(e) {
            if (e.dataTransfer && Ext.Array.contains(e.dataTransfer.types || [], 'text/pcw-key')) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                me.el.addCls('pcw-drop');
            }
        });
        root.addEventListener('dragleave', function() {
            me.el.removeCls('pcw-drop');
        });
        root.addEventListener('drop', function(e) {
            me.el.removeCls('pcw-drop');
            let from = e.dataTransfer.getData('text/pcw-key');
            if (from && from !== me.key()) {
                e.preventDefault();
                let w = me.getWall();
                if (w) {
                    w.reorderTile(from, me.key());
                }
            }
        });
    },

    // ---- teardown ----------------------------------------------------------

    shutdownTile: function() {
        let me = this;
        me.destroyed_ = true;
        if (me.statusTimer) {
            clearInterval(me.statusTimer);
            me.statusTimer = null;
        }
        me.teardownConsole();
    },
});
