import { mulDivRoundingUp } from "./math";
import { TokenInfo } from "./tokens";

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

  static calculateFee(amount: bigint, fee: number) {
    return mulDivRoundingUp(amount, BigInt(fee), BigInt(1e6));
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
