import { PRICE } from "./intent.ts";
export const price = PRICE.instrument({
  path: "pricing:price",
  generator: "claude-code",
})((cents: number) => Math.max(0, cents));
