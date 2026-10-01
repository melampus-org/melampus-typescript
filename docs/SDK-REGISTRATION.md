# Class and module registration pilot

This is an unreleased prototype. The published v0.1.0 artifact does not contain
`instrument`. Existing `instrumented` and `Contract.instrument` APIs remain available.

## Register once

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

The corresponding reviewed registry is:

```ts
export const CONTRACTS = { "pricing:PricingService.price": PRICE };
```

For functions, register an object at the module boundary:

```ts
const pricing = instrument(
  { price, discount },
  {
    namespace: "pricing",
    contracts: { price: PRICE, discount: DISCOUNT },
  },
);
pricing.price(-100);
```

The map autocompletes public callable string keys. Predicates must accept each
method's resolved return type. The returned type retains the target's parameters
and sync/async results. Register before sharing objects or capturing methods.
Registering the same object twice throws instead of nesting spans.

`namespace: "pricing"` produces `pricing:price`; `"pricing:PricingService"`
produces `pricing:PricingService.price`. Namespaces must be nonempty and contain
at most one colon with nonempty parts. Derived paths retain the 256-character
limit. Use stable namespaces rather than constructor names or instance IDs.
`generator`, `policy`, and `tracer` are optional shared settings. Each Contract
supplies its intent, checks, assumptions, and sampling.

## Behavior and coverage boundaries

- Selected properties are modified **in place**. The returned object is the same
  instance. No Proxy, class replacement, or prototype mutation is used. Each new
  instance needs registration. Wrapping a prototype method adds an own property,
  so reflection can observe this change.
- Own function properties (including arrow fields) and immediate prototype
  methods are supported. Public methods can use `#private` state. Ordinary
  `this.otherMethod()` calls reach registered wrappers. Receivers are preserved,
  not automatically bound; detached methods still need the caller to supply `this`.
- Accessors, symbols, private methods, constructor/static-class registration,
  generators, and methods inherited from farther up the prototype chain are
  outside this pilot. Selecting them fails explicitly. Missing methods, empty
  maps, and methods that cannot be replaced also fail. Getters are not invoked
  during discovery. Validation precedes writes for ordinary targets; user-defined
  Proxies and exotic objects are unsupported.
- Module-object property calls are checked. Original imports, captured references,
  lexical calls inside functions, and direct prototype calls bypass wrappers.
  This does not instrument an entire source file. Replacing methods after
  registration is unsupported and also bypasses their wrappers.
- Omitted methods are **unconfigured**, not verified. Keep the reviewed `CONTRACTS`
  registry and registration map aligned. Sessions report absent check execution
  and undeclared required paths as incomplete. Unlisted methods are not discovered
  or reported automatically.
- Multiple instances can share a path when every registration matches the reviewed
  intent, assumptions, and exact Check objects. Conflicts remain incomplete even
  after valid registrations. Evidence is aggregated by method path: every required
  check must run, not every instance. One instance's pass cannot cancel another's
  failure.
- The underlying wrapper preserves results, thrown errors, and rejection reasons.
  Promises/thenables are checked after fulfillment; promise identity is not
  guaranteed. No arguments or results are captured as telemetry. The core SDK
  configures no provider; checks require recording spans. Sessions provide their
  own local provider.

The Python-compatible wire schema is unchanged. No overhead guarantee is claimed.

## Rationale and evaluation

The member-map approach follows [MobX registration](https://mobx.js.org/observable-state.html).
[NestJS interceptors](https://docs.nestjs.com/interceptors) also demonstrate
registration at controller scope, within framework handlers.
[OpenTelemetry automatic instrumentation](https://opentelemetry.io/docs/concepts/instrumentation/zero-code/)
covers supported libraries; it cannot supply reviewed business predicates for us.

Decorators are deferred: [Node 22](https://nodejs.org/docs/latest-v22.x/api/typescript.html#typescript-features)
does not transform them, and [modern/legacy TypeScript decorators](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-0.html)
have different semantics. Optional adapters can follow the pilot. Preserving sync
behavior matters: [AWS Powertools](https://docs.aws.amazon.com/powertools/typescript/latest/features/tracer/)
documents that its method decorator can convert sync methods to async.

Run `npm run demo:registration` to exercise the same contract through all three
styles. Use the [pilot worksheet](../examples/sdk-registration/README.md) to collect
onboarding time, code edits, ease of adding a method, understanding failures, and
recognition of uncovered calls. Human preference and comfort remain unmeasured.
