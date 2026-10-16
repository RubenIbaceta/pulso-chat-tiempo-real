#!/usr/bin/env sh
# Ejecutar por SSH dentro del servidor de alwaysdata, desde cualquier carpeta.
set -eu

app_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$app_dir"
export NODEJS_VERSION=24

node -e 'if (Number(process.versions.node.split(".")[0]) < 24) { console.error("Selecciona Node.js 24 en Environment > Node.js."); process.exit(1); }'
npm ci --include=dev
npm run build
npm prune --omit=dev

printf '\nPulso compilado. Configura el sitio Node.js para ejecutar:\nnode %s/dist/index.js start\n' "$app_dir"
printf 'Usa las variables del panel indicadas en PUBLICAR.md.\n'
