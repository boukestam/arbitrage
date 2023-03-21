import ethers from "ethers";
import { Arbitrage } from "../arbitrage/arbitrage";
import fs from "fs";

export type DEXType = "uniswap-v2";

export abstract class Exchange {
  name: string;

  constructor(name: string) {
    this.name = name;
  }

  abstract getPairs(): Pair[];

  abstract load(provider: ethers.providers.BaseProvider): void;

  async loadFromFile(provider: ethers.providers.BaseProvider, dir: string) {
    const file = "data/" + dir + "/" + this.name + ".json";

    console.log("Loading dex: " + this.name + "...");

    if (fs.existsSync(file)) {
      const json = JSON.parse(fs.readFileSync(file).toString());
      this.fromJSON(json);
    } else {
      await this.load(provider);
      const json = this.toJSON();
      fs.writeFileSync(file, JSON.stringify(json));
    }
  }

  abstract getSwapTx(
    provider: ethers.providers.BaseProvider,
    input: bigint,
    minOutput: bigint,
    path: Arbitrage[],
    to: string
  ): Promise<ethers.PopulatedTransaction>;

  abstract toJSON(): any;
  abstract fromJSON(data: any): void;
}

export abstract class Pair {
  exchange: Exchange;
  address: string;
  token0: string;
  token1: string;

  constructor(
    exchange: Exchange,
    address: string,
    token0: string,
    token1: string
  ) {
    this.exchange = exchange;
    this.address = address;
    this.token0 = token0;
    this.token1 = token1;
  }

  abstract isTradable(): boolean;

  abstract reload(provider: ethers.providers.BaseProvider): Promise<void>;

  other(token: string) {
    if (token === this.token0) return this.token1;
    return this.token0;
  }

  abstract convert(token: string, amount: bigint): bigint;
  abstract swap(token: string, amount: bigint, update?: boolean): bigint;

  abstract reserve(token: string): bigint;

  abstract save(): void;
  abstract restore(): void;
}
