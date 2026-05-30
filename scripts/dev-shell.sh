#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env.dev"
if [[ ! -f "$ENV_FILE" ]]; then
  ENV_FILE="$ROOT/.env.dev.example"
fi

set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
set +a

# Defaults for variables that may be missing from an older .env.dev so `set -u`
# expansion below doesn't abort, and so child processes receive them.
# Keep in sync with .env.dev.example.
: "${HOME_PORT:=4334}"
: "${EVIDENCE_PORT:=4335}"
: "${DEV_PROVIDERS_PORT:=4336}"
: "${HOME_PULSE_TICKERS:=AAPL,MSFT,GOOGL}"
: "${ENABLE_UNOFFICIAL_DEV_PROVIDERS:=false}"
export HOME_PORT EVIDENCE_PORT DEV_PROVIDERS_PORT HOME_PULSE_TICKERS ENABLE_UNOFFICIAL_DEV_PROVIDERS

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
  if [[ ! -d "$dir/node_modules" ]]; then
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
  if [[ "$ENABLE_UNOFFICIAL_DEV_PROVIDERS" == "true" ]]; then
    ensure_python_service_install "$ROOT/services/dev-providers"
  fi

  assert_port_available web "$WEB_PORT"
  assert_port_available chat "$CHAT_PORT"
  assert_port_available resolver "$RESOLVER_PORT"
  assert_port_available dev-api "$DEV_API_PORT"
  assert_port_available watchlists "$WATCHLISTS_PORT"
  assert_port_available market "$MARKET_PORT"
  assert_port_available fundamentals "$FUNDAMENTALS_PORT"
  assert_port_available screener "$SCREENER_PORT"
  assert_port_available portfolio "$PORTFOLIO_PORT"
  assert_port_available home "$HOME_PORT"
  assert_port_available evidence "$EVIDENCE_PORT"
  if [[ "$ENABLE_UNOFFICIAL_DEV_PROVIDERS" == "true" ]]; then
    assert_port_available dev-providers "$DEV_PROVIDERS_PORT"
  fi

  if [[ "$(container_status postgres)" == "running" ]]; then
    postgres_was_running=1
  fi

  if [[ "$(container_status redis)" == "running" ]]; then
    redis_was_running=1
  fi

  if ! compose up -d; then
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

  if [[ "$ENABLE_UNOFFICIAL_DEV_PROVIDERS" == "true" ]]; then
    start_and_track_process dev-providers "$ROOT/services/dev-providers" "$(python_service_command "$ROOT/services/dev-providers" "dev_providers.main:app" "$DEV_PROVIDERS_PORT")"
  fi
  start_and_track_process web "$ROOT/web" "npm run dev -- --host 127.0.0.1 --port $WEB_PORT"
  start_and_track_process chat "$ROOT/services/chat" "npm run dev"
  start_and_track_process resolver "$ROOT/services/resolver" "npm run dev"
  start_and_track_process dev-api "$ROOT/services/dev-api" "npm run dev"
  start_and_track_process watchlists "$ROOT/services/watchlists" "npm run dev"
  start_and_track_process market "$ROOT/services/market" "npm run dev"
  start_and_track_process fundamentals "$ROOT/services/fundamentals" "npm run dev"
  start_and_track_process screener "$ROOT/services/screener" "npm run dev"
  start_and_track_process portfolio "$ROOT/services/portfolio" "npm run dev"
  start_and_track_process home "$ROOT/services/home" "npm run dev"
  start_and_track_process evidence "$ROOT/services/evidence" "npm run dev"

  if [[ "$ENABLE_UNOFFICIAL_DEV_PROVIDERS" == "true" ]] && ! wait_for_service dev-providers "$DEV_PROVIDERS_PORT"; then
    cleanup_failed_up
    return 1
  fi

  if ! wait_for_service web "$WEB_PORT"; then
    cleanup_failed_up
    return 1
  fi

  if ! wait_for_service chat "$CHAT_PORT"; then
    cleanup_failed_up
    return 1
  fi

  if ! wait_for_service resolver "$RESOLVER_PORT"; then
    cleanup_failed_up
    return 1
  fi

  if ! wait_for_service dev-api "$DEV_API_PORT"; then
    cleanup_failed_up
    return 1
  fi

  if ! wait_for_service watchlists "$WATCHLISTS_PORT"; then
    cleanup_failed_up
    return 1
  fi

  if ! wait_for_service market "$MARKET_PORT"; then
    cleanup_failed_up
    return 1
  fi

  if ! wait_for_service fundamentals "$FUNDAMENTALS_PORT"; then
    cleanup_failed_up
    return 1
  fi

  if ! wait_for_service screener "$SCREENER_PORT"; then
    cleanup_failed_up
    return 1
  fi

  if ! wait_for_service portfolio "$PORTFOLIO_PORT"; then
    cleanup_failed_up
    return 1
  fi

  if ! wait_for_service home "$HOME_PORT"; then
    cleanup_failed_up
    return 1
  fi

  if ! wait_for_service evidence "$EVIDENCE_PORT"; then
    cleanup_failed_up
    return 1
  fi

  status
}

down() {
  stop_processes
  compose stop
}

status() {
  printf "postgres  %-8s 127.0.0.1:%s\n" "$(container_status postgres)" "$DEV_POSTGRES_PORT"
  printf "redis     %-8s 127.0.0.1:%s\n" "$(container_status redis)" "$DEV_REDIS_PORT"
  printf "web       %-8s http://127.0.0.1:%s  log=%s\n" "$(service_status web "$WEB_PORT")" "$WEB_PORT" "$LOG_DIR/web.log"
  printf "chat      %-8s http://127.0.0.1:%s  log=%s\n" "$(service_status chat "$CHAT_PORT")" "$CHAT_PORT" "$LOG_DIR/chat.log"
  printf "resolver  %-8s http://127.0.0.1:%s  log=%s\n" "$(service_status resolver "$RESOLVER_PORT")" "$RESOLVER_PORT" "$LOG_DIR/resolver.log"
  printf "dev-api   %-8s http://127.0.0.1:%s  log=%s\n" "$(service_status dev-api "$DEV_API_PORT")" "$DEV_API_PORT" "$LOG_DIR/dev-api.log"
  printf "watchlists %-7s http://127.0.0.1:%s  log=%s\n" "$(service_status watchlists "$WATCHLISTS_PORT")" "$WATCHLISTS_PORT" "$LOG_DIR/watchlists.log"
  printf "market    %-8s http://127.0.0.1:%s  log=%s\n" "$(service_status market "$MARKET_PORT")" "$MARKET_PORT" "$LOG_DIR/market.log"
  printf "fundamentals %-4s http://127.0.0.1:%s  log=%s\n" "$(service_status fundamentals "$FUNDAMENTALS_PORT")" "$FUNDAMENTALS_PORT" "$LOG_DIR/fundamentals.log"
  printf "screener  %-8s http://127.0.0.1:%s  log=%s\n" "$(service_status screener "$SCREENER_PORT")" "$SCREENER_PORT" "$LOG_DIR/screener.log"
  printf "portfolio %-8s http://127.0.0.1:%s  log=%s\n" "$(service_status portfolio "$PORTFOLIO_PORT")" "$PORTFOLIO_PORT" "$LOG_DIR/portfolio.log"
  printf "home      %-8s http://127.0.0.1:%s  log=%s\n" "$(service_status home "$HOME_PORT")" "$HOME_PORT" "$LOG_DIR/home.log"
  printf "evidence  %-8s http://127.0.0.1:%s  log=%s\n" "$(service_status evidence "$EVIDENCE_PORT")" "$EVIDENCE_PORT" "$LOG_DIR/evidence.log"
  if [[ "$ENABLE_UNOFFICIAL_DEV_PROVIDERS" == "true" ]]; then
    printf "dev-providers %-3s http://127.0.0.1:%s  log=%s\n" "$(service_status dev-providers "$DEV_PROVIDERS_PORT")" "$DEV_PROVIDERS_PORT" "$LOG_DIR/dev-providers.log"
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
    echo "Usage: ./scripts/dev-shell.sh <up|down|status>" >&2
    exit 1
    ;;
esac
