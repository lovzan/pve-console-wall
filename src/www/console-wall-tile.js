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
    rfb: null,
    reconnectTimer: null,
    statusTimer: null,
    reconnectAttempts: 0,
    connected: false,
    destroyed_: false,

    // noVNC RFB module is loaded lazily and cached across all tiles
    statics: {
        rfbModulePromise: null,
        loadRFB: function() {
            let me = PVE.consolewall.ConsoleTile;
            if (!me.rfbModulePromise) {
                // Proxmox ships noVNC under /novnc/ as ES modules.
                me.rfbModulePromise = import('/novnc/core/rfb.js')
                    .then((mod) => mod.default)
                    .catch((err) => {
                        // Reset so a later tile can retry after a transient failure.
                        me.rfbModulePromise = null;
                        throw err;
                    });
            }
            return me.rfbModulePromise;
        },
    },

    initComponent: function() {
        let me = this;
        let res = me.getVmResource() || {};

        me.title = undefined; // we render our own header bar

        me.tbar = me.buildToolbar();

        me.consoleId = 'pcw-console-' + res.node + '-' + res.vmid + '-' + Ext.id();

        me.items = [{
            xtype: 'container',
            layout: 'fit',
            items: [{
                xtype: 'component',
                cls: 'pcw-console-holder',
                // The div that noVNC will attach its canvas to.
                html: '<div id="' + me.consoleId + '" class="pcw-console-target"></div>' +
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

    connectConsole: function() {
        let me = this;
        let res = me.getVmResource();
        if (!res || me.destroyed_) {
            return;
        }

        me.setStatusMessage(gettext('Connecting...'));

        let vmtype = res.type === 'lxc' ? 'lxc' : 'qemu';
        let baseUrl = '/nodes/' + res.node + '/' + vmtype + '/' + res.vmid;
        let proxyParams = {};
        if (vmtype === 'lxc') {
            proxyParams = { 'websocket': 1 };
        } else {
            proxyParams = { 'websocket': 1, 'generate-password': 0 };
        }

        // 1) Ask Proxmox for a short-lived VNC ticket + port.
        Proxmox.Utils.API2Request({
            url: baseUrl + '/vncproxy',
            method: 'POST',
            params: proxyParams,
            success: function(response) {
                if (me.destroyed_) {
                    return;
                }
                let data = response.result.data;
                me.openRFB(res, vmtype, data);
            },
            failure: function(response) {
                me.setStatusMessage(gettext('Console error') + ': ' +
                    (response.htmlStatus || response.result?.message || ''));
                me.scheduleReconnect();
            },
        });
    },

    openRFB: function(res, vmtype, data) {
        let me = this;

        PVE.consolewall.ConsoleTile.loadRFB().then((RFB) => {
            if (me.destroyed_) {
                return;
            }
            let target = document.getElementById(me.consoleId);
            if (!target) {
                return;
            }
            target.innerHTML = '';

            // 2) Build the authenticated WebSocket URL to the VNC proxy.
            let loc = window.location;
            let proto = loc.protocol === 'https:' ? 'wss' : 'ws';
            let path = '/api2/json/nodes/' + res.node + '/' + vmtype + '/' +
                res.vmid + '/vncwebsocket' +
                '?port=' + encodeURIComponent(data.port) +
                '&vncticket=' + encodeURIComponent(data.ticket);
            let url = proto + '://' + loc.host + path;

            try {
                me.rfb = new RFB(target, url, {
                    credentials: { password: data.ticket },
                    wsProtocols: ['binary'],
                });
            } catch (err) {
                me.setStatusMessage(gettext('Console error') + ': ' + err.message);
                me.scheduleReconnect();
                return;
            }

            me.rfb.viewOnly = me.getMode() === 'readonly';
            me.rfb.scaleViewport = true;
            me.rfb.resizeSession = false;
            me.rfb.background = '#111418';

            me.rfb.addEventListener('connect', () => me.onRfbConnect());
            me.rfb.addEventListener('disconnect', (e) => me.onRfbDisconnect(e));
            me.rfb.addEventListener('securityfailure', (e) => {
                me.setStatusMessage(gettext('Authentication failure'));
            });
        }).catch((err) => {
            me.setStatusMessage(gettext('noVNC failed to load') + ': ' + err.message);
        });
    },

    onRfbConnect: function() {
        let me = this;
        me.connected = true;
        me.reconnectAttempts = 0;
        me.setStatusMessage(null);
        me.setConnectedState(true);
    },

    onRfbDisconnect: function(e) {
        let me = this;
        me.connected = false;
        me.setConnectedState(false);
        if (me.destroyed_) {
            return;
        }
        let clean = e && e.detail && e.detail.clean;
        me.setStatusMessage(clean ? gettext('Disconnected') : gettext('Connection lost'));
        me.scheduleReconnect();
    },

    scheduleReconnect: function() {
        let me = this;
        if (me.destroyed_ || me.reconnectTimer) {
            return;
        }
        me.reconnectAttempts++;
        // Exponential backoff capped at 30s so a wall of dead VMs stays calm.
        let delay = Math.min(30000, 2000 * Math.pow(1.6, me.reconnectAttempts - 1));
        me.reconnectTimer = Ext.defer(function() {
            me.reconnectTimer = null;
            let res = me.getVmResource();
            if (res && (!res.status || res.status === 'running')) {
                me.connectConsole();
            }
        }, delay);
    },

    reconnect: function() {
        let me = this;
        me.teardownRFB();
        me.reconnectAttempts = 0;
        if (me.reconnectTimer) {
            clearTimeout(me.reconnectTimer);
            me.reconnectTimer = null;
        }
        me.connectConsole();
    },

    teardownRFB: function() {
        let me = this;
        if (me.rfb) {
            try {
                me.rfb.disconnect();
            } catch (e) {
                // ignore teardown races
            }
            me.rfb = null;
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
            me.teardownRFB();
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
        if (me.rfb) {
            me.rfb.viewOnly = mode === 'readonly';
        }
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
        if (me.reconnectTimer) {
            clearTimeout(me.reconnectTimer);
            me.reconnectTimer = null;
        }
        me.teardownRFB();
    },
});
