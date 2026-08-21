#!/usr/bin/env bash
# Genera un <archivo>.min.js junto a cada script clásico (sin import/export,
# cargado vía <script src>, no módulo ES) en js/.
# Corre en build.sh antes del commit, así el .min.js nunca queda
# desactualizado respecto al fuente legible que se edita a mano.
#
# Los módulos ES (player.js, sync-engine.js, progress.js, etc.) NO se tocan:
# minificarlos sin --bundle no ahorra mucho y renombrarlos rompería los
# import specifiers cruzados entre módulos.
#
# index.html enlaza directamente los .min.js — el .js original se mantiene
# como fuente editable y versionada en git.
set -euo pipefail
cd "$(dirname "$0")/../js"

ESBUILD_VERSION="0.24.0"

shopt -s nullglob
for js in *.js; do
  [[ "$js" == *.min.js ]] && continue
  if grep -qE '^\s*(export |import )' "$js"; then
    continue # módulo ES, no tocar
  fi
  out="${js%.js}.min.js"
  npx --yes "esbuild@${ESBUILD_VERSION}" "$js" --minify --outfile="$out" --log-level=warning
  echo "  ✓ $js → $out"
done
