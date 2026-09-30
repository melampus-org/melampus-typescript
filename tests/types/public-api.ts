import { Check, Contract, instrumented } from "../../src/index.js";
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
