#!/bin/sh
# Deploys (or rolls back to) the image CI built for a commit. Builds nothing: pull, check, swap.
#   sh scripts/deploy.sh <full commit sha>
# A failed pull or doctor leaves the running site untouched. The Deploy workflow runs this over SSH
# after moving the checkout to the same commit (for this script and docker-compose.yml).
set -eu

REPO=ghcr.io/sammcaulay/tegwardogssite
# Images kept for rolling back, besides the one running
KEEP=3

main() {
  sha="${1:?usage: deploy.sh <full commit sha>}"
  image="$REPO:sha-$sha"
  cd "${DEPLOY_DIR:-/home/debian/teg-wardogs-site}"

  echo "pulling $image…"
  docker pull --quiet "$image"

  echo "running doctor…"
  DOCTOR_IMAGE="$image" docker compose run --rm doctor

  docker tag "$image" teg-wardogs-site:current
  docker compose up -d site

  # Old deploys: keep the newest few for rollback, drop the rest.
  docker image ls "$REPO" --format '{{.CreatedAt}}|{{.Repository}}:{{.Tag}}' | sort -r | tail -n "+$((KEEP + 2))" \
    | cut -d'|' -f2 | xargs -r docker rmi >/dev/null 2>&1 || true
  docker image prune -f >/dev/null
  echo "deployed ${sha%"${sha#???????}"}"
}

# All in a function so sh has read the whole file before anything runs: a deploy may replace it.
main "$@"
