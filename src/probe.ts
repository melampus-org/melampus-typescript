import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import {
  AlwaysOnSampler,
  SimpleSpanProcessor,
  type ReadableSpan,
  type SpanExporter,
} from "@opentelemetry/sdk-trace-base";
import { Contract, setDeclarationValidator, validPath } from "./sdk.js";
import { Session, evidenceFromAttributes, type Finding } from "./watcher.js";

export async function evaluate(config: { contracts: string; probe: string }) {
  const contracts: Record<string, Contract<any>> = (
    await import(pathToFileURL(config.contracts).href)
  ).CONTRACTS;
  if (
    !contracts ||
    typeof contracts !== "object" ||
    Array.isArray(contracts) ||
    !Object.keys(contracts).length
  )
    throw new Error("Invalid CONTRACTS");
  const expected = new Set<string>();
  for (const [path, contract] of Object.entries(contracts)) {
    if (
      !validPath(path) ||
      !path.includes(":") ||
      !(contract instanceof Contract) ||
      !contract.checks.length ||
      contract.checks.some((c) => c.sample !== 1)
    )
      throw new Error("Invalid session contract");
    contract.instrument({ path });
    for (const check of contract.checks) expected.add(`${path}/${check.id}`);
  }
  if (expected.size > 256) throw new Error("At most 256 required checks");
  const declarations = new Set<string>();
  const violations = new Set<string>();
  const observed = new Set<string>();
  setDeclarationValidator((path, intent, checks, assumptions) => {
    const contract = contracts[path];
    if (!contract) return;
    if (
      declarations.has(path) ||
      intent !== contract.intent ||
      JSON.stringify(assumptions) !== JSON.stringify(contract.assumptions) ||
      checks.length !== contract.checks.length ||
      checks.some((c, i) => c !== contract.checks[i])
    )
      violations.add(path);
    declarations.add(path);
  });
  const findings: Finding[] = [];
  const session = new Session((f) => {
    if (findings.length < 32) findings.push(f);
  }, 10_000);
  const exporter: SpanExporter = {
    export(spans: ReadableSpan[], callback) {
      try {
        for (const span of spans) {
          const ctx = span.spanContext();
          const item = evidenceFromAttributes(
            span.attributes,
            ctx.traceId,
            ctx.spanId,
          );
          if (!item) continue;
          session.accept([item]);
          for (const [id, , result] of item.checks) {
            if (result === "passed" || result === "failed")
              observed.add(`${item.function}/${id}`);
            else session.invalid++;
          }
        }
      } catch {
        session.invalid++;
      }
      callback({ code: 0 });
    },
    async shutdown() {},
  };
  const provider = new NodeTracerProvider({
    sampler: new AlwaysOnSampler(),
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  provider.register();
  let probeError = false;
  try {
    await import(pathToFileURL(config.probe).href);
  } catch {
    probeError = true;
  } finally {
    await provider.shutdown();
    setDeclarationValidator(undefined);
  }
  const missing = [...expected].filter((k) => !observed.has(k)).sort();
  const undeclared = Object.keys(contracts)
    .filter((k) => !declarations.has(k))
    .sort();
  return {
    exit_code:
      probeError ||
      missing.length ||
      undeclared.length ||
      violations.size ||
      session.exitCode === 2
        ? 2
        : session.exitCode,
    findings,
    missing,
    undeclared,
    contract_mismatch: [...violations].sort(),
    probe_error: probeError,
    checks: session.counts,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  let report: object;
  try {
    report = await evaluate(JSON.parse(readFileSync(process.argv[2]!, "utf8")));
  } catch {
    report = {
      exit_code: 2,
      message: "Contract or scenario configuration failed to load.",
    };
  }
  writeFileSync(process.argv[3]!, JSON.stringify(report));
}
