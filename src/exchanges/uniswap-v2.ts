import { ethers, BigNumber, Contract } from "ethers";
import { Exchange, Pair, DEXType } from "./types";
import { batch } from "../util/utils";

import uniswapV2FactoryABI from "../abi/uniswap-v2-factory.json";
import uniswapV2PairABI from "../abi/uniswap-v2-pair.json";
import uniswapV2RouterABI from "../abi/uniswap-v2-router.json";
import { Arbitrage } from "../arbitrage/arbitrage";

export class UniswapV2 extends Exchange {
  factory: string;
  router: string;
  pairs: UniswapV2Pair[];

  constructor(name: string, factory: string, router: string) {
    super(name);

    this.factory = factory;
    this.router = router;
    this.pairs = [];
  }

  getPairs() {
    return this.pairs;
  }

  async load(provider: ethers.providers.BaseProvider) {
    const factory = new Contract(this.factory, uniswapV2FactoryABI, provider);

    const count = (await factory.allPairsLength()).toNumber();
    const indexes = [];
    for (let i = 0; i < count; i++) indexes.push(i);

    this.pairs = await batch(
      indexes,
      async (i) => {
        const address = await factory.allPairs(i);
        const pair = new Contract(address, uniswapV2PairABI, provider);

        const token0 = await pair.token0();
        const token1 = await pair.token1();
        const { _reserve0, _reserve1 } = await pair.getReserves();
        return new UniswapV2Pair(
          this,
          address,
          token0,
          token1,
          _reserve0.toBigInt(),
          _reserve1.toBigInt()
        );
      },
      1000,
      true
    );
  }

  getContract(provider: ethers.providers.Provider | ethers.Signer) {
    return new Contract(this.router, uniswapV2RouterABI, provider);
  }

  toJSON() {
    return {
      pairs: this.pairs.map((pair) => ({
        address: pair.address,
        token0: pair.token0,
        token1: pair.token1,
        reserve0: pair.reserve0.toString(),
        reserve1: pair.reserve1.toString(),
      })),
    };
  }

  fromJSON(data: any) {
    this.pairs = data.pairs.map(
      (item: any) =>
        new UniswapV2Pair(
          this,
          item.address,
          item.token0,
          item.token1,
          BigInt(item.reserve0),
          BigInt(item.reserve1)
        )
    );
  }
}

export class UniswapV2Pair extends Pair {
  reserve0: bigint;
  reserve1: bigint;

  reserve0BeforeUpdate: bigint;
  reserve1BeforeUpdate: bigint;

  constructor(
    exchange: UniswapV2,
    address: string,
    token0: string,
    token1: string,
    reserve0: bigint,
    reserve1: bigint
  ) {
    super(exchange, address, token0, token1);

    this.reserve0 = reserve0;
    this.reserve1 = reserve1;
  }

  isTradable() {
    return this.reserve0 > 0 && this.reserve1 > 0;
  }

  getContract(provider: ethers.providers.Provider | ethers.Signer) {
    return new Contract(this.address, uniswapV2PairABI, provider);
  }

  async reload(provider: ethers.providers.BaseProvider) {
    const contract = this.getContract(provider);
    const { _reserve0, _reserve1 } = await contract.getReserves();
    this.reserve0 = _reserve0.toBigInt();
    this.reserve1 = _reserve1.toBigInt();
  }

  convert(token: string, amount: bigint): bigint {
    if (token === this.token0) {
      if (this.reserve0 === 0n) throw new Error("Zero reserve");
      return (this.reserve1 * amount) / this.reserve0;
    }

    if (token === this.token1) {
      if (this.reserve1 === 0n) throw new Error("Zero reserve");
      return (this.reserve0 * amount) / this.reserve1;
    }

    throw new Error("Invalid token for pair");
  }

  swap(token: string, amount: bigint, update: boolean = false): bigint {
    if (this.reserve0 === 0n || this.reserve1 === 0n)
      throw new Error("Zero reserve");

    const amountWithFee = amount * 997n;

    if (token === this.token0) {
      const numerator = amountWithFee * this.reserve1;
      const denominator = this.reserve0 * 1000n + amountWithFee;
      const output = numerator / denominator;

      if (update) {
        this.reserve0 += amount;
        this.reserve1 -= output;
      }

      return output;
    }

    if (token === this.token1) {
      const numerator = amountWithFee * this.reserve0;
      const denominator = this.reserve1 * 1000n + amountWithFee;
      const output = numerator / denominator;

      if (update) {
        this.reserve0 -= output;
        this.reserve1 += amount;
      }

      return output;
    }

    throw new Error("Invalid token for pair");
  }

  reserve(token: string): bigint {
    if (token === this.token0) return this.reserve0;
    if (token === this.token1) return this.reserve1;

    throw new Error("Invalid token for pair");
  }

  save() {
    this.reserve0BeforeUpdate = this.reserve0;
    this.reserve1BeforeUpdate = this.reserve1;
  }

  restore() {
    this.reserve0 = this.reserve0BeforeUpdate;
    this.reserve1 = this.reserve1BeforeUpdate;
  }
}
