import { ContractRunner } from "ethers";
import { createPairMap } from "./liquidity";
import { TokenInfo } from "./tokens";
import { Pair } from "./types";
import { batch } from "./utils";

export class Arbitrage {
  previous: Arbitrage | null;
  token: string;
  amount: bigint;
  depth: number;

  constructor(
    previous: Arbitrage | null,
    token: string,
    amount: bigint,
    depth: number
  ) {
    this.previous = previous;
    this.token = token;
    this.amount = amount;
    this.depth = depth;
  }

  getPath() {
    const path: Arbitrage[] = [];
    let current: Arbitrage = this;
    while (current) {
      path.unshift(current);
      current = current.previous;
    }
    return path;
  }

  getProfitPercentage() {
    return Number((this.amount * 10000n) / this.getPath()[0].amount) / 100;
  }

  toString(tokens: Map<string, TokenInfo>) {
    const path = this.getPath();
    const percentage = this.getProfitPercentage();

    return (
      percentage +
      "% - " +
      path.map((node) => tokens.get(node.token).symbol).join("->")
    );
  }
}

export class CircularArbitrager {
  pairs: Pair[];

  pairsByToken: Map<string, Pair[]>;
  usdRatioByToken: Map<string, bigint>;

  constructor(pairs: Pair[]) {
    this.pairs = pairs;
    this.pairsByToken = createPairMap(pairs);
  }

  async reload(provider: ContractRunner) {
    await batch(this.pairs, (pair) => pair.reload(provider), 1000);
  }

  find() {
    const arbitrages = [];

    for (const token of this.pairsByToken.keys()) {
      const amount = 100000000000000000000n;
      const results = this.findForToken(token, amount, 10);

      for (const result of results) {
        arbitrages.push(result);
      }
    }

    return arbitrages;
  }

  findForToken(token: string, amount: bigint, maxDepth: number) {
    const nodes: Arbitrage[] = [new Arbitrage(null, token, amount, 0)];

    const bestOutputByToken = new Map<string, bigint>();
    bestOutputByToken.set(token, amount);

    const arbitrages: Arbitrage[] = [];

    let i = 0;

    while (nodes.length > 0) {
      const node = nodes.shift();

      const pairs = this.pairsByToken.get(node.token);

      for (const pair of pairs) {
        const otherToken = pair.other(node.token);

        let amountOut;
        try {
          amountOut = pair.swap(node.token, node.amount);
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
            new Arbitrage(node, otherToken, amountOut, node.depth + 1)
          );
        } else if (node.depth + 1 < maxDepth) {
          nodes.push(
            new Arbitrage(node, otherToken, amountOut, node.depth + 1)
          );
        }
      }
    }

    return arbitrages;
  }
}
