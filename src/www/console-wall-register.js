/*
 * Proxmox Console Wall - Datacenter registration
 *
 * Injects the "Console Wall" item into the Datacenter navigation tree.
 *
 * PVE.dc.Config builds its navigation from `me.items` inside initComponent and
 * then hands them to the PVE.panel.Config base class via callParent(). We wrap
 * initComponent so that, at the moment the base class is about to consume the
 * items, our tab has already been appended.
 *
 * Part of the pve-console-wall plugin. Distributed under AGPL-3.0.
 */
/* global Ext, gettext */

Ext.define('PVE.consolewall.DcConfigOverride', {
    override: 'PVE.dc.Config',

    initComponent: function() {
        let me = this;

        // Wrap callParent for this single invocation: PVE.dc.Config sets
        // me.items just before calling its parent, so this is the right seam
        // to append our entry without duplicating the base construction logic.
        let realCallParent = me.callParent;
        me.callParent = function(args) {
            if (Ext.isArray(me.items)) {
                let already = me.items.some((it) => it && it.itemId === 'consolewall');
                if (!already) {
                    me.items.push({
                        xtype: 'pveConsoleWall',
                        title: gettext('Console Wall'),
                        iconCls: 'fa fa-th',
                        itemId: 'consolewall',
                        // Top-level entry, sibling of Summary/Nodes/Storage.
                    });
                }
            }
            me.callParent = realCallParent;
            return realCallParent.call(me, args);
        };

        me.callParent(arguments);
    },
});
