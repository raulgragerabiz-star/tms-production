#!/bin/sh
# Aplica migraciones pendientes antes de arrancar (a diferencia de dev, aquí se usa
# `migrate deploy`, no `db push`, para respetar el historial de migraciones versionado).
set -e
echo "[entrypoint] Applying pending Prisma migrations..."
npx prisma migrate deploy
echo "[entrypoint] Starting server..."
exec "$@"
