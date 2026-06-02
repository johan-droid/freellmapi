#!/bin/sh
set -e

DB_PATH="/app/server/data/freeapi.db"
CONFIG_PATH="/app/litestream.yml"

# If Litestream environment variables are set, use it. Otherwise start node directly.
if [ -n "$LITESTREAM_BUCKET" ] && [ -n "$LITESTREAM_ACCESS_KEY_ID" ] && [ -n "$LITESTREAM_SECRET_ACCESS_KEY" ]; then
  echo "[litestream] S3 credentials found. Checking for existing database backups in cloud..."
  
  # Restore database from replica if it exists and local DB doesn't
  litestream restore -if-db-not-exists -if-replica-exists -config "$CONFIG_PATH" "$DB_PATH"
  
  echo "[litestream] Starting application under replication mode..."
  # Replicate writes to the cloud store in real time
  exec litestream replicate -config "$CONFIG_PATH" -exec "node server/dist/index.js"
else
  echo "[litestream] No replica bucket credentials configured. Starting application directly..."
  exec node server/dist/index.js
fi
