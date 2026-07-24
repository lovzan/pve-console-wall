/*
 * Proxmox Console Wall - Datacenter registration
 *
 * Injects the "Console Wall" item into the Datacenter navigation.
 *
 * PVE.dc.Config builds its list of sub-panels into `me.items` inside its
 * initComponent and then hands them to the base class PVE.panel.Config via
 * callParent(). We override PVE.panel.Config.initComponent (the base) and, for
 * the Datacenter instance only, append our tab to `me.items` *before* the base
 * consumes it. This uses a normal callParent() with no rebinding, so it is
 * robust across PVE 7/8/9.
 *
 * Part of the pve-console-wall plugin. Distributed under AGPL-3.0.
 */
/* global Ext, PVE, gettext */

Ext.define('PVE.consolewall.PanelConfigOverride', {
    override: 'PVE.panel.Config',

    initComponent: function() {
        let me = this;

        try {
            // Only touch the Datacenter config panel, not node/guest/storage.
            if (typeof PVE !== 'undefined' && PVE.dc && PVE.dc.Config &&
                me instanceof PVE.dc.Config && Ext.isArray(me.items)) {

                let exists = me.items.some((it) => it && it.itemId === 'consolewall');
                if (!exists) {
                    me.items.push({
                        xtype: 'pveConsoleWall',
                        title: gettext('Console Wall'),
                        iconCls: 'fa fa-th',
                        itemId: 'consolewall',
                    });
                }
            }
        } catch (e) {
            if (window.console) {
                window.console.error('console-wall: menu injection failed', e);
            }
        }

        me.callParent();
    },
});
