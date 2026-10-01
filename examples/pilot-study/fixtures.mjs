import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const STYLES = ["wrapper", "class", "module"];
export const ORDERS = [
  ["wrapper", "class", "module"],
  ["wrapper", "module", "class"],
  ["class", "wrapper", "module"],
  ["class", "module", "wrapper"],
  ["module", "wrapper", "class"],
  ["module", "class", "wrapper"],
];
const sdk = new URL("../../dist/index.js", import.meta.url).href;
export const namespace = (style) =>
  style === "class" ? "pilot:PricingService" : "pilot";
export const pathFor = (style, method) =>
  `${namespace(style)}${style === "class" ? "." : ":"}${method}`;

export function business(style) {
  return style === "class"
    ? `export class PricingService {
  price(cents: number): number { return Math.max(0, cents); }
  discount(cents: number): number { return Math.floor(Math.max(0, cents) * 0.9); }
  label(): string { return "cents"; }
}
`
    : `export const price = (cents: number): number => Math.max(0, cents);
export const discount = (cents: number): number => Math.floor(Math.max(0, cents) * 0.9);
export const label = (): string => "cents";
`;
}

export function entry(style) {
  return style === "class"
    ? `import { PricingService } from "./business.ts";
export const api = new PricingService();
`
    : `import { price, discount, label } from "./business.ts";
export const api = { price, discount, label };
`;
}

export function reviewed(style, second) {
  const registry = [`${JSON.stringify(pathFor(style, "price"))}: PRICE`];
  if (second)
    registry.push(`${JSON.stringify(pathFor(style, "discount"))}: DISCOUNT`);
  return {
    "sdk.ts": `export { instrument } from ${JSON.stringify(sdk)};\n`,
    "intent.ts": `import { Check, Contract } from ${JSON.stringify(sdk)};
export const PRICE = new Contract<number>({ intent: "Return a nonnegative price", checks: [new Check("nonnegative", n => n >= 0, "Price is nonnegative")] });
export const DISCOUNT = new Contract<number>({ intent: "Return a nonnegative integer discounted price", checks: [new Check("integer", n => Number.isInteger(n) && n >= 0, "Discount is a nonnegative integer")] });
export const CONTRACTS = { ${registry.join(", ")} };
`,
    "exercise.ts": `import { api } from "./entry.ts";
for (const cents of [-100, 0, 250]) {
  api.price(cents);
  api.discount(cents);
  api.label();
}
`,
    "package.json": '{"type":"module"}\n',
    "melampus.json":
      JSON.stringify(
        {
          contracts: "intent.ts",
          probe: "exercise.ts",
          watch: ["business.ts", "entry.ts"],
          protect: ["package.json", "sdk.ts"],
          timeout: 5,
        },
        null,
        2,
      ) + "\n",
  };
}

export function installReviewed(root, style, second) {
  for (const [file, content] of Object.entries(reviewed(style, second)))
    writeFileSync(join(root, file), content);
}

/** Reference integration is used only by the explicitly synthetic walkthrough. */
export function solution(root, style, second) {
  if (style === "wrapper") {
    let source = business(style);
    source = source.replace(
      "export const price = (cents: number): number => Math.max(0, cents);",
      `export const price = PRICE.instrument({ path: "pilot:price" })((cents: number): number => Math.max(0, cents));`,
    );
    if (second)
      source = source.replace(
        "export const discount = (cents: number): number => Math.floor(Math.max(0, cents) * 0.9);",
        `export const discount = DISCOUNT.instrument({ path: "pilot:discount" })((cents: number): number => Math.floor(Math.max(0, cents) * 0.9));`,
      );
    writeFileSync(
      join(root, "business.ts"),
      `import { PRICE${second ? ", DISCOUNT" : ""} } from "./intent.ts";\n` +
        source,
    );
  } else {
    const base =
      style === "class" ? "new PricingService()" : "{ price, discount, label }";
    const imports = entry(style).split("\n")[0];
    writeFileSync(
      join(root, "entry.ts"),
      `${imports}
import { instrument } from "./sdk.ts";
import { PRICE${second ? ", DISCOUNT" : ""} } from "./intent.ts";
export const api = instrument(${base}, { namespace: ${JSON.stringify(namespace(style))}, contracts: { price: PRICE${second ? ", discount: DISCOUNT" : ""} } });
`,
    );
  }
}

export function seedDrift(root) {
  const path = join(root, "business.ts");
  const source = readFileSync(path, "utf8");
  if (!source.includes("Math.max(0, cents)"))
    throw new Error(
      "Drift task needs the original Math.max(0, cents) expression. Restore that price expression before continuing.",
    );
  writeFileSync(
    path,
    source.replace("Math.max(0, cents)", "Math.min(0, cents)"),
  );
}

export function coverageQuestions(style) {
  return [
    {
      id: "registered",
      prompt: "api.price(-100), after registration, with a recording tracer",
      expected: "covered",
    },
    {
      id: "omitted",
      prompt: "api.label(), which has no configured contract",
      expected: "uncovered",
    },
    {
      id: "captured",
      prompt:
        "Calling a reference to the raw price implementation captured BEFORE wrapping",
      expected: "uncovered",
    },
    {
      id: "boundary",
      prompt:
        style === "class"
          ? "new PricingService().price(-100), on another UNREGISTERED instance"
          : style === "module"
            ? "Calling the original price imported directly from business.ts"
            : "Calling the raw implementation directly instead of its returned function wrapper",
      expected: "uncovered",
    },
    {
      id: "missing",
      prompt:
        "Session requires price AND discount, but the scenario only calls price. Gate outcome?",
      expected: "incomplete",
    },
    {
      id: "aggregate",
      prompt:
        "A required price check fails once and passes later in the same scenario. Gate outcome?",
      expected: "drift",
    },
  ];
}
