import { Check, Contract, instrumented, instrument } from "../../src/index.js";
const c = new Contract({
  intent: "positive",
  checks: [new Check<number>("positive", (v) => v > 0, "positive")],
});
const sync = c.instrument({ path: "demo:sync" })((value: number) => value);
const asyncFn = c.instrument({ path: "demo:async" })(
  async (value: number) => value,
);
const n: number = sync(1);
const p: Promise<number> = asyncFn(1);
const method = instrumented({
  path: "demo:method",
  intent: "preserve receiver",
})(function (this: { value: number }, offset: number) {
  return this.value + offset;
});
method.call({ value: n }, 2);
void p;
// @ts-expect-error return type must agree with the reviewed predicate
c.instrument({ path: "demo:wrong" })(() => "wrong");
// @ts-expect-error parameters remain typed
sync("wrong");

class Service {
  count = 1;
  #base = 1;
  price(n: number): number {
    return n + this.#base;
  }
  async quote(n: number): Promise<number> {
    return this.price(n);
  }
  label(): string {
    return "label";
  }
}
const service = instrument(new Service(), {
  namespace: "demo:Service",
  contracts: { price: c, quote: c },
});
const instance: Service = service;
const amount: number = service.price(1);
const quoted: Promise<number> = service.quote(1);
void [instance, amount, quoted];
instrument(
  { price: (n: number) => n },
  { namespace: "demo", contracts: { price: c } },
);
// @ts-expect-error unknown method keys cannot widen the inferred target
instrument(new Service(), { namespace: "demo", contracts: { missing: c } });
// @ts-expect-error fields cannot be instrumented
instrument(new Service(), { namespace: "demo", contracts: { count: c } });
// @ts-expect-error predicate type must agree with method result
instrument(new Service(), { namespace: "demo", contracts: { label: c } });
// @ts-expect-error parameters remain typed
service.price("wrong");
