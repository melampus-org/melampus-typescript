import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
export const sdkUrl = new URL("../dist/index.js", import.meta.url).href;
export const healthy =
  "import { PRICE } from './intent.ts';\nexport const price = PRICE.instrument({ path: 'pricing:price' })((n: number) => Math.max(0, n));\n";
export const drift = healthy.replace("Math.max(0, n)", "Math.min(0, n)");
export function project(t, overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), "melampus-test-"));
  t?.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (name, body) => writeFileSync(join(root, name), body);
  write("package.json", '{"type":"module"}');
  write(
    "intent.ts",
    `import { Check, Contract } from ${JSON.stringify(sdkUrl)};\nexport const PRICE = new Contract<number>({ intent: 'Nonnegative', checks: [new Check('nonnegative', n => n >= 0, 'Nonnegative')] });\nexport const CONTRACTS = { 'pricing:price': PRICE };\n`,
  );
  write("pricing.ts", healthy);
  write(
    "exercise.ts",
    "import { price } from './pricing.ts';\nawait price(-1); await price(2);\n",
  );
  write(
    "melampus.json",
    JSON.stringify({
      contracts: "intent.ts",
      probe: "exercise.ts",
      watch: ["pricing.ts"],
      protect: ["package.json"],
      timeout: 5,
      ...overrides,
    }),
  );
  return {
    root,
    config: join(root, "melampus.json"),
    write,
    read: (name) => readFileSync(join(root, name), "utf8"),
  };
}
export async function waitFor(predicate, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((done) => setTimeout(done, 30));
  }
  throw new Error("Timed out waiting for test condition");
}
