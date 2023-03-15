import { ethers } from "ethers";
import { Arbitrage } from "./arbitrage";
import { StartToken } from "../config";
import { LiquidityInfo } from "../exchanges/liquidity";
import { percentage } from "../util/math";
import { Pair } from "../exchanges/types";
import { batch, createMap } from "../util/utils";

export class CircularArbitrager {
  pairs: LiquidityInfo[];

  pairsByToken: Map<string, LiquidityInfo[]>;
  usdRatioByToken: Map<string, bigint>;

  constructor(pairs: LiquidityInfo[]) {
    this.pairs = pairs;
    this.pairsByToken = createMap(pairs, (pair) => [
      pair.pair.token0,
      pair.pair.token1,
    ]);
  }

  find(starters: StartToken[]): Arbitrage[] {
    const arbitrages = [];

    for (const token of starters) {
      const pairs = this.pairsByToken.get(token.address);
      const minAmount =
        pairs[0].pair.token0 === token.address
          ? pairs[0].minAmount0
          : pairs[0].minAmount1;
      const amount = minAmount / 10n;

      const fee = Arbitrage.calculateFee(amount, token.fee);

      const results = this.findForToken(token.address, amount, 10);

      for (const result of results) {
        if (result.amount - fee > amount) {
          arbitrages.push(result);
        }
      }
    }

    return arbitrages;
  }

  findForToken(token: string, amount: bigint, maxDepth: number) {
    const nodes: Arbitrage[] = [new Arbitrage(null, null, token, amount, 0)];

    const bestOutputByToken = new Map<string, bigint>();
    bestOutputByToken.set(token, amount);

    const arbitrages: Arbitrage[] = [];

    while (nodes.length > 0) {
      const node = nodes.shift();

      const pairs = this.pairsByToken.get(node.token);

      for (const pair of pairs) {
        const otherToken = pair.pair.other(node.token);

        let amountOut;
        try {
          amountOut = pair.pair.swap(node.token, node.amount);
          if (amountOut === 0n) continue;
        } catch {
          continue;
        }

        if (!bestOutputByToken.has(otherToken)) {
          bestOutputByToken.set(otherToken, amountOut);
        } else {
          const bestAmountOut = bestOutputByToken.get(otherToken);
          if (amountOut < bestAmountOut) continue;

          bestOutputByToken.set(otherToken, amountOut);
        }

        if (otherToken === token) {
          arbitrages.push(
            new Arbitrage(node, pair.pair, otherToken, amountOut, node.depth + 1)
          );
        } else if (node.depth + 1 < maxDepth) {
          nodes.push(
            new Arbitrage(node, pair.pair, otherToken, amountOut, node.depth + 1)
          );
        }
      }
    }

    return arbitrages;
  }

  getOutput(arbitrage: Arbitrage, input: bigint, fee: number) {
    const path = arbitrage.getPath();

    let amount = input;
    for (let i = 0; i < path.length - 1; i++) {
      const pair = this.pairsByToken
        .get(path[i].token)
        .find((pair) => pair.pair.other(path[i].token) === path[i + 1].token);

      amount = pair.pair.swap(path[i].token, amount);
    }

    return amount - input - Arbitrage.calculateFee(input, fee);
  }

  findOptimalAmounts(arbitrage: Arbitrage, fee: number) {
    const path = arbitrage.getPath();

    let input = path[0].amount;
    let output = arbitrage.amount;

    const precision = BigInt(1e6);
    let divider = precision * 2n;

    while (true) {
      const lessInput = (input * precision) / divider;
      const moreInput = (input * divider) / precision;

      const lessOutput = this.getOutput(arbitrage, lessInput, fee);
      const moreOutput = this.getOutput(arbitrage, moreInput, fee);

      if (lessOutput - lessInput > output - input) {
        input = lessInput;
        output = lessOutput;
      } else if (moreOutput - moreInput > output - input) {
        input = moreInput;
        output = moreOutput;
      } else if (divider > 100) {
        divider /= 2n;
      } else {
        break;
      }
    }

    return { input, output };
  }
}
