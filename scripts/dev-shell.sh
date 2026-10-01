#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env.dev"
if [[ ! -f "$ENV_FILE" ]]; then
  ENV_FILE="$ROOT/.env.dev.example"
fi

# DEV_PROFILE, DEV_NO_KEYS and DEV_MODE are per-invocation switches
# (DEV_PROFILE=chat DEV_NO_KEYS=true ./scripts/dev-shell.sh up), so a value the caller
# set beats the env file's, even an empty one (DEV_MODE= returns to the default mode).
CALLER_SWITCHES=()
for switch in DEV_PROFILE DEV_NO_KEYS DEV_MODE; do
  if [[ -n "${!switch+set}" ]]; then
    CALLER_SWITCHES+=("$switch=${!switch}")
  fi
done

set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
set +a

for assignment in ${CALLER_SWITCHES[@]+"${CALLER_SWITCHES[@]}"}; do
  export "$assignment"
done

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
# No API keys needed: recorded LLM replies + the golden frozen dataset (#122).
: "${DEV_NO_KEYS:=false}"
# Development mode (#123): analyst (frozen data + live LLM) or data (live providers).
: "${DEV_MODE:=}"
# The one-process chat-profile app serves the web UI, so it takes the web port.
: "${APP_PORT:=${WEB_PORT:-5173}}"
export HOME_PORT EVIDENCE_PORT DEV_PROVIDERS_PORT ANALYST_GRIDS_PORT HOME_PULSE_TICKERS ENABLE_UNOFFICIAL_DEV_PROVIDERS DISCOVERY_ENABLED DISCOVERY_WORKER_POLL_MS DEV_PROFILE DEV_NO_KEYS DEV_MODE APP_PORT

# HTTP dev services, in start order. DEV_PROFILE=chat runs only what the golden chat
# conversation needs (#117), as one process: services/app hosts APP_SERVES (#122).
# The rest are parked (not started), never deleted.
FULL_SERVICES="web chat resolver dev-api watchlists market fundamentals screener portfolio home evidence analyst-grids"
CHAT_SERVICES="app"
APP_SERVES="web chat resolver dev-api market fundamentals"

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
  rm -f "$pid_file" "$PID_DIR/$name.launch-env"
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
  # The web app starts signed in with the dev mock session (#122); set false to test sign-in.
  export VITE_MA_FLAG_DEV_AUTO_LOGIN
  VITE_MA_FLAG_DEV_AUTO_LOGIN="${VITE_MA_FLAG_DEV_AUTO_LOGIN:-true}"
  if [[ "$DEV_NO_KEYS" == "true" ]]; then
    # The golden test's recorded replies (services/chat/test/golden), on the same
    # fixture channel it uses. Overrides whatever .env.dev set: the settings file is
    # dropped (it would override the process env) and the Settings UI hidden.
    export LLM_CHANNELS=fixture LLM_FIXTURE_PROTOCOL=openai LLM_FIXTURE_MODELS=recorded
    export LITELLM_MODEL=fixture/recorded LITELLM_FALLBACK_MODELS="" AGENT_LITELLM_MODEL=""
    export LLM_REPLAY_FILE="$ROOT/services/chat/test/golden/llm-replies.json"
    export LLM_SETTINGS_ENV_FILE="" MA_FLAG_LLM_SETTINGS=false VITE_MA_FLAG_LLM_SETTINGS=false
  fi
  if [[ "$DEV_MODE" == "analyst" ]]; then
    # One line per model completion: model, latency, tokens (services/llm).
    export LLM_USAGE_LOG=true
  fi
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

# Whether the LLM settings the services will load yield a deployable model; asks the llm
# package itself (it prints the settings issues when not).
llm_deployable() {
  node --experimental-strip-types "$ROOT/services/llm/scripts/check-deployments.ts" >/dev/null
}

# Validates DEV_MODE (#123) and fails fast when a mode's live credentials are missing.
check_dev_mode() {
  local missing=()
  case "$DEV_MODE" in
    "") return 0 ;;
    ui)
      # Replays a recorded fixture through the one-process app: no keys, DB or LLM.
      if [[ "$DEV_PROFILE" != "chat" ]]; then
        echo "DEV_MODE=ui replays through the one-process app; run it with DEV_PROFILE=chat" >&2
        return 1
      fi
      return 0
      ;;
    analyst | data) ;;
    *)
      echo "Unknown DEV_MODE '$DEV_MODE' (expected ui, analyst or data, or unset)" >&2
      return 1
      ;;
  esac
  if [[ "$DEV_NO_KEYS" == "true" ]]; then
    echo "DEV_NO_KEYS=true (recorded replies) contradicts DEV_MODE=$DEV_MODE (live LLM); pick one" >&2
    return 1
  fi
  if [[ "$DEV_MODE" == "data" ]]; then
    [[ -n "${POLYGON_API_KEY:-}" ]] || missing+=(POLYGON_API_KEY)
    [[ -n "${SEC_EDGAR_USER_AGENT:-}" ]] || missing+=(SEC_EDGAR_USER_AGENT)
  fi
  if ((${#missing[@]} > 0)); then
    echo "DEV_MODE=$DEV_MODE needs live credentials in .env.dev: ${missing[*]} is not set" >&2
    return 1
  fi
  # A set LITELLM_MODEL isn't enough: it must name a configured channel and model.
  if ! llm_deployable; then
    echo "DEV_MODE=$DEV_MODE needs a live LLM: set LLM_CHANNELS, the channel's settings and LITELLM_MODEL in .env.dev" >&2
    if [[ "$DEV_MODE" == "analyst" ]]; then
      echo "  (analyst mode runs a live LLM; for no keys at all use DEV_NO_KEYS=true)" >&2
    fi
    return 1
  fi
}

# The golden conversation's frozen dataset backs the no-keys and analyst modes.
seeds_frozen_data() {
  [[ "$DEV_NO_KEYS" == "true" || "$DEV_MODE" == "analyst" ]]
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
  # Empty for portless processes (discovery-worker).
  printf '%s' "${!var:-}"
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
    wait_for_port_free "$(service_port "$name")"
  done
}

# `up` leaves running processes alone, but some settings are read only at start:
# Vite bakes VITE_* into the client (web, or app under chat), and chat/dev-api build
# their LLM router from LLM_*/LITELLM_* (DEV_NO_KEYS rewrites those). Each such process
# gets a stamp of that env when it starts; a running one whose stamp differs is
# restarted. The stamp is a checksum so LLM API keys are not copied into .dev.
launch_env_pattern() {
  local llm='LLM_|LITELLM_|AGENT_LITELLM_'
  case "$1" in
    web) printf '^VITE_' ;;
    # DEV_MODE switches app between live services and the UI-mode replay.
    app) printf '^(VITE_|DEV_MODE=|DEV_REPLAY_FILE=|DEV_CAPTURE_FILE=|%s)' "$llm" ;;
    chat | dev-api) printf '^(%s)' "$llm" ;;
    *) return 1 ;;
  esac
}

launch_env_checksum() {
  local pattern
  pattern="$(launch_env_pattern "$1")" || return 0
  { env | grep -E "$pattern" || true; } | LC_ALL=C sort | cksum
}

write_launch_env_stamp() {
  launch_env_pattern "$1" >/dev/null || return 0
  launch_env_checksum "$1" >"$PID_DIR/$1.launch-env"
}

restart_if_launch_env_changed() {
  local name
  for name in "$@"; do
    launch_env_pattern "$name" >/dev/null || continue
    process_running "$PID_DIR/$name.pid" || continue
    if [[ "$(cat "$PID_DIR/$name.launch-env" 2>/dev/null)" == "$(launch_env_checksum "$name")" ]]; then
      continue
    fi
    stop_process "$name"
    # Wait for the port so the restarted server doesn't drift to the next free one.
    wait_for_port_free "$(service_port "$name")"
  done
}

# SIGTERM and server shutdown are asynchronous: a stopped process can hold its port
# for a moment, and web and app share one, so wait before checking or reusing it.
wait_for_port_free() {
  local port="$1" attempt
  [[ -n "$port" ]] || return 0
  for attempt in $(seq 1 20); do
    port_listening "$port" || return 0
    sleep 0.5
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

export_web_flags() {
  export VITE_MA_FLAG_PLACEHOLDER_API="$MA_FLAG_PLACEHOLDER_API"
  export VITE_MA_FLAG_SHOW_DEV_BANNER="$MA_FLAG_SHOW_DEV_BANNER"
}

# UI mode (#123): only the one-process app, replaying a recorded fixture, so there are
# no containers, migrations, seeds, keys or LLM.
up_ui() {
  ensure_command lsof
  ensure_command npm
  configure_runtime_env
  STARTED_SERVICES=()
  COMPOSE_STARTED=0
  ensure_install "$ROOT/web"
  stop_parked_processes "app"
  assert_port_available app "$(service_port app)"
  export_web_flags
  restart_if_launch_env_changed app
  start_and_track_process app "$(service_dir app)" "$(service_command app)"
  if ! wait_for_service app "$(service_port app)"; then
    cleanup_failed_up
    return 1
  fi
  write_launch_env_stamp app
  status
}

up() {
  local postgres_was_running=0
  local redis_was_running=0
  local services name
  # Unquoted on use: empty means every compose service.
  local compose_services=""

  check_dev_mode || return 1
  if [[ "$DEV_MODE" == "ui" ]]; then
    up_ui
    return
  fi
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

  # Idempotent; fails (all-or-nothing) if provider-hydrated tickers already clash.
  # Data mode must not run on a database a frozen mode seeded: its golden facts and
  # long-lived caches would let a live check pass on frozen values.
  if [[ "$DEV_MODE" == "data" ]] && ! (cd "$ROOT/services/chat" && npm run seed:golden -- --assert-absent); then
    cleanup_failed_up
    return 1
  fi

  if seeds_frozen_data && ! (cd "$ROOT/services/chat" && npm run seed:golden); then
    cleanup_failed_up
    return 1
  fi

  if ! (cd "$ROOT/services/resolver" && npm run repair:provider-identities); then
    cleanup_failed_up
    return 1
  fi

  export_web_flags
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

  # shellcheck disable=SC2086
  restart_if_launch_env_changed $services
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
  for name in $services; do
    write_launch_env_stamp "$name"
  done

  status
}

have_docker() {
  command -v docker >/dev/null 2>&1
}

down() {
  stop_processes
  # UI mode needs no Docker at all; without it there are no containers to stop.
  if have_docker; then
    compose stop
  fi
}

status() {
  local services name port
  services="$(active_services)" || return 1

  printf "profile   %s\n" "$DEV_PROFILE"
  printf "postgres  %-8s 127.0.0.1:%s\n" "$(container_status postgres)" "$DEV_POSTGRES_PORT"
  printf "redis     %-8s 127.0.0.1:%s\n" "$(container_status redis)" "$DEV_REDIS_PORT"
  for name in $CHAT_SERVICES $FULL_SERVICES $( [[ "$ENABLE_UNOFFICIAL_DEV_PROVIDERS" == "true" ]] && printf dev-providers ); do
    if [[ " $services " == *" $name "* ]]; then
      port="$(service_port "$name")"
      printf "%-13s %-8s http://127.0.0.1:%s  log=%s\n" "$name" "$(service_status "$name" "$port")" "$port" "$LOG_DIR/$name.log"
    elif [[ "$DEV_PROFILE" == "chat" && " $APP_SERVES " == *" $name "* ]]; then
      printf "%-13s %-8s one process on :%s\n" "$name" "in app" "$APP_PORT"
    elif [[ "$name" == "app" ]]; then
      continue
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
