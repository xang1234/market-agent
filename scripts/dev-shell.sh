#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env.dev"
if [[ ! -f "$ENV_FILE" ]]; then
  ENV_FILE="$ROOT/.env.dev.example"
fi

# DEV_PROFILE is a per-invocation switch (DEV_PROFILE=chat ./scripts/dev-shell.sh up),
# so the caller's value beats the env file's.
CALLER_DEV_PROFILE="${DEV_PROFILE:-}"

set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
set +a

DEV_PROFILE="${CALLER_DEV_PROFILE:-${DEV_PROFILE:-}}"

# Defaults for variables that may be missing from an older .env.dev so `set -u`
# expansion below doesn't abort, and so child processes receive them.
# Keep in sync with .env.dev.example.
: "${HOME_PORT:=4334}"
: "${EVIDENCE_PORT:=4335}"
: "${DEV_PROVIDERS_PORT:=4336}"
: "${ANALYST_GRIDS_PORT:=8093}"
: "${HOME_PULSE_TICKERS:=AAPL,MSFT,GOOGL}"
: "${ENABLE_UNOFFICIAL_DEV_PROVIDERS:=false}"
: "${DISCOVERY_ENABLED:=false}"
: "${DISCOVERY_WORKER_POLL_MS:=1000}"
: "${DEV_PROFILE:=full}"
export HOME_PORT EVIDENCE_PORT DEV_PROVIDERS_PORT ANALYST_GRIDS_PORT HOME_PULSE_TICKERS ENABLE_UNOFFICIAL_DEV_PROVIDERS DISCOVERY_ENABLED DISCOVERY_WORKER_POLL_MS DEV_PROFILE

# HTTP dev services, in start order. DEV_PROFILE=chat runs only what the golden chat
# conversation needs (#117); the rest are parked (not started), never deleted.
FULL_SERVICES="web chat resolver dev-api watchlists market fundamentals screener portfolio home evidence analyst-grids"
CHAT_SERVICES="web chat resolver dev-api market fundamentals"

DEV_DIR="$ROOT/.dev"
LOG_DIR="$DEV_DIR/logs"
PID_DIR="$DEV_DIR/pids"
mkdir -p "$LOG_DIR" "$PID_DIR"
STARTED_SERVICES=()
COMPOSE_STARTED=0

compose() {
  docker compose -f "$ROOT/docker-compose.dev.yml" --env-file "$ENV_FILE" "$@"
}

ensure_command() {
  local name="$1"
  if ! command -v "$name" >/dev/null 2>&1; then
    echo "Missing required command: $name" >&2
    exit 1
  fi
}

ensure_install() {
  local dir="$1"
  # Reinstall when the lockfile changed since the last install (npm records the
  # installed tree in node_modules/.package-lock.json), so a pulled dependency
  # addition reaches existing checkouts too.
  if [[ ! -d "$dir/node_modules" ]] || { [[ -f "$dir/package-lock.json" ]] && [[ "$dir/package-lock.json" -nt "$dir/node_modules/.package-lock.json" ]]; }; then
    (cd "$dir" && npm install)
  fi
}

ensure_python_service_install() {
  local dir="$1"
  if command -v uv >/dev/null 2>&1; then
    (cd "$dir" && uv sync)
    return
  fi

  if [[ ! -x "$dir/.venv/bin/python" ]]; then
    python3 -m venv "$dir/.venv"
  fi
  "$dir/.venv/bin/python" -m pip install -r "$dir/requirements.txt"
}

python_service_command() {
  local dir="$1"
  local module="$2"
  local port="$3"
  local python="$dir/.venv/bin/python"

  if [[ -x "$python" ]]; then
    printf '"%s" -m uvicorn %s --host 127.0.0.1 --port %s' "$python" "$module" "$port"
  elif command -v uv >/dev/null 2>&1; then
    printf 'uv run python -m uvicorn %s --host 127.0.0.1 --port %s' "$module" "$port"
  else
    printf 'python3 -m uvicorn %s --host 127.0.0.1 --port %s' "$module" "$port"
  fi
}

process_running() {
  local pid_file="$1"
  if [[ ! -f "$pid_file" ]]; then
    return 1
  fi

  local pid
  pid="$(cat "$pid_file")"
  kill -0 "$pid" 2>/dev/null
}

parent_pid() {
  local pid="$1"
  ps -o ppid= -p "$pid" 2>/dev/null | tr -d '[:space:]'
}

listener_pid() {
  local port="$1"
  lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | head -n 1
}

pid_in_tree() {
  local root_pid="$1"
  local candidate_pid="$2"

  while [[ -n "$candidate_pid" && "$candidate_pid" != "0" ]]; do
    if [[ "$candidate_pid" == "$root_pid" ]]; then
      return 0
    fi

    candidate_pid="$(parent_pid "$candidate_pid")"
  done

  return 1
}

port_listening() {
  local port="$1"
  lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
}

service_owns_port() {
  local name="$1"
  local port="$2"
  local pid_file="$PID_DIR/$name.pid"
  local root_pid
  local listening_pid

  if ! process_running "$pid_file"; then
    return 1
  fi

  root_pid="$(cat "$pid_file")"
  listening_pid="$(listener_pid "$port")"
  if [[ -z "$listening_pid" ]]; then
    return 1
  fi

  pid_in_tree "$root_pid" "$listening_pid"
}

service_status() {
  local name="$1"
  local port="$2"
  local pid_file="$PID_DIR/$name.pid"

  if service_owns_port "$name" "$port"; then
    printf "running"
    return
  fi

  if port_listening "$port"; then
    printf "blocked"
    return
  fi

  if process_running "$pid_file"; then
    printf "starting"
    return
  fi

  printf "stopped"
}

assert_port_available() {
  local name="$1"
  local port="$2"

  if port_listening "$port" && ! service_owns_port "$name" "$port"; then
    echo "$name port 127.0.0.1:$port is already in use" >&2
    return 1
  fi
}

stop_process() {
  local name="$1"
  local pid_file="$PID_DIR/$name.pid"

  if [[ ! -f "$pid_file" ]]; then
    return
  fi

  local pid
  pid="$(cat "$pid_file")"
  kill "$pid" 2>/dev/null || true
  rm -f "$pid_file"
}

start_process() {
  local name="$1"
  local dir="$2"
  local command="$3"
  local pid_file="$PID_DIR/$name.pid"
  local log_file="$LOG_DIR/$name.log"

  if process_running "$pid_file"; then
    return
  fi

  rm -f "$pid_file"

  (
    cd "$dir"
    nohup bash -lc "$command" </dev/null >"$log_file" 2>&1 &
    echo $! >"$pid_file"
  )
}

wait_for_service() {
  local name="$1"
  local port="$2"
  local pid_file="$PID_DIR/$name.pid"
  local log_file="$LOG_DIR/$name.log"
  local attempt

  for attempt in $(seq 1 30); do
    if service_owns_port "$name" "$port"; then
      return
    fi

    if ! process_running "$pid_file"; then
      echo "$name exited before binding 127.0.0.1:$port" >&2
      [[ -f "$log_file" ]] && sed -n '1,120p' "$log_file" >&2
      return 1
    fi

    sleep 1
  done

  echo "$name did not bind 127.0.0.1:$port in time" >&2
  [[ -f "$log_file" ]] && sed -n '1,120p' "$log_file" >&2
  return 1
}

stop_processes() {
  local pid_file
  for pid_file in "$PID_DIR"/*.pid; do
    [[ -e "$pid_file" ]] || continue
    stop_process "$(basename "$pid_file" .pid)"
  done
}

wait_for_postgres() {
  local attempt
  for attempt in $(seq 1 30); do
    if compose exec -T postgres pg_isready -U "$DEV_POSTGRES_USER" -d "$DEV_POSTGRES_DB" >/dev/null 2>&1; then
      return
    fi
    sleep 1
  done

  echo "postgres did not become ready" >&2
  return 1
}

build_database_url() {
  printf "postgresql://%s:%s@127.0.0.1:%s/%s" \
    "$DEV_POSTGRES_USER" \
    "$DEV_POSTGRES_PASSWORD" \
    "$DEV_POSTGRES_PORT" \
    "$DEV_POSTGRES_DB"
}

build_redis_url() {
  printf "redis://127.0.0.1:%s" "$DEV_REDIS_PORT"
}

configure_runtime_env() {
  export DATABASE_URL
  DATABASE_URL="$(build_database_url)"
  export REDIS_URL
  REDIS_URL="$(build_redis_url)"
  export DEV_API_ANALYZE_SEAL_MODULE
  DEV_API_ANALYZE_SEAL_MODULE="${DEV_API_ANALYZE_SEAL_MODULE:-$ROOT/services/dev-api/src/local-runtime.ts}"
  export DEV_API_RUNTIME_MODULE
  DEV_API_RUNTIME_MODULE="${DEV_API_RUNTIME_MODULE:-$DEV_API_ANALYZE_SEAL_MODULE}"
  export CHAT_ANALYST_RUNTIME_MODULE
  CHAT_ANALYST_RUNTIME_MODULE="${CHAT_ANALYST_RUNTIME_MODULE:-$ROOT/services/chat/src/local-runtime.ts}"
  export CHAT_PERSISTENCE_MODULE
  CHAT_PERSISTENCE_MODULE="${CHAT_PERSISTENCE_MODULE:-$ROOT/services/chat/src/local-runtime.ts}"
  export LLM_SETTINGS_ENV_FILE
  LLM_SETTINGS_ENV_FILE="${LLM_SETTINGS_ENV_FILE:-$ROOT/.env.dev}"
  export MA_FLAG_LLM_SETTINGS
  MA_FLAG_LLM_SETTINGS="${MA_FLAG_LLM_SETTINGS:-true}"
  export VITE_MA_FLAG_LLM_SETTINGS
  VITE_MA_FLAG_LLM_SETTINGS="${VITE_MA_FLAG_LLM_SETTINGS:-true}"
  if [[ "$ENABLE_UNOFFICIAL_DEV_PROVIDERS" == "true" ]]; then
    export DEV_PROVIDERS_ORIGIN
    DEV_PROVIDERS_ORIGIN="${DEV_PROVIDERS_ORIGIN:-http://127.0.0.1:$DEV_PROVIDERS_PORT}"
    export DEV_PROVIDERS_BASE_URL
    DEV_PROVIDERS_BASE_URL="${DEV_PROVIDERS_BASE_URL:-$DEV_PROVIDERS_ORIGIN}"
  fi
}

container_status() {
  local service="$1"
  local running
  running="$(compose ps --status running --services 2>/dev/null || true)"
  if printf '%s\n' "$running" | grep -Fxq "$service"; then
    printf "running"
  else
    printf "stopped"
  fi
}

cleanup_failed_up() {
  local name

  for name in "${STARTED_SERVICES[@]}"; do
    stop_process "$name"
  done

  if [[ "$COMPOSE_STARTED" -eq 1 ]]; then
    compose down >/dev/null 2>&1 || true
  fi
}

profile_services() {
  case "$DEV_PROFILE" in
    full) printf '%s' "$FULL_SERVICES" ;;
    chat) printf '%s' "$CHAT_SERVICES" ;;
    *)
      echo "Unknown DEV_PROFILE '$DEV_PROFILE' (expected chat or full)" >&2
      return 1
      ;;
  esac
}

# The profile's services, preceded by the opt-in dev-providers sidecar.
active_services() {
  local services
  services="$(profile_services)" || return 1
  if [[ "$ENABLE_UNOFFICIAL_DEV_PROVIDERS" == "true" ]]; then
    services="dev-providers $services"
  fi
  printf '%s' "$services"
}

# Every service's port lives in <NAME>_PORT (dev-api -> DEV_API_PORT).
service_port() {
  local var
  var="$(printf '%s' "$1" | tr 'a-z-' 'A-Z_')_PORT"
  printf '%s' "${!var}"
}

service_dir() {
  case "$1" in
    web) printf '%s' "$ROOT/web" ;;
    *) printf '%s' "$ROOT/services/$1" ;;
  esac
}

service_command() {
  case "$1" in
    web) printf 'npm run dev -- --host 127.0.0.1 --port %s' "$WEB_PORT" ;;
    dev-providers) python_service_command "$ROOT/services/dev-providers" "dev_providers.main:app" "$DEV_PROVIDERS_PORT" ;;
    *) printf 'npm run dev' ;;
  esac
}

# The discovery worker has no port; the chat profile parks it even when enabled.
discovery_active() {
  [[ "$DISCOVERY_ENABLED" == "true" && "$DEV_PROFILE" == "full" ]]
}

# Stop tracked processes the active profile doesn't run, so switching a running full
# stack to DEV_PROFILE=chat actually parks them (status would otherwise mislabel them).
stop_parked_processes() {
  local services="$1" pid_file name
  for pid_file in "$PID_DIR"/*.pid; do
    [[ -e "$pid_file" ]] || continue
    name="$(basename "$pid_file" .pid)"
    if [[ " $services " == *" $name "* ]]; then
      continue
    fi
    if [[ "$name" == "discovery-worker" ]] && discovery_active; then
      continue
    fi
    stop_process "$name"
  done
}

start_and_track_process() {
  local name="$1"
  local dir="$2"
  local command="$3"
  local pid_file="$PID_DIR/$name.pid"

  if process_running "$pid_file"; then
    return
  fi

  start_process "$name" "$dir" "$command"
  STARTED_SERVICES+=("$name")
}

up() {
  local postgres_was_running=0
  local redis_was_running=0
  local services name
  # Unquoted on use: empty means every compose service.
  local compose_services=""

  services="$(active_services)" || return 1
  if [[ "$DEV_PROFILE" == "chat" ]]; then
    compose_services="postgres"
  fi

  ensure_command docker
  ensure_command lsof
  ensure_command npm
  if [[ "$ENABLE_UNOFFICIAL_DEV_PROVIDERS" == "true" ]]; then
    ensure_command python3
  fi
  configure_runtime_env
  STARTED_SERVICES=()
  COMPOSE_STARTED=0

  ensure_install "$ROOT/db"
  ensure_install "$ROOT/web"
  ensure_install "$ROOT/services/chat"
  ensure_install "$ROOT/services/resolver"
  ensure_install "$ROOT/services/dev-api"
  ensure_install "$ROOT/services/watchlists"
  ensure_install "$ROOT/services/market"
  ensure_install "$ROOT/services/fundamentals"
  ensure_install "$ROOT/services/screener"
  ensure_install "$ROOT/services/portfolio"
  ensure_install "$ROOT/services/home"
  ensure_install "$ROOT/services/evidence"
  ensure_install "$ROOT/services/analyst-grids"
  ensure_install "$ROOT/services/agents"
  ensure_install "$ROOT/services/analyze"
  ensure_install "$ROOT/services/artifact"
  ensure_install "$ROOT/services/notifications"
  ensure_install "$ROOT/services/observability"
  ensure_install "$ROOT/services/snapshot"
  ensure_install "$ROOT/services/summary"
  ensure_install "$ROOT/services/themes"
  ensure_install "$ROOT/services/tools"
  ensure_install "$ROOT/services/llm"
  # Imported as sources by chat and others; resolves ajv/decimal.js from its own node_modules.
  ensure_install "$ROOT/services/financial-core"
  if discovery_active; then
    ensure_install "$ROOT/services/discovery"
  fi
  if [[ "$ENABLE_UNOFFICIAL_DEV_PROVIDERS" == "true" ]]; then
    ensure_python_service_install "$ROOT/services/dev-providers"
  fi

  stop_parked_processes "$services"
  # The chat profile needs only postgres from docker-compose.dev.yml; park the others.
  if [[ -n "$compose_services" ]]; then
    compose stop redis minio
  fi

  for name in $services; do
    assert_port_available "$name" "$(service_port "$name")"
  done

  if [[ "$(container_status postgres)" == "running" ]]; then
    postgres_was_running=1
  fi

  # The chat profile doesn't start redis, so only postgres decides whether this run
  # brought the containers up (and must take them down on failure).
  if [[ "$(container_status redis)" == "running" || -n "$compose_services" ]]; then
    redis_was_running=1
  fi

  # shellcheck disable=SC2086
  if ! compose up -d $compose_services; then
    cleanup_failed_up
    return 1
  fi

  if [[ "$postgres_was_running" -eq 0 || "$redis_was_running" -eq 0 ]]; then
    COMPOSE_STARTED=1
  fi

  if ! wait_for_postgres; then
    cleanup_failed_up
    return 1
  fi

  if ! (cd "$ROOT/db" && npm run migrate -- up); then
    cleanup_failed_up
    return 1
  fi

  if ! (cd "$ROOT/db" && npm run seed); then
    cleanup_failed_up
    return 1
  fi

  if ! (cd "$ROOT/services/resolver" && npm run repair:provider-identities); then
    cleanup_failed_up
    return 1
  fi

  export VITE_MA_FLAG_PLACEHOLDER_API="$MA_FLAG_PLACEHOLDER_API"
  export VITE_MA_FLAG_SHOW_DEV_BANNER="$MA_FLAG_SHOW_DEV_BANNER"
  export DEV_API_ORIGIN="${DEV_API_ORIGIN:-http://127.0.0.1:$DEV_API_PORT}"
  export CHAT_ORIGIN="${CHAT_ORIGIN:-http://127.0.0.1:$CHAT_PORT}"
  export RESOLVER_ORIGIN="${RESOLVER_ORIGIN:-http://127.0.0.1:$RESOLVER_PORT}"
  export WATCHLISTS_ORIGIN="${WATCHLISTS_ORIGIN:-http://127.0.0.1:$WATCHLISTS_PORT}"
  export MARKET_ORIGIN="${MARKET_ORIGIN:-http://127.0.0.1:$MARKET_PORT}"
  export FUNDAMENTALS_ORIGIN="${FUNDAMENTALS_ORIGIN:-http://127.0.0.1:$FUNDAMENTALS_PORT}"
  export SCREENER_ORIGIN="${SCREENER_ORIGIN:-http://127.0.0.1:$SCREENER_PORT}"
  export PORTFOLIO_ORIGIN="${PORTFOLIO_ORIGIN:-http://127.0.0.1:$PORTFOLIO_PORT}"
  export HOME_ORIGIN="${HOME_ORIGIN:-http://127.0.0.1:$HOME_PORT}"
  export EVIDENCE_ORIGIN="${EVIDENCE_ORIGIN:-http://127.0.0.1:$EVIDENCE_PORT}"
  export ANALYST_GRIDS_ORIGIN="${ANALYST_GRIDS_ORIGIN:-http://127.0.0.1:$ANALYST_GRIDS_PORT}"

  for name in $services; do
    start_and_track_process "$name" "$(service_dir "$name")" "$(service_command "$name")"
  done
  if discovery_active; then
    start_and_track_process discovery-worker "$ROOT/services/discovery" "npm run worker"
  fi

  for name in $services; do
    if ! wait_for_service "$name" "$(service_port "$name")"; then
      cleanup_failed_up
      return 1
    fi
  done

  status
}

down() {
  stop_processes
  compose stop
}

status() {
  local services name port
  services="$(active_services)" || return 1

  printf "profile   %s\n" "$DEV_PROFILE"
  printf "postgres  %-8s 127.0.0.1:%s\n" "$(container_status postgres)" "$DEV_POSTGRES_PORT"
  printf "redis     %-8s 127.0.0.1:%s\n" "$(container_status redis)" "$DEV_REDIS_PORT"
  for name in $FULL_SERVICES $( [[ "$ENABLE_UNOFFICIAL_DEV_PROVIDERS" == "true" ]] && printf dev-providers ); do
    if [[ " $services " == *" $name "* ]]; then
      port="$(service_port "$name")"
      printf "%-13s %-8s http://127.0.0.1:%s  log=%s\n" "$name" "$(service_status "$name" "$port")" "$port" "$LOG_DIR/$name.log"
    else
      printf "%-13s %-8s DEV_PROFILE=%s\n" "$name" "parked" "$DEV_PROFILE"
    fi
  done
  if [[ "$DEV_PROFILE" != "full" ]]; then
    printf "%-13s %-8s DEV_PROFILE=%s\n" "discovery" "parked" "$DEV_PROFILE"
  elif discovery_active; then
    printf "discovery %-4s worker log=%s\n" "$(process_running "$PID_DIR/discovery-worker.pid" && printf running || printf stopped)" "$LOG_DIR/discovery-worker.log"
  else
    printf "discovery %-4s feature disabled\n" "off"
  fi
  printf "analyze   %-8s %s\n" "bff" "/v1/analyze via dev-api"
  printf "agents    %-8s %s\n" "bff" "/v1/agents via dev-api"
  printf "artifact  %-8s %s\n" "library" "shared package; no standalone dev HTTP server"
  printf "notifications %-4s %s\n" "library" "delivery processor package; no standalone dev HTTP server"
  printf "snapshot  %-8s %s\n" "library" "shared package; no standalone dev HTTP server"
  printf "tools     %-8s %s\n" "library" "shared package; no standalone dev HTTP server"
  printf "observability %-3s %s\n" "library" "run-activity primitives exposed via chat/home"
  printf "themes    %-8s %s\n" "library" "shared package; no standalone dev HTTP server"
  printf "summary   %-8s %s\n" "library" "shared package; no standalone dev HTTP server"
}

configure_runtime_env

if [[ "${MARKET_AGENT_DEV_SHELL_SOURCE_ONLY:-0}" == "1" ]]; then
  return 0 2>/dev/null || exit 0
fi

case "${1:-}" in
  up) up ;;
  down) down ;;
  status) status ;;
  *)
    echo "Usage: [DEV_PROFILE=chat|full] ./scripts/dev-shell.sh <up|down|status>" >&2
    exit 1
    ;;
esac
