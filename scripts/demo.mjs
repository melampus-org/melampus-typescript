import assert from "node:assert/strict";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Supervisor, hookDecision } from "../dist/session.js";

const root = mkdtempSync(join(tmpdir(), "melampus-demo-"));
try {
  cpSync(new URL("../examples/agent-session/", import.meta.url), root, {
    recursive: true,
  });
  writeFileSync(join(root, "package.json"), '{"private":true,"type":"module"}');
  const sdk = new URL("../dist/index.js", import.meta.url).href;
  for (const file of ["intent.ts", "registration.ts"]) {
    const path = join(root, file);
    writeFileSync(
      path,
      readFileSync(path, "utf8").replace(
        '"melampus-typescript"',
        JSON.stringify(sdk),
      ),
    );
  }
  const implementation = join(root, "pricing.ts");
  const healthy = readFileSync(implementation, "utf8");
  const supervisor = new Supervisor(join(root, "melampus.json"));
  let report = await supervisor.check();
  assert.equal(report.exit_code, 0);
  console.log("HEALTHY", JSON.stringify(report));
  writeFileSync(implementation, healthy.replace("Math.max", "Math.min"));
  report = await supervisor.check();
  assert.equal(report.exit_code, 1);
  assert.equal(
    hookDecision({ hook_event_name: "Stop" }, report, supervisor).decision,
    "block",
  );
  console.log("DRIFT → BLOCK", JSON.stringify(report));
  writeFileSync(implementation, healthy);
  report = await supervisor.check();
  assert.equal(report.exit_code, 0);
  console.log("REPAIRED → HEALTHY", JSON.stringify(report));
} finally {
  rmSync(root, { recursive: true, force: true });
}
