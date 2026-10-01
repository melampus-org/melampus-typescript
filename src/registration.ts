import {
  Contract,
  instrumented,
  validPath,
  type InstrumentOptions,
} from "./sdk.js";

/** Only callable string keys are eligible; predicates receive the resolved result. */
export type ContractMap<T extends object> = {
  [
    K in keyof T as K extends string
      ? T[K] extends (...args: any[]) => any
        ? K
        : never
      : never
  ]?: T[K] extends (...args: any[]) => infer R ? Contract<Awaited<R>> : never;
};

export interface RegistrationOptions<T extends object> extends Pick<
  InstrumentOptions<unknown>,
  "generator" | "policy" | "tracer"
> {
  /** "module" produces module:method; "module:Class" produces module:Class.method. */
  namespace: string;
  contracts: ContractMap<T>;
}

const registered = new WeakSet<object>();

/**
 * Install wrappers on selected methods of this object and return the same object.
 * Register before sharing instances or capturing method references. Only own
 * methods and public prototype methods are supported, including inherited ones.
 */
export function instrument<T extends object>(
  target: T,
  options: RegistrationOptions<NoInfer<T>>,
): T {
  if (target === null || typeof target !== "object")
    throw new TypeError(
      "Instrumentation target must be an object or class instance",
    );
  if (registered.has(target))
    throw new TypeError(
      "Object is already instrumented; register it only once",
    );
  const { namespace, contracts, ...shared } = options;
  if (
    !validPath(namespace) ||
    namespace.split(":").some((part) => !part) ||
    namespace.split(":").length > 2
  )
    throw new TypeError("Namespace must be module or module:Class");
  if (!contracts || typeof contracts !== "object" || Array.isArray(contracts))
    throw new TypeError("Contracts must be a nonempty method-to-Contract map");
  const keys = Reflect.ownKeys(contracts);
  if (!keys.length)
    throw new TypeError("Contracts must be a nonempty method-to-Contract map");

  // Plan every change first: getters are never evaluated during registration.
  const plan = keys.map((key) => {
    if (
      typeof key !== "string" ||
      ["constructor", "__proto__", "prototype"].includes(key)
    )
      throw new TypeError("Contract keys must name ordinary string methods");
    const contract = Object.getOwnPropertyDescriptor(contracts, key)?.value;
    if (!(contract instanceof Contract))
      throw new TypeError(`Contract for ${key} must be a reviewed Contract`);
    const own = Object.getOwnPropertyDescriptor(target, key);
    let descriptor = own;
    let prototype = Object.getPrototypeOf(target);
    while (
      !descriptor &&
      prototype !== Object.prototype &&
      prototype !== null
    ) {
      descriptor = Object.getOwnPropertyDescriptor(prototype, key);
      prototype = Object.getPrototypeOf(prototype);
    }
    if (!descriptor || typeof descriptor.value !== "function")
      throw new TypeError(
        `Method ${key} must be an own function or public prototype method; accessors are unsupported`,
      );
    if (own ? !own.configurable && !own.writable : !Object.isExtensible(target))
      throw new TypeError(`Method ${key} cannot be replaced on this object`);
    const path = `${namespace}${namespace.includes(":") ? "." : ":"}${key}`;
    const wrapped = instrumented({
      ...shared,
      path,
      intent: contract.intent,
      checks: contract.checks,
      assumptions: contract.assumptions,
    })(descriptor.value);
    return { key, descriptor: { ...descriptor, value: wrapped } };
  });
  for (const { key, descriptor } of plan)
    Object.defineProperty(target, key, descriptor);
  registered.add(target);
  return target;
}
