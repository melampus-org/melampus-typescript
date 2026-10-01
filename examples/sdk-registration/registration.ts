import { instrument } from "melampus-typescript";
import { PRICE } from "./intent.ts";
import { PricingService } from "./service.ts";
import { price, label } from "./functions.ts";

export const service = instrument(new PricingService(), {
  namespace: "pilot:PricingService",
  contracts: { price: PRICE },
});

// Independent instances can use the same reviewed declaration.
export const secondService = instrument(new PricingService(), {
  namespace: "pilot:PricingService",
  contracts: { price: PRICE },
});

export const pricing = instrument(
  { price, label },
  {
    namespace: "pilot",
    contracts: { price: PRICE },
  },
);
