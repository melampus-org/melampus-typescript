import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { Supervisor, hookDecision } from "../dist/session.js";
import { project, healthy, drift } from "../tests/helpers.mjs";
const p = project();
try {
  const supervisor = new Supervisor(p.config);
  let report = await supervisor.check();
  assert.equal(report.exit_code, 0);
  console.log("HEALTHY", JSON.stringify(report));
  p.write("pricing.ts", drift);
  report = await supervisor.check();
  assert.equal(report.exit_code, 1);
  assert.equal(
    hookDecision({ hook_event_name: "Stop" }, report, supervisor).decision,
    "block",
  );
  console.log("DRIFT → BLOCK", JSON.stringify(report));
  p.write("pricing.ts", healthy);
  report = await supervisor.check();
  assert.equal(report.exit_code, 0);
  console.log("REPAIRED → HEALTHY", JSON.stringify(report));
} finally {
  rmSync(p.root, { recursive: true, force: true });
}
