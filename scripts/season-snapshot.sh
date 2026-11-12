#!/usr/bin/env bash
# Builds one season snapshot from Warcon's database (read only) and installs it in the site's data
# volume. Run from the repo root on a machine with the deploy key; see docs/DEPLOYMENT.md §9b.
#   scripts/season-snapshot.sh season-two 2026-10-14T00:00:00Z 2026-11-12T14:00:00Z
#   scripts/season-snapshot.sh before-season-three -infinity 2026-11-12T14:00:00Z
set -euo pipefail
name=$1 start=$2 cutoff=$3
host=debian@57.129.156.97
ssh_() { ssh -i ~/.ssh/wardogs_deploy "$host" "$@"; }
mkdir -p data
{ printf "\\set start '''%s'''\n\\set cutoff '''%s'''\n" "$start" "$cutoff"; cat scripts/season-one.sql; } |
  ssh_ 'cd /home/debian/warcon && docker compose exec -T db sh -c "psql -v ON_ERROR_STOP=1 -U \$POSTGRES_USER -d \$POSTGRES_DB -At -F \"	\""' |
  node scripts/season-one-db.mjs "data/$name.db"
scp -i ~/.ssh/wardogs_deploy "data/$name.db" "$host:/tmp/"
# Copied under a temp name then moved, as the running site may have the old file open.
ssh_ "docker cp /tmp/$name.db teg-wardogs-site:/app/data/$name.db.new && docker exec teg-wardogs-site mv /app/data/$name.db.new /app/data/$name.db && rm /tmp/$name.db"
echo "installed $name.db"
