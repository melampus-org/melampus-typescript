import { instrument } from "melampus-typescript";
import { PRICE } from "./intent.ts";
import { price } from "./pricing.ts";

export const pricing = instrument(
  { price },
  {
    namespace: "pricing",
    contracts: { price: PRICE },
    generator: "claude-code",
  },
);
