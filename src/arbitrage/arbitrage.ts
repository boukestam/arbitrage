import { mulDivRoundingUp } from "../util/math";
import { TokenInfo } from "../bot/tokens";
import { Pair } from "../exchanges/types";

export class Arbitrage {
  previous: Arbitrage | null;
  pair: Pair;
  token: string;
  amount: bigint;
  depth: number;

  constructor(
    previous: Arbitrage | null,
    pair: Pair | null,
    token: string,
    amount: bigint,
    depth: number
  ) {
    this.previous = previous;
    this.pair = pair;
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

  static calculateFee(amount: bigint, fee: bigint) {
    return mulDivRoundingUp(amount, fee, BigInt(1e6));
  }

  getHash() {
    return this.getPath().slice(1).map(p => p.pair.address).join('->');
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
