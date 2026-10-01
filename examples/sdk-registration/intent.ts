import { Check, Contract } from "melampus-typescript";

export const PRICE = new Contract<number>({
  intent: "Return a nonnegative price in cents",
  checks: [
    new Check("nonnegative", (value) => value >= 0, "Price is nonnegative."),
  ],
});

// A shared predicate, with a separate evidence path for each integration style.
export const CONTRACTS = {
  "pilot:wrappedPrice": PRICE,
  "pilot:PricingService.price": PRICE,
  "pilot:price": PRICE,
};
