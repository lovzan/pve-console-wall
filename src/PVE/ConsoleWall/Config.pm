package PVE::ConsoleWall::Config;

# Persistence for Console Wall saved layouts.
#
# Layouts are stored per-user as JSON under the Proxmox cluster filesystem
# (/etc/pve), so they are replicated across all nodes and survive failover.
#
# Part of the pve-console-wall plugin. Distributed under AGPL-3.0.

use strict;
use warnings;

use JSON;
use PVE::Tools qw(file_get_contents file_set_contents);
use PVE::Cluster;

# /etc/pve is the pmxcfs cluster filesystem, replicated to every node.
my $basedir = "/etc/pve/console-wall";

sub _userfile {
    my ($userid) = @_;
    die "missing userid\n" if !defined($userid);
    # sanitise: userids look like "root@pam"; keep them filesystem-safe.
    my $safe = $userid;
    $safe =~ s/[^A-Za-z0-9._\@-]/_/g;
    return "$basedir/${safe}.json";
}

sub _ensure_dir {
    if (!-d $basedir) {
        mkdir($basedir) or die "unable to create $basedir: $!\n" if !-d $basedir;
    }
}

# Returns a hashref: { layoutname => { name => ..., config => <json-string>, mtime => ... } }
sub load_layouts {
    my ($userid) = @_;
    my $file = _userfile($userid);
    return {} if !-e $file;
    my $raw = eval { file_get_contents($file) };
    return {} if !$raw;
    my $data = eval { decode_json($raw) };
    return {} if !$data || ref($data) ne 'HASH';
    return $data;
}

sub save_layout {
    my ($userid, $name, $config) = @_;

    die "missing layout name\n" if !defined($name) || $name eq '';
    die "missing layout config\n" if !defined($config);

    # validate that config is well-formed JSON before storing it
    eval { decode_json($config) };
    die "layout config is not valid JSON: $@\n" if $@;

    _ensure_dir();
    my $file = _userfile($userid);

    # Serialize writes with a lock to avoid clobbering concurrent saves.
    PVE::Tools::lock_file("$file.lock", 10, sub {
        my $layouts = load_layouts($userid);
        $layouts->{$name} = {
            name => $name,
            config => $config,
            mtime => time(),
        };
        file_set_contents($file, encode_json($layouts));
    });
    die $@ if $@;

    return 1;
}

sub delete_layout {
    my ($userid, $name) = @_;

    die "missing layout name\n" if !defined($name) || $name eq '';
    my $file = _userfile($userid);
    return 1 if !-e $file;

    PVE::Tools::lock_file("$file.lock", 10, sub {
        my $layouts = load_layouts($userid);
        delete $layouts->{$name};
        file_set_contents($file, encode_json($layouts));
    });
    die $@ if $@;

    return 1;
}

1;
