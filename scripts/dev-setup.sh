#!/usr/bin/env bash
# Arranque local sin Docker: crea BD, instala deps, migra, siembra y levanta backend+frontend.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "== Backend =="
cd "$ROOT_DIR/backend"
[ -f .env ] || cp .env.example .env
npm install
npx prisma migrate dev --name init
npm run db:seed

echo "== Frontend =="
cd "$ROOT_DIR/frontend"
[ -f .env ] || cp .env.example .env
npm install

echo "Setup completo. Arranca 'npm run dev' en /backend y /frontend en dos terminales."
