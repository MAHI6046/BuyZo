#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
FRONTEND_DIR="${REPO_ROOT}/frontend"
ENV_FILE="${BACKEND_ENV_FILE:-${REPO_ROOT}/backend/.env}"
BACKEND_BASE_URL="${BACKEND_BASE_URL:-https://anydot-backend.vercel.app}"
USE_APP_CHECK="${USE_APP_CHECK:-false}"

read_env_var() {
  local key="$1"
  local value
  value="$(grep -E "^[[:space:]]*${key}=" "${ENV_FILE}" | tail -n1 | sed -E "s/^[[:space:]]*${key}=//" || true)"
  value="${value%\"}"
  value="${value#\"}"
  value="${value%\'}"
  value="${value#\'}"
  printf '%s' "$value"
}

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Env file not found: ${ENV_FILE}" >&2
  exit 1
fi

APP_CLIENT_KEY="${APP_CLIENT_KEY:-$(read_env_var APP_CLIENT_KEY)}"
if [[ -z "${APP_CLIENT_KEY}" ]]; then
  echo "APP_CLIENT_KEY is missing in ${ENV_FILE}" >&2
  exit 1
fi

cd "${FRONTEND_DIR}"
flutter build apk --release \
  -t lib/main.dart \
  --dart-define="BACKEND_BASE_URL=${BACKEND_BASE_URL}" \
  --dart-define="APP_CLIENT_KEY=${APP_CLIENT_KEY}" \
  --dart-define="USE_APP_CHECK=${USE_APP_CHECK}" \
  "$@"
