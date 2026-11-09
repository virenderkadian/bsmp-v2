#!/bin/sh
# Runs a command with the local build secrets loaded from .env.build.local (if it
# exists): the App Store Connect API key path and ids that `eas submit` needs.
# That file is git-ignored — the key's location is specific to one machine and
# must never be committed. See .env.build.local.example.
cd "$(dirname "$0")/.." || exit 1
if [ -f .env.build.local ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env.build.local
  set +a
fi
exec "$@"
