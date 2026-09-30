import { Check, Contract } from "melampus-typescript";
export const PRICE = new Contract<number>({
  intent: "Return a nonnegative price in cents",
  checks: [
    new Check("nonnegative", (value) => value >= 0, "Price is nonnegative."),
  ],
});
export const CONTRACTS = { "pricing:price": PRICE };
