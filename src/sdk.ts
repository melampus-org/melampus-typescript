import { createHash } from "node:crypto";
import {
  trace,
  SpanStatusCode,
  type Span,
  type Tracer,
} from "@opentelemetry/api";
import * as sc from "./semconv.js";

export const SCHEMA_VERSION = "0.1.0";
export const IDENTIFIER = /^[A-Za-z0-9_.:-]{1,64}$/;
export const MAX_CHECKS = 16;
export const hash = (text: string): string =>
  createHash("sha256").update(text, "utf8").digest("hex");
export function validPath(path: unknown): path is string {
  return (
    typeof path === "string" &&
    [...path].length > 0 &&
    [...path].length <= 256 &&
    !/[\p{C}\p{Zl}\p{Zp}]/u.test(path)
  );
}

export class Check<T = unknown> {
  readonly id: string;
  readonly predicate: (result: T) => boolean;
  readonly contract: string;
  readonly sample: number;
  constructor(
    id: string,
    predicate: (result: T) => boolean,
    contract: string,
    sample = 1,
  ) {
    if (typeof id !== "string" || !IDENTIFIER.test(id) || id.includes("\n"))
      throw new TypeError("Invalid check identifier");
    if (typeof contract !== "string" || !contract)
      throw new TypeError("Contract must be nonempty text");
    if (
      typeof predicate !== "function" ||
      predicate.constructor.name === "AsyncFunction"
    )
      throw new TypeError("Predicate must be synchronous");
    if (!Number.isFinite(sample) || sample < 0 || sample > 1)
      throw new TypeError("Sample must be in [0,1]");
    this.id = id;
    this.predicate = predicate;
    this.contract = contract;
    this.sample = sample;
    Object.freeze(this);
  }
}

export interface PolicyOptions {
  checksPerSecond?: number | null;
  disabledPaths?: readonly string[];
}
export class Policy {
  private limit: number | null = null;
  private disabled = new Set<string>();
  private window = 0;
  private used = 0;
  constructor(options: PolicyOptions = {}) {
    this.configure(options);
  }
  configure({
    checksPerSecond = null,
    disabledPaths = [],
  }: PolicyOptions = {}): void {
    if (
      checksPerSecond !== null &&
      (!Number.isSafeInteger(checksPerSecond) || checksPerSecond < 0)
    )
      throw new TypeError("Invalid check budget");
    if (
      !Array.isArray(disabledPaths) ||
      disabledPaths.some((p) => typeof p !== "string")
    )
      throw new TypeError("Invalid disabled paths");
    this.limit = checksPerSecond;
    this.disabled = new Set(disabledPaths);
    this.window = 0;
    this.used = 0;
  }
  admit(path: string, sampled: boolean): string | undefined {
    if (this.disabled.has(path)) return "disabled";
    if (!sampled) return "sampled_out";
    const now = Math.floor(performance.now() / 1000);
    if (now !== this.window) {
      this.window = now;
      this.used = 0;
    }
    if (this.limit !== null && this.used >= this.limit) return "budget";
    this.used++;
    return undefined;
  }
}
export const DEFAULT_POLICY = new Policy();

export interface InstrumentOptions<T> {
  /** Stable module:qualifiedName, explicit because JavaScript cannot reliably infer module names. */
  path: string;
  intent: string;
  checks?: readonly Check<T>[];
  assumptions?: readonly string[];
  generator?: string;
  policy?: Policy;
  tracer?: Tracer;
  captureContent?: boolean;
}
type DeclarationValidator = (
  path: string,
  intent: string,
  checks: readonly Check<any>[],
  assumptions: readonly string[],
) => void;
let validator: DeclarationValidator | undefined;
/** Internal disposable-runner hook; not exported from the package entry point. */
export function setDeclarationValidator(
  value: DeclarationValidator | undefined,
): void {
  validator = value;
}

export function sampled(check: Check<any>, span: Span): boolean {
  if (check.sample === 0 || check.sample === 1) return check.sample === 1;
  const ctx = span.spanContext();
  const seed = `${ctx.traceId}:${ctx.spanId}:${check.id}`;
  const value = createHash("sha256").update(seed).digest().readBigUInt64BE();
  return value < BigInt(Math.floor(check.sample * 2 ** 64));
}

export function instrumented<T>(options: InstrumentOptions<T>) {
  const {
    path,
    intent,
    generator = "unspecified",
    policy = DEFAULT_POLICY,
  } = options;
  if (options.captureContent)
    throw new Error("Content capture is unsupported in schema 0.1.0");
  if (!validPath(path)) throw new TypeError("Invalid function path");
  if (typeof intent !== "string" || !intent)
    throw new TypeError("Intent must be nonempty text");
  if (
    typeof generator !== "string" ||
    !IDENTIFIER.test(generator) ||
    generator.includes("\n")
  )
    throw new TypeError("Invalid generator");
  if (
    options.assumptions !== undefined &&
    (!Array.isArray(options.assumptions) ||
      options.assumptions.some((a) => typeof a !== "string"))
  )
    throw new TypeError("Invalid assumptions");
  const checks = Object.freeze([...(options.checks ?? [])]);
  const assumptions = Object.freeze([...(options.assumptions ?? [])]);
  if (
    checks.some((c) => !(c instanceof Check)) ||
    checks.length > MAX_CHECKS ||
    new Set(checks.map((c) => c.id)).size !== checks.length
  )
    throw new TypeError("Checks must have unique IDs, at most 16");
  const declaration = {
    [sc.SCHEMA_VERSION]: SCHEMA_VERSION,
    [sc.FUNCTION]: path,
    [sc.GENERATOR]: generator,
    [sc.INTENT_HASH]: hash(intent),
    [sc.ASSUMPTIONS_HASH]: hash(JSON.stringify(assumptions)),
    [sc.CHECK_IDS]: checks.map((c) => c.id),
    [sc.CHECK_CONTRACT_HASHES]: checks.map((c) => hash(c.contract)),
    [sc.CHECK_SAMPLE_RATES]: checks.map((c) => c.sample),
    [sc.CHECK_RESULTS]: checks.map(() => "not_executed"),
  };
  return function wrap<
    This,
    Args extends unknown[],
    R extends T | PromiseLike<T>,
  >(fn: (this: This, ...args: Args) => R): (this: This, ...args: Args) => R {
    if (
      ["GeneratorFunction", "AsyncGeneratorFunction"].includes(
        fn.constructor.name,
      )
    )
      throw new TypeError("Generators are unsupported");
    validator?.(path, intent, checks, assumptions);
    return function (this: This, ...args: Args): R {
      const tracer =
        options.tracer ?? trace.getTracer("melampus", SCHEMA_VERSION);
      return tracer.startActiveSpan(
        path,
        { attributes: declaration },
        (span) => {
          const fail = (error: unknown): never => {
            span.setStatus({ code: SpanStatusCode.ERROR });
            span.end();
            throw error;
          };
          const finish = (value: T): T => {
            if (span.isRecording()) {
              const results = checks.map((check) => {
                const reason = policy.admit(path, sampled(check, span));
                if (reason) return reason;
                try {
                  const verdict: unknown = check.predicate(value);
                  // Observe accidental rejected promises so an invalid predicate cannot crash the host.
                  if (
                    verdict &&
                    typeof (verdict as PromiseLike<unknown>).then === "function"
                  )
                    void Promise.resolve(verdict).catch(() => {});
                  return typeof verdict === "boolean"
                    ? verdict
                      ? "passed"
                      : "failed"
                    : "error";
                } catch {
                  return "error";
                }
              });
              span.setAttribute(sc.CHECK_RESULTS, results);
            }
            span.end();
            return value;
          };
          let result: R;
          try {
            result = fn.apply(this, args);
            if (
              result != null &&
              typeof (result as unknown as PromiseLike<T>).then === "function"
            )
              return Promise.resolve(result as T | PromiseLike<T>).then(
                finish,
                fail,
              ) as R;
          } catch (error) {
            return fail(error);
          }
          return finish(result as T) as R;
        },
      );
    };
  };
}

export class Contract<T = unknown> {
  readonly intent: string;
  readonly checks: readonly Check<T>[];
  readonly assumptions: readonly string[];
  constructor(
    options: Pick<InstrumentOptions<T>, "intent" | "checks" | "assumptions">,
  ) {
    this.intent = options.intent;
    this.checks = Object.freeze([...(options.checks ?? [])]);
    this.assumptions = Object.freeze([...(options.assumptions ?? [])]);
    instrumented({
      path: "contract:validation",
      intent: this.intent,
      checks: this.checks,
      assumptions: this.assumptions,
    });
    Object.freeze(this);
  }
  instrument(options: Pick<InstrumentOptions<T>, "path" | "generator">) {
    return instrumented({
      ...options,
      intent: this.intent,
      checks: this.checks,
      assumptions: this.assumptions,
    });
  }
}
