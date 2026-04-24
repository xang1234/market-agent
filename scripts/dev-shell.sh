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

DEV_DIR="$ROOT/.dev"
LOG_DIR="$DEV_DIR/logs"
PID_DIR="$DEV_DIR/pids"
mkdir -p "$LOG_DIR" "$PID_DIR"

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

process_running() {
  local pid_file="$1"
  if [[ ! -f "$pid_file" ]]; then
    return 1
  fi

  local pid
  pid="$(cat "$pid_file")"
  kill -0 "$pid" 2>/dev/null
}

port_listening() {
  local port="$1"
  lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
}

service_status() {
  local name="$1"
  local port="$2"
  local pid_file="$PID_DIR/$name.pid"

  if port_listening "$port"; then
    printf "running"
    return
  fi

  if process_running "$pid_file"; then
    printf "starting"
    return
  fi

  printf "stopped"
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
    nohup bash -lc "$command" >"$log_file" 2>&1 &
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
    if port_listening "$port"; then
      return
    fi

    if ! process_running "$pid_file"; then
      echo "$name exited before binding 127.0.0.1:$port" >&2
      [[ -f "$log_file" ]] && sed -n '1,120p' "$log_file" >&2
      exit 1
    fi

    sleep 1
  done

  echo "$name did not bind 127.0.0.1:$port in time" >&2
  [[ -f "$log_file" ]] && sed -n '1,120p' "$log_file" >&2
  exit 1
}

stop_processes() {
  local pid_file
  for pid_file in "$PID_DIR"/*.pid; do
    [[ -e "$pid_file" ]] || continue

    local pid
    pid="$(cat "$pid_file")"
    kill "$pid" 2>/dev/null || true
    rm -f "$pid_file"
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
  exit 1
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

up() {
  ensure_command docker
  ensure_command lsof
  ensure_command npm

  ensure_install "$ROOT/db"
  ensure_install "$ROOT/web"
  ensure_install "$ROOT/services/chat"
  ensure_install "$ROOT/services/resolver"
  ensure_install "$ROOT/services/dev-api"

  compose up -d
  wait_for_postgres
  (cd "$ROOT/db" && npm run migrate -- up)
  (cd "$ROOT/db" && npm run seed)

  export VITE_MA_FLAG_PLACEHOLDER_API="$MA_FLAG_PLACEHOLDER_API"
  export VITE_MA_FLAG_SHOW_DEV_BANNER="$MA_FLAG_SHOW_DEV_BANNER"

  start_process web "$ROOT/web" "npm run dev -- --host 127.0.0.1 --port $WEB_PORT"
  start_process chat "$ROOT/services/chat" "npm run dev"
  start_process resolver "$ROOT/services/resolver" "npm run dev"
  start_process dev-api "$ROOT/services/dev-api" "npm run dev"
  wait_for_service web "$WEB_PORT"
  wait_for_service chat "$CHAT_PORT"
  wait_for_service resolver "$RESOLVER_PORT"
  wait_for_service dev-api "$DEV_API_PORT"

  status
}

down() {
  stop_processes
  compose down
}

status() {
  printf "postgres  %-8s 127.0.0.1:%s\n" "$(container_status postgres)" "$DEV_POSTGRES_PORT"
  printf "redis     %-8s 127.0.0.1:%s\n" "$(container_status redis)" "$DEV_REDIS_PORT"
  printf "web       %-8s http://127.0.0.1:%s  log=%s\n" "$(service_status web "$WEB_PORT")" "$WEB_PORT" "$LOG_DIR/web.log"
  printf "chat      %-8s http://127.0.0.1:%s  log=%s\n" "$(service_status chat "$CHAT_PORT")" "$CHAT_PORT" "$LOG_DIR/chat.log"
  printf "resolver  %-8s http://127.0.0.1:%s  log=%s\n" "$(service_status resolver "$RESOLVER_PORT")" "$RESOLVER_PORT" "$LOG_DIR/resolver.log"
  printf "dev-api   %-8s http://127.0.0.1:%s  log=%s\n" "$(service_status dev-api "$DEV_API_PORT")" "$DEV_API_PORT" "$LOG_DIR/dev-api.log"
}

case "${1:-}" in
  up) up ;;
  down) down ;;
  status) status ;;
  *)
    echo "Usage: ./scripts/dev-shell.sh <up|down|status>" >&2
    exit 1
    ;;
esac
