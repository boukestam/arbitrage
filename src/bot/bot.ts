import { ethers, Wallet } from "ethers";
import { CircularArbitrager } from "../arbitrage/circular-arbitrager";
import { DEX, Pair } from "../exchanges/types";
import { loadTokens, TokenInfo } from "./tokens";
import { batch, sleep } from "../util/utils";
import { findLiquidPairs, LiquidityInfo } from "../exchanges/liquidity";
import {
  executeFlashLoanArbitrage,
  verifyFlashLoanArbitrage,
} from "../arbitrage/flash-loan";
import { blocked, constants } from "./config";
import { formatUnits } from "ethers/lib/utils";
import { Arbitrage } from "../arbitrage/arbitrage";
import { StartToken } from "../arbitrage/starters";

interface ProfitableArbitrage {
  arbitrage: Arbitrage;
  input: bigint;
  token: TokenInfo;
  profit: bigint;
  profitInUSD: bigint;
  gasInETH: bigint;
  gasInUSD: bigint;
  gasInToken: bigint;
  netProfitInUSD: bigint;
  gasLimit: bigint;
  gasPrice: bigint;
  args: any[];
}

export class Bot {
  provider: ethers.providers.BaseProvider;
  dexes: DEX[];
  stable: string;
  starters: StartToken[];

  pairs: Pair[] = [];
  tokens = new Map<string, TokenInfo>();

  ethPrice: bigint;
  minLiquidityInUSDT: bigint;

  constructor(
    provider: ethers.providers.BaseProvider,
    dexes: DEX[],
    stable: string,
    starters: StartToken[]
  ) {
    this.provider = provider;
    this.dexes = dexes;
    this.stable = stable;
    this.starters = starters;

    this.ethPrice = constants.ETH_PRICE;
    this.minLiquidityInUSDT = constants.MIN_LIQUIDITY_IN_USDT;
  }

  async load() {
    for (const dex of this.dexes) {
      await dex.loadFromFile(this.provider);

      for (const pair of dex.getPairs()) {
        this.pairs.push(pair);
      }
    }

    const tokens = new Set<string>();
    for (const pair of this.pairs) {
      tokens.add(pair.token0);
      tokens.add(pair.token1);
    }

    console.log("Loading tokens...");

    this.tokens = await loadTokens(Array.from(tokens.values()), this.provider);
  }

  async run() {
    let nextBlock = (await this.provider.getBlockNumber()) + 1;

    console.log("Finding liquid pairs");
    let initialLiquidPairs = findLiquidPairs(
      this.pairs,
      this.stable,
      this.minLiquidityInUSDT / 2n
    );
    console.log("Initial liquid pairs: " + initialLiquidPairs.length);

    await batch(
      initialLiquidPairs,
      (pair) => pair.pair.reload(this.provider),
      1000,
      true
    );

    let liquidPairs = findLiquidPairs(
      initialLiquidPairs.map((pair) => pair.pair),
      this.stable,
      this.minLiquidityInUSDT
    );
    console.log("Final liquid pairs: " + liquidPairs.length);

    liquidPairs = liquidPairs.filter((pair) => {
      if (blocked.has(pair.pair.token0) || blocked.has(pair.pair.token1))
        return false;
      // if (this.tokens.get(pair.pair.token0).symbol === "---") return false;
      // if (this.tokens.get(pair.pair.token1).symbol === "---") return false;
      return true;
    });
    console.log("Not blocked pairs: " + liquidPairs.length);

    while (true) {
      const pairsToUpdate = new Set<Pair>();

      const latestBlock = await this.provider.getBlock("latest");
      while (nextBlock <= latestBlock.number) {
        const block = await this.provider.getBlockWithTransactions(nextBlock);

        const receipts = await batch(
          block.transactions,
          (tx) => this.provider.getTransactionReceipt(tx.hash),
          1000
        );

        for (const receipt of receipts) {
          for (const log of receipt.logs) {
            const pair = liquidPairs.find(
              (pair) => pair.pair.address === log.address
            );
            if (pair) pairsToUpdate.add(pair.pair);
          }
        }

        nextBlock++;
      }

      if (pairsToUpdate.size > 0) {
        await batch(
          Array.from(pairsToUpdate.values()),
          (pair) => pair.reload(this.provider),
          1000
        );

        const arbitragePairs = findLiquidPairs(
          liquidPairs.map((pair) => pair.pair),
          this.stable,
          this.minLiquidityInUSDT
        );

        await this.findArbitrages(arbitragePairs, nextBlock);
      }

      // 12 seconds is the average block time
      let sleepTime = latestBlock.timestamp * 1000 + 12000 - Date.now();
      sleepTime = Math.max(sleepTime, 1000); // sleep at least 1 second
      await sleep(sleepTime);
    }
  }

  async findArbitrages(arbitragePairs: LiquidityInfo[], nextBlock: number) {
    const arbitrager = new CircularArbitrager(arbitragePairs);

    const arbitrages = arbitrager.find(this.starters);

    arbitrages.sort(
      (a, b) => b.getProfitPercentage() - a.getProfitPercentage()
    );

    console.log("Found " + arbitrages.length + " arbitrages");

    for (const arbitrage of arbitrages.slice(0, 10)) {
      console.log(arbitrage.toString(this.tokens));
    }

    const results = await batch(
      arbitrages,
      async (arbitrage) => {
        const token = this.tokens.get(arbitrage.token);

        const pool = this.starters.find(
          (starter) => starter.address === arbitrage.token
        );

        const { input, output } = arbitrager.findOptimalAmounts(
          arbitrage,
          pool.fee
        );

        try {
          const { profit, gas, args } = await verifyFlashLoanArbitrage(
            this.provider,
            this.dexes[0],
            input,
            arbitrage.getPath(),
            pool.v3Pool,
            pool.isToken0,
            pool.fee
          );

          return { token, pool, input, profit, gas, args };
        } catch (e) {
          return null;
        }
      },
      100
    );

    const gasData = await this.provider.getFeeData();

    const profitableArbitrages: ProfitableArbitrage[] = [];

    for (let i = 0; i < arbitrages.length; i++) {
      const arbitrage = arbitrages[i];
      const result = results[i];

      if (!result) continue;

      const { token, pool, input, profit, gas, args } = result;

      const minLiquidityOfToken =
        arbitragePairs.find((pair) => pair.pair.token0 === token.address)
          ?.minAmount0 ||
        arbitragePairs.find((pair) => pair.pair.token1 === token.address)
          ?.minAmount1;

      const profitInUSD =
        (profit * this.minLiquidityInUSDT) / minLiquidityOfToken;

      const gasPrice = gasData.gasPrice.toBigInt();
      const gasInETH = gas * gasPrice;
      const gasInUSD = (gasInETH * this.ethPrice) / BigInt(1e12);

      const netProfitInUSD = profitInUSD - gasInUSD;

      if (netProfitInUSD < 0) continue;

      const gasInToken = (profit * gasInUSD) / profitInUSD;

      const info: ProfitableArbitrage = {
        arbitrage,
        input,
        token,
        profit,
        profitInUSD,
        gasInETH,
        gasInUSD,
        gasInToken,
        netProfitInUSD,
        gasLimit: gas,
        gasPrice: gasPrice,
        args,
      };

      profitableArbitrages.push(info);
    }

    if (profitableArbitrages.length > 0) {
      profitableArbitrages.sort((a, b) =>
        Number(b.netProfitInUSD - a.netProfitInUSD)
      );

      const wallet = new Wallet(
        constants.PRIVATE_KEY,
        this.provider
      );

      const arbitrage = profitableArbitrages[0];

      console.log("Time: " + new Date().toLocaleString());
      console.log(arbitrage.arbitrage.toString(this.tokens));
      console.log(
        "Optimal input: " +
          formatUnits(arbitrage.input, arbitrage.token.decimals) +
          " " +
          arbitrage.token.symbol
      );
      console.log(
        "Profit: " +
          formatUnits(arbitrage.profit, arbitrage.token.decimals) +
          " " +
          arbitrage.token.symbol
      );
      console.log("Profit in USD: " + formatUnits(arbitrage.profitInUSD, 6));
      console.log("Gas fee in USD: " + formatUnits(arbitrage.gasInUSD, 6));

      console.log(
        "Minimum output: " +
          formatUnits(arbitrage.gasInToken, arbitrage.token.decimals) +
          " " +
          arbitrage.token.symbol
      );

      let minerRewardInETH = 0n;

      // Increase the gas if there is a big profit
      if (arbitrage.netProfitInUSD > 10000000n) {
        const minerRewardInUSD = arbitrage.netProfitInUSD - 10000000n;

        minerRewardInETH =
          (arbitrage.gasInETH * minerRewardInUSD) / arbitrage.gasInUSD;

        arbitrage.gasInToken =
          (arbitrage.gasInToken * (arbitrage.gasInUSD + minerRewardInUSD)) /
          arbitrage.gasInUSD;

        console.log("Miner reward in USD: " + formatUnits(minerRewardInUSD, 6));
        console.log(
          "Miner reward in ETH: " + formatUnits(minerRewardInETH, 18)
        );

        console.log(
          "Increased minimum output: " +
            formatUnits(arbitrage.gasInToken, arbitrage.token.decimals) +
            " " +
            arbitrage.token.symbol
        );
      }

      try {
        const receipts = await executeFlashLoanArbitrage(
          this.provider,
          wallet,
          arbitrage.args,
          arbitrage.gasInToken,
          nextBlock,
          arbitrage.gasLimit,
          arbitrage.gasPrice,
          minerRewardInETH
        );

        console.log("Arbitrage successfull");
        console.log(receipts);
      } catch (e) {
        console.log("Arbitrage failed");
        console.error(e);
      }
    }
  }
}
