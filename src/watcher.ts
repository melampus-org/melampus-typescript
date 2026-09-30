import { createServer, type IncomingMessage } from "node:http";
import { gunzipSync } from "node:zlib";
import protobuf from "protobufjs";
import { IDENTIFIER, MAX_CHECKS, SCHEMA_VERSION, validPath } from "./sdk.js";
import * as sc from "./semconv.js";

export const MAX_BODY = 1024 * 1024;
const HASH = /^[0-9a-f]{64}$/;
const RESULTS = new Set([
  "passed",
  "failed",
  "error",
  "sampled_out",
  "budget",
  "disabled",
  "not_executed",
]);
// Wire-compatible projection of opentelemetry-proto trace_service.proto. Unknown
// resource, scope, event and timing fields are deliberately ignored by protobuf.
const root = protobuf.parse(`syntax = "proto3";
message AnyValue { oneof value { string string_value = 1; bool bool_value = 2; int64 int_value = 3; double double_value = 4; ArrayValue array_value = 5; bytes kvlist_value = 6; bytes bytes_value = 7; } }
message ArrayValue { repeated AnyValue values = 1; }
message KeyValue { string key = 1; AnyValue value = 2; }
message Span { bytes trace_id = 1; bytes span_id = 2; repeated KeyValue attributes = 9; }
message ScopeSpans { repeated Span spans = 2; }
message ResourceSpans { repeated ScopeSpans scope_spans = 2; }
message ExportTraceServiceRequest { repeated ResourceSpans resource_spans = 1; }
`).root;
export const TraceRequest = root.lookupType("ExportTraceServiceRequest");
export interface Evidence {
  trace_id: string;
  span_id: string;
  function: string;
  checks: [string, string, string][];
}
export interface Finding {
  function: string;
  check_id: string;
  contract_hash: string;
  trace_id: string;
  span_id: string;
  observed: false;
  expected: true;
}
function validHash(value: unknown): value is string {
  return typeof value === "string" && value.length === 64 && HASH.test(value);
}
function validId(value: unknown): value is string {
  return (
    typeof value === "string" && IDENTIFIER.test(value) && !value.includes("\n")
  );
}

export function evidenceFromAttributes(
  attrs: Record<string, unknown>,
  traceId: string,
  spanId: string,
): Evidence | undefined {
  if (!Object.keys(attrs).some((k) => k.startsWith("code_artifact.")))
    return undefined;
  if (
    attrs[sc.SCHEMA_VERSION] !== SCHEMA_VERSION ||
    !validPath(attrs[sc.FUNCTION]) ||
    !validId(attrs[sc.GENERATOR])
  )
    throw new Error("Invalid declaration");
  if (
    !validHash(attrs[sc.INTENT_HASH]) ||
    !validHash(attrs[sc.ASSUMPTIONS_HASH])
  )
    throw new Error("Invalid declaration hash");
  const arrays = [
    sc.CHECK_IDS,
    sc.CHECK_CONTRACT_HASHES,
    sc.CHECK_SAMPLE_RATES,
    sc.CHECK_RESULTS,
  ].map((k) => attrs[k]);
  if (!arrays.every(Array.isArray)) throw new Error("Missing check arrays");
  const [ids, hashes, rates, results] = arrays as unknown[][];
  if (
    !ids ||
    !hashes ||
    !rates ||
    !results ||
    ids.length > MAX_CHECKS ||
    arrays.some((a) => (a as unknown[]).length !== ids.length)
  )
    throw new Error("Misaligned check arrays");
  if (
    !ids.every(validId) ||
    new Set(ids).size !== ids.length ||
    !hashes.every(validHash) ||
    !rates.every(
      (r) => typeof r === "number" && Number.isFinite(r) && r >= 0 && r <= 1,
    ) ||
    !results.every((r) => typeof r === "string" && RESULTS.has(r))
  )
    throw new Error("Invalid check evidence");
  if (
    !/^[0-9a-f]{32}$/.test(traceId) ||
    /^0+$/.test(traceId) ||
    !/^[0-9a-f]{16}$/.test(spanId) ||
    /^0+$/.test(spanId)
  )
    throw new Error("Invalid trace/span ID");
  return {
    trace_id: traceId,
    span_id: spanId,
    function: attrs[sc.FUNCTION] as string,
    checks: ids.map((id, i) => [
      id as string,
      hashes[i] as string,
      results[i] as string,
    ]),
  };
}
function value(input: Record<string, any>, depth = 0): unknown {
  if (depth > 4) throw new Error("Attribute nesting too deep");
  const keys = Object.keys(input);
  if (keys.length !== 1) throw new Error("Invalid attribute");
  if ("arrayValue" in input)
    return (input.arrayValue.values ?? []).map((v: Record<string, any>) =>
      value(v, depth + 1),
    );
  for (const key of ["stringValue", "boolValue", "intValue", "doubleValue"])
    if (key in input) return input[key];
  throw new Error("Unsupported attribute type");
}
export function decode(payload: Uint8Array): Evidence[] {
  const message = TraceRequest.toObject(TraceRequest.decode(payload), {
    longs: Number,
    bytes: Buffer,
  });
  const evidence: Evidence[] = [];
  for (const resource of message.resourceSpans ?? [])
    for (const scope of resource.scopeSpans ?? [])
      for (const span of scope.spans ?? []) {
        const attrs: Record<string, unknown> = Object.create(null);
        for (const attr of span.attributes ?? []) {
          if (!attr.key?.startsWith("code_artifact.")) continue;
          if (attr.key in attrs) throw new Error("Duplicate attribute");
          attrs[attr.key] = value(attr.value ?? {});
        }
        const item = evidenceFromAttributes(
          attrs,
          Buffer.from(span.traceId ?? []).toString("hex"),
          Buffer.from(span.spanId ?? []).toString("hex"),
        );
        if (item) evidence.push(item);
      }
  return evidence;
}

export class Session {
  readonly seen = new Set<string>();
  readonly counts: Record<string, number> = Object.create(null);
  invalid = 0;
  constructor(
    readonly emit: (finding: Finding) => void = () => {},
    readonly maxSpans = 100_000,
  ) {
    if (!Number.isSafeInteger(maxSpans) || maxSpans < 1)
      throw new TypeError("Invalid span capacity");
  }
  accept(evidence: Evidence[]): void {
    const keys = new Set(
      evidence
        .map((e) => `${e.trace_id}:${e.span_id}`)
        .filter((k) => !this.seen.has(k)),
    );
    if (this.seen.size + keys.size > this.maxSpans)
      throw new Error("Session capacity exhausted");
    for (const item of evidence) {
      const key = `${item.trace_id}:${item.span_id}`;
      if (this.seen.has(key)) continue;
      this.seen.add(key);
      for (const [check_id, contract_hash, result] of item.checks) {
        this.counts[result] = (this.counts[result] ?? 0) + 1;
        if (result === "failed")
          this.emit({
            function: item.function,
            check_id,
            contract_hash,
            trace_id: item.trace_id,
            span_id: item.span_id,
            observed: false,
            expected: true,
          });
      }
    }
  }
  get exitCode(): 0 | 1 | 2 {
    if (
      this.invalid ||
      this.counts.error ||
      this.counts.not_executed ||
      !(this.counts.passed || this.counts.failed)
    )
      return 2;
    return this.counts.failed ? 1 : 0;
  }
  summary() {
    return {
      spans: this.seen.size,
      checks: { ...this.counts },
      invalid_requests: this.invalid,
      exit_code: this.exitCode,
    };
  }
}

export async function readBody(
  request: IncomingMessage,
  max: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > max) throw new Error("Request too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
export function makeServer(session: Session) {
  const server = createServer(async (req, res) => {
    const reply = (status: number, body = "") => {
      res.writeHead(status, {
        "Content-Type":
          status === 200 && req.method === "POST"
            ? "application/x-protobuf"
            : "text/plain",
      });
      res.end(body);
    };
    if (req.method === "GET") {
      reply(req.url === "/healthz" ? 200 : 404, "ready\n");
      return;
    }
    if (req.method !== "POST" || req.url !== "/v1/traces") {
      reply(404);
      return;
    }
    if (
      req.headers["content-type"]?.split(";")[0]?.trim() !==
        "application/x-protobuf" ||
      !["identity", "gzip"].includes(
        req.headers["content-encoding"] ?? "identity",
      )
    ) {
      session.invalid++;
      reply(415);
      return;
    }
    const length =
      req.headers["content-length"] === undefined
        ? undefined
        : Number(req.headers["content-length"]);
    if (
      length !== undefined &&
      (!Number.isSafeInteger(length) || length < 0 || length > MAX_BODY)
    ) {
      session.invalid++;
      reply(413);
      return;
    }
    try {
      let payload = await readBody(req, MAX_BODY);
      if (length !== undefined && payload.length !== length)
        throw new Error("Incomplete body");
      if (req.headers["content-encoding"] === "gzip")
        payload = gunzipSync(payload, { maxOutputLength: MAX_BODY });
      session.accept(decode(payload));
      reply(200);
    } catch {
      session.invalid++;
      if (!res.destroyed)
        reply(400, "invalid telemetry or session capacity exceeded\n");
    }
  });
  server.maxConnections = 16;
  server.requestTimeout = 1000;
  server.headersTimeout = 1000;
  server.setTimeout(1000, (socket) => socket.destroy());
  return server;
}

export async function watch({
  host = "127.0.0.1",
  port = 4318,
  duration = 0,
  maxSpans = 100_000,
} = {}): Promise<number> {
  const session = new Session(
    (f) => console.log("DRIFT " + JSON.stringify(f)),
    maxSpans,
  );
  const server = makeServer(session);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  console.log(
    `READY http://${host}:${typeof address === "object" && address ? address.port : port}`,
  );
  await new Promise<void>((resolve) => {
    let timer: NodeJS.Timeout | undefined;
    const stop = () => {
      clearTimeout(timer);
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      server.closeAllConnections();
      server.close(() => resolve());
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    if (duration) timer = setTimeout(stop, duration * 1000);
  });
  console.log("SUMMARY " + JSON.stringify(session.summary()));
  return session.exitCode;
}
