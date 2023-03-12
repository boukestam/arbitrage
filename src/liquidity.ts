import { Pair } from "./types";

export function findLiquidPairs(
  pairs: Pair[],
  stable: string,
  minStableAmount: bigint
): Pair[] {
  const pairsByToken = createPairMap(pairs);
  const output: Pair[] = [];

  findLiquidPairsRecursive(
    output,
    new Set<Pair>(),
    pairsByToken,
    stable,
    minStableAmount,
    3
  );

  return output;
}

function findLiquidPairsRecursive(
  output: Pair[],
  visited: Set<Pair>,
  pairsByToken: Map<string, Pair[]>,
  token: string,
  minAmount: bigint,
  depth: number
) {
  const stablePairs = pairsByToken.get(token);

  for (const pair of stablePairs) {
    if (visited.has(pair)) continue;
    visited.add(pair);

    if (pair.reserve(token) >= minAmount) {
      output.push(pair);
    }

    if (depth > 0) {
      try {
        findLiquidPairsRecursive(
          output,
          visited,
          pairsByToken,
          pair.other(token),
          pair.convert(token, minAmount),
          depth - 1
        );
      } catch {}
    }
  }
}

export function createPairMap(pairs: Pair[]) {
  const map = new Map<string, Pair[]>();

  for (const pair of pairs) {
    addPairByToken(map, pair, pair.token0);
    addPairByToken(map, pair, pair.token1);
  }

  return map;
}

function addPairByToken(map: Map<string, Pair[]>, pair: Pair, token: string) {
  if (!map.has(token)) map.set(token, []);
  map.get(token).push(pair);
}
