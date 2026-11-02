#!/bin/bash
# Publica o motor no Railway do ESCRITÓRIO.
# Token de projeto em ~/.mv-railway-token (nunca o de outra operação).
set -euo pipefail

TOKEN_ARQ="$HOME/.mv-railway-token"
if [ ! -f "$TOKEN_ARQ" ]; then
  echo "Falta o token do Railway do escritório em $TOKEN_ARQ. Nada foi publicado." >&2
  exit 1
fi

# a partir da raiz do repositório, empacota SÓ a pasta motor/ (sem --path-as-root o CLI
# empacotaria o projeto inteiro); node_modules fica de fora pelo .gitignore
cd "$(dirname "$0")/.."
RAILWAY_TOKEN="$(cat "$TOKEN_ARQ")" railway up motor --path-as-root --service mv-motor --detach
echo "Lembrete: 1 réplica só; conferir o healthcheck em / no painel."
