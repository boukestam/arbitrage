import ethers, { Wallet } from "ethers";
import { CircularArbitrager } from "./circular-arbitrager";
import { DEX, Pair } from "./types";
import fs from "fs";
import { loadTokens, TokenInfo } from "./tokens";
import { batch, sleep } from "./utils";
import { findLiquidPairs } from "./liquidity";
import {
  executeFlashLoanArbitrage,
  verifyFlashLoanArbitrage,
} from "./flash-loan";
import { blocked, starters } from "./config";
import { formatUnits } from "ethers/lib/utils";
import { Arbitrage } from "./arbitrage";

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
  provider: ethers.providers.JsonRpcBatchProvider;
  dexes: DEX[];
  stable: string;

  pairs: Pair[] = [];
  tokens = new Map<string, TokenInfo>();

  constructor(
    provider: ethers.providers.JsonRpcBatchProvider,
    dexes: DEX[],
    stable: string
  ) {
    this.provider = provider;
    this.dexes = dexes;
    this.stable = stable;
  }

  async load() {
    for (const dex of this.dexes) {
      const file = "data/" + dex.name + ".json";

      console.log("Loading dex: " + dex.name + "...");

      if (fs.existsSync(file)) {
        const json = JSON.parse(fs.readFileSync(file).toString());
        dex.fromJSON(json);
      } else {
        await dex.load(this.provider);
        const json = dex.toJSON();
        fs.writeFileSync(file, JSON.stringify(json));
      }

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
    const ETH_PRICE = BigInt(process.env.ETH_PRICE as string);
    const minLiquidityInUSDT = BigInt(
      process.env.MIN_LIQUIDITY_IN_USDT as string
    );

    console.log("Finding liquid pairs");
    let initialLiquidPairs = findLiquidPairs(
      this.pairs,
      this.stable,
      minLiquidityInUSDT / 2n
    );
    console.log("Initial liquid pairs: " + initialLiquidPairs.length);

    await batch(
      initialLiquidPairs,
      (pair) => pair.pair.reload(this.provider),
      1000
    );

    let liquidPairs = findLiquidPairs(
      initialLiquidPairs.map((pair) => pair.pair),
      this.stable,
      minLiquidityInUSDT
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
      const start = Date.now();

      await batch(liquidPairs, (pair) => pair.pair.reload(this.provider), 1000);

      const arbitragePairs = findLiquidPairs(
        liquidPairs.map((pair) => pair.pair),
        this.stable,
        minLiquidityInUSDT
      );

      const arbitrager = new CircularArbitrager(arbitragePairs);

      const arbitrages = arbitrager.find(starters);

      const results = await batch(
        arbitrages,
        async (arbitrage) => {
          const token = this.tokens.get(arbitrage.token);

          const pool = starters.find(
            (starter) => starter.address === arbitrage.token
          );

          const { input, output } = arbitrager.findOptimalAmounts(
            arbitrage,
            pool.fee
          );

          try {
            const { profit, gas, args } = await verifyFlashLoanArbitrage(
              this.provider,
              input,
              arbitrage.getPath().map((path) => path.token),
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

        const profitInUSD = (profit * minLiquidityInUSDT) / minLiquidityOfToken;

        const gasPrice = gasData.gasPrice.toBigInt();
        const gasInETH = gas * gasPrice;
        const gasInUSD = (gasInETH * ETH_PRICE) / BigInt(1e12);

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

        const exeuctionProvider = new ethers.providers.JsonRpcProvider(
          process.env.EXECUTION_RPC as string
        );
        const executionWallet = new Wallet(
          process.env.PRIVATE_KEY as string,
          exeuctionProvider
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
        console.log(
          "Gas fee in USD: " +
            parseFloat(formatUnits(arbitrage.gasInUSD, 6)).toFixed(2) +
            " " +
            arbitrage.token.symbol
        );

        try {
          const receipt = await executeFlashLoanArbitrage(
            executionWallet,
            arbitrage.args,
            arbitrage.gasInToken,
            arbitrage.gasLimit,
            arbitrage.gasPrice
          );

          console.log("Arbitrage successfull");
          console.log(receipt);
        } catch (e) {
          console.log("Arbitrage failed");
          console.error(e);
        }

        return;
      }

      const timeInLoop = Date.now() - start;
      await sleep(12000 - timeInLoop); // 12 seconds is the block time
    }
  }
}
