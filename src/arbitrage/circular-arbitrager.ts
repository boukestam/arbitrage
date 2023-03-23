import { ethers } from "ethers";
import { Arbitrage } from "./arbitrage";
import { LiquidityInfo } from "../exchanges/liquidity";
import { percentage } from "../util/math";
import { Exchange, Pair } from "../exchanges/types";
import { allTheSame, batch, createMap } from "../util/utils";
import { StartToken } from "./starters";
import { Queue } from "js-linked-queue";

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
      if (!pairs || pairs.length === 1) continue;

      const minAmount =
        pairs[0].pair.token0 === token.address
          ? pairs[0].minAmount0
          : pairs[0].minAmount1;
      const amount = minAmount / 100n;

      const fee = Arbitrage.calculateFee(amount, token.fee);

      const results = this.findForToken(token.address, amount, 8);

      for (const result of results) {
        if (result.amount - fee > amount) {
          arbitrages.push(result);
        }
      }
    }

    return arbitrages;
  }

  findForToken(token: string, amount: bigint, maxDepth: number): Arbitrage[] {
    const queue: Queue<Arbitrage> = new Queue<Arbitrage>([
      new Arbitrage(null, null, token, amount, 0),
    ]);

    const bestOutputByToken = new Map<string, bigint>();
    bestOutputByToken.set(token, amount);

    const arbitrages: Arbitrage[] = [];

    while (queue.size() > 0) {
      const node = queue.dequeue();

      const pairs = this.pairsByToken.get(node.token);

      for (const pair of pairs) {
        const otherToken = pair.pair.other(node.token);

        let amountOut = pair.pair.swap(node.token, node.amount);

        if (!bestOutputByToken.has(otherToken)) {
          bestOutputByToken.set(otherToken, amountOut);
        } else {
          const bestAmountOut = bestOutputByToken.get(otherToken);
          if (amountOut < bestAmountOut) continue;

          bestOutputByToken.set(otherToken, amountOut);
        }

        if (otherToken === token) {
          arbitrages.push(
            new Arbitrage(
              node,
              pair.pair,
              otherToken,
              amountOut,
              node.depth + 1
            )
          );
        } else if (node.depth + 1 < maxDepth) {
          queue.enqueue(
            new Arbitrage(
              node,
              pair.pair,
              otherToken,
              amountOut,
              node.depth + 1
            )
          );
        }
      }
    }

    return arbitrages;
  }

  getOutput(arbitrage: Arbitrage, input: bigint, fee: bigint) {
    const path = arbitrage.getPath();

    for (let i = 1; i < path.length; i++) path[i].pair.save();

    let amount = input;
    for (let i = 1; i < path.length; i++) {
      amount = path[i].pair.swap(path[i - 1].token, amount, true);
    }

    for (let i = 1; i < path.length; i++) path[i].pair.restore();

    return amount - Arbitrage.calculateFee(input, fee);
  }

  findOptimalAmounts(arbitrage: Arbitrage, fee: bigint) {
    const path = arbitrage.getPath();

    let input = path[0].amount;
    let output = this.getOutput(arbitrage, input, fee);

    const precision = 1000n;
    const step = precision / 10n;
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
      } else if (divider > precision) {
        divider -= step;
      } else {
        break;
      }
    }

    return { input, output };
  }
}
