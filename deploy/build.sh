#!/usr/bin/env bash
# Builds the router image on any machine with Docker.
set -euo pipefail

tag="${IMAGE_TAG:-latest}"

cd "$(dirname "$0")/.."
# The real path: on macOS the temp folder is a symlink, which breaks the links pnpm deploy writes.
out="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$out"' EXIT

pnpm install --frozen-lockfile
pnpm build
pnpm --filter shop-router deploy --prod "$out/router"

docker build -t "shop-router:$tag" -f deploy/Dockerfile "$out/router"
