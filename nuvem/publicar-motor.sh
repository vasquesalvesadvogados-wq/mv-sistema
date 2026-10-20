#!/bin/bash
# Publica o motor no Railway do ESCRITÓRIO.
# Token de projeto em ~/.mv-railway-token (nunca o de outra operação).
set -euo pipefail

TOKEN_ARQ="$HOME/.mv-railway-token"
if [ ! -f "$TOKEN_ARQ" ]; then
  echo "Falta o token do Railway do escritório em $TOKEN_ARQ. Nada foi publicado." >&2
  exit 1
fi

cd "$(dirname "$0")/../motor"
RAILWAY_TOKEN="$(cat "$TOKEN_ARQ")" railway up --service mv-motor --detach
echo "Lembrete: 1 réplica só; conferir o healthcheck em / no painel."
