import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { request } from "node:http";
import { gzipSync } from "node:zlib";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { Check, instrumented } from "../dist/index.js";
import {
  Session,
  TraceRequest,
  decode,
  makeServer,
  MAX_BODY,
} from "../dist/watcher.js";

export const fixture = (name = "healthy") =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url)));
function anyValue(v) {
  if (Array.isArray(v)) return { arrayValue: { values: v.map(anyValue) } };
  return typeof v === "string"
    ? { stringValue: v }
    : typeof v === "boolean"
      ? { boolValue: v }
      : { doubleValue: v };
}
export function payload(f = fixture()) {
  return TraceRequest.encode(
    TraceRequest.create({
      resourceSpans: [
        {
          scopeSpans: [
            {
              spans: [
                {
                  traceId: Buffer.from(f.trace_id, "hex"),
                  spanId: Buffer.from(f.span_id, "hex"),
                  attributes: Object.entries(f.attributes).map(([key, v]) => ({
                    key,
                    value: anyValue(v),
                  })),
                },
              ],
            },
          ],
        },
      ],
    }),
  ).finish();
}
for (const [name, code] of [
  ["healthy", 0],
  ["drift", 1],
  ["suppressed", 2],
])
  test(`Python wire fixture ${name}, duplicate delivery and findings`, () => {
    const findings = [];
    const session = new Session((f) => findings.push(f));
    const evidence = decode(payload(fixture(name)));
    session.accept(evidence);
    session.accept(evidence);
    assert.equal(session.exitCode, code);
    assert.equal(findings.length, fixture(name).expected_findings);
    assert.equal(session.seen.size, 1);
    if (findings.length)
      assert.deepEqual(
        [findings[0].observed, findings[0].expected],
        [false, true],
      );
    assert.deepEqual(
      decode(
        readFileSync(new URL(`./fixtures/${name}.protobuf`, import.meta.url)),
      ),
      evidence,
    );
  });
test("malformed declarations and transport payloads are rejected", () => {
  const mutations = [
    ["schema.version", "9"],
    ["function", "\n"],
    ["generator", "bad name"],
    ["intent.hash", "x"],
    ["assumptions.hash", "x"],
    ["check.ids", ["a", "a"]],
    ["check.contract_hashes", ["x"]],
    ["check.sample_rates", [NaN]],
    ["check.sample_rates", [-1]],
    ["check.results", ["unknown"]],
    ["check.results", "passed"],
  ];
  for (const [key, value] of mutations) {
    const f = fixture();
    f.attributes["code_artifact." + key] = value;
    assert.throws(() => decode(payload(f)), key);
  }
  for (const key of ["trace_id", "span_id"]) {
    const f = fixture();
    f[key] = "00".repeat(key === "trace_id" ? 16 : 8);
    assert.throws(() => decode(payload(f)));
  }
  assert.throws(() => decode(Buffer.from([255])));
  const f = fixture();
  f.attributes = { "other.name": "ignored" };
  assert.deepEqual(decode(payload(f)), []);
  const decoded = TraceRequest.decode(payload());
  const span = decoded.resourceSpans[0].scopeSpans[0].spans[0];
  span.attributes.push(span.attributes[0]);
  assert.throws(() => decode(TraceRequest.encode(decoded).finish()));
});
test("capacity is atomic and incomplete evidence outranks drift", () => {
  const session = new Session(() => {}, 1);
  const a = decode(payload(fixture("drift")));
  const b = structuredClone(a);
  b[0].span_id = "03".repeat(8);
  assert.throws(() => session.accept([...a, ...b]));
  assert.equal(session.seen.size, 0);
  session.accept(a);
  assert.equal(session.exitCode, 1);
  session.invalid++;
  assert.equal(session.exitCode, 2);
  for (const result of ["error", "not_executed"]) {
    const s = new Session();
    const e = structuredClone(a);
    e[0].checks[0][2] = result;
    s.accept(e);
    assert.equal(s.exitCode, 2);
  }
  assert.throws(() => new Session(() => {}, 0));
});
async function listening(t) {
  const session = new Session();
  const server = makeServer(session);
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return { session, url: `http://127.0.0.1:${server.address().port}` };
}
test("HTTP receiver accepts binary/gzip and rejects unsupported, oversized and corrupt requests", async (t) => {
  const { session, url } = await listening(t);
  assert.equal((await fetch(url + "/healthz")).status, 200);
  assert.equal((await fetch(url + "/missing")).status, 404);
  const post = (body, headers = {}, path = "/v1/traces") =>
    fetch(url + path, {
      method: "POST",
      headers: { "Content-Type": "application/x-protobuf", ...headers },
      body,
    });
  assert.equal((await post(payload())).status, 200);
  assert.equal(
    (await post(gzipSync(payload()), { "Content-Encoding": "gzip" })).status,
    200,
  );
  assert.equal(session.seen.size, 1);
  assert.equal((await post(payload(), {}, "/missing")).status, 404);
  assert.equal(
    (await post("{}", { "Content-Type": "application/json" })).status,
    415,
  );
  assert.equal(
    (await post(payload(), { "Content-Encoding": "br" })).status,
    415,
  );
  assert.equal((await post(Buffer.from([255]))).status, 400);
  assert.equal((await post(Buffer.alloc(MAX_BODY + 1))).status, 413);
  assert.equal(
    (
      await post(gzipSync(Buffer.alloc(MAX_BODY + 1)), {
        "Content-Encoding": "gzip",
      })
    ).status,
    400,
  );
  const chunked = await new Promise((done) => {
    const req = request(
      url + "/v1/traces",
      { method: "POST", headers: { "Content-Type": "application/x-protobuf" } },
      (res) => {
        res.resume();
        done(res.statusCode);
      },
    );
    req.write(payload());
    req.end();
  });
  assert.equal(chunked, 200);
  assert.equal(session.exitCode, 2);
});
test("real OTel JavaScript exporter sends compatible protobuf", async (t) => {
  const { session, url } = await listening(t);
  const provider = new NodeTracerProvider({
    spanProcessors: [
      new SimpleSpanProcessor(
        new OTLPTraceExporter({ url: url + "/v1/traces" }),
      ),
    ],
  });
  const fn = instrumented({
    path: "integration:price",
    intent: "positive",
    checks: [new Check("positive", (n) => n >= 0, "nonnegative")],
    tracer: provider.getTracer("test"),
  })((n) => n);
  fn(1);
  fn(-1);
  await provider.shutdown();
  assert.equal(session.counts.passed, 1);
  assert.equal(session.counts.failed, 1);
  assert.equal(session.exitCode, 1);
});
