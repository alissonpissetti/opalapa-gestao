#!/usr/bin/env bash
# Dispara deploy no Coolify (Docker build no servidor).
# Uso local: COOLIFY_WEBHOOK=... COOLIFY_TOKEN=... ./scripts/coolify-deploy.sh
set -euo pipefail

if [ -z "${COOLIFY_WEBHOOK:-}" ]; then
  echo "COOLIFY_WEBHOOK não definido." >&2
  echo "Coolify → Application → Webhooks → Deploy Webhook URL" >&2
  exit 1
fi

if [ -z "${COOLIFY_TOKEN:-}" ]; then
  echo "COOLIFY_TOKEN não definido." >&2
  echo "Coolify → Keys & Tokens → API token com permissão Deploy" >&2
  echo "Coolify → Settings → Advanced → habilite API Access" >&2
  exit 1
fi

deploy_base="${COOLIFY_WEBHOOK%%\?*}"
uuid="$(printf '%s' "$COOLIFY_WEBHOOK" | sed -n 's/.*[?&]uuid=\([^&]*\).*/\1/p')"

if [ -z "$uuid" ]; then
  echo "COOLIFY_WEBHOOK sem parâmetro uuid=..." >&2
  exit 1
fi

force="${COOLIFY_FORCE:-false}"
response_file="$(mktemp)"
trap 'rm -f "$response_file"' EXIT

echo "Disparando deploy no Coolify (uuid=${uuid})..."

http_code="$(
  curl -sS \
    -o "$response_file" \
    -w "%{http_code}" \
    -X POST "$deploy_base" \
    -H "Authorization: Bearer ${COOLIFY_TOKEN}" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json" \
    -d "{\"uuid\":\"${uuid}\",\"force\":${force}}"
)"

echo "Resposta do Coolify (HTTP ${http_code}):"
cat "$response_file" || true
echo ""

case "$http_code" in
  200|201|202|204)
    echo "Deploy disparado com sucesso."
    ;;
  401|403)
    echo "Coolify recusou autenticação (HTTP ${http_code}). Verifique COOLIFY_TOKEN e API Access." >&2
    exit 1
    ;;
  429)
    echo "Fila de deploy do Coolify cheia (HTTP 429). Tente novamente em instantes." >&2
    exit 1
    ;;
  *)
    echo "Coolify retornou HTTP ${http_code}. Verifique webhook, token e permissões." >&2
    exit 1
    ;;
esac
