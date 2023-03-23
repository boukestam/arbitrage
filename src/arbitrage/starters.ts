import { constants } from "../bot/config";
import { findLiquidPairs } from "../exchanges/liquidity";
import { UniswapV3, UniswapV3Pair } from "../exchanges/uniswap-v3";

export interface StartToken {
  address: string;
  v3Pool: string;
  isToken0: boolean;
  fee: bigint;
}

export function getStarters(uniswapV3: UniswapV3, stable: string) {
  const liquidV3Pairs = findLiquidPairs(
    uniswapV3.pairs,
    stable,
    constants.MIN_LIQUIDITY_IN_USDT / 10n
  );

  const starters: StartToken[] = [];

  const add = (pair: UniswapV3Pair, token: string, isToken0: boolean) => {
    const existing = starters.find((starter) => starter.address === token);
    if (existing) {
      if (existing.fee > pair.fee) {
        existing.v3Pool = pair.address;
        existing.isToken0 = isToken0;
        existing.fee = pair.fee;
      }
    } else {
      starters.push({
        address: token,
        v3Pool: pair.address,
        isToken0: isToken0,
        fee: pair.fee,
      });
    }
  };

  for (const liquidPair of liquidV3Pairs) {
    const pair = liquidPair.pair as UniswapV3Pair;

    add(pair, pair.token0, true);
    add(pair, pair.token1, false);
  }

  return starters;
}
