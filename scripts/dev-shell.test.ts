import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
      'mkdir -p "$ROOT/db" "$ROOT/web" "$ROOT/services/chat" "$ROOT/services/resolver" "$ROOT/services/dev-api"',
      "ensure_command(){ :; }",
      "ensure_install(){ :; }",
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
