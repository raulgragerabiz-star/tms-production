#!/bin/sh
# Este proyecto no usa `prisma migrate` (no existe carpeta prisma/migrations, ni la ha
# habido nunca): el esquema se aplica a mano contra Neon con `npx prisma db push` desde un
# entorno de confianza (ver el resto de esta sesión), ANTES de desplegar el código nuevo
# que dependa de columnas nuevas. El contenedor de producción NUNCA debe intentar migrar
# el esquema por sí mismo al arrancar (antes ejecutaba `prisma migrate deploy`, que fallaba
# porque no hay ninguna migración versionada que aplicar).
set -e
echo "[entrypoint] Starting server..."
exec "$@"
