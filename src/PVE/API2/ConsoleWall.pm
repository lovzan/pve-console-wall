package PVE::API2::ConsoleWall;

# REST API for the Console Wall plugin.
#
# Exposes per-user saved layouts under /cluster/console-wall/layouts. All
# console streaming and VM actions reuse the existing Proxmox VE API
# (vncproxy / vncwebsocket / status), so this module only adds persistence.
#
# Part of the pve-console-wall plugin. Distributed under AGPL-3.0.

use strict;
use warnings;

use PVE::Tools;
use PVE::Exception qw(raise_param_exc);
use PVE::JSONSchema qw(get_standard_option);
use PVE::RESTHandler;
use PVE::RPCEnvironment;
use PVE::ConsoleWall::Config;

use base qw(PVE::RESTHandler);

__PACKAGE__->register_method({
    name => 'index',
    path => '',
    method => 'GET',
    description => "Console Wall index.",
    permissions => { user => 'all' },
    parameters => {
        additionalProperties => 0,
        properties => {},
    },
    returns => {
        type => 'array',
        items => {
            type => "object",
            properties => { subdir => { type => 'string' } },
        },
        links => [ { rel => 'child', href => "{subdir}" } ],
    },
    code => sub {
        return [
            { subdir => 'layouts' },
        ];
    },
});

__PACKAGE__->register_method({
    name => 'list_layouts',
    path => 'layouts',
    method => 'GET',
    description => "List the calling user's saved Console Wall layouts.",
    permissions => { user => 'all' },
    parameters => {
        additionalProperties => 0,
        properties => {},
    },
    returns => {
        type => 'array',
        items => {
            type => 'object',
            properties => {
                name => { type => 'string' },
                config => { type => 'string' },
                mtime => { type => 'integer', optional => 1 },
            },
        },
    },
    code => sub {
        my ($param) = @_;

        my $rpcenv = PVE::RPCEnvironment::get();
        my $userid = $rpcenv->get_user();

        my $layouts = PVE::ConsoleWall::Config::load_layouts($userid);
        my $res = [];
        foreach my $name (sort keys %$layouts) {
            my $l = $layouts->{$name};
            push @$res, {
                name => $l->{name} // $name,
                config => $l->{config},
                mtime => $l->{mtime},
            };
        }
        return $res;
    },
});

__PACKAGE__->register_method({
    name => 'save_layout',
    path => 'layouts',
    method => 'POST',
    protected => 1,
    description => "Create or update a saved Console Wall layout for the calling user.",
    permissions => { user => 'all' },
    parameters => {
        additionalProperties => 0,
        properties => {
            name => {
                type => 'string',
                description => "Layout name.",
                maxLength => 64,
            },
            config => {
                type => 'string',
                description => "Opaque JSON-encoded layout configuration.",
                maxLength => 65536,
            },
        },
    },
    returns => { type => 'null' },
    code => sub {
        my ($param) = @_;

        my $rpcenv = PVE::RPCEnvironment::get();
        my $userid = $rpcenv->get_user();

        eval {
            PVE::ConsoleWall::Config::save_layout($userid, $param->{name}, $param->{config});
        };
        raise_param_exc({ config => $@ }) if $@;

        return undef;
    },
});

__PACKAGE__->register_method({
    name => 'delete_layout',
    path => 'layouts/{name}',
    method => 'DELETE',
    protected => 1,
    description => "Delete a saved Console Wall layout for the calling user.",
    permissions => { user => 'all' },
    parameters => {
        additionalProperties => 0,
        properties => {
            name => {
                type => 'string',
                description => "Layout name.",
                maxLength => 64,
            },
        },
    },
    returns => { type => 'null' },
    code => sub {
        my ($param) = @_;

        my $rpcenv = PVE::RPCEnvironment::get();
        my $userid = $rpcenv->get_user();

        PVE::ConsoleWall::Config::delete_layout($userid, $param->{name});

        return undef;
    },
});

1;
