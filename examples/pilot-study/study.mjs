import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  renameSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { Supervisor, hookDecision } from "../../dist/session.js";
import {
  STYLES,
  ORDERS,
  business,
  entry,
  reviewed,
  installReviewed,
  seedDrift,
  coverageQuestions,
} from "./fixtures.mjs";

const json = (value) => JSON.stringify(value, null, 2) + "\n";
const text = (value) => {
  if (typeof value !== "string" || !value.trim() || value.length > 4000)
    throw new Error("Provide a nonempty response of at most 4000 characters.");
  return value.trim();
};

/** Line additions + deletions using LCS; replacements count as two changed lines. */
export function changedLines(before, after) {
  const lines = (s) =>
    s === "" ? [] : s.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
  const a = lines(before),
    b = lines(after);
  if (a.length > 2000 || b.length > 2000)
    throw new Error("Pilot business file exceeds 2000 lines.");
  let previous = new Uint32Array(b.length + 1);
  for (const line of a) {
    const next = new Uint32Array(b.length + 1);
    for (let j = 1; j <= b.length; j++)
      next[j] =
        line === b[j - 1]
          ? previous[j - 1] + 1
          : Math.max(previous[j], next[j - 1]);
    previous = next;
  }
  const common = previous[b.length];
  return {
    added: b.length - common,
    deleted: a.length - common,
    total: a.length + b.length - 2 * common,
  };
}

export class PilotStudy {
  constructor(
    directory,
    {
      participant,
      rotation = 0,
      mode = "participant",
      clock = () => performance.now(),
    } = {},
  ) {
    this.root = resolve(directory);
    this.clock = clock;
    this.lastTick = null;
    this.file = join(this.root, "study.json");
    if (existsSync(this.file)) {
      this.data = JSON.parse(readFileSync(this.file, "utf8"));
      if (
        this.data.schema !== 1 ||
        this.data.participant !== participant ||
        this.data.mode !== mode ||
        this.data.rotation !== rotation
      )
        throw new Error(
          "Study identity, rotation, or mode differs. Resume with the original options or use a new directory.",
        );
      if (this.data.timer?.running) {
        this.data.timer.running = false;
        this.data.interruptions++;
      }
    } else {
      if (
        !/^[A-Za-z0-9_-]{1,64}$/.test(participant ?? "") ||
        !Number.isInteger(rotation) ||
        rotation < 0 ||
        rotation > 5 ||
        !["participant", "synthetic"].includes(mode)
      )
        throw new Error(
          "Use a participant ID of 1–64 letters/digits/_/-, rotation 0–5, and a valid mode.",
        );
      if (existsSync(this.root))
        throw new Error(
          "Refusing to overwrite an existing directory without study.json.",
        );
      mkdirSync(this.root, { recursive: true });
      this.data = {
        schema: 1,
        participant,
        rotation,
        mode,
        createdAt: new Date().toISOString(),
        order: ORDERS[rotation],
        index: 0,
        stage: "setup",
        timer: null,
        interruptions: 0,
        results: {},
        preference: null,
      };
      for (const style of STYLES) {
        const folder = join(this.root, style);
        mkdirSync(folder);
        writeFileSync(join(folder, "business.ts"), business(style));
        writeFileSync(join(folder, "entry.ts"), entry(style));
        installReviewed(folder, style, false);
        this.data.results[style] = {
          setup: { passed: false, elapsedMs: null, attempts: [] },
          second: { passed: false, elapsedMs: null, attempts: [] },
          integrationBusinessLines: null,
          secondBusinessLines: null,
          coverage: null,
          diagnosis: null,
          repair: { passed: false, elapsedMs: null, attempts: [] },
          confusion: null,
        };
      }
    }
    this.save();
  }
  get style() {
    return this.data.order[this.data.index];
  }
  get folder() {
    return join(this.root, this.style);
  }
  get result() {
    return this.data.results[this.style];
  }
  expect(stage) {
    if (this.data.stage !== stage)
      throw new Error(`Expected ${stage}; study is at ${this.data.stage}.`);
  }
  save() {
    const temp = this.file + ".tmp";
    writeFileSync(temp, json(this.data));
    renameSync(temp, this.file);
  }
  tick() {
    if (this.lastTick !== null && this.data.timer?.running) {
      const now = this.clock();
      this.data.timer.elapsedMs += Math.max(0, now - this.lastTick);
      this.lastTick = now;
    }
    this.save();
  }
  startTimer() {
    if (!["setup", "second", "repair"].includes(this.data.stage))
      throw new Error("This task is not timed.");
    this.data.timer ??= { task: this.data.stage, elapsedMs: 0, running: false };
    if (!this.data.timer.running) {
      this.lastTick = this.clock();
      this.data.timer.running = true;
    }
    this.save();
  }
  pause() {
    this.tick();
    if (this.data.timer) this.data.timer.running = false;
    this.lastTick = null;
    this.writeReports();
  }
  stopTimer() {
    this.tick();
    const elapsed = Math.round(this.data.timer.elapsedMs);
    this.data.timer = null;
    this.lastTick = null;
    return elapsed;
  }
  async check() {
    const stage = this.data.stage;
    if (!["setup", "second", "repair"].includes(stage))
      throw new Error("Check only during a timed task.");
    if (!this.data.timer?.running)
      throw new Error("Start the task timer before checking.");
    const second = stage !== "setup";
    const expected = reviewed(this.style, second);
    let report;
    try {
      const changed = Object.entries(expected)
        .filter(
          ([file, content]) =>
            readFileSync(join(this.folder, file), "utf8") !== content,
        )
        .map(([file]) => file);
      report = changed.length
        ? {
            exit_code: 2,
            message:
              "Reviewed study files changed; restore them before checking.",
            protected_changed: changed,
          }
        : await new Supervisor(join(this.folder, "melampus.json")).check();
    } catch {
      report = { exit_code: 2, message: "Unable to load study files." };
    }
    // Calling all fixture methods lets the harness reject an early second-method
    // integration and keep the coverage quiz's unconfigured-label premise true.
    if (report.exit_code === 0 && report.checks?.passed !== (second ? 6 : 3)) {
      report = {
        ...report,
        sdk_exit_code: 0,
        exit_code: 2,
        task_error: "unexpected_check_count",
        message: second
          ? "This task requires exactly price and discount; leave label unconfigured and avoid duplicate wrappers."
          : "For the first task, register only price. Add discount during the separately timed second task; leave label unconfigured.",
      };
    }
    this.tick();
    this.result[stage].attempts.push({
      exit_code: report.exit_code,
      elapsedMs: Math.round(this.data.timer.elapsedMs),
      findings: report.findings ?? [],
      message: report.message ?? null,
      task_error: report.task_error ?? null,
      sdk_exit_code: report.sdk_exit_code ?? report.exit_code,
    });
    if (report.exit_code === 0) {
      // Compute before changing stage; line-diff errors leave this task available.
      const submitted = readFileSync(join(this.folder, "business.ts"), "utf8");
      const diff = changedLines(
        stage === "second"
          ? this.result.setupBusinessSnapshot
          : business(this.style),
        submitted,
      );
      this.result[stage].passed = true;
      this.result[stage].elapsedMs = this.stopTimer();
      if (stage === "setup") {
        this.result.integrationBusinessLines = diff;
        this.result.setupBusinessSnapshot = submitted;
        installReviewed(this.folder, this.style, true);
        this.data.stage = "second";
      } else if (stage === "second") {
        this.result.secondBusinessLines = diff;
        this.data.stage = "coverage";
      } else this.data.stage = "feedback";
    }
    this.writeReports();
    return report;
  }
  answerCoverage(answers) {
    this.expect("coverage");
    const questions = coverageQuestions(this.style);
    if (
      !Array.isArray(answers) ||
      answers.length !== questions.length ||
      answers.some(
        (a) => !["covered", "uncovered", "incomplete", "drift"].includes(a),
      )
    )
      throw new Error(
        "Answer every coverage question using covered/uncovered/incomplete/drift.",
      );
    const items = questions.map((q, i) => ({
      ...q,
      answer: answers[i],
      correct: answers[i] === q.expected,
    }));
    this.result.coverage = {
      correct: items.filter((i) => i.correct).length,
      total: items.length,
      items,
    };
    this.data.stage = "diagnosis";
    this.writeReports();
  }
  async introduceDrift() {
    this.expect("diagnosis");
    if (this.result.drift) return this.result.drift;
    if (!this.result.driftSeeded) {
      seedDrift(this.folder);
      this.result.driftSeeded = true;
      this.save();
    }
    const supervisor = new Supervisor(join(this.folder, "melampus.json"));
    const report = await supervisor.check();
    if (report.exit_code !== 1)
      throw new Error(
        "Drift did not produce the expected failing price check. Restore the original price expression and rerun the diagnosis task.",
      );
    this.result.drift = {
      report,
      blocked:
        hookDecision({ hook_event_name: "Stop" }, report, supervisor)
          .decision === "block",
    };
    this.save();
    return this.result.drift;
  }
  answerDiagnosis(cause, explanation) {
    this.expect("diagnosis");
    if (!this.result.drift)
      throw new Error("Introduce the failing check first.");
    if (!["result", "network", "missing"].includes(cause))
      throw new Error("Choose result/network/missing.");
    this.result.diagnosis = {
      cause,
      correct: cause === "result",
      explanation: text(explanation),
    };
    this.data.stage = "repair";
    this.writeReports();
  }
  feedback(notes) {
    this.expect("feedback");
    const normalized = Object.fromEntries(
      ["setup", "second", "errors"].map((key) => [key, text(notes?.[key])]),
    );
    this.result.confusion = normalized;
    this.data.index++;
    this.data.stage =
      this.data.index === STYLES.length ? "preference" : "setup";
    this.writeReports();
  }
  finish(style, reason) {
    this.expect("preference");
    if (![...STYLES, "no-preference"].includes(style))
      throw new Error("Choose wrapper/class/module/no-preference.");
    this.data.preference = { style, reason: text(reason) };
    this.data.stage = "done";
    this.data.completedAt = new Date().toISOString();
    this.writeReports();
  }
  writeReports() {
    this.save();
    const synthetic = this.data.mode === "synthetic";
    const title = synthetic
      ? "SYNTHETIC WALKTHROUGH — not participant feedback"
      : "Participant pilot feedback";
    const rows = this.data.order.map((style) => {
      const r = this.data.results[style];
      return {
        style,
        setupMinutes:
          r.setup.elapsedMs === null
            ? ""
            : (r.setup.elapsedMs / 60000).toFixed(3),
        businessLinesChanged: r.integrationBusinessLines?.total ?? "",
        secondMethodMinutes:
          r.second.elapsedMs === null
            ? ""
            : (r.second.elapsedMs / 60000).toFixed(3),
        coverageCorrect: r.coverage
          ? `${r.coverage.correct}/${r.coverage.total}`
          : "",
        diagnosisCorrect: r.diagnosis?.correct ?? "",
        repairPassed: r.repair.elapsedMs === null ? "" : r.repair.passed,
        repairMinutes:
          r.repair.elapsedMs === null
            ? ""
            : (r.repair.elapsedMs / 60000).toFixed(3),
        setupConfusion: r.confusion?.setup ?? "",
        secondMethodConfusion: r.confusion?.second ?? "",
        errorConfusion: r.confusion?.errors ?? "",
        preferred: this.data.preference
          ? this.data.preference.style === style
          : "",
        preferenceReason: this.data.preference?.reason ?? "",
        preferenceStyle: this.data.preference?.style ?? "",
      };
    });
    const escape = (v) =>
      String(v).replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
    const metric = (label, field) =>
      `| ${label} | ${rows.map((row) => escape(row[field])).join(" | ")} |`;
    writeFileSync(
      join(this.root, "feedback.md"),
      `# ${title}\n\nParticipant: ${this.data.participant}; rotation: ${this.data.rotation}; state: ${this.data.stage}.\n\n| Measure | ${this.data.order.join(" | ")} |\n| --- | --- | --- | --- |\n${[
        metric("Minutes to first passing gate", "setupMinutes"),
        metric("Business-code lines added + deleted", "businessLinesChanged"),
        metric("Minutes to second checked method", "secondMethodMinutes"),
        metric("Coverage quiz correct", "coverageCorrect"),
        metric("Understood failing check (diagnosis)", "diagnosisCorrect"),
        metric("Repaired failing check (fresh gate)", "repairPassed"),
        metric("Minutes to repair", "repairMinutes"),
        metric("Setup confusion", "setupConfusion"),
        metric("Second-method confusion", "secondMethodConfusion"),
        metric("Error-message confusion", "errorConfusion"),
        metric("Preferred style", "preferred"),
        metric("Selected preference (or no preference)", "preferenceStyle"),
        metric("Preference reason", "preferenceReason"),
      ].join(
        "\n",
      )}\n\nTimers include reading, editing, and gate evaluation after task start. Explicit pauses exclude downtime. Interrupted timers resume from the last checkpoint (up to one second lost); interruptions: ${this.data.interruptions}. Line counts compare business.ts at the first passing gate against its uninstrumented baseline. A replaced line counts as one deletion plus one addition; formatting edits count. Registration-only edits in entry.ts are excluded. Full attempts, quiz answers, explanations, second-method diffs, and timing data are in study.json. Empty cells are pending. Preference is a participant response, never inferred from speed.\n`,
    );
    const keys = Object.keys(rows[0]);
    const csv = (value) => '"' + String(value).replace(/"/g, '""') + '"';
    writeFileSync(
      join(this.root, "feedback.csv"),
      [
        ["participant", "mode", "rotation", "status", ...keys]
          .map(csv)
          .join(","),
        ...rows.map((row) =>
          [
            this.data.participant,
            this.data.mode,
            this.data.rotation,
            this.data.stage,
            ...keys.map((key) => row[key]),
          ]
            .map(csv)
            .join(","),
        ),
      ].join("\n") + "\n",
    );
  }
}
