import { ethers } from "ethers";
import { CircularArbitrager } from "../arbitrage/circular-arbitrager";
import { Exchange, Pair } from "../exchanges/types";
import { loadTokens, TokenInfo } from "./tokens";
import { batch, sleep } from "../util/utils";
import { findLiquidPairs, LiquidityInfo } from "../exchanges/liquidity";
import { blocked, constants } from "./config";
import { StartToken } from "../arbitrage/starters";
import { ArbitrageExecution } from "../arbitrage/arbitrage-execution";
import { Arbitrage } from "../arbitrage/arbitrage";

export class Bot {
  provider: ethers.providers.BaseProvider;
  dexes: Exchange[];
  stable: string;
  starters: StartToken[];

  pairs: Pair[] = [];
  tokens = new Map<string, TokenInfo>();

  history: ArbitrageExecution[][] = [];
  executed: ArbitrageExecution[] = [];

  blacklist = new Map<string, number>();

  constructor(
    provider: ethers.providers.BaseProvider,
    dexes: Exchange[],
    stable: string,
    starters: StartToken[]
  ) {
    this.provider = provider;
    this.dexes = dexes;
    this.stable = stable;
    this.starters = starters;
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

  isBlacklisted(arbitrage: Arbitrage) {
    const time = this.blacklist.get(arbitrage.getHash());
    return time && time >= Date.now();
  }

  addToBlacklist(arbitrage: Arbitrage) {
    this.blacklist.set(arbitrage.getHash(), Date.now() + 3600000); // blacklist for 1 hour
  }

  async run() {
    let nextBlock = (await this.provider.getBlockNumber()) + 1;

    console.log("Finding liquid pairs");
    let initialLiquidPairs = findLiquidPairs(
      this.pairs,
      this.stable,
      constants.MIN_LIQUIDITY_IN_USDT / 2n
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
      constants.MIN_LIQUIDITY_IN_USDT
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
          constants.MIN_LIQUIDITY_IN_USDT
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

    // Find all arbitrages
    const arbitrages = arbitrager.find(this.starters).filter((arbitrage) => !this.isBlacklisted(arbitrage));
    if (arbitrages.length === 0) return;

    // Create executions
    const executions = arbitrages.map((arbitrage) => {
      const token = this.tokens.get(arbitrage.token);

      const pool = this.starters.find(
        (starter) => starter.address === arbitrage.token
      );

      return new ArbitrageExecution(arbitrage, arbitrager, token, pool);
    });

    // Store executions in history
    this.history.push(executions);
    if (this.history.length > 20) this.history.shift();

    // Verify executions
    await batch(
      executions,
      (execution) => execution.verify(this.provider),
      100
    );

    for (const execution of executions) {
      if (!execution.verified) this.addToBlacklist(execution.arbitrage);
    }

    const verifiedExecutions = executions.filter(
      (execution) => execution.verified
    );
    if (verifiedExecutions.length === 0) return;

    // Get current gas price
    const gasData = await this.provider.getFeeData();

    // Calculate profit
    for (const execution of verifiedExecutions) {
      execution.calculateProfit(arbitragePairs, gasData);
    }

    const profitableExecutions = executions.filter(
      (execution) => execution.netProfitInUSD > 0
    );
    if (profitableExecutions.length === 0) return;

    // Sort by profit
    profitableExecutions.sort((a, b) =>
      Number(b.netProfitInUSD - a.netProfitInUSD)
    );

    this.executed.push(profitableExecutions[0]);

    // Execute the most profitable arbitrage
    await profitableExecutions[0].execute(this.provider, nextBlock);
  }
}
