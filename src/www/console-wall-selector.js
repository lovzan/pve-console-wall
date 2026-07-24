/*
 * Proxmox Console Wall - VM Selector
 *
 * Modal picker for choosing which guests appear on the wall. Supports free-text
 * search plus filtering by node and by tag, and multi-select with checkboxes.
 *
 * Part of the pve-console-wall plugin. Distributed under AGPL-3.0.
 */
/* global Ext, Proxmox, PVE, gettext */

Ext.define('PVE.consolewall.VMSelector', {
    extend: 'Ext.window.Window',
    xtype: 'pveConsoleWallSelector',

    title: gettext('Select VMs for Console Wall'),
    modal: true,
    width: 720,
    height: 560,
    layout: 'fit',

    config: {
        resourceStore: null,
        selection: [],
        callback: Ext.emptyFn,
    },

    resourceKey: function(d) {
        return d.node + '/' + (d.type === 'lxc' ? 'lxc' : 'qemu') + '/' + d.vmid;
    },

    initComponent: function() {
        let me = this;

        // Build a flat store from the live cluster resources.
        let selected = {};
        (me.getSelection() || []).forEach((k) => { selected[k] = true; });

        let records = [];
        me.getResourceStore().getData().each(function(r) {
            let d = r.data;
            if (d.type !== 'qemu' && d.type !== 'lxc') {
                return;
            }
            let key = me.resourceKey(d);
            records.push({
                key: key,
                vmid: d.vmid,
                name: d.name || '',
                node: d.node,
                type: d.type,
                status: d.status,
                tags: d.tags || '',
                checked: !!selected[key],
            });
        });

        me.gridStore = Ext.create('Ext.data.Store', {
            fields: ['key', 'vmid', 'name', 'node', 'type', 'status', 'tags', 'checked'],
            data: records,
            sorters: [{ property: 'vmid', direction: 'ASC' }],
        });

        let nodes = Ext.Array.unique(records.map((r) => r.node)).sort();
        let tags = Ext.Array.unique(
            records.reduce((acc, r) => acc.concat(r.tags ? r.tags.split(/[;,\s]+/) : []), [])
                .filter((t) => t)
        ).sort();

        me.items = [{
            xtype: 'grid',
            itemId: 'vmGrid',
            store: me.gridStore,
            selModel: { type: 'checkboxmodel', checkOnly: false, showHeaderCheckbox: true },
            tbar: [{
                xtype: 'textfield',
                emptyText: gettext('Search name or VMID'),
                width: 220,
                enableKeyEvents: true,
                listeners: { change: (f, v) => me.applyFilters() },
                itemId: 'searchField',
            }, {
                xtype: 'combo',
                emptyText: gettext('All nodes'),
                width: 150,
                editable: false,
                store: [''].concat(nodes),
                itemId: 'nodeFilter',
                listeners: { change: (f, v) => me.applyFilters() },
            }, {
                xtype: 'combo',
                emptyText: gettext('All tags'),
                width: 150,
                editable: false,
                store: [''].concat(tags),
                itemId: 'tagFilter',
                listeners: { change: (f, v) => me.applyFilters() },
            }, '->', {
                xtype: 'tbtext',
                itemId: 'countText',
            }],
            columns: [{
                text: gettext('VMID'),
                dataIndex: 'vmid',
                width: 80,
            }, {
                text: gettext('Name'),
                dataIndex: 'name',
                flex: 1,
            }, {
                text: gettext('Node'),
                dataIndex: 'node',
                width: 120,
            }, {
                text: gettext('Type'),
                dataIndex: 'type',
                width: 70,
                renderer: (v) => v === 'lxc' ? 'CT' : 'VM',
            }, {
                text: gettext('Status'),
                dataIndex: 'status',
                width: 90,
                renderer: function(v) {
                    let cls = v === 'running' ? 'pcw-run' : 'pcw-stop';
                    return '<span class="' + cls + '">' + Ext.String.htmlEncode(v) + '</span>';
                },
            }, {
                text: gettext('Tags'),
                dataIndex: 'tags',
                flex: 1,
                renderer: (v) => Ext.String.htmlEncode(v || ''),
            }],
            listeners: {
                afterrender: function(grid) {
                    // preselect according to incoming selection
                    let sm = grid.getSelectionModel();
                    let toSelect = [];
                    me.gridStore.each(function(rec) {
                        if (rec.get('checked')) {
                            toSelect.push(rec);
                        }
                    });
                    sm.select(toSelect, true);
                    me.updateCount();
                },
                selectionchange: () => me.updateCount(),
            },
        }];

        me.buttons = [{
            text: gettext('Clear'),
            handler: function() {
                me.down('#vmGrid').getSelectionModel().deselectAll();
            },
        }, '->', {
            text: gettext('Cancel'),
            handler: () => me.close(),
        }, {
            text: gettext('Apply'),
            handler: () => me.apply(),
        }];

        me.callParent();
    },

    applyFilters: function() {
        let me = this;
        let search = (me.down('#searchField').getValue() || '').toLowerCase();
        let node = me.down('#nodeFilter').getValue();
        let tag = me.down('#tagFilter').getValue();

        me.gridStore.clearFilter(true);
        me.gridStore.filterBy(function(rec) {
            let d = rec.data;
            if (node && d.node !== node) {
                return false;
            }
            if (tag && (!d.tags || d.tags.split(/[;,\s]+/).indexOf(tag) === -1)) {
                return false;
            }
            if (search) {
                let hay = (d.name + ' ' + d.vmid).toLowerCase();
                if (hay.indexOf(search) === -1) {
                    return false;
                }
            }
            return true;
        });
    },

    updateCount: function() {
        let me = this;
        let grid = me.down('#vmGrid');
        if (!grid) {
            return;
        }
        let n = grid.getSelectionModel().getCount();
        me.down('#countText').setText(Ext.String.format(gettext('{0} selected'), n));
    },

    apply: function() {
        let me = this;
        let sm = me.down('#vmGrid').getSelectionModel();
        let keys = sm.getSelection().map((rec) => rec.get('key'));
        me.getCallback()(keys);
        me.close();
    },
});
