export function price(cents: number): number {
  return Math.max(0, cents);
}

export function label(): string {
  return "cents";
}
