import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import net from "node:net";
import test from "node:test";

const REPO_ROOT = dirname(dirname(new URL(import.meta.url).pathname));
const SOURCE_SCRIPT = join(REPO_ROOT, "scripts", "dev-shell.sh");

type ShellResult = {
  code: number;
  stdout: string;
  stderr: string;
};

async function createShellFixture(envOverrides: Record<string, string> = {}) {
  const root = await mkdtemp(join(tmpdir(), "market-agent-dev-shell-"));
  const scriptDir = join(root, "scripts");
  await mkdir(scriptDir, { recursive: true });
  const script = await readFile(SOURCE_SCRIPT, "utf8");
  const scriptPath = join(scriptDir, "dev-shell.sh");
  await writeFile(scriptPath, script);
  await chmod(scriptPath, 0o755);

  const env = {
    DEV_POSTGRES_PORT: "54329",
    DEV_REDIS_PORT: "63791",
    WEB_PORT: "5173",
    CHAT_PORT: "4310",
    RESOLVER_PORT: "4311",
    DEV_API_PORT: "4312",
    WATCHLISTS_PORT: "4313",
    MARKET_PORT: "4321",
    FUNDAMENTALS_PORT: "4322",
    SCREENER_PORT: "4323",
    PORTFOLIO_PORT: "4333",
    HOME_PORT: "4334",
    EVIDENCE_PORT: "4335",
    DEV_PROVIDERS_PORT: "4336",
    ENABLE_UNOFFICIAL_DEV_PROVIDERS: "false",
    DEV_POSTGRES_USER: "postgres",
    DEV_POSTGRES_PASSWORD: "postgres",
    DEV_POSTGRES_DB: "market_agent",
    DATABASE_URL: "postgresql://wrong:wrong@127.0.0.1:9999/wrong",
    REDIS_URL: "redis://127.0.0.1:9999",
    MA_FLAG_PLACEHOLDER_API: "true",
    MA_FLAG_SHOW_DEV_BANNER: "false",
    ...envOverrides,
  };

  await writeFile(
    join(root, ".env.dev.example"),
    `${Object.entries(env)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n")}\n`,
  );

  return { root, scriptPath };
}

function runBash(command: string, cwd: string): Promise<ShellResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", ["--noprofile", "--norc", "-lc", command], {
      cwd,
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function withListener<T>(run: (port: number) => Promise<T>): Promise<T> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    return await run(address.port);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function killTrackedPids(root: string) {
  const pidDir = join(root, ".dev", "pids");
  const entries = await readdir(pidDir).catch(() => []);

  for (const entry of entries) {
    const pidText = await readFile(join(pidDir, entry), "utf8").catch(() => "");
    const pid = Number.parseInt(pidText, 10);
    if (!Number.isNaN(pid)) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // Ignore already-exited test processes.
      }
    }
  }
}

test("service_status reports blocked when another process owns the port", async () => {
  const fixture = await createShellFixture();

  await withListener(async (port) => {
    const result = await runBash(
      [
        "MARKET_AGENT_DEV_SHELL_SOURCE_ONLY=1 source ./scripts/dev-shell.sh",
        "sleep 60 &",
        'bg=$!; echo "$bg" > "$PID_DIR/web.pid"',
        `service_status web ${port}`,
        'kill "$bg" 2>/dev/null || true',
        'wait "$bg" 2>/dev/null || true',
      ].join("\n"),
      fixture.root,
    );

    assert.equal(result.code, 0);
    assert.equal(result.stdout.trim(), "blocked");
  });

  await rm(fixture.root, { recursive: true, force: true });
});

test("assert_port_available fails before startup when an unrelated process owns the port", async () => {
  const fixture = await createShellFixture();

  await withListener(async (port) => {
    const result = await runBash(
      [
        "MARKET_AGENT_DEV_SHELL_SOURCE_ONLY=1 source ./scripts/dev-shell.sh",
        "set +e",
        "sleep 60 &",
        'bg=$!; echo "$bg" > "$PID_DIR/web.pid"',
        `assert_port_available web ${port}`,
        "rc=$?",
        'kill "$bg" 2>/dev/null || true',
        'wait "$bg" 2>/dev/null || true',
        "exit $rc",
      ].join("\n"),
      fixture.root,
    );

    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /web port .* already in use/i);
  });

  await rm(fixture.root, { recursive: true, force: true });
});

test("up rolls back already-started services when a later readiness check fails", async () => {
  const fixture = await createShellFixture();
  const traceFile = join(fixture.root, "trace.log");

  const result = await runBash(
    [
      "MARKET_AGENT_DEV_SHELL_SOURCE_ONLY=1 source ./scripts/dev-shell.sh",
      `TRACE_FILE="${traceFile}"`,
      'mkdir -p "$ROOT/db" "$ROOT/web" "$ROOT/services/chat" "$ROOT/services/resolver" "$ROOT/services/dev-api" "$ROOT/services/watchlists" "$ROOT/services/market" "$ROOT/services/fundamentals" "$ROOT/services/screener" "$ROOT/services/portfolio" "$ROOT/services/home" "$ROOT/services/evidence" "$ROOT/services/agents" "$ROOT/services/analyze" "$ROOT/services/artifact" "$ROOT/services/notifications" "$ROOT/services/observability" "$ROOT/services/snapshot" "$ROOT/services/summary" "$ROOT/services/themes" "$ROOT/services/tools" "$ROOT/services/llm"',
      "ensure_command(){ :; }",
      "ensure_install(){ :; }",
      "assert_port_available(){ :; }",
      "npm(){ :; }",
      "export -f npm",
      'compose(){ printf "compose:%s\\n" "$*" >> "$TRACE_FILE"; }',
      "wait_for_postgres(){ :; }",
      'start_process(){ local name="$1"; printf "start:%s\\n" "$name" >> "$TRACE_FILE"; sleep 60 & echo $! > "$PID_DIR/$name.pid"; }',
      'wait_for_service(){ local name="$1"; if [[ "$name" == "resolver" ]]; then printf "fail:%s\\n" "$name" >> "$TRACE_FILE"; return 1; fi; printf "ready:%s\\n" "$name" >> "$TRACE_FILE"; }',
      "status(){ :; }",
      "up",
    ].join("\n"),
    fixture.root,
  );

  assert.notEqual(result.code, 0);

  const trace = await readFile(traceFile, "utf8");
  assert.match(trace, /compose:up -d/);
  assert.match(trace, /fail:resolver/);
  assert.match(trace, /compose:down/);
  // Every HTTP service must be registered in up(); a missing entry means the
  // web proxy 502s for that surface (this caught analyst-grids being absent).
  assert.match(trace, /start:analyst-grids/);

  const pidDirEntries = await readdir(join(fixture.root, ".dev", "pids"));
  assert.deepEqual(pidDirEntries, []);

  await killTrackedPids(fixture.root).catch(() => {});
  await rm(fixture.root, { recursive: true, force: true });
});

test("up rolls back when postgres never becomes ready", async () => {
  const fixture = await createShellFixture();
  const traceFile = join(fixture.root, "trace.log");

  const result = await runBash(
    [
      "MARKET_AGENT_DEV_SHELL_SOURCE_ONLY=1 source ./scripts/dev-shell.sh",
      `TRACE_FILE="${traceFile}"`,
      'mkdir -p "$ROOT/db" "$ROOT/web" "$ROOT/services/chat" "$ROOT/services/resolver" "$ROOT/services/dev-api" "$ROOT/services/watchlists" "$ROOT/services/market" "$ROOT/services/fundamentals" "$ROOT/services/screener" "$ROOT/services/portfolio" "$ROOT/services/home" "$ROOT/services/evidence" "$ROOT/services/agents" "$ROOT/services/analyze" "$ROOT/services/artifact" "$ROOT/services/notifications" "$ROOT/services/observability" "$ROOT/services/snapshot" "$ROOT/services/summary" "$ROOT/services/themes" "$ROOT/services/tools" "$ROOT/services/llm"',
      "ensure_command(){ :; }",
      "ensure_install(){ :; }",
      "assert_port_available(){ :; }",
      "sleep(){ :; }",
      'compose(){ printf "compose:%s\\n" "$*" >> "$TRACE_FILE"; case "$*" in "exec -T postgres pg_isready"*) return 1 ;; esac; return 0; }',
      'start_process(){ local name="$1"; printf "start:%s\\n" "$name" >> "$TRACE_FILE"; sleep 60 & echo $! > "$PID_DIR/$name.pid"; }',
      'status(){ printf "status\\n" >> "$TRACE_FILE"; }',
      "up",
    ].join("\n"),
    fixture.root,
  );

  assert.notEqual(result.code, 0);

  const trace = await readFile(traceFile, "utf8");
  assert.match(trace, /compose:up -d/);
  assert.match(trace, /compose:down/);
  assert.doesNotMatch(trace, /start:/);
  assert.doesNotMatch(trace, /^status$/m);

  const pidDirEntries = await readdir(join(fixture.root, ".dev", "pids"));
  assert.deepEqual(pidDirEntries, []);

  await killTrackedPids(fixture.root).catch(() => {});
  await rm(fixture.root, { recursive: true, force: true });
});

test("runtime DATABASE_URL is derived from primitive postgres vars", async () => {
  const fixture = await createShellFixture({
    DEV_POSTGRES_PORT: "5544",
    DEV_POSTGRES_USER: "devuser",
    DEV_POSTGRES_PASSWORD: "secret",
    DEV_POSTGRES_DB: "sample_db",
    DATABASE_URL: "postgresql://wrong:wrong@127.0.0.1:9999/wrong",
  });

  const result = await runBash(
    [
      "MARKET_AGENT_DEV_SHELL_SOURCE_ONLY=1 source ./scripts/dev-shell.sh",
      'printf "%s" "$DATABASE_URL"',
    ].join("\n"),
    fixture.root,
  );

  assert.equal(result.code, 0);
  assert.equal(result.stdout.trim(), "postgresql://devuser:secret@127.0.0.1:5544/sample_db");

  await rm(fixture.root, { recursive: true, force: true });
});

test("runtime module env vars default to in-repo durable local stack wiring", async () => {
  const fixture = await createShellFixture();

  const result = await runBash(
    [
      "MARKET_AGENT_DEV_SHELL_SOURCE_ONLY=1 source ./scripts/dev-shell.sh",
      'printf "%s\\n%s\\n%s\\n%s\\n%s\\n%s\\n%s\\n<%s>" "$DEV_API_ANALYZE_SEAL_MODULE" "$DEV_API_RUNTIME_MODULE" "$CHAT_ANALYST_RUNTIME_MODULE" "$CHAT_PERSISTENCE_MODULE" "$LLM_SETTINGS_ENV_FILE" "$MA_FLAG_LLM_SETTINGS" "$VITE_MA_FLAG_LLM_SETTINGS" "${CHAT_LOCAL_TOOL_EXECUTOR:-}"',
    ].join("\n"),
    fixture.root,
  );

  assert.equal(result.code, 0);
  const root = await realpath(fixture.root);
  assert.deepEqual(result.stdout.trim().split("\n"), [
    `${root}/services/dev-api/src/local-runtime.ts`,
    `${root}/services/dev-api/src/local-runtime.ts`,
    `${root}/services/chat/src/local-runtime.ts`,
    `${root}/services/chat/src/local-runtime.ts`,
    `${root}/.env.dev`,
    "true",
    "true",
    "<>",
  ]);

  await rm(fixture.root, { recursive: true, force: true });
});

test("the web app signs in with the dev mock session by default, unless opted out", async () => {
  const on = await createShellFixture();
  const onResult = await runBash(
    ["MARKET_AGENT_DEV_SHELL_SOURCE_ONLY=1 source ./scripts/dev-shell.sh", 'printf "%s" "$VITE_MA_FLAG_DEV_AUTO_LOGIN"'].join("\n"),
    on.root,
  );
  await rm(on.root, { recursive: true, force: true });
  assert.equal(onResult.code, 0, onResult.stderr);
  assert.equal(onResult.stdout.trim(), "true");

  const off = await createShellFixture({ VITE_MA_FLAG_DEV_AUTO_LOGIN: "false" });
  const offResult = await runBash(
    ["MARKET_AGENT_DEV_SHELL_SOURCE_ONLY=1 source ./scripts/dev-shell.sh", 'printf "%s" "$VITE_MA_FLAG_DEV_AUTO_LOGIN"'].join("\n"),
    off.root,
  );
  await rm(off.root, { recursive: true, force: true });
  assert.equal(offResult.stdout.trim(), "false");
});

test("up restarts a running web process when its VITE_* settings changed, and only then", async () => {
  const { result, trace } = await traceUp({}, [
    'stop_process(){ printf "stop:%s\\n" "$1" >> "$TRACE_FILE"; kill "$(cat "$PID_DIR/$1.pid")" 2>/dev/null; rm -f "$PID_DIR/$1.pid"; }',
    "port_listening(){ return 1; }",
    "up",
    'printf "mark:unchanged\\n" >> "$TRACE_FILE"',
    "up",
    'printf "mark:opt-out\\n" >> "$TRACE_FILE"',
    "export VITE_MA_FLAG_DEV_AUTO_LOGIN=false",
  ]);
  assert.equal(result.code, 0, result.stderr);
  const [first, unchanged, optOut] = trace.split(/mark:\S+\n/);
  assert.match(first, /^start:web$/m);
  assert.doesNotMatch(unchanged, /^(stop|start):web$/m, "same VITE_* settings: web keeps running");
  assert.match(optOut, /^stop:web$/m, "a changed VITE_* setting restarts web");
  assert.match(optOut, /^start:web$/m);
});

test("under DEV_PROFILE=chat a VITE_* change restarts the app process, which serves the UI", async () => {
  const { result, trace } = await traceUp({ DEV_PROFILE: "chat" }, [
    'stop_process(){ printf "stop:%s\\n" "$1" >> "$TRACE_FILE"; kill "$(cat "$PID_DIR/$1.pid")" 2>/dev/null; rm -f "$PID_DIR/$1.pid"; }',
    "port_listening(){ return 1; }",
    "up",
    'printf "mark:opt-out\\n" >> "$TRACE_FILE"',
    "export VITE_MA_FLAG_DEV_AUTO_LOGIN=false",
  ]);
  assert.equal(result.code, 0, result.stderr);
  const [, optOut] = trace.split(/mark:\S+\n/);
  assert.match(optOut, /^stop:app$/m);
  assert.match(optOut, /^start:app$/m);
});

test("DEV_NO_KEYS=true pins recorded LLM replies and ignores .env.dev's LLM settings", async () => {
  const printLlmEnv =
    'printf "%s|%s|%s|%s|%s|<%s>|<%s>|%s" "${LLM_CHANNELS:-}" "${LLM_FIXTURE_MODELS:-}" "${LITELLM_MODEL:-}" "${LLM_REPLAY_FILE:-}" "${VITE_MA_FLAG_LLM_SETTINGS:-}" "${LITELLM_FALLBACK_MODELS-unset}" "${LLM_SETTINGS_ENV_FILE-unset}" "${MA_FLAG_LLM_SETTINGS:-}"';

  // A developer's real LLM settings in the env file must not leak into no-keys mode.
  const on = await createShellFixture({
    DEV_NO_KEYS: "true",
    LLM_CHANNELS: "openai",
    LITELLM_MODEL: "openai/gpt-4.1",
    LITELLM_FALLBACK_MODELS: "openai/o3",
  });
  const onResult = await runBash(["MARKET_AGENT_DEV_SHELL_SOURCE_ONLY=1 source ./scripts/dev-shell.sh", printLlmEnv].join("\n"), on.root);
  const root = await realpath(on.root);
  await rm(on.root, { recursive: true, force: true });
  assert.equal(onResult.code, 0, onResult.stderr);
  assert.equal(
    onResult.stdout.trim(),
    `fixture|recorded|fixture/recorded|${root}/services/chat/test/golden/llm-replies.json|false|<>|<>|false`,
  );

  const off = await createShellFixture();
  const offResult = await runBash(["MARKET_AGENT_DEV_SHELL_SOURCE_ONLY=1 source ./scripts/dev-shell.sh", 'printf "<%s>" "${LLM_REPLAY_FILE:-}"'].join("\n"), off.root);
  await rm(off.root, { recursive: true, force: true });
  assert.equal(offResult.stdout.trim(), "<>", "no replay unless asked");
});

test("DEV_NO_KEYS from the command line wins over the env file", async () => {
  const fixture = await createShellFixture({ DEV_NO_KEYS: "false" });
  const result = await runBash(
    ["export DEV_NO_KEYS=true", "MARKET_AGENT_DEV_SHELL_SOURCE_ONLY=1 source ./scripts/dev-shell.sh", 'printf "%s|%s" "$DEV_NO_KEYS" "${LLM_CHANNELS:-}"'].join("\n"),
    fixture.root,
  );
  await rm(fixture.root, { recursive: true, force: true });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout.trim(), "true|fixture");
});

test("turning on DEV_NO_KEYS restarts the running processes that own the LLM runtime, and only those", async () => {
  // .env.dev already hides the Settings UI, so the VITE_* stamp alone would not change.
  const { result, trace } = await traceUp({ VITE_MA_FLAG_LLM_SETTINGS: "false" }, [
    'stop_process(){ printf "stop:%s\\n" "$1" >> "$TRACE_FILE"; kill "$(cat "$PID_DIR/$1.pid")" 2>/dev/null; rm -f "$PID_DIR/$1.pid"; }',
    "port_listening(){ return 1; }",
    'mkdir -p "$ROOT/services/chat"',
    "up",
    'printf "mark:no-keys\\n" >> "$TRACE_FILE"',
    "DEV_NO_KEYS=true",
  ]);
  assert.equal(result.code, 0, result.stderr);
  const [, noKeys] = trace.split(/mark:\S+\n/);
  const stopped = noKeys.split("\n").filter((l) => l.startsWith("stop:")).map((l) => l.slice(5)).sort();
  assert.deepEqual(stopped, ["chat", "dev-api"], "chat and dev-api run the LLM; the rest keep running");
});

test("under DEV_PROFILE=chat, turning on DEV_NO_KEYS restarts the app process", async () => {
  const { result, trace } = await traceUp({ DEV_PROFILE: "chat", VITE_MA_FLAG_LLM_SETTINGS: "false" }, [
    'stop_process(){ printf "stop:%s\\n" "$1" >> "$TRACE_FILE"; kill "$(cat "$PID_DIR/$1.pid")" 2>/dev/null; rm -f "$PID_DIR/$1.pid"; }',
    "port_listening(){ return 1; }",
    'mkdir -p "$ROOT/services/chat"',
    "up",
    'printf "mark:no-keys\\n" >> "$TRACE_FILE"',
    "DEV_NO_KEYS=true",
  ]);
  assert.equal(result.code, 0, result.stderr);
  const [, noKeys] = trace.split(/mark:\S+\n/);
  assert.match(noKeys, /^stop:app$/m);
  assert.match(noKeys, /^start:app$/m);
});

test("launch-env stamps are checksums, so LLM API keys are not copied into .dev", async () => {
  const fixture = await createShellFixture({ LLM_OPENAI_API_KEY: "sk-secret-value" });
  const result = await runBash(
    [
      "MARKET_AGENT_DEV_SHELL_SOURCE_ONLY=1 source ./scripts/dev-shell.sh",
      "write_launch_env_stamp chat",
      'cat "$PID_DIR/chat.launch-env"',
    ].join("\n"),
    fixture.root,
  );
  await rm(fixture.root, { recursive: true, force: true });
  assert.equal(result.code, 0, result.stderr);
  assert.ok(result.stdout.trim().length > 0);
  assert.doesNotMatch(result.stdout, /sk-secret-value/);
});

const NPM_TRACE = ['npm(){ printf "npm:%s:%s\\n" "${PWD##*/}" "$*" >> "$TRACE_FILE"; }', "export -f npm", 'mkdir -p "$ROOT/services/chat"'];
const LIVE_LLM = { LLM_CHANNELS: "openai", LLM_OPENAI_MODELS: "gpt-4.1", LITELLM_MODEL: "openai/gpt-4.1" };

test("DEV_MODE=analyst: frozen dataset + the developer's live LLM, with per-completion usage logging", async () => {
  const fixture = await createShellFixture({ DEV_MODE: "analyst", ...LIVE_LLM });
  const result = await runBash(
    [
      "MARKET_AGENT_DEV_SHELL_SOURCE_ONLY=1 source ./scripts/dev-shell.sh",
      'printf "%s|%s|<%s>|%s" "$LLM_CHANNELS" "$LITELLM_MODEL" "${LLM_REPLAY_FILE:-}" "${LLM_USAGE_LOG:-}"',
    ].join("\n"),
    fixture.root,
  );
  await rm(fixture.root, { recursive: true, force: true });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout.trim(), "openai|openai/gpt-4.1|<>|true");

  const { result: up, lines } = await traceUp({ DEV_MODE: "analyst", ...LIVE_LLM }, NPM_TRACE);
  assert.equal(up.code, 0, up.stderr);
  assert.ok(lines("npm:").includes("chat:run seed:golden"), "the frozen dataset is seeded");
});

test("DEV_MODE=analyst fails fast without a deployable LLM, pointing at DEV_NO_KEYS", async () => {
  // LITELLM_MODEL is set but names no configured channel: the llm check says no.
  const { result, trace } = await traceUp({ DEV_MODE: "analyst", LITELLM_MODEL: "openai/gpt-4.1" }, [
    "llm_deployable(){ return 1; }",
  ]);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /analyst.*live LLM.*LITELLM_MODEL.*DEV_NO_KEYS/s);
  assert.equal(trace, "", "nothing starts");
});

test("the live-mode LLM preflight sees the same settings file the services will load", async () => {
  // The services reparse LLM_SETTINGS_ENV_FILE (default $ROOT/.env.dev); the preflight
  // must check that file, not just the shell-sourced values.
  const { result, lines } = await traceUp({ DEV_MODE: "analyst", ...LIVE_LLM }, [
    ...NPM_TRACE,
    'llm_deployable(){ printf "llm-settings-file:%s\\n" "${LLM_SETTINGS_ENV_FILE:-}" >> "$TRACE_FILE"; }',
  ]);
  assert.equal(result.code, 0, result.stderr);
  const [file] = lines("llm-settings-file:");
  assert.ok(file && file.endsWith("/.env.dev"), `preflight saw LLM_SETTINGS_ENV_FILE=${file}`);
});

test("DEV_MODE=data needs live provider credentials and does not seed frozen data", async () => {
  const missing = await traceUp({ DEV_MODE: "data", ...LIVE_LLM });
  assert.notEqual(missing.result.code, 0);
  assert.match(missing.result.stderr, /data.*POLYGON_API_KEY.*SEC_EDGAR_USER_AGENT/s);

  const { result, lines } = await traceUp(
    // No space: the fixture writes the env file unquoted.
    { DEV_MODE: "data", ...LIVE_LLM, POLYGON_API_KEY: "pk", SEC_EDGAR_USER_AGENT: "market-agent-dev@example.com" },
    NPM_TRACE,
  );
  assert.equal(result.code, 0, result.stderr);
  // It only checks the golden dataset is absent; it never seeds it.
  assert.ok(!lines("npm:").includes("chat:run seed:golden"), lines("npm:").join(", "));
});

test("DEV_MODE=data refuses a database that still holds the frozen golden dataset", async () => {
  const LIVE = { DEV_MODE: "data", ...LIVE_LLM, POLYGON_API_KEY: "pk", SEC_EDGAR_USER_AGENT: "market-agent-dev@example.com" };
  const { result, lines } = await traceUp(LIVE, NPM_TRACE);
  assert.equal(result.code, 0, result.stderr);
  const npm = lines("npm:");
  assert.ok(npm.indexOf("chat:run seed:golden -- --assert-absent") > npm.indexOf("db:run migrate -- up"), npm.join(", "));

  // The check fails: up stops and rolls back instead of starting on frozen data.
  const frozen = await traceUp(LIVE, [
    'npm(){ printf "npm:%s:%s\\n" "${PWD##*/}" "$*" >> "$TRACE_FILE"; [[ "$*" != *--assert-absent* ]]; }',
    "export -f npm",
    'mkdir -p "$ROOT/services/chat"',
  ]);
  assert.notEqual(frozen.result.code, 0);
  assert.deepEqual(frozen.lines("start:"), [], "nothing starts on frozen data");
});

test("DEV_MODE=ui runs only the app, replaying a fixture: no containers, migrations, seeds or LLM", async () => {
  const { result, lines, trace } = await traceUp({ DEV_PROFILE: "chat", DEV_MODE: "ui" }, [
    ...NPM_TRACE,
    'llm_deployable(){ printf "llm-check\\n" >> "$TRACE_FILE"; }',
  ]);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(lines("start:"), ["app"]);
  assert.deepEqual(lines("ready:"), ["app"]);
  assert.deepEqual(lines("compose:"), [], "no containers");
  assert.deepEqual(lines("npm:").filter((l) => /migrate|seed/.test(l)), [], "no database work");
  assert.doesNotMatch(trace, /llm-check/, "no LLM needed");
});

test("DEV_MODE=ui needs the one-process chat profile", async () => {
  const { result, trace } = await traceUp({ DEV_MODE: "ui" });
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /DEV_MODE=ui.*DEV_PROFILE=chat/);
  assert.equal(trace, "");
});

test("switching a running chat stack into DEV_MODE=ui restarts the app", async () => {
  const { result, trace } = await traceUp({ DEV_PROFILE: "chat" }, [
    ...NPM_TRACE,
    'stop_process(){ printf "stop:%s\\n" "$1" >> "$TRACE_FILE"; kill "$(cat "$PID_DIR/$1.pid")" 2>/dev/null; rm -f "$PID_DIR/$1.pid"; }',
    "port_listening(){ return 1; }",
    "up",
    'printf "mark:ui\\n" >> "$TRACE_FILE"',
    "export DEV_MODE=ui",
  ]);
  assert.equal(result.code, 0, result.stderr);
  const [, ui] = trace.split(/mark:\S+\n/);
  assert.match(ui, /^stop:app$/m);
  assert.match(ui, /^start:app$/m);
});

test("an unknown DEV_MODE, or DEV_NO_KEYS with a live mode, fails before starting anything", async () => {
  const unknown = await traceUp({ DEV_MODE: "turbo" });
  assert.notEqual(unknown.result.code, 0);
  assert.match(unknown.result.stderr, /DEV_MODE.*turbo/);

  const clash = await traceUp({ DEV_MODE: "analyst", DEV_NO_KEYS: "true", ...LIVE_LLM });
  assert.notEqual(clash.result.code, 0);
  assert.match(clash.result.stderr, /DEV_NO_KEYS.*DEV_MODE=analyst/);
  assert.equal(clash.trace, "");
});

test("an explicitly empty DEV_MODE on the command line returns to the default mode", async () => {
  const fixture = await createShellFixture({ DEV_MODE: "analyst" });
  const result = await runBash(
    ["export DEV_MODE=", "MARKET_AGENT_DEV_SHELL_SOURCE_ONLY=1 source ./scripts/dev-shell.sh", 'printf "<%s>" "$DEV_MODE"'].join("\n"),
    fixture.root,
  );
  await rm(fixture.root, { recursive: true, force: true });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout.trim(), "<>");
});

test("DEV_MODE from the command line wins over the env file", async () => {
  const fixture = await createShellFixture({ DEV_MODE: "data" });
  const result = await runBash(
    ["export DEV_MODE=analyst", "MARKET_AGENT_DEV_SHELL_SOURCE_ONLY=1 source ./scripts/dev-shell.sh", 'printf "%s" "$DEV_MODE"'].join("\n"),
    fixture.root,
  );
  await rm(fixture.root, { recursive: true, force: true });
  assert.equal(result.stdout.trim(), "analyst");
});

test("DEV_NO_KEYS=true seeds the golden dataset after the dev seeds", async () => {
  const { result, lines } = await traceUp({ DEV_NO_KEYS: "true" }, [
    'npm(){ printf "npm:%s:%s\\n" "${PWD##*/}" "$*" >> "$TRACE_FILE"; }',
    "export -f npm",
    'mkdir -p "$ROOT/services/chat"',
  ]);
  assert.equal(result.code, 0, result.stderr);
  const npm = lines("npm:");
  assert.ok(npm.indexOf("chat:run seed:golden") > npm.indexOf("db:run seed"), npm.join(", "));
});

test("without DEV_NO_KEYS, up does not seed the golden dataset", async () => {
  const { result, lines } = await traceUp({}, [
    'npm(){ printf "npm:%s:%s\\n" "${PWD##*/}" "$*" >> "$TRACE_FILE"; }',
    "export -f npm",
  ]);
  assert.equal(result.code, 0, result.stderr);
  assert.ok(!lines("npm:").some((l) => l.includes("seed:golden")));
});

test("unofficial dev providers are opt-in and set a local sidecar origin", async () => {
  const disabled = await createShellFixture();
  const disabledResult = await runBash(
    [
      "MARKET_AGENT_DEV_SHELL_SOURCE_ONLY=1 source ./scripts/dev-shell.sh",
      'printf "%s|%s" "${ENABLE_UNOFFICIAL_DEV_PROVIDERS:-}" "${DEV_PROVIDERS_ORIGIN:-}"',
    ].join("\n"),
    disabled.root,
  );
  assert.equal(disabledResult.code, 0);
  assert.equal(disabledResult.stdout.trim(), "false|");
  await rm(disabled.root, { recursive: true, force: true });

  const enabled = await createShellFixture({ ENABLE_UNOFFICIAL_DEV_PROVIDERS: "true" });
  const enabledResult = await runBash(
    [
      "MARKET_AGENT_DEV_SHELL_SOURCE_ONLY=1 source ./scripts/dev-shell.sh",
      'printf "%s|%s" "$ENABLE_UNOFFICIAL_DEV_PROVIDERS" "$DEV_PROVIDERS_ORIGIN"',
    ].join("\n"),
    enabled.root,
  );
  assert.equal(enabledResult.code, 0);
  assert.equal(enabledResult.stdout.trim(), "true|http://127.0.0.1:4336");
  await rm(enabled.root, { recursive: true, force: true });
});

test("discovery is feature-off by default and its worker joins dev-shell cleanup only when enabled", async () => {
  const disabled = await createShellFixture();
  const disabledResult = await runBash(
    ["MARKET_AGENT_DEV_SHELL_SOURCE_ONLY=1 source ./scripts/dev-shell.sh", 'printf "%s" "$DISCOVERY_ENABLED"'].join("\n"),
    disabled.root,
  );
  assert.equal(disabledResult.code, 0);
  assert.equal(disabledResult.stdout.trim(), "false");
  await rm(disabled.root, { recursive: true, force: true });

  const fixture = await createShellFixture({ DISCOVERY_ENABLED: "true" });
  const traceFile = join(fixture.root, "trace.log");
  const result = await runBash(
    [
      "MARKET_AGENT_DEV_SHELL_SOURCE_ONLY=1 source ./scripts/dev-shell.sh",
      `TRACE_FILE="${traceFile}"`,
      'mkdir -p "$ROOT/db" "$ROOT/web" "$ROOT/services/chat" "$ROOT/services/resolver" "$ROOT/services/dev-api" "$ROOT/services/watchlists" "$ROOT/services/market" "$ROOT/services/fundamentals" "$ROOT/services/screener" "$ROOT/services/portfolio" "$ROOT/services/home" "$ROOT/services/evidence" "$ROOT/services/analyst-grids" "$ROOT/services/agents" "$ROOT/services/analyze" "$ROOT/services/artifact" "$ROOT/services/notifications" "$ROOT/services/observability" "$ROOT/services/snapshot" "$ROOT/services/summary" "$ROOT/services/themes" "$ROOT/services/tools" "$ROOT/services/llm" "$ROOT/services/discovery"',
      "ensure_command(){ :; }",
      'ensure_install(){ printf "install:%s\\n" "$1" >> "$TRACE_FILE"; }',
      "assert_port_available(){ :; }",
      "npm(){ :; }",
      "export -f npm",
      "compose(){ :; }",
      "wait_for_postgres(){ :; }",
      'start_process(){ local name="$1"; printf "start:%s:%s\\n" "$name" "$3" >> "$TRACE_FILE"; sleep 60 >/dev/null 2>&1 & echo $! > "$PID_DIR/$name.pid"; }',
      'wait_for_service(){ :; }',
      "status(){ :; }",
      "up",
    ].join("\n"),
    fixture.root,
  );
  assert.equal(result.code, 0, result.stderr);
  const trace = await readFile(traceFile, "utf8");
  assert.match(trace, /install:.*services\/discovery/);
  assert.match(trace, /start:discovery-worker:npm run worker/);
  await killTrackedPids(fixture.root).catch(() => {});
  await rm(fixture.root, { recursive: true, force: true });
});

test("up starts the unofficial dev provider sidecar only when explicitly enabled", async () => {
  const fixture = await createShellFixture({ ENABLE_UNOFFICIAL_DEV_PROVIDERS: "true" });
  const traceFile = join(fixture.root, "trace.log");

  const result = await runBash(
    [
      "MARKET_AGENT_DEV_SHELL_SOURCE_ONLY=1 source ./scripts/dev-shell.sh",
      `TRACE_FILE="${traceFile}"`,
      'mkdir -p "$ROOT/db" "$ROOT/web" "$ROOT/services/chat" "$ROOT/services/resolver" "$ROOT/services/dev-api" "$ROOT/services/watchlists" "$ROOT/services/market" "$ROOT/services/fundamentals" "$ROOT/services/screener" "$ROOT/services/portfolio" "$ROOT/services/home" "$ROOT/services/evidence" "$ROOT/services/dev-providers" "$ROOT/services/agents" "$ROOT/services/analyze" "$ROOT/services/artifact" "$ROOT/services/notifications" "$ROOT/services/observability" "$ROOT/services/snapshot" "$ROOT/services/summary" "$ROOT/services/themes" "$ROOT/services/tools" "$ROOT/services/llm"',
      "ensure_command(){ :; }",
      "ensure_install(){ :; }",
      "ensure_python_service_install(){ printf \"python-install:%s\\n\" \"$1\" >> \"$TRACE_FILE\"; }",
      "assert_port_available(){ printf \"port:%s:%s\\n\" \"$1\" \"$2\" >> \"$TRACE_FILE\"; }",
      "npm(){ :; }",
      "export -f npm",
      'compose(){ printf "compose:%s\\n" "$*" >> "$TRACE_FILE"; }',
      "wait_for_postgres(){ :; }",
      'start_process(){ local name="$1"; printf "start:%s:%s\\n" "$name" "$3" >> "$TRACE_FILE"; sleep 60 >/dev/null 2>&1 & echo $! > "$PID_DIR/$name.pid"; }',
      'wait_for_service(){ local name="$1"; printf "ready:%s\\n" "$name" >> "$TRACE_FILE"; }',
      "status(){ :; }",
      "up",
    ].join("\n"),
    fixture.root,
  );

  assert.equal(result.code, 0, result.stderr);
  const trace = await readFile(traceFile, "utf8");
  assert.match(trace, /port:dev-providers:4336/);
  assert.match(trace, /python-install:.*services\/dev-providers/);
  assert.match(trace, /start:dev-providers:/);
  assert.match(trace, /ready:dev-providers/);

  await killTrackedPids(fixture.root).catch(() => {});
  await rm(fixture.root, { recursive: true, force: true });
});

test("down stops compose services without deleting dev database containers", async () => {
  const fixture = await createShellFixture();
  const traceFile = join(fixture.root, "trace.log");

  const result = await runBash(
    [
      "MARKET_AGENT_DEV_SHELL_SOURCE_ONLY=1 source ./scripts/dev-shell.sh",
      `TRACE_FILE="${traceFile}"`,
      'compose(){ printf "compose:%s\\n" "$*" >> "$TRACE_FILE"; }',
      "down",
    ].join("\n"),
    fixture.root,
  );

  assert.equal(result.code, 0, result.stderr);
  const trace = await readFile(traceFile, "utf8");
  assert.match(trace, /compose:stop/);
  assert.doesNotMatch(trace, /compose:down/);

  await rm(fixture.root, { recursive: true, force: true });
});

test("docker compose declares persistent storage for Postgres dev data", async () => {
  const composeFile = await readFile(join(REPO_ROOT, "docker-compose.dev.yml"), "utf8");

  assert.match(composeFile, /postgres-data:\/var\/lib\/postgresql\/data/);
  assert.match(composeFile, /^volumes:\n(?:[\s\S]*\n)?  postgres-data:/m);
});

// Runs `up` with every side effect stubbed and returns the trace of what it would do.
async function traceUp(envOverrides: Record<string, string> = {}, preamble: string[] = []) {
  const fixture = await createShellFixture(envOverrides);
  const traceFile = join(fixture.root, "trace.log");
  const result = await runBash(
    [
      "MARKET_AGENT_DEV_SHELL_SOURCE_ONLY=1 source ./scripts/dev-shell.sh",
      `TRACE_FILE="${traceFile}"`,
      'mkdir -p "$ROOT/db" "$ROOT/services/resolver"',
      "ensure_command(){ :; }",
      'ensure_install(){ printf "install:%s\\n" "${1#"$ROOT"/}" >> "$TRACE_FILE"; }',
      "ensure_python_service_install(){ :; }",
      'assert_port_available(){ printf "port:%s\\n" "$1" >> "$TRACE_FILE"; }',
      "npm(){ :; }",
      "export -f npm",
      'compose(){ printf "compose:%s\\n" "$*" >> "$TRACE_FILE"; }',
      "container_status(){ printf stopped; }",
      "wait_for_postgres(){ :; }",
      'start_process(){ local name="$1"; printf "start:%s\\n" "$name" >> "$TRACE_FILE"; sleep 60 >/dev/null 2>&1 & echo $! > "$PID_DIR/$name.pid"; }',
      'wait_for_service(){ printf "ready:%s\\n" "$1" >> "$TRACE_FILE"; }',
      "status(){ :; }",
      // The real check runs services/llm, absent from the fixture; tests opt in to failure.
      "llm_deployable(){ :; }",
      ...preamble,
      "up",
    ].join("\n"),
    fixture.root,
  );
  const trace = await readFile(traceFile, "utf8").catch(() => "");
  await killTrackedPids(fixture.root).catch(() => {});
  await rm(fixture.root, { recursive: true, force: true });
  const lines = (prefix: string) =>
    trace.split("\n").filter((l) => l.startsWith(prefix)).map((l) => l.slice(prefix.length));
  return { result, trace, lines };
}

const FULL_SERVICES = [
  "web", "chat", "resolver", "dev-api", "watchlists", "market", "fundamentals",
  "screener", "portfolio", "home", "evidence", "analyst-grids",
];
// DEV_PROFILE=chat runs one process (services/app) serving web, chat, resolver,
// dev-api, market and fundamentals on the web port (#122).
const CHAT_SERVICES = ["app"];

test("DEV_PROFILE defaults to full: every service is checked, started and awaited, with all containers", async () => {
  const { result, lines } = await traceUp();
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(lines("port:"), FULL_SERVICES);
  assert.deepEqual(lines("start:"), FULL_SERVICES);
  assert.deepEqual(lines("ready:"), FULL_SERVICES);
  assert.deepEqual(lines("compose:"), ["up -d"]);
});

test("DEV_PROFILE=chat starts only the golden-chat services and only the Postgres container", async () => {
  const { result, lines } = await traceUp({ DEV_PROFILE: "chat", DISCOVERY_ENABLED: "true" });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(lines("port:"), CHAT_SERVICES);
  assert.deepEqual(lines("start:"), CHAT_SERVICES, "parked services (and the discovery worker) are not started");
  assert.deepEqual(lines("ready:"), CHAT_SERVICES);
  assert.deepEqual(lines("compose:"), ["stop redis minio", "up -d postgres"]);
  // chat imports financial-core sources, which resolve ajv/decimal.js from its own node_modules.
  assert.ok(lines("install:").includes("services/financial-core"), "financial-core deps are installed");
});

test("switching a running full stack to DEV_PROFILE=chat stops the separate processes and parked containers", async () => {
  // A full stack is already up: web, chat, watchlists and the discovery worker are tracked.
  const { result, lines } = await traceUp({ DEV_PROFILE: "chat" }, [
    'stop_process(){ printf "stop:%s\\n" "$1" >> "$TRACE_FILE"; kill "$(cat "$PID_DIR/$1.pid")" 2>/dev/null; rm -f "$PID_DIR/$1.pid"; }',
    'for name in web chat watchlists discovery-worker; do sleep 60 >/dev/null 2>&1 & echo $! > "$PID_DIR/$name.pid"; done',
  ]);
  assert.equal(result.code, 0, result.stderr);
  // web and chat now run inside app; their standalone processes would hold its ports.
  assert.deepEqual(lines("stop:"), ["chat", "discovery-worker", "watchlists", "web"]);
  assert.deepEqual(lines("compose:"), ["stop redis minio", "up -d postgres"]);
  assert.deepEqual(lines("start:"), ["app"]);
});

test("switching chat to full waits for the stopped app to free the shared web port before checking it", async () => {
  const { result, trace } = await traceUp({}, [
    'stop_process(){ printf "stop:%s\\n" "$1" >> "$TRACE_FILE"; kill "$(cat "$PID_DIR/$1.pid")" 2>/dev/null; rm -f "$PID_DIR/$1.pid"; }',
    'port_listening(){ printf "listening?:%s\\n" "$1" >> "$TRACE_FILE"; return 1; }',
    'sleep 60 >/dev/null 2>&1 & echo $! > "$PID_DIR/app.pid"',
  ]);
  assert.equal(result.code, 0, result.stderr);
  const stop = trace.indexOf("stop:app\n");
  const waited = trace.indexOf("listening?:5173\n");
  const checked = trace.indexOf("port:web\n");
  assert.ok(stop !== -1 && waited > stop, "waits on app's port after stopping it");
  assert.ok(checked > waited, "only then checks the web port");
});

test("DEV_PROFILE=chat still honours the unofficial dev-provider sidecar opt-in", async () => {
  const { result, lines } = await traceUp({ DEV_PROFILE: "chat", ENABLE_UNOFFICIAL_DEV_PROVIDERS: "true" });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(lines("start:"), ["dev-providers", ...CHAT_SERVICES]);
});

test("DEV_PROFILE from the command line wins over the env file", async () => {
  const fixture = await createShellFixture({ DEV_PROFILE: "full" });
  const result = await runBash(
    ["export DEV_PROFILE=chat", "MARKET_AGENT_DEV_SHELL_SOURCE_ONLY=1 source ./scripts/dev-shell.sh", 'printf "%s" "$DEV_PROFILE"'].join("\n"),
    fixture.root,
  );
  await rm(fixture.root, { recursive: true, force: true });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout.trim(), "chat");
});

test("an unknown DEV_PROFILE fails before starting anything", async () => {
  const { result, trace } = await traceUp({ DEV_PROFILE: "everything" });
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /DEV_PROFILE.*everything.*chat.*full/);
  assert.equal(trace, "");
});

test("status shows the one app process, the services it hosts, and parked services under DEV_PROFILE=chat", async () => {
  // An unused web port, so a local dev server on 5173 can't make app read "blocked".
  const fixture = await createShellFixture({ DEV_PROFILE: "chat", WEB_PORT: "59173" });
  const result = await runBash(
    [
      "MARKET_AGENT_DEV_SHELL_SOURCE_ONLY=1 source ./scripts/dev-shell.sh",
      "container_status(){ printf stopped; }",
      "status",
    ].join("\n"),
    fixture.root,
  );
  await rm(fixture.root, { recursive: true, force: true });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^profile\s+chat$/m);
  assert.match(result.stdout, /^app\s+stopped\s+http:\/\/127\.0\.0\.1:59173/m, "app serves on the web port");
  for (const hosted of ["web", "chat", "resolver", "dev-api", "market", "fundamentals"]) {
    assert.match(result.stdout, new RegExp(`^${hosted}\\s+in app`, "m"), hosted);
  }
  for (const parked of ["watchlists", "screener", "portfolio", "home", "evidence", "analyst-grids", "discovery"]) {
    assert.match(result.stdout, new RegExp(`^${parked}\\s+parked`, "m"), parked);
  }
});
