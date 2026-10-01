import { PRICE } from "./intent.ts";

export const wrappedPrice = PRICE.instrument({ path: "pilot:wrappedPrice" })(
  (cents: number) => Math.max(0, cents),
);
