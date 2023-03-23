import { ethers } from "ethers";
import { CircularArbitrager } from "../arbitrage/circular-arbitrager";
import { Exchange, Pair } from "../exchanges/types";
import { loadTokens, TokenInfo } from "./tokens";
import { batch, sleep } from "../util/utils";
import { findLiquidPairs, LiquidityInfo } from "../exchanges/liquidity";
import { constants } from "./config";
import { StartToken } from "../arbitrage/starters";
import { ArbitrageExecution } from "../arbitrage/arbitrage-execution";
import { Arbitrage } from "../arbitrage/arbitrage";

const VALIDATION_BATCH_SIZE = 250;

export interface ArbitrageResult {
  executions: ArbitrageExecution[];
  block: number;
  timestamp: number;
  pathFindingTime: number;
  validationTime: number;
}

export class Bot {
  name: string;
  provider: ethers.providers.BaseProvider;
  executionProvider: ethers.providers.BaseProvider;
  dexes: Exchange[];
  blocked: Set<string>;
  flashContract: string;
  stable: string;
  starters: StartToken[];
  ethPrice: bigint;
  useFlashbots: boolean;

  pairs: Pair[] = [];
  tokens = new Map<string, TokenInfo>();

  history: ArbitrageResult[] = [];
  executed: ArbitrageExecution[] = [];

  blacklist = new Map<string, number>();

  liquidPairs: LiquidityInfo[];

  constructor(
    name: string,
    provider: ethers.providers.BaseProvider,
    executionProvider: ethers.providers.BaseProvider,
    dexes: Exchange[],
    blocked: Set<string>,
    flashContract: string,
    stable: string,
    starters: StartToken[],
    ethPrice: bigint,
    useFlashbots: boolean
  ) {
    this.name = name;
    this.provider = provider;
    this.executionProvider = executionProvider;
    this.dexes = dexes;
    this.blocked = blocked;
    this.flashContract = flashContract;
    this.stable = stable;
    this.starters = starters;
    this.ethPrice = ethPrice;
    this.useFlashbots = useFlashbots;
  }

  async load() {
    for (const dex of this.dexes) {
      await dex.loadFromFile(this.provider, this.name);

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

    this.tokens = await loadTokens(
      Array.from(tokens.values()),
      this.provider,
      this.name
    );
  }

  isBlacklisted(arbitrage: Arbitrage) {
    const time = this.blacklist.get(arbitrage.getHash());
    return time && time >= Date.now();
  }

  addToBlacklist(arbitrage: Arbitrage) {
    this.blacklist.set(arbitrage.getHash(), Date.now() + 3600000); // blacklist for 1 hour
  }

  async init() {
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
      if (
        this.blocked.has(pair.pair.token0) ||
        this.blocked.has(pair.pair.token1)
      )
        return false;
      return true;
    });
    console.log("Not blocked pairs: " + liquidPairs.length);

    this.liquidPairs = liquidPairs;
  }

  async run() {
    let latestBlock: ethers.providers.Block;
    let nextBlock = (await this.provider.getBlockNumber()) + 1;

    while (true) {
      const pairsToUpdate = new Set<Pair>();
      const newBlockNumbers = [];

      try {
        // Get new blocks
        latestBlock = await this.provider.getBlock("latest");
        for (let i = nextBlock; i <= latestBlock.number; i++) {
          newBlockNumbers.push(i);
        }

        // Retrieve all transactions in the new blocks
        const blocks = await batch(
          newBlockNumbers,
          (blockNumber) => this.provider.getBlockWithTransactions(blockNumber),
          100
        );

        // Retrieve all receipts for the transactions
        const receipts = await batch(
          blocks.reduce((a, v) => {
            a.push(...v.transactions);
            return a;
          }, []),
          (tx) => this.provider.getTransactionReceipt(tx.hash),
          1000
        );

        // Find all pairs that have been updated
        for (const receipt of receipts) {
          for (const log of receipt.logs) {
            const pair = this.liquidPairs.find(
              (pair) => pair.pair.address === log.address
            );
            if (pair) pairsToUpdate.add(pair.pair);
          }
        }

        if (pairsToUpdate.size > 0) {
          const pairsToUpdateArray = Array.from(pairsToUpdate.values());

          await batch(
            pairsToUpdateArray,
            (pair) => pair.reload(this.provider),
            1000
          );

          const arbitragePairs = findLiquidPairs(
            this.liquidPairs.map((pair) => pair.pair),
            this.stable,
            constants.MIN_LIQUIDITY_IN_USDT
          );

          await this.findArbitrages(
            arbitragePairs,
            pairsToUpdateArray,
            latestBlock
          );
        }

        nextBlock += newBlockNumbers.length;

        // 12 seconds is the average block time
        let sleepTime = latestBlock.timestamp * 1000 + 12000 - Date.now();
        sleepTime = Math.max(sleepTime, 1000); // sleep at least 1 second
        await sleep(sleepTime);
      } catch (e) {
        console.error(e);
        await sleep(1000); // sleep to not get stuck in a CPU blocking loop
      }
    }
  }

  async findArbitrages(
    arbitragePairs: LiquidityInfo[],
    updatedPairs: Pair[],
    latestBlock: ethers.providers.Block
  ) {
    const arbitrager = new CircularArbitrager(arbitragePairs);

    const startPathFinding = Date.now();

    const updatedTokens = new Set<string>();
    for (const pair of updatedPairs) {
      updatedTokens.add(pair.token0);
      updatedTokens.add(pair.token1);
    }

    const updatedStarters = this.starters
      .filter((starter) => updatedTokens.has(starter.address))
      .slice(0, 10); // max 10 starters to not overload the path finding

    // Find all arbitrages
    let arbitrages = arbitrager
      .find(updatedStarters)
      .filter((arbitrage) => !this.isBlacklisted(arbitrage));

    const pathFindingTime = Date.now() - startPathFinding;
    console.log(
      this.name +
        " bot found " +
        arbitrages.length +
        " arbitrages for " +
        updatedStarters.length +
        " starters in " +
        pathFindingTime +
        "ms"
    );

    if (arbitrages.length === 0) return;

    // Sort and take top arbitrages
    arbitrages.sort(
      (a, b) => b.getProfitPercentage() - a.getProfitPercentage()
    );
    arbitrages = arbitrages.slice(0, VALIDATION_BATCH_SIZE);

    // Create executions
    const executions = arbitrages.map((arbitrage) => {
      const token = this.tokens.get(arbitrage.token);

      const pool = this.starters.find(
        (starter) => starter.address === arbitrage.token
      );

      return new ArbitrageExecution(arbitrage, arbitrager, token, pool);
    });

    const result = {
      executions: executions,
      block: latestBlock.number,
      timestamp: Date.now(),
      pathFindingTime: pathFindingTime,
      validationTime: 0,
    };

    // Store executions in history
    this.history.push(result);
    if (this.history.length > 20) this.history.shift();

    const startValidation = Date.now();

    // Verify executions
    await batch(
      executions,
      (execution) => execution.verify(this.provider, this.flashContract),
      VALIDATION_BATCH_SIZE
    );

    result.validationTime = Date.now() - startValidation;

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
      execution.calculateProfit(arbitragePairs, gasData, this.ethPrice);
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

    await profitableExecutions[0].execute(
      this.provider,
      this.executionProvider,
      this.flashContract,
      latestBlock,
      this.useFlashbots
    );

    // await profitableExecutions[0].simulate(
    //   this.provider,
    //   this.flashContract,
    //   latestBlock
    // );
  }
}
