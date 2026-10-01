import assert from "node:assert/strict";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Supervisor, hookDecision } from "../dist/session.js";

const root = mkdtempSync(join(tmpdir(), "melampus-registration-"));
try {
  cpSync(new URL("../examples/sdk-registration/", import.meta.url), root, {
    recursive: true,
  });
  writeFileSync(join(root, "package.json"), '{"type":"module"}');
  // Resolve the built checkout from a disposable project without installing it.
  for (const file of ["intent.ts", "registration.ts"])
    writeFileSync(
      join(root, file),
      readFileSync(join(root, file), "utf8").replace(
        '"melampus-typescript"',
        JSON.stringify(new URL("../dist/index.js", import.meta.url).href),
      ),
    );
  const supervisor = new Supervisor(join(root, "melampus.json"));
  assert.equal((await supervisor.check()).exit_code, 0);
  console.log("All three styles: HEALTHY (label methods are unconfigured)");
  for (const file of ["wrapper.ts", "service.ts", "functions.ts"]) {
    const path = join(root, file);
    const original = readFileSync(path, "utf8");
    writeFileSync(path, original.replace("Math.max", "Math.min"));
    const broken = await supervisor.check();
    assert.equal(broken.exit_code, 1);
    assert.equal(
      hookDecision({ hook_event_name: "Stop" }, broken, supervisor).decision,
      "block",
    );
    writeFileSync(path, original);
    assert.equal((await supervisor.check()).exit_code, 0);
    console.log(`${file}: DRIFT → BLOCKED → REPAIRED`);
  }
  const exercise = join(root, "exercise.ts");
  writeFileSync(
    exercise,
    readFileSync(exercise, "utf8").replace("pricing.price(cents);", ""),
  );
  // New session reviews this deliberately incomplete scenario.
  const incomplete = await new Supervisor(join(root, "melampus.json")).check();
  assert.equal(incomplete.exit_code, 2);
  assert.deepEqual(incomplete.missing, ["pilot:price/nonnegative"]);
  console.log("Unexecuted module contract: INCOMPLETE");
} finally {
  rmSync(root, { recursive: true, force: true });
}
