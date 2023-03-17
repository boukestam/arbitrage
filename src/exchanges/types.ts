import ethers from "ethers";
import { Arbitrage } from "../arbitrage/arbitrage";

export type DEXType = "uniswap-v2";

export abstract class DEX {
  name: string;

  constructor(name: string) {
    this.name = name;
  }

  abstract getPairs(): Pair[];

  abstract load(provider: ethers.providers.JsonRpcBatchProvider): void;

  abstract getSwapTx(
    provider: ethers.providers.JsonRpcBatchProvider,
    input: bigint,
    path: Arbitrage[],
    to: string
  ): Promise<ethers.PopulatedTransaction>;

  abstract toJSON(): any;
  abstract fromJSON(data: any): void;
}

export abstract class Pair {
  address: string;
  token0: string;
  token1: string;

  constructor(address: string, token0: string, token1: string) {
    this.address = address;
    this.token0 = token0;
    this.token1 = token1;
  }

  abstract isTradable(): boolean;

  abstract reload(
    provider: ethers.providers.JsonRpcBatchProvider
  ): Promise<void>;

  other(token: string) {
    if (token === this.token0) return this.token1;
    return this.token0;
  }

  abstract convert(token: string, amount: bigint): bigint;
  abstract swap(token: string, amount: bigint): bigint;

  abstract reserve(token: string): bigint;
}
