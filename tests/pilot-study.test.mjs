import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { PilotStudy, changedLines } from "../examples/pilot-study/study.mjs";
import { runSynthetic } from "../examples/pilot-study/cli.mjs";
import {
  ORDERS,
  solution,
  coverageQuestions,
} from "../examples/pilot-study/fixtures.mjs";

function workspace(t) {
  const parent = mkdtempSync(join(tmpdir(), "melampus-pilot-test-"));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  return join(parent, "study");
}

test("all worksheet measures are populated by actual gates, with synthetic responses explicitly labeled", async (t) => {
  const directory = workspace(t);
  const study = new PilotStudy(directory, {
    participant: "automated",
    mode: "synthetic",
    rotation: 4,
  });
  await runSynthetic(study);
  assert.equal(study.data.stage, "done");
  assert.deepEqual(study.data.order, ["module", "wrapper", "class"]);
  assert.equal(new Set(ORDERS.map((order) => order.join())).size, 6);
  for (const style of study.data.order) {
    const r = study.data.results[style];
    for (const phase of ["setup", "second", "repair"]) {
      assert.equal(r[phase].passed, true);
      assert.ok(r[phase].elapsedMs > 0);
      assert.deepEqual(
        r[phase].attempts.map((a) => a.exit_code),
        phase === "repair" ? [1, 0] : [2, 0],
      );
    }
    assert.equal(r.coverage.correct, 6);
    assert.equal(r.diagnosis.correct, true);
    assert.equal(r.drift.blocked, true);
    assert.equal(r.drift.report.findings[0].check_id, "nonnegative");
    assert.ok(r.diagnosis.explanation.length > 0);
    assert.deepEqual(Object.keys(r.confusion), ["setup", "second", "errors"]);
    assert.equal(r.integrationBusinessLines.total === 0, style !== "wrapper");
    assert.equal(r.secondBusinessLines.total === 0, style !== "wrapper");
  }
  assert.equal(study.data.preference.style, "module");
  assert.ok(study.data.preference.reason.includes("not a human"));
  const markdown = readFileSync(join(directory, "feedback.md"), "utf8");
  for (const metric of [
    "Minutes to first passing gate",
    "Business-code lines",
    "Minutes to second checked method",
    "Coverage quiz",
    "Understood failing check",
    "Repaired failing check",
    "Setup confusion",
    "Error-message confusion",
    "Preferred style",
    "Preference reason",
  ])
    assert.ok(markdown.includes(metric));
  assert.ok(markdown.includes("SYNTHETIC WALKTHROUGH"));
  assert.ok(
    readFileSync(join(directory, "feedback.csv"), "utf8").includes(
      '"synthetic"',
    ),
  );
  assert.equal(
    JSON.parse(readFileSync(join(directory, "study.json"))).stage,
    "done",
  );
});

test("task timers exclude pauses, survive resume, and retain failed attempt timing", async (t) => {
  const directory = workspace(t);
  let now = 1000;
  let study = new PilotStudy(directory, {
    participant: "timing",
    clock: () => now,
  });
  study.startTimer();
  now += 60000;
  study.pause();
  assert.equal(study.data.timer.elapsedMs, 60000);
  now += 600000; // downtime must not be counted
  study = new PilotStudy(directory, {
    participant: "timing",
    clock: () => now,
  });
  study.startTimer();
  now += 30000;
  assert.equal((await study.check()).exit_code, 2);
  assert.equal(study.result.setup.attempts[0].elapsedMs, 90000);
  solution(study.folder, study.style, false);
  now += 30000;
  assert.equal((await study.check()).exit_code, 0);
  assert.equal(study.result.setup.elapsedMs, 120000);
  assert.equal(study.data.stage, "second");
  study.startTimer();
  now += 5000;
  study.tick(); // a saved heartbeat before unexpected process termination
  now += 3600000;
  const resumed = new PilotStudy(directory, {
    participant: "timing",
    clock: () => now,
  });
  assert.equal(resumed.data.interruptions, 1);
  assert.equal(resumed.data.timer.elapsedMs, 5000);
  resumed.startTimer();
  now += 5000;
  solution(resumed.folder, resumed.style, true);
  assert.equal((await resumed.check()).exit_code, 0);
  assert.equal(resumed.result.second.elapsedMs, 10000);
  const answers = coverageQuestions(resumed.style).map((q) => q.expected);
  answers[0] = "uncovered";
  assert.throws(() => resumed.answerCoverage(["covered"]));
  resumed.answerCoverage(answers);
  assert.equal(resumed.result.coverage.correct, 5);
  assert.equal((await resumed.introduceDrift()).blocked, true);
  // Diagnosis can resume without injecting another mutation.
  const next = new PilotStudy(directory, {
    participant: "timing",
    clock: () => now,
  });
  assert.equal((await next.introduceDrift()).report.exit_code, 1);
  next.answerDiagnosis("network", "Participant misidentified the failure.");
  assert.equal(next.result.diagnosis.correct, false);
});

test("reviewed file edits cannot produce a false first pass; pending reports stay pending", async (t) => {
  const study = new PilotStudy(workspace(t), {
    participant: "guard",
    rotation: 2,
  });
  assert.throws(() => study.finish("class", "premature"));
  assert.throws(() => study.answerDiagnosis("result", "premature"));
  const reviewed = join(study.folder, "intent.ts");
  const original = readFileSync(reviewed, "utf8");
  solution(study.folder, study.style, true); // completing the second task early must not get a timing advantage
  study.startTimer();
  const early = await study.check();
  assert.equal(early.exit_code, 2);
  assert.equal(early.sdk_exit_code, 0);
  assert.equal(early.task_error, "unexpected_check_count");
  assert.equal(study.data.stage, "setup");
  solution(study.folder, study.style, false);
  writeFileSync(reviewed, original.replace("n >= 0", "true"));
  study.startTimer();
  const report = await study.check();
  assert.equal(report.exit_code, 2);
  assert.deepEqual(report.protected_changed, ["intent.ts"]);
  assert.equal(study.result.setup.passed, false);
  writeFileSync(reviewed, original);
  assert.equal((await study.check()).exit_code, 0);
  const feedback = readFileSync(join(study.root, "feedback.md"), "utf8");
  assert.ok(
    feedback.includes("| Repaired failing check (fresh gate) |  |  |  |"),
  );
});

test(
  "interactive CLI pauses, resumes, and collects every participant prompt",
  { timeout: 30000 },
  async (t) => {
    const directory = workspace(t);
    const cli = new URL("../examples/pilot-study/cli.mjs", import.meta.url);
    async function run(pauseFirst) {
      const child = spawn(
        process.execPath,
        [cli.pathname, "--participant", "terminal-test", "--dir", directory],
        { stdio: ["pipe", "pipe", "pipe"] },
      );
      t.after(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      });
      let buffer = "",
        errors = "",
        failure;
      let phaseKey = "",
        promptIndex = 0;
      child.stderr.on("data", (chunk) => {
        errors += chunk;
      });
      child.stdout.on("data", (chunk) => {
        buffer += chunk;
        while (buffer.includes("\n> ")) {
          buffer = buffer.slice(buffer.indexOf("\n> ") + 4);
          try {
            if (pauseFirst) {
              child.stdin.write("pause\n");
              continue;
            }
            const state = JSON.parse(
              readFileSync(join(directory, "study.json"), "utf8"),
            );
            const key = `${state.index}:${state.stage}`;
            if (key !== phaseKey) {
              phaseKey = key;
              promptIndex = 0;
            }
            const style = state.order[state.index];
            const folder = join(directory, style ?? "");
            let answer;
            if (state.stage === "setup" || state.stage === "second") {
              solution(folder, style, state.stage === "second");
              answer = "check";
            } else if (state.stage === "coverage")
              answer = coverageQuestions(style)[promptIndex].expected;
            else if (state.stage === "diagnosis")
              answer =
                promptIndex === 0
                  ? "result"
                  : "The changed formula returns a negative price.";
            else if (state.stage === "repair") {
              const file = join(folder, "business.ts");
              writeFileSync(
                file,
                readFileSync(file, "utf8").replace(
                  "Math.min(0, cents)",
                  "Math.max(0, cents)",
                ),
              );
              answer = "check";
            } else if (state.stage === "feedback") answer = "none";
            else if (state.stage === "preference")
              answer =
                promptIndex === 0
                  ? "no-preference"
                  : "Automated terminal test response, not usability evidence.";
            else throw new Error(`Unexpected prompt at ${state.stage}`);
            promptIndex++;
            child.stdin.write(answer + "\n");
          } catch (error) {
            failure = error;
            child.kill("SIGKILL");
          }
        }
      });
      const code = await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", resolve);
      });
      if (failure) throw failure;
      assert.equal(code, 0, errors);
    }
    await run(true);
    const paused = JSON.parse(
      readFileSync(join(directory, "study.json"), "utf8"),
    );
    assert.equal(paused.stage, "setup");
    assert.equal(paused.timer.running, false);
    await run(false);
    const completed = JSON.parse(
      readFileSync(join(directory, "study.json"), "utf8"),
    );
    assert.equal(completed.stage, "done");
    assert.equal(completed.preference.style, "no-preference");
    for (const r of Object.values(completed.results)) {
      assert.equal(r.coverage.correct, 6);
      assert.equal(r.diagnosis.correct, true);
      assert.equal(r.repair.passed, true);
      assert.deepEqual(r.confusion, {
        setup: "none",
        second: "none",
        errors: "none",
      });
    }
  },
);

test("line changes count additions and deletions precisely, including formatting", () => {
  assert.deepEqual(changedLines("a\nb\n", "a\nb\n"), {
    added: 0,
    deleted: 0,
    total: 0,
  });
  assert.deepEqual(changedLines("a\nb\n", "a\nc\n"), {
    added: 1,
    deleted: 1,
    total: 2,
  });
  assert.equal(changedLines("a\nb\n", "a\nx\nb\n").total, 1);
  assert.equal(changedLines("a\n", " a\n").total, 2);
  assert.equal(changedLines("a\r\n", "a\n").total, 0);
  assert.deepEqual(changedLines("", "a\n"), { added: 1, deleted: 0, total: 1 });
});

test("CLI validates identity and directories and cleans locks after errors", (t) => {
  const root = workspace(t);
  mkdirSync(root);
  assert.throws(
    () => new PilotStudy(root, { participant: "valid" }),
    /overwrite/,
  );
  assert.throws(() => new PilotStudy(root, { participant: "../invalid" }));
  const cli = new URL("../examples/pilot-study/cli.mjs", import.meta.url);
  const run = (args) =>
    spawnSync(process.execPath, [cli.pathname, ...args], { encoding: "utf8" });
  assert.equal(run(["--help"]).status, 0);
  for (const args of [
    ["--unknown"],
    ["--participant"],
    ["--participant", "../bad"],
    ["--participant", "valid", "--rotation", "6", "--dir", root + "-invalid"],
  ])
    assert.equal(run(args).status, 1);
  const study = new PilotStudy(root + "-resume", { participant: "valid" });
  t.after(() => rmSync(study.root, { recursive: true, force: true }));
  assert.throws(
    () => new PilotStudy(study.root, { participant: "other" }),
    /identity/,
  );
  assert.throws(
    () =>
      new PilotStudy(study.root, { participant: "valid", mode: "synthetic" }),
    /identity/,
  );
});
