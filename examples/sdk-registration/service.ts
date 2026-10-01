export class PricingService {
  price(cents: number): number {
    return Math.max(0, cents);
  }

  // Deliberately has no contract: a healthy report makes no claim about this method.
  label(): string {
    return "cents";
  }
}
