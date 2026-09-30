import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { trace } from "@opentelemetry/api";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  AlwaysOffSampler,
} from "@opentelemetry/sdk-trace-base";
import { Check, Contract, instrumented, Policy } from "../dist/index.js";
import { sampled, hash } from "../dist/sdk.js";

const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});
provider.register();
after(() => provider.shutdown());
const latest = () => exporter.getFinishedSpans().at(-1);
const check = () => new Check("positive", (n) => n > 0, "Result is positive");
const options = () => ({
  path: "test:price",
  intent: "Return a positive price",
  checks: [check()],
});
test("sync return, receiver, metadata and Unicode hashes are preserved without content capture", () => {
  const secret = "秘密 é";
  const fn = instrumented({
    ...options(),
    intent: secret,
    assumptions: ["é", "a\nb"],
  })(function (n) {
    return this.base + n;
  });
  assert.equal(fn.call({ base: 4 }, 2), 6);
  const span = latest();
  assert.equal(span.attributes["code_artifact.intent.hash"], hash(secret));
  assert.equal(
    span.attributes["code_artifact.assumptions.hash"],
    hash('["é","a\\nb"]'),
  );
  assert.deepEqual(span.attributes["code_artifact.check.results"], ["passed"]);
  assert.equal(JSON.stringify(span.attributes).includes(secret), false);
  assert.equal(span.events.length, 0);
});
test("failed, throwing and non-boolean predicates preserve application result", () => {
  const checks = [
    new Check("false", () => false, "false"),
    new Check(
      "throws",
      () => {
        throw new Error("secret");
      },
      "throws",
    ),
    new Check("number", () => 1, "number"),
    new Check("promise", () => Promise.reject(new Error("secret")), "promise"),
  ];
  assert.equal(instrumented({ ...options(), checks })(() => 42)(), 42);
  assert.deepEqual(latest().attributes["code_artifact.check.results"], [
    "failed",
    "error",
    "error",
    "error",
  ]);
  assert.equal(JSON.stringify(latest().attributes).includes("secret"), false);
});
test("async and thenable results checked only after settlement with active context", async () => {
  let active;
  const fn = instrumented(options())(async () => {
    await Promise.resolve();
    active = trace.getActiveSpan()?.spanContext().spanId;
    return 3;
  });
  assert.equal(await fn(), 3);
  assert.equal(active, latest().spanContext().spanId);
  assert.equal(
    await instrumented(options())(() => ({
      then(resolve) {
        resolve(2);
      },
    }))(),
    2,
  );
});
test("application throw/rejection identity and privacy, checks not executed", async () => {
  const error = new Error("private details");
  assert.throws(
    instrumented(options())(() => {
      throw error;
    }),
    (e) => e === error,
  );
  assert.deepEqual(latest().status, { code: 2 });
  assert.equal(latest().events.length, 0);
  assert.deepEqual(latest().attributes["code_artifact.check.results"], [
    "not_executed",
  ]);
  await assert.rejects(
    instrumented(options())(async () => {
      throw error;
    })(),
    (e) => e === error,
  );
  assert.equal(latest().events.length, 0);
  assert.throws(
    instrumented(options())(() => ({
      get then() {
        throw error;
      },
    })),
    (e) => e === error,
  );
});
test("non-recording spans skip predicates", async () => {
  const off = new NodeTracerProvider({ sampler: new AlwaysOffSampler() });
  let calls = 0;
  instrumented({
    ...options(),
    tracer: off.getTracer("test"),
    checks: [
      new Check(
        "x",
        () => {
          calls++;
          return true;
        },
        "x",
      ),
    ],
  })(() => 1)();
  assert.equal(calls, 0);
  await off.shutdown();
});
test("shared budget, sampling and disabled paths have explicit outcomes", () => {
  const policy = new Policy({ checksPerSecond: 1 });
  const fn = instrumented({
    ...options(),
    policy,
    checks: [new Check("skip", () => true, "skip", 0), check()],
  })(() => 2);
  fn();
  assert.deepEqual(latest().attributes["code_artifact.check.results"], [
    "sampled_out",
    "passed",
  ]);
  fn();
  assert.deepEqual(latest().attributes["code_artifact.check.results"], [
    "sampled_out",
    "budget",
  ]);
  policy.configure({ disabledPaths: ["test:price"] });
  fn();
  assert.deepEqual(latest().attributes["code_artifact.check.results"], [
    "disabled",
    "disabled",
  ]);
  policy.configure();
  fn();
  assert.deepEqual(latest().attributes["code_artifact.check.results"], [
    "sampled_out",
    "passed",
  ]);
});
test("deterministic sampling matches Python SHA-256 uint64 threshold", () => {
  const c = new Check("test", () => true, "test", 0.25);
  for (let i = 1; i <= 100; i++) {
    const traceId = i.toString(16).padStart(32, "0"),
      spanId = "1234567812345678";
    const expected =
      createHash("sha256")
        .update(`${traceId}:${spanId}:test`)
        .digest()
        .readBigUInt64BE() <
      2n ** 62n;
    assert.equal(
      sampled(c, { spanContext: () => ({ traceId, spanId }) }),
      expected,
    );
  }
});
test("declaration validation rejects invalid input early", () => {
  for (const id of ["", "x\n", "x".repeat(65), "space here"])
    assert.throws(() => new Check(id, () => true, "ok"));
  for (const sample of [-1, 2, NaN, Infinity])
    assert.throws(() => new Check("x", () => true, "ok", sample));
  assert.throws(() => new Check("x", async () => true, "ok"));
  assert.throws(() => new Check("x", () => true, ""));
  for (const patch of [
    { intent: "" },
    { path: "\n" },
    { path: "x".repeat(257) },
    { generator: "bad name" },
    { assumptions: "bad" },
    { assumptions: [1] },
    { checks: [check(), check()] },
    {
      checks: Array.from(
        { length: 17 },
        (_, i) => new Check(String(i), () => true, "x"),
      ),
    },
    { captureContent: true },
  ])
    assert.throws(() => instrumented({ ...options(), ...patch }));
  assert.throws(() =>
    instrumented(options())(function* () {
      yield 1;
    }),
  );
  assert.throws(() =>
    instrumented(options())(async function* () {
      yield 1;
    }),
  );
  for (const checksPerSecond of [-1, 0.5, NaN, Infinity])
    assert.throws(() => new Policy({ checksPerSecond }));
  assert.throws(() => new Policy({ disabledPaths: "x" }));
});
test("contracts and check declarations cannot mutate after review", () => {
  const checks = [check()];
  const c = new Contract({ intent: "positive", checks });
  checks.length = 0;
  assert.equal(c.checks.length, 1);
  assert.throws(() => {
    c.checks[0].predicate = () => false;
  });
  assert.equal(c.instrument({ path: "test:contract" })(() => 1)(), 1);
  assert.deepEqual(latest().attributes["code_artifact.check.results"], [
    "passed",
  ]);
});
