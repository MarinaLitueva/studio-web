#!/usr/bin/env bash
# Local / docker-compose startup for the graph-postgres image.
#
# The base is a CloudNativePG operand: `Entrypoint: none`, `Cmd: ["bash"]`,
# user 26. In Kubernetes the CNPG operator supplies the instance-manager
# command AND the runAsUser, so this ENTRYPOINT and the image USER are both
# overridden and NEVER run there — the k8s contract is unchanged. Under plain
# `docker compose` the container would otherwise just run `bash` and exit 0;
# this script gives it the official-image behaviour instead: initdb on first
# boot, apply POSTGRES_* + /docker-entrypoint-initdb.d, then exec a real server.
set -Eeuo pipefail

PGUID=26
export PATH="/usr/lib/postgresql/19/bin:${PATH}"
export PGDATA="${PGDATA:-/var/lib/postgresql/data}"
DEFAULT_USER="${POSTGRES_USER:-postgres}"

as_pg() { setpriv --reuid="$PGUID" --regid="$PGUID" --clear-groups "$@"; }

# Named volumes come up root-owned; postgres refuses a data dir it does not own.
mkdir -p "$PGDATA"
chown -R "$PGUID:$PGUID" "$PGDATA"
chmod 700 "$PGDATA"

# postgres (uid 26) must own its runtime socket/lock dir. It defaults to
# /var/run/postgresql, which is root-owned tmpfs recreated on every boot, so
# (re)create it before the server starts — otherwise the final server dies with
# "could not create lock file .../.s.PGSQL.5432.lock: Permission denied".
install -d -o "$PGUID" -g "$PGUID" -m 2775 /var/run/postgresql

if [ ! -s "$PGDATA/PG_VERSION" ]; then
    echo "graph-postgres entrypoint: initialising $PGDATA"
    pwfile="$(mktemp)"
    printf '%s' "${POSTGRES_PASSWORD:-}" > "$pwfile"
    chown "$PGUID" "$pwfile"
    as_pg initdb -D "$PGDATA" --username="$DEFAULT_USER" \
        --pwfile="$pwfile" --auth-local=trust --auth-host=scram-sha-256 \
        --encoding=UTF8 --no-locale
    rm -f "$pwfile"

    echo "listen_addresses = '*'" >> "$PGDATA/postgresql.conf"
    echo "host all all all scram-sha-256" >> "$PGDATA/pg_hba.conf"

    # Bootstrap on a private unix socket (no TCP yet) to create the app DB and
    # run the initdb.d scripts, exactly like the official postgres image.
    as_pg pg_ctl -D "$PGDATA" \
        -o "-c listen_addresses='' -c unix_socket_directories=/tmp" -w start

    db="${POSTGRES_DB:-}"
    if [ -n "$db" ] && [ "$db" != "postgres" ]; then
        as_pg psql -v ON_ERROR_STOP=1 -h /tmp -U "$DEFAULT_USER" -d postgres \
            -c "CREATE DATABASE \"$db\" OWNER \"$DEFAULT_USER\";"
    fi
    target_db="${db:-postgres}"
    for f in /docker-entrypoint-initdb.d/*.sql; do
        [ -e "$f" ] || continue
        echo "graph-postgres entrypoint: applying $f"
        as_pg psql -v ON_ERROR_STOP=1 -h /tmp -U "$DEFAULT_USER" -d "$target_db" -f "$f"
    done

    as_pg pg_ctl -D "$PGDATA" -m fast -w stop
    echo "graph-postgres entrypoint: initialisation complete"
fi

exec setpriv --reuid="$PGUID" --regid="$PGUID" --clear-groups postgres -D "$PGDATA"
