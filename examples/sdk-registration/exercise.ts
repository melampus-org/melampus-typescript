import { wrappedPrice } from "./wrapper.ts";
import { service, secondService, pricing } from "./registration.ts";

for (const cents of [-100, 0, 250]) {
  wrappedPrice(cents);
  service.price(cents);
  secondService.price(cents);
  pricing.price(cents);
}
