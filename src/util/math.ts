export function mulmod(x: bigint, y: bigint, k: bigint): bigint {
  return (x * y) % k;
}

export function mulDivRoundingUp(
  a: bigint,
  b: bigint,
  denominator: bigint
): bigint {
  let result = (a * b) / denominator;

  if (mulmod(a, b, denominator) > 0) {
    result += 1n;
  }

  return result;
}

export function percentage(part: bigint, total: bigint) {
  return Number((part * 10000n) / total) / 100;
}
