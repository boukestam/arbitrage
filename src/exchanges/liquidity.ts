import { Pair } from "./types";
import { createMap } from "../util/utils";

export interface LiquidityInfo {
  pair: Pair;
  minAmount0: bigint;
  minAmount1: bigint;
}

export function findLiquidPairs(
  pairs: Pair[],
  stable: string,
  minStableAmount: bigint
): LiquidityInfo[] {
  pairs = pairs.filter((pair) => pair.isTradable());

  const pairsByToken = createMap(pairs, (pair) => [pair.token0, pair.token1]);
  const output: LiquidityInfo[] = [];

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
  output: LiquidityInfo[],
  visited: Set<Pair>,
  pairsByToken: Map<string, Pair[]>,
  token: string,
  minAmount: bigint,
  depth: number
) {
  const pairs = pairsByToken.get(token);

  const nextLayer: { token: string; minAmount: bigint }[] = [];

  for (const pair of pairs) {
    if (visited.has(pair)) continue;
    visited.add(pair);

    if (pair.reserve(token) < minAmount) continue;

    const otherMinAmount = pair.convert(token, minAmount);
    const otherToken = pair.other(token);

    if (pair.reserve(otherToken) < otherMinAmount) continue;

    output.push({
      pair,
      minAmount0: pair.token0 === token ? minAmount : otherMinAmount,
      minAmount1: pair.token0 === token ? otherMinAmount : minAmount,
    });

    if (depth === 0) continue;

    nextLayer.push({
      token: otherToken,
      minAmount: otherMinAmount,
    });
  }

  for (const { token, minAmount } of nextLayer) {
    try {
      findLiquidPairsRecursive(
        output,
        visited,
        pairsByToken,
        token,
        minAmount,
        depth - 1
      );
    } catch {}
  }
}
