import { ethers, Contract, BigNumber } from "ethers";
import { DEX, Pair } from "./types";
import { batch } from "../util/utils";
import { getEvents } from "../util/events";

import uniswapV3FactoryABI from "../abi/uniswap-v3-factory.json";
import uniswapV3PoolABI from "../abi/uniswap-v3-pool.json";
import uniswapV2RouterABI from "../abi/uniswap-v2-router.json";
import erc20ABI from "../abi/erc20.json";

export class UniswapV3 extends DEX {
  factory: string;
  router: string;
  pairs: UniswapV3Pair[];

  constructor(name: string, factory: string, router: string) {
    super(name);

    this.factory = factory;
    this.router = router;
    this.pairs = [];
  }

  getPairs() {
    return this.pairs;
  }

  async load(provider: ethers.providers.JsonRpcBatchProvider) {
    const factory = new Contract(this.factory, uniswapV3FactoryABI, provider);

    const events = await getEvents(factory, ['PoolCreated'], 12369621, 16772418, 2500, 10, true);

    this.pairs = await batch(
      events,
      async (event) => {
        const address = event.args.pool;
        const pair = new Contract(address, uniswapV3PoolABI, provider);

        const token0 = event.args.token0;
        const token1 = event.args.token1;
        const fee: BigNumber = event.args.fee
        const tickSpacing: BigNumber = event.args.tickSpacing;

        const token0Contract = new Contract(token0, erc20ABI, provider)
        const token1Contract = new Contract(token1, erc20ABI, provider)

        let reserve0: BigNumber;
        let reserve1: BigNumber;
        
        try {
          reserve0 = await token0Contract.balanceOf(address);
          reserve1 = await token1Contract.balanceOf(address);
        } catch (e) {
          reserve0 = BigNumber.from(0);
          reserve1 = BigNumber.from(0);
        }

        return new UniswapV3Pair(
          address,
          token0,
          token1,
          reserve0.toBigInt(),
          reserve1.toBigInt(),
          BigInt(fee.toString()),
          BigInt(tickSpacing.toString())
        );
      },
      1000,
      true
    );
  }

  async getSwapTx(provider: ethers.providers.JsonRpcBatchProvider, input: bigint, path: string[], to: string) {
    const router = new Contract(
      this.router,
      uniswapV2RouterABI,
      provider
    );
    
    const swapTx = await router.populateTransaction.swapExactTokensForTokens(
      input,
      input,
      path,
      to,
      Math.floor(Date.now() / 1000) + 600 // 10 minutes from now
    );

    return swapTx;
  }

  toJSON() {
    return {
      pairs: this.pairs.map((pair) => ({
        address: pair.address,
        token0: pair.token0,
        token1: pair.token1,
        reserve0: pair.reserve0.toString(),
        reserve1: pair.reserve1.toString(),
        fee: pair.fee.toString(),
        tickSpacing: pair.tickSpacing.toString(),
      })),
    };
  }

  fromJSON(data: any) {
    this.pairs = data.pairs.map(
      (item: any) =>
        new UniswapV3Pair(
          item.address,
          item.token0,
          item.token1,
          BigInt(item.reserve0),
          BigInt(item.reserve1),
          BigInt(item.fee),
          BigInt(item.tickSpacing)
        )
    );
  }
}

export class UniswapV3Pair extends Pair {
  reserve0: bigint;
  reserve1: bigint;

  fee: bigint;
  tickSpacing: bigint;

  constructor(
    address: string,
    token0: string,
    token1: string,
    reserve0: bigint,
    reserve1: bigint,
    fee: bigint, 
    tickSpacing: bigint
  ) {
    super(address, token0, token1);

    this.reserve0 = reserve0;
    this.reserve1 = reserve1;

    this.fee = fee;
    this.tickSpacing = tickSpacing;
  }

  getContract(provider: ethers.providers.JsonRpcBatchProvider) {
    return new Contract(this.address, uniswapV3PoolABI, provider);
  }

  async reload(provider: ethers.providers.JsonRpcBatchProvider) {
    const contract = this.getContract(provider);
    
    const reserve0: BigNumber = await contract.balance0();
    const reserve1: BigNumber = await contract.balance1();

    this.reserve0 = reserve0.toBigInt();
    this.reserve1 = reserve1.toBigInt();
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

  swap(token: string, amount: bigint): bigint {
    if (this.reserve0 === 0n || this.reserve1 === 0n)
      throw new Error("Zero reserve");

    const amountWithFee = amount * (BigInt(1e6) - this.fee);

    if (token === this.token0) {
      const numerator = amountWithFee * this.reserve1;
      const denominator = this.reserve0 * BigInt(1e6) + amountWithFee;
      return numerator / denominator;
    }

    if (token === this.token1) {
      const numerator = amountWithFee * this.reserve0;
      const denominator = this.reserve1 * BigInt(1e6) + amountWithFee;
      return numerator / denominator;
    }

    throw new Error("Invalid token for pair");
  }

  reserve(token: string): bigint {
    if (token === this.token0) return this.reserve0;
    if (token === this.token1) return this.reserve1;

    throw new Error("Invalid token for pair");
  }
}
