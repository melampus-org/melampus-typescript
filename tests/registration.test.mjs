import test, { after } from "node:test";
import assert from "node:assert/strict";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { Check, Contract, Policy, instrument } from "../dist/index.js";

const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});
provider.register();
after(() => provider.shutdown());
const positive = new Contract({
  intent: "Positive",
  checks: [new Check("positive", (n) => n > 0, "Positive")],
});
const options = (contracts) => ({ namespace: "test:Service", contracts });
const latest = () => exporter.getFinishedSpans().at(-1);

test("class registration preserves identity, private state, sync/async methods and self calls", async () => {
  class Service {
    #base = 2;
    price(n) {
      return this.#base + n;
    }
    async quote(n) {
      return this.price(n);
    }
    arrow = (n) => this.#base + n;
    unconfigured() {
      return -1;
    }
  }
  const original = Service.prototype.price;
  const service = new Service();
  assert.equal(
    instrument(
      service,
      options({ price: positive, quote: positive, arrow: positive }),
    ),
    service,
  );
  assert.equal(service instanceof Service, true);
  assert.equal(Service.prototype.price, original);
  assert.equal(
    Object.getOwnPropertyDescriptor(service, "price").enumerable,
    false,
  );
  assert.equal(service.price(2), 4);
  assert.equal(latest().name, "test:Service.price");
  const start = exporter.getFinishedSpans().length;
  assert.equal(await service.quote(2), 4);
  const spans = exporter.getFinishedSpans().slice(start);
  assert.deepEqual(
    spans.map((s) => s.name),
    ["test:Service.price", "test:Service.quote"],
  );
  assert.equal(
    spans[0].parentSpanContext.spanId,
    spans[1].spanContext().spanId,
  );
  assert.equal(service.arrow(1), 3);
  const before = exporter.getFinishedSpans().length;
  assert.equal(service.unconfigured(), -1);
  assert.equal(new Service().price(1), 3);
  assert.equal(exporter.getFinishedSpans().length, before);
  const second = instrument(new Service(), options({ price: positive }));
  assert.equal(second.price(3), 5);
  assert.throws(
    () => instrument(service, options({ price: positive })),
    /already instrumented/,
  );
});

test("module registration covers object calls, not original functions or saved references", () => {
  function price(n) {
    return n;
  }
  function quote(n) {
    return price(n);
  }
  const module = { price, quote, ignored: () => -1 };
  const captured = module.price;
  instrument(module, {
    namespace: "pricing",
    contracts: { price: positive, quote: positive },
  });
  const start = exporter.getFinishedSpans().length;
  assert.equal(module.price(-1), -1);
  assert.deepEqual(latest().attributes["code_artifact.check.results"], [
    "failed",
  ]);
  assert.equal(module.quote(1), 1);
  assert.equal(captured(1), 1);
  assert.equal(price(1), 1);
  assert.equal(module.ignored(), -1);
  assert.deepEqual(
    exporter
      .getFinishedSpans()
      .slice(start)
      .map((s) => s.name),
    ["pricing:price", "pricing:quote"],
  );
});

test("registered methods preserve receiver, error identity and shared policy", async () => {
  const error = new Error("private");
  const service = {
    base: 4,
    price(n) {
      return this.base + n;
    },
    fail() {
      throw error;
    },
    async reject() {
      throw error;
    },
  };
  const policy = new Policy({ disabledPaths: ["test:Service.price"] });
  instrument(service, {
    ...options({ price: positive, fail: positive, reject: positive }),
    policy,
    generator: "pilot",
  });
  assert.equal(service.price.call({ base: 8 }, 1), 9);
  assert.deepEqual(latest().attributes["code_artifact.check.results"], [
    "disabled",
  ]);
  assert.equal(latest().attributes["code_artifact.generator"], "pilot");
  assert.throws(
    () => service.fail(),
    (e) => e === error,
  );
  await assert.rejects(service.reject(), (e) => e === error);
  assert.equal(latest().events.length, 0);
});

test("invalid registrations leave ordinary targets unchanged without invoking accessors", () => {
  const invalidMaps = [
    {},
    [],
    null,
    { missing: positive },
    { price: {} },
    { value: positive },
    { constructor: positive },
    { prototype: positive },
    { [Symbol("price")]: positive },
    Object.defineProperty({}, "__proto__", { value: positive }),
    Object.defineProperty({}, "price", {
      get() {
        throw new Error("must not run");
      },
    }),
    { getPrice: positive },
    { generator: positive },
  ];
  for (const contracts of invalidMaps) {
    const target = {
      price: (n) => n,
      value: 1,
      get getPrice() {
        throw new Error("must not run");
      },
      *generator() {
        yield 1;
      },
    };
    const before = Object.getOwnPropertyDescriptors(target);
    assert.throws(() => instrument(target, options(contracts)), TypeError);
    assert.deepEqual(Object.getOwnPropertyDescriptors(target), before);
  }
  for (const namespace of [
    "",
    "\n",
    "bad:",
    ":bad",
    "a:b:c",
    "x".repeat(256),
  ]) {
    const target = { price: () => 1 };
    assert.throws(() =>
      instrument(target, { namespace, contracts: { price: positive } }),
    );
  }
  for (const target of [null, undefined, 1, () => 1])
    assert.throws(
      () => instrument(target, options({ price: positive })),
      /target/,
    );
  const target = { price: () => 1 };
  const original = target.price;
  assert.throws(() =>
    instrument(target, options({ price: positive, missing: positive })),
  );
  assert.equal(target.price, original);
  instrument(target, options({ price: positive })); // failed registration did not mark it registered
});

test("inherited methods preserve private state and respect nearest overrides", () => {
  class Base {
    #base = 4;
    price(n) {
      return this.#base + n;
    }
  }
  class Child extends Base {}
  const original = Base.prototype.price;
  const child = instrument(new Child(), options({ price: positive }));
  assert.equal(child.price(2), 6);
  assert.equal(latest().name, "test:Service.price");
  assert.equal(Base.prototype.price, original);
  assert.equal(new Child().price(2), 6);
  class Override extends Base {
    price(n) {
      return super.price(n) * 2;
    }
  }
  assert.equal(
    instrument(new Override(), options({ price: positive })).price(2),
    12,
  );
  class Accessor extends Base {
    get price() {
      throw new Error("must not run");
    }
  }
  assert.throws(
    () => instrument(new Accessor(), options({ price: positive })),
    /accessors/,
  );
  class Field extends Base {
    price = 1;
  }
  assert.throws(() => instrument(new Field(), options({ price: positive })));
});

test("immutable methods and Object.prototype methods fail explicitly", () => {
  class Base {
    price() {
      return 1;
    }
  }
  for (const target of [
    Object.freeze(new Base()),
    Object.freeze({ price: () => 1 }),
    Object.create(null),
  ])
    assert.throws(() => instrument(target, options({ price: positive })));
  assert.throws(() => instrument({}, options({ toString: positive })));
  // An own writable property can still be wrapped on a sealed object.
  const sealed = Object.seal({ price: () => 1 });
  instrument(sealed, options({ price: positive }));
  assert.equal(sealed.price(), 1);
});
