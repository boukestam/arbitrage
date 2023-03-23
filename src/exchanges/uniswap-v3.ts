import { ethers, Contract, BigNumber } from "ethers";
import { Exchange, Pair } from "./types";
import { batch, bigintToHex } from "../util/utils";
import { getEvents } from "../util/events";
import {
  getTickAtSqrtRatio,
  getSqrtRatioAtTick,
  getAmount0ForLiquidity,
  getAmount1ForLiquidity,
} from "../util/uniswap-v3-math";

import uniswapV3FactoryABI from "../abi/uniswap-v3-factory.json";
import uniswapV3PoolABI from "../abi/uniswap-v3-pool.json";
import uniswapV3RouterABI from "../abi/uniswap-v3-router.json";
import { Arbitrage } from "../arbitrage/arbitrage";

const PRICE_PRECISION = 10n ** 18n;

export class UniswapV3 extends Exchange {
  factory: string;
  router: string;
  pairs: UniswapV3Pair[];

  fromBlock: number;
  toBlock: number;

  constructor(
    name: string,
    factory: string,
    router: string,
    fromBlock: number,
    toBlock: number
  ) {
    super(name);

    this.factory = factory;
    this.router = router;
    this.pairs = [];

    this.fromBlock = fromBlock;
    this.toBlock = toBlock;
  }

  getPairs() {
    return this.pairs;
  }

  async load(provider: ethers.providers.BaseProvider) {
    const factory = new Contract(this.factory, uniswapV3FactoryABI, provider);

    const events = await getEvents(
      factory,
      ["PoolCreated"],
      this.fromBlock,
      this.toBlock,
      2500,
      10,
      true,
      true
    );

    this.pairs = await batch(
      events,
      async (event) => {
        const address = event.args.pool;
        const pair = new Contract(address, uniswapV3PoolABI, provider);

        const token0 = event.args.token0;
        const token1 = event.args.token1;
        const fee = BigInt(event.args.fee.toString());
        const tickSpacing = BigInt(event.args.tickSpacing.toString());

        const slot0 = await pair.slot0();
        const tick = BigInt(slot0.tick.toString());

        const liquidity: BigNumber = await pair.liquidity();
        const tickLiquidity: BigNumber = (
          await pair.ticks(tick - (tick % tickSpacing))
        ).liquidityGross;

        return new UniswapV3Pair(
          this,
          address,
          token0,
          token1,
          fee,
          BigInt(slot0.sqrtPriceX96.toString()),
          BigInt(liquidity.toString()),
          tick,
          tickSpacing,
          BigInt(tickLiquidity.toString())
        );
      },
      1000,
      true
    );
  }

  getContract(provider: ethers.providers.Provider | ethers.Signer) {
    return new Contract(this.router, uniswapV3RouterABI, provider);
  }

  static encodePath(path: string[], fees: bigint[]): string {
    if (path.length != fees.length + 1) {
      throw new Error("path/fee lengths do not match");
    }

    let encoded = "0x";
    for (let i = 0; i < fees.length; i++) {
      // 20 byte encoding of the address
      encoded += String(path[i]).slice(2);
      // 3 byte encoding of the fee
      encoded += bigintToHex(fees[i], 3);
    }
    // encode the final token
    encoded += path[path.length - 1].slice(2);

    return encoded.toLowerCase();
  }

  toJSON() {
    return {
      pairs: this.pairs.map((pair) => ({
        address: pair.address,
        token0: pair.token0,
        token1: pair.token1,
        fee: pair.fee.toString(),
        sqrtPriceX96: pair.sqrtPriceX96.toString(),
        liquidity: pair.liquidity.toString(),
        tick: pair.tick.toString(),
        tickSpacing: pair.tickSpacing.toString(),
        tickLiquidity: pair.tickLiquidity.toString(),
      })),
    };
  }

  fromJSON(data: any) {
    this.pairs = data.pairs.map(
      (item: any) =>
        new UniswapV3Pair(
          this,
          item.address,
          item.token0,
          item.token1,
          BigInt(item.fee),
          BigInt(item.sqrtPriceX96),
          BigInt(item.liquidity),
          BigInt(item.tick),
          BigInt(item.tickSpacing),
          BigInt(item.tickLiquidity)
        )
    );
  }
}

export class UniswapV3Pair extends Pair {
  reserve0: bigint;
  reserve1: bigint;

  fee: bigint;
  sqrtPriceX96: bigint;
  liquidity: bigint;

  tick: bigint;
  tickSpacing: bigint;
  tickLiquidity: bigint;

  price: bigint;

  constructor(
    exchange: UniswapV3,
    address: string,
    token0: string,
    token1: string,
    fee: bigint,
    sqrtPriceX96: bigint,
    liquidity: bigint,
    tick: bigint,
    tickSpacing: bigint,
    tickLiquidity: bigint
  ) {
    super(exchange, address, token0, token1);

    this.fee = fee;
    this.sqrtPriceX96 = sqrtPriceX96;
    this.liquidity = liquidity;

    this.tick = tick;
    this.tickSpacing = tickSpacing;
    this.tickLiquidity = tickLiquidity;

    if (sqrtPriceX96 > 0) {
      const tickLower = this.tick - (this.tick % tickSpacing);
      const tickUpper = tickLower + tickSpacing;

      const sqrtRatioAX96 = getSqrtRatioAtTick(tickLower);
      const sqrtRatioBX96 = getSqrtRatioAtTick(tickUpper);

      this.reserve0 = getAmount0ForLiquidity(
        sqrtRatioAX96,
        sqrtRatioBX96,
        liquidity
      );
      this.reserve1 = getAmount1ForLiquidity(
        sqrtRatioAX96,
        sqrtRatioBX96,
        liquidity
      );
    } else {
      this.reserve0 = 0n;
      this.reserve1 = 0n;
    }

    this.price = UniswapV3Pair.getPriceFromSqrtPriceX96(sqrtPriceX96);
  }

  isTradable() {
    return (
      this.liquidity > 0 &&
      this.reserve0 > 0 &&
      this.reserve1 > 0 &&
      this.tickLiquidity != this.liquidity &&
      this.price > 0
    );
  }

  getContract(provider: ethers.providers.Provider | ethers.Signer) {
    return new Contract(this.address, uniswapV3PoolABI, provider);
  }

  async reload(provider: ethers.providers.BaseProvider) {
    const contract = new Contract(this.address, uniswapV3PoolABI, provider);

    const slot0 = await contract.slot0();

    this.sqrtPriceX96 = BigInt(slot0.sqrtPriceX96.toString());
    this.price = UniswapV3Pair.getPriceFromSqrtPriceX96(this.sqrtPriceX96);
  }

  convert(token: string, amount: bigint): bigint {
    if (this.reserve0 === 0n || this.reserve1 === 0n)
      throw new Error("Zero reserve");

    if (this.price === 0n) {
      throw new Error("Zero price");
    }

    if (token === this.token0) return (this.price * amount) / PRICE_PRECISION;
    if (token === this.token1) return (amount * PRICE_PRECISION) / this.price;

    throw new Error("Invalid token for pair");
  }

  swap(token: string, amount: bigint): bigint {
    return (
      (this.convert(token, amount) * (BigInt(1e6) - this.fee)) / BigInt(1e6)
    );
  }

  reserve(token: string): bigint {
    if (token === this.token0) return this.reserve0;
    if (token === this.token1) return this.reserve1;

    throw new Error("Invalid token for pair");
  }

  static getPriceFromSqrtPriceX96(sqrtPriceX96: bigint): bigint {
    return (sqrtPriceX96 * sqrtPriceX96 * PRICE_PRECISION) >> 192n;
  }

  save() {
    // TODO: implement
  }

  restore() {
    // TODO: implement
  }
}
