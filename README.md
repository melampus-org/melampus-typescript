# Melampus for TypeScript

Keep AI coding sessions aligned with reviewed intent and fresh local execution evidence.
TypeScript counterpart of [melampus-python](https://github.com/melampus-org/melampus-python),
with the same experimental `code_artifact` wire schema.

**0.2.0 alpha. npm publication is separate from GitHub releases.** Node.js 22.18+,
ES modules; local sessions target macOS/Linux. Install from this checkout:

```sh
npm ci
npm run ci
npm run demo
```

The demo executes **healthy → drift → blocked completion → repair → healthy**
without an LLM request, collector, tracing backend or cloud service.

## Start beside a coding agent

```sh
npm run build
cd examples/agent-session
node ../../dist/cli.js session
```

In another terminal, enter the same example directory and run `claude`. Review
and enable the included synchronous project hooks. They query the supervisor
before/after tools and on completion. Drift or incomplete evidence blocks
progression while reads and scoped Edit/Write repairs remain available.
Other agents can use `melampus gate` and its 0/1/2 exit contract.

See [the runnable example](examples/agent-session/README.md) and
[session behavior](docs/AGENT-SESSION.md).

## Reviewed contracts travel with the code

Keep reviewed claims in `intent.ts`:

```ts
import { Check, Contract } from "melampus-typescript";

export const PRICE = new Contract<number>({
  intent: "Return a nonnegative price in cents",
  checks: [
    new Check("nonnegative", (value) => value >= 0, "Price is nonnegative."),
  ],
});
export const CONTRACTS = { "pricing:price": PRICE };
```

Keep business functions plain in `pricing.ts`:

```ts
export function price(cents: number): number {
  return Math.max(0, cents);
}
```

Register once at the application boundary in `registration.ts`:

```ts
import { instrument } from "melampus-typescript";
import { price } from "./pricing.ts";
import { PRICE } from "./intent.ts";

export const pricing = instrument(
  { price },
  {
    namespace: "pricing",
    contracts: { price: PRICE },
    generator: "claude-code",
  },
);
pricing.price(-100);
```

Call through the registered object. Original imports and previously captured
references bypass instrumentation. Only configured methods are checked.

The supervisor runs reviewed scenarios in fresh Node processes, verifies the
exact reviewed Check objects, and requires every declared check to execute.
The session runner configures its own always-on OpenTelemetry provider locally.

For ordinary applications, `instrumented({ path, intent, checks, ... })` returns
a typed function wrapper. Sync calls stay sync; promises are checked after
settlement; arguments and `this` are preserved. Explicit stable paths replace
Python's inferred `module:qualified_name`. Generators are unsupported.
The core entry point uses only the OTel API and configures no provider/exporter;
CLI subpaths load the installed SDK and protobuf dependencies. Without a
recording tracer, checks do not execute. Applications own export and flushing.

## Register a class instance once

Use the same API for a class instance:

```ts
import { instrument } from "melampus-typescript";
import { PRICE } from "./intent.ts";

class PricingService {
  price(cents: number): number {
    return Math.max(0, cents);
  }
}

const pricing = instrument(new PricingService(), {
  namespace: "pricing:PricingService",
  contracts: { price: PRICE },
});
pricing.price(-100);
```

Register its reviewed path as `pricing:PricingService.price`. Register each
instance before sharing it; methods can use private state and inherited public
methods. The target is modified in place and returned with its original type.
Business methods need no wrappers or decorators. Function-level `instrumented`
and `Contract.instrument` remain available for small integrations.

Run `npm run demo:registration` to compare wrapper, class, and module styles.
Run `npm run demo:pilot` to validate all pilot worksheet measures, or
`npm run pilot -- --participant p01 --rotation 0` for a timed participant study.
The [study guide](examples/pilot-study/README.md) explains tasks and exported reports.
See [API boundaries](docs/SDK-REGISTRATION.md) and the
[runnable pilot and feedback worksheet](examples/sdk-registration/README.md).

## Observe OTLP evidence

```sh
node dist/cli.js watch --duration 30
# Send/flush OTLP HTTP binary protobuf to http://127.0.0.1:4318/v1/traces
```

The loopback receiver supports gzip and bounded chunked bodies, exposes
`/healthz`, and deduplicates spans within the session. JSON and gRPC are unsupported.
The TypeScript receiver accepts Python spans; the Python decoder accepts TypeScript
spans. Python 0.1.0's HTTP receiver rejects chunked transfer, so use a collector or
Content-Length forwarding when connecting the JavaScript exporter to that receiver.

| Exit | Meaning                                                           |
| ---- | ----------------------------------------------------------------- |
| 0    | At least one evaluated check; no failures or incomplete evidence  |
| 1    | Failed predicates (drift)                                         |
| 2    | Missing/invalid evidence, errors, timeout, or capacity exhaustion |

Exit 2 takes precedence. Suppression is never a pass. The local supervisor is
stricter than the optional watcher: **every required check** must execute.

## Privacy and execution controls

Checks are pure, fast synchronous predicates returning exactly `boolean`.
Check failures/errors preserve the application result. Application throws and
promise rejections propagate unchanged. Melampus records no arguments, returned
values, intent prose, exception messages or stack traces. `captureContent: true`
is rejected. Hashes identify declarations; they are not anonymization.

```ts
import { Policy, instrumented } from "melampus-typescript";
const policy = new Policy({ checksPerSecond: 100 });
const compute = instrumented({
  path: "service:compute",
  intent: "Compute a result",
  policy,
})(() => 42);
policy.configure({ checksPerSecond: 100, disabledPaths: ["service:compute"] });
compute();
```

A shared Policy limits check counts per Node isolate in fixed one-second windows;
worker threads and processes have separate budgets. `new Check(id, predicate,
contract, 0.1)` samples deterministically from trace ID, span ID and check ID.
These controls cannot time-limit or sandbox predicates.

## Boundaries and development

A healthy session validates reviewed executable claims on exercised inputs. It
cannot infer arbitrary intent, prove unexecuted behavior, or prevent a hostile
same-user process bypassing hooks. TypeScript scenarios use Node's native type
stripping; type-check separately. Browser support, CommonJS, decorators, Windows
sessions and production overhead guarantees are outside this alpha.

```sh
npm run ci       # schema/version, lint, types, build, coverage, installed tarball
npm run format
npm run demo
```

[Port decisions](docs/PORT.md) · [Release operations](docs/RELEASE.md) ·
[Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) ·
[Wire schema](semconv/README.md) · [Apache-2.0](LICENSE)
