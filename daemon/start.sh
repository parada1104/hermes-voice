#!/usr/bin/env bash
# Arranca el daemon conector de Hermes Voice con la key del API server de Hermes.
# La key correcta vive en config.yaml → platforms.api_server.key (NO en ~/.hermes/.env,
# que tiene la del gateway). Se extrae con sed/grep y se exporta como API_SERVER_KEY.
set -a
CONFIG="$HOME/.hermes/config.yaml"
API_KEY=""
if [ -f "$CONFIG" ]; then
  # extrae el valor de la línea:     key: TbuO...   (bajo platforms: api_server:)
  API_KEY=$(sed -n '/^  api_server:/,/^[a-z]/p' "$CONFIG" | grep -E '^\s+key:' | head -1 | sed 's/.*key:\s*//' | tr -d '"' | tr -d ' ' | tr -d '\r')
fi
# fallback: si no está en config, usar la del .env (por si cambia la config)
[ -z "$API_KEY" ] && [ -f "$HOME/.hermes/.env" ] && API_KEY=$(grep '^API_SERVER_KEY=' "$HOME/.hermes/.env" | cut -d= -f2- | tr -d ' ')
export API_SERVER_KEY="$API_KEY"
set +a
cd "$(dirname "$0")"
exec node server.js