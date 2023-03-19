import { BigNumber, ethers, PopulatedTransaction, Wallet } from "ethers";
import { constants } from "../bot/config";
import { TokenInfo } from "../bot/tokens";
import { LiquidityInfo } from "../exchanges/liquidity";
import { Arbitrage } from "./arbitrage";
import { CircularArbitrager } from "./circular-arbitrager";
import {
  executeFlashLoanArbitrage,
  FlashDebug,
  verifyFlashLoanArbitrage,
} from "./flash-loan";
import { StartToken } from "./starters";

export class ArbitrageExecution {
  arbitrage: Arbitrage;
  arbitrager: CircularArbitrager;

  token: TokenInfo;
  pool: StartToken;

  optimalInput: bigint;
  optimalOutput: bigint;

  profit: bigint;
  gasLimit: bigint;
  args: any[];

  verified: boolean = false;

  errorIndex: bigint;
  errorReason: string;

  profitInUSD: bigint;
  gasInETH: bigint;
  gasInUSD: bigint;
  gasInToken: bigint;
  netProfitInUSD: bigint;
  gasPrice: bigint;
  minerRewardInUSD: bigint;

  success: boolean = false;
  tx: PopulatedTransaction;
  debug: FlashDebug;
  error: any;

  constructor(
    arbitrage: Arbitrage,
    arbitrager: CircularArbitrager,
    token: TokenInfo,
    pool: StartToken
  ) {
    this.arbitrage = arbitrage;
    this.arbitrager = arbitrager;

    this.token = token;
    this.pool = pool;
  }

  async verify(provider: ethers.providers.BaseProvider) {
    const { input, output } = this.arbitrager.findOptimalAmounts(
      this.arbitrage,
      this.pool.fee
    );

    this.optimalInput = input;
    this.optimalOutput = output;

    if (output <= input) {
      return;
    }

    try {
      const result = await verifyFlashLoanArbitrage(
        provider,
        input,
        this.arbitrage.getPath(),
        this.pool.v3Pool,
        this.pool.isToken0,
        this.pool.fee
      );

      this.profit = result.profit;
      this.gasLimit = result.gas;
      this.args = result.args;

      this.verified = true;
    } catch (e: any) {
      if (e.errorArgs && e.errorArgs.returnData) {
        this.errorIndex = (e.errorArgs.index as BigNumber).toBigInt();

        try {
          this.errorReason = ethers.utils.defaultAbiCoder.decode(
            ["string"],
            ethers.utils.hexDataSlice(e.errorArgs.returnData, 4)
          ) as any as string;
        } catch {}
      }
    }
  }

  calculateProfit(
    arbitragePairs: LiquidityInfo[],
    gasData: ethers.providers.FeeData
  ) {
    const minLiquidityOfToken =
      arbitragePairs.find((pair) => pair.pair.token0 === this.token.address)
        ?.minAmount0 ||
      arbitragePairs.find((pair) => pair.pair.token1 === this.token.address)
        ?.minAmount1;

    this.profitInUSD =
      (this.profit * constants.MIN_LIQUIDITY_IN_USDT) / minLiquidityOfToken;

    this.gasPrice = gasData.gasPrice.toBigInt();
    this.gasInETH = this.gasLimit * this.gasPrice;
    this.gasInUSD = (this.gasInETH * constants.ETH_PRICE) / BigInt(1e12);
    this.gasInToken = (this.profit * this.gasInUSD) / this.profitInUSD;

    this.netProfitInUSD = this.profitInUSD - this.gasInUSD;
  }

  async execute(provider: ethers.providers.BaseProvider, nextBlock: number) {
    const wallet = new Wallet(constants.PRIVATE_KEY, provider);

    // Increase the gas if there is a big profit
    if (this.netProfitInUSD > 5000000n) {
      this.minerRewardInUSD = this.netProfitInUSD - 5000000n;

      this.gasPrice =
        (this.gasPrice * (this.gasInUSD + this.minerRewardInUSD)) /
        this.gasInUSD;

      this.gasInToken =
        (this.gasInToken * (this.gasInUSD + this.minerRewardInUSD)) /
        this.gasInUSD;
    }

    try {
      const result = await executeFlashLoanArbitrage(
        provider,
        wallet,
        this.args,
        this.gasInToken,
        nextBlock,
        this.gasLimit,
        this.gasPrice,
        0n
      );

      this.success = result.success;
      this.tx = result.tx;
      this.debug = result.debug;
    } catch (e) {
      this.error = e;
    }
  }

  toObject(tokens: Map<string, TokenInfo>) {
    const path = this.arbitrage.getPath().map((arbitrage) => ({
      token: tokens.get(arbitrage.token),
      amount: arbitrage.amount,
      pair: arbitrage.pair?.address,
    }));

    return {
      path: path,

      token: this.token,
      pool: this.pool,

      optimalInput: this.optimalInput,
      optimalOutput: this.optimalOutput,

      profit: this.profit,
      gasLimit: this.gasLimit,
      args: this.args,

      verified: this.verified,

      errorIndex: this.errorIndex,
      errorReason: this.errorReason,

      profitInUSD: this.profitInUSD,
      gasInETH: this.gasInETH,
      gasInUSD: this.gasInUSD,
      gasInToken: this.gasInToken,
      netProfitInUSD: this.netProfitInUSD,
      gasPrice: this.gasPrice,
      minerRewardInUSD: this.minerRewardInUSD,

      success: this.success,
      tx: this.tx,
      debug: this.debug,
      error: this.error,
    };
  }
}
