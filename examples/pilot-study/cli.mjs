import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { PilotStudy } from "./study.mjs";
import { coverageQuestions, solution, pathFor } from "./fixtures.mjs";

export async function runSynthetic(study) {
  if (
    study.data.mode !== "synthetic" ||
    study.data.stage !== "setup" ||
    study.data.index !== 0
  )
    throw new Error("Synthetic walkthrough requires a new synthetic study.");
  while (study.data.stage !== "preference") {
    const style = study.style;
    study.startTimer();
    assert.equal((await study.check()).exit_code, 2); // no instrumentation yet
    solution(study.folder, style, false);
    assert.equal((await study.check()).exit_code, 0);
    study.startTimer();
    assert.equal((await study.check()).exit_code, 2); // second method not registered yet
    solution(study.folder, style, true);
    assert.equal((await study.check()).exit_code, 0);
    study.answerCoverage(coverageQuestions(style).map((q) => q.expected));
    const drift = await study.introduceDrift();
    assert.equal(drift.report.exit_code, 1);
    assert.equal(drift.blocked, true);
    study.answerDiagnosis(
      "result",
      "Scripted answer: Math.min returns a negative price for negative input.",
    );
    study.startTimer();
    assert.equal((await study.check()).exit_code, 1);
    const file = join(study.folder, "business.ts");
    writeFileSync(
      file,
      readFileSync(file, "utf8").replace(
        "Math.min(0, cents)",
        "Math.max(0, cents)",
      ),
    );
    assert.equal((await study.check()).exit_code, 0);
    study.feedback({
      setup: "Scripted walkthrough; no participant feedback.",
      second: "Scripted walkthrough; no participant feedback.",
      errors: "Scripted walkthrough; no participant feedback.",
    });
    console.log(
      `${style}: setup, second method, 6-question quiz, diagnosis, blocked drift, repair, and notes recorded`,
    );
  }
  study.finish(
    "module",
    "Scripted preference to test report collection; not a human preference.",
  );
}

async function runParticipant(study) {
  const readline = createInterface({ input: stdin, output: stdout });
  const abort = new AbortController();
  const stop = () => abort.abort();
  readline.once("SIGINT", stop);
  readline.once("close", stop);
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  const ask = async (prompt, choices) => {
    for (;;) {
      const answer = (
        await readline.question(prompt + "\n> ", { signal: abort.signal })
      ).trim();
      if (answer.toLowerCase() === "pause") return null;
      if (
        answer &&
        answer.length <= 4000 &&
        (!choices || choices.includes(answer))
      )
        return answer;
      console.log(
        choices
          ? `Choose ${choices.join(" / ")}, or pause.`
          : "Enter a response (up to 4000 characters), or pause.",
      );
    }
  };
  const timer = setInterval(() => study.tick(), 1000);
  try {
    console.log(
      `Participant ${study.data.participant}; order: ${study.data.order.join(" → ")}.`,
    );
    console.log(
      "Use your usual editor. Type pause at any prompt to save and exclude downtime. Preserve the business formulas and reviewed files. No source or feedback is uploaded.",
    );
    while (study.data.stage !== "done") {
      const stage = study.data.stage;
      if (["setup", "second", "repair"].includes(stage)) {
        console.log(`\n${study.style}: ${stage}. Edit ${study.folder}`);
        if (stage === "setup")
          console.log(
            `Register price using PRICE from intent.ts. Its evidence path must be ${pathFor(study.style, "price")}. Edit business.ts for wrappers, entry.ts for class/module registration (import instrument from ./sdk.ts). Leave discount unregistered until the next task. Gate 0 completes this task.`,
          );
        if (stage === "second")
          console.log(
            `Add DISCOUNT to the integration. Both ${pathFor(study.style, "price")} and ${pathFor(study.style, "discount")} are now required. Preserve formulas and get gate 0.`,
          );
        if (stage === "repair")
          console.log(
            "Repair the failing price implementation, keeping both contracts and integrations intact. Obtain a fresh gate 0.",
          );
        study.startTimer();
        const action = await ask(
          "After editing, enter check to evaluate, or pause.",
          ["check"],
        );
        if (action === null) return;
        const report = await study.check();
        console.log(`Gate ${report.exit_code}: ${JSON.stringify(report)}`);
      } else if (stage === "coverage") {
        const answers = [];
        console.log(
          "\nCoverage quiz. Assume a recording tracer. covered/uncovered describe calls; incomplete/drift describe gate outcomes.",
        );
        for (const question of coverageQuestions(study.style)) {
          const answer = await ask(question.prompt, [
            "covered",
            "uncovered",
            "incomplete",
            "drift",
          ]);
          if (answer === null) return;
          answers.push(answer);
        }
        study.answerCoverage(answers);
        console.log("Coverage answers saved. Review scores after the study.");
      } else if (stage === "diagnosis") {
        const drift = await study.introduceDrift();
        console.log(
          `\nDeliberate drift. Completion blocked: ${drift.blocked}.\n${JSON.stringify(drift.report, null, 2)}`,
        );
        const cause = await ask(
          "What caused this failure? result = result violates reviewed predicate; network = telemetry transport problem; missing = method never executed.",
          ["result", "network", "missing"],
        );
        if (cause === null) return;
        const explanation = await ask(
          "Explain the failing behavior in your own words before repairing it.",
        );
        if (explanation === null) return;
        study.answerDiagnosis(cause, explanation);
      } else if (stage === "feedback") {
        const notes = {};
        for (const [key, prompt] of [
          [
            "setup",
            "What confused you during initial setup? Enter none if nothing.",
          ],
          [
            "second",
            "What confused you while adding the second method? Enter none if nothing.",
          ],
          [
            "errors",
            "Were gate failures and error messages understandable? Describe confusion, or enter none.",
          ],
        ]) {
          const answer = await ask(prompt);
          if (answer === null) return;
          notes[key] = answer;
        }
        study.feedback(notes);
      } else if (stage === "preference") {
        const style = await ask(
          "Which integration style would you prefer in your own project?",
          ["wrapper", "class", "module", "no-preference"],
        );
        if (style === null) return;
        const reason = await ask(
          "Why? Explain comfort, readability, or setup tradeoffs in your own words.",
        );
        if (reason === null) return;
        study.finish(style, reason);
      } else throw new Error("Unknown study stage.");
    }
  } catch (error) {
    if (error.name !== "AbortError") throw error;
  } finally {
    clearInterval(timer);
    study.pause();
    readline.close();
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}

export async function main(args = process.argv.slice(2)) {
  const help =
    "node examples/pilot-study/cli.mjs --participant ID [--rotation 0..5] [--dir PATH]\nRepeat the same command to resume. --demo runs synthetic data only.\nEnvironment installation/build is outside task timers. See examples/pilot-study/README.md.";
  if (args.includes("--help")) {
    console.log(help);
    return;
  }
  const options = { rotation: 0, mode: "participant" };
  let directory;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--demo") options.mode = "synthetic";
    else if (["--participant", "--rotation", "--dir"].includes(arg)) {
      const value = args[++i];
      if (!value || value.startsWith("--"))
        throw new Error(`Missing value for ${arg}`);
      if (arg === "--participant") options.participant = value;
      if (arg === "--rotation") options.rotation = Number(value);
      if (arg === "--dir") directory = value;
    } else throw new Error(`Unknown option ${arg}.\n${help}`);
  }
  options.participant ??=
    options.mode === "synthetic" ? `demo-${Date.now()}` : undefined;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(options.participant ?? ""))
    throw new Error("Provide --participant with a short pseudonymous ID.");
  directory = resolve(directory ?? join("pilot-results", options.participant));
  mkdirSync(dirname(directory), { recursive: true });
  const lock = directory + ".lock";
  try {
    writeFileSync(lock, String(process.pid), { flag: "wx" });
  } catch {
    throw new Error(
      `Study already has a runner lock: ${lock}. If an earlier runner crashed, verify it stopped and remove its stale lock before resuming.`,
    );
  }
  try {
    const study = new PilotStudy(directory, options);
    if (options.mode === "synthetic") {
      console.log(
        "SYNTHETIC WALKTHROUGH: timings and answers are automated, not usability evidence.",
      );
      await runSynthetic(study);
    } else await runParticipant(study);
    study.writeReports();
    console.log(
      `Study ${study.data.stage}. Reports: ${join(directory, "feedback.md")}, feedback.csv, study.json`,
    );
  } finally {
    rmSync(lock, { force: true });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
