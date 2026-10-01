import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  cpSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const temp = mkdtempSync(join(tmpdir(), "melampus-package-"));
const run = (command, args, cwd = process.cwd()) =>
  execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
try {
  const [pack] = JSON.parse(
    run("npm", [
      "pack",
      "--ignore-scripts",
      "--json",
      "--pack-destination",
      temp,
    ]),
  );
  const paths = pack.files.map((f) => f.path);
  for (const required of [
    "dist/index.js",
    "dist/index.d.ts",
    "dist/cli.js",
    "dist/probe.js",
    "dist/session.js",
    "dist/watcher.js",
    "README.md",
    "LICENSE",
    "VERSION",
    "examples/agent-session/intent.ts",
    "examples/sdk-registration/registration.ts",
    "dist/registration.js",
    "dist/registration.d.ts",
  ])
    if (!paths.includes(required))
      throw new Error(`Package missing ${required}`);
  if (
    paths.some(
      (p) =>
        p.startsWith("node_modules/") ||
        p.includes(".melampus/") ||
        p.endsWith(".test.mjs"),
    )
  )
    throw new Error("Unexpected package content");
  writeFileSync(join(temp, "package.json"), '{"private":true,"type":"module"}');
  run(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      join(temp, pack.filename),
    ],
    temp,
  );
  run(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "import {Check, Contract} from 'melampus-typescript'; const c = new Contract({intent:'positive', checks:[new Check('positive', x => x > 0, 'positive')]}); if(c.instrument({path:'smoke:fn'})(() => 1)() !== 1) process.exit(1);",
    ],
    temp,
  );
  const installed = join(temp, "node_modules/melampus-typescript");
  const version = run(
    process.execPath,
    [join(installed, "dist/cli.js"), "--version"],
    temp,
  ).trim();
  if (version !== readFileSync("VERSION", "utf8").trim())
    throw new Error("Installed CLI version mismatch");
  // Copy the shipped example outside node_modules: Node intentionally refuses to strip types inside dependencies.
  cpSync(join(installed, "examples/agent-session"), join(temp, "example"), {
    recursive: true,
  });
  const script = `import { Supervisor } from 'melampus-typescript/session'; const r = await new Supervisor(${JSON.stringify(join(temp, "example/melampus.json"))}).check(); if(r.exit_code !== 0) throw new Error(JSON.stringify(r));`;
  run(process.execPath, ["--input-type=module", "-e", script], temp);
  cpSync(
    join(installed, "examples/sdk-registration"),
    join(temp, "registration-example"),
    { recursive: true },
  );
  const pilot = `import { Supervisor } from 'melampus-typescript/session'; const r = await new Supervisor(${JSON.stringify(join(temp, "registration-example/melampus.json"))}).check(); if(r.exit_code !== 0) throw new Error(JSON.stringify(r));`;
  run(process.execPath, ["--input-type=module", "-e", pilot], temp);
  console.log(
    `Verified ${pack.filename}: exports, declarations, CLI and both installed session examples`,
  );
  if (process.argv.includes("--keep"))
    run("npm", [
      "pack",
      "--ignore-scripts",
      "--pack-destination",
      resolve("dist"),
    ]);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
