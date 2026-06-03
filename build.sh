#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 REGISTRY"
  echo "  e.g. $0 myregistry.com/flyhigh"
  exit 1
fi

REGISTRY="$1"

echo "==> Building..."
docker compose build

echo ""
echo "==> Pushing to ${REGISTRY}..."
docker tag flyhigh-backend  "${REGISTRY}/flyhigh-backend:latest"
docker tag flyhigh-frontend "${REGISTRY}/flyhigh-frontend:latest"
docker push "${REGISTRY}/flyhigh-backend:latest"
docker push "${REGISTRY}/flyhigh-frontend:latest"

echo ""
echo "On the target machine:"
echo "  docker pull ${REGISTRY}/flyhigh-backend:latest"
echo "  docker pull ${REGISTRY}/flyhigh-frontend:latest"
echo "  docker tag  ${REGISTRY}/flyhigh-backend:latest  flyhigh-backend"
echo "  docker tag  ${REGISTRY}/flyhigh-frontend:latest flyhigh-frontend"
echo "  cp .env.docker .env  # edit TILE_SERVER_URL"
echo "  mkdir -p maps missions && cp /path/to/dtm.tif maps/"
echo "  docker compose --env-file .env up -d"
