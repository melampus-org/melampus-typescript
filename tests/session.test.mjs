import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  statSync,
  symlinkSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Supervisor, hookDecision, gate } from "../dist/session.js";
import { project, healthy, drift, sdkUrl, waitFor } from "./helpers.mjs";
const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

test("fresh process healthy → same-size drift → scoped repair → healthy", async (t) => {
  const p = project(t);
  const s = new Supervisor(p.config);
  assert.equal((await s.check()).exit_code, 0);
  assert.equal((await s.check()).generation, 1);
  assert.equal(healthy.length, drift.length);
  p.write("pricing.ts", drift);
  const broken = await s.check();
  assert.equal(broken.exit_code, 1);
  assert.equal(broken.findings[0].check_id, "nonnegative");
  assert.equal(
    hookDecision(
      { hook_event_name: "PreToolUse", tool_name: "Bash" },
      broken,
      s,
    ).hookSpecificOutput.permissionDecision,
    "deny",
  );
  assert.deepEqual(
    hookDecision(
      { hook_event_name: "PreToolUse", tool_name: "Read" },
      broken,
      s,
    ),
    {},
  );
  assert.ok(
    hookDecision(
      {
        hook_event_name: "PreToolUse",
        tool_name: "Edit",
        tool_input: { file_path: "pricing.ts" },
      },
      broken,
      s,
    ).hookSpecificOutput.additionalContext,
  );
  for (const file_path of ["intent.ts", "../escape.ts", "other.ts", ""])
    assert.equal(
      hookDecision(
        {
          hook_event_name: "PreToolUse",
          tool_name: "Write",
          tool_input: { file_path },
        },
        broken,
        s,
      ).hookSpecificOutput.permissionDecision,
      "deny",
    );
  for (const hook_event_name of ["Stop", "PostToolUse"])
    assert.equal(
      hookDecision({ hook_event_name }, broken, s).decision,
      "block",
    );
  assert.ok(
    hookDecision({ hook_event_name: "PostToolUseFailure" }, broken, s)
      .hookSpecificOutput.additionalContext,
  );
  p.write("pricing.ts", healthy);
  const recovered = await s.check();
  assert.equal(recovered.exit_code, 0);
  assert.equal(recovered.generation, 3);
  assert.deepEqual(hookDecision({ hook_event_name: "Stop" }, recovered, s), {});
  assert.deepEqual(
    hookDecision(
      { hook_event_name: "PreToolUse", tool_name: "Bash" },
      recovered,
      s,
    ),
    {},
  );
  assert.equal(
    hookDecision(
      {
        hook_event_name: "PreToolUse",
        tool_name: "Edit",
        tool_input: { file_path: "intent.ts" },
      },
      recovered,
      s,
    ).hookSpecificOutput.permissionDecision,
    "deny",
  );
});
test("missing instrumentation, substituted predicates, skipped checks and app errors are incomplete", async (t) => {
  const variants = [
    "export const price = (n: number) => n;",
    `import { Check, instrumented } from ${JSON.stringify(sdkUrl)}; export const price = instrumented({ path: 'pricing:price', intent: 'Nonnegative', checks: [new Check('nonnegative', () => true, 'Nonnegative')] })((n: number) => n);`,
    "import { PRICE } from './intent.ts'; export const price = PRICE.instrument({ path: 'pricing:price' })((n: number) => { throw new Error('secret'); });",
    `import { DEFAULT_POLICY } from ${JSON.stringify(sdkUrl)}; DEFAULT_POLICY.configure({ checksPerSecond: 0 }); ${healthy}`,
  ];
  for (const source of variants) {
    const p = project(t);
    p.write("pricing.ts", source);
    const report = await new Supervisor(p.config).check();
    assert.equal(report.exit_code, 2);
    assert.equal(JSON.stringify(report).includes("secret"), false);
  }
  const p = project(t);
  p.write("exercise.ts", "export {};");
  const report = await new Supervisor(p.config).check();
  assert.equal(report.exit_code, 2);
  assert.deepEqual(report.undeclared, ["pricing:price"]);
});
test("protected files, disappearance and escaping symlinks cannot preserve green state", async (t) => {
  const p = project(t);
  const s = new Supervisor(p.config);
  assert.equal((await s.check()).exit_code, 0);
  const intent = p.read("intent.ts");
  p.write("intent.ts", intent + "\n");
  assert.deepEqual((await s.check()).protected_changed, ["intent.ts"]);
  p.write("intent.ts", intent);
  assert.equal((await s.check()).exit_code, 0);
  rmSync(join(p.root, "pricing.ts"));
  assert.equal((await s.check()).exit_code, 2);
  symlinkSync("/tmp", join(p.root, "pricing.ts"));
  assert.equal((await s.check()).exit_code, 2);
  assert.throws(() => s.local("pricing.ts/escape.ts"));
});
test("scope directories detect additions, ignore generated folders and reject repairs there", async (t) => {
  const p = project(t, { watch: ["."] });
  const s = new Supervisor(p.config);
  const before = s.snapshot();
  mkdirSync(join(p.root, "dist"));
  p.write("dist/file.js", "generated");
  assert.equal(s.snapshot(), before);
  p.write("new.ts", "export {};");
  assert.notEqual(s.snapshot(), before);
  assert.equal(s.repairPath("new.ts"), true);
  assert.equal(s.repairPath("dist/new.js"), false);
});
test("timeout, early process death and source changes during a run fail closed", async (t) => {
  const p = project(t, { timeout: 0.5 });
  p.write(
    "pricing.ts",
    healthy.replace("Math.max(0, n)", "(() => { while (true) {} })()"),
  );
  assert.match((await new Supervisor(p.config).check()).message, /timed out/);
  p.write(
    "pricing.ts",
    "process.exit(0); export const price = (n: number) => n;",
  );
  assert.equal((await new Supervisor(p.config).check()).exit_code, 2);
  const q = project(t);
  q.write(
    "exercise.ts",
    "import { price } from './pricing.ts'; await new Promise(r => setTimeout(r, 500)); price(1);",
  );
  const s = new Supervisor(q.config);
  const pending = s.check();
  await new Promise((done) => setTimeout(done, 200));
  q.write("pricing.ts", drift);
  assert.match((await pending).message, /Source changed/);
  assert.equal((await s.check()).exit_code, 0); // scenario exercised only +1, which is nonnegative under both implementations
});
test("configuration and invalid contract registries rejected", async (t) => {
  for (const overrides of [
    { timeout: 0 },
    { timeout: 11 },
    { watch: [] },
    { watch: "x" },
    { contracts: "../outside.ts" },
  ]) {
    const p = project(t, overrides);
    assert.throws(() => new Supervisor(p.config));
  }
  for (const source of [
    "export const CONTRACTS = {};",
    "export const CONTRACTS = { bad: {} };",
  ]) {
    const p = project(t);
    p.write("intent.ts", source);
    assert.equal((await new Supervisor(p.config).check()).exit_code, 2);
  }
});

test("live authenticated supervisor, hook CLI, ownership and dead-supervisor gate", async (t) => {
  const p = project(t);
  const state = join(p.root, ".melampus/session.json");
  const child = spawn(
    process.execPath,
    [
      cli,
      "session",
      "--config",
      p.config,
      "--state",
      state,
      "--interval",
      "0.05",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let stdout = "";
  child.stdout.on("data", (c) => {
    stdout += c;
  });
  child.stderr.resume();
  t.after(() => {
    if (child.exitCode === null) child.kill("SIGKILL");
  });
  await waitFor(() => stdout.includes("READY"));
  assert.equal(statSync(state).mode & 0o777, 0o600);
  assert.equal((await gate(state)).report.exit_code, 0);
  const descriptor = JSON.parse(readFileSync(state));
  assert.equal(
    (
      await fetch(`http://127.0.0.1:${descriptor.port}/gate`, {
        method: "POST",
        body: "{}",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(`http://127.0.0.1:${descriptor.port}/gate`, {
        method: "POST",
        headers: { Authorization: "Bearer " + descriptor.token },
        body: "[]",
      })
    ).status,
    400,
  );
  const duplicate = spawnSync(process.execPath, [
    cli,
    "session",
    "--config",
    p.config,
    "--state",
    state,
  ]);
  assert.equal(duplicate.status, 2);
  assert.equal((await gate(state, { cwd: "/" })).report.exit_code, 2);
  p.write("pricing.ts", drift);
  const result = await gate(state, { hook_event_name: "Stop" });
  assert.equal(result.report.exit_code, 1);
  assert.equal(result.decision.decision, "block");
  // Async child here: the supervisor is a separate process and can answer while we wait.
  const hook = spawnSync(process.execPath, [cli, "hook", "--state", state], {
    input: JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "secret" },
    }),
    encoding: "utf8",
  });
  assert.equal(hook.status, 0);
  assert.equal(
    JSON.parse(hook.stdout).hookSpecificOutput.permissionDecision,
    "deny",
  );
  p.write("pricing.ts", healthy);
  assert.equal((await gate(state)).report.exit_code, 0);
  child.kill("SIGTERM");
  await new Promise((done) => child.once("exit", done));
  assert.equal(existsSync(state), false);
  assert.equal(existsSync(state + ".lock"), false);
  const dead = await gate(state, { hook_event_name: "Stop" });
  assert.equal(dead.report.exit_code, 2);
  assert.equal(dead.decision.decision, "block");
});
test("CLI help/version and invalid input", () => {
  for (const args of [["--help"], ["--version"]])
    assert.equal(spawnSync(process.execPath, [cli, ...args]).status, 0);
  for (const args of [
    ["unknown"],
    ["watch", "--duration", "-1"],
    ["watch", "--port", "65536"],
    ["session", "--interval", "0"],
    ["gate", "extra"],
    ["--wrong"],
  ])
    assert.equal(spawnSync(process.execPath, [cli, ...args]).status, 2);
  assert.equal(
    spawnSync(process.execPath, [cli, "hook"], { input: "bad" }).status,
    2,
  );
  assert.equal(
    spawnSync(process.execPath, [cli, "gate", "--state", "/missing"]).status,
    2,
  );
  const watch = spawnSync(
    process.execPath,
    [cli, "watch", "--port", "0", "--duration", "0.05"],
    { encoding: "utf8" },
  );
  assert.equal(watch.status, 2);
  assert.match(watch.stdout, /READY/);
  assert.match(watch.stdout, /SUMMARY/);
});
