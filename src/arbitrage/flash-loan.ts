import {
  ethers,
  BigNumber,
  Contract,
  Wallet,
  PopulatedTransaction,
} from "ethers";
import { Arbitrage } from "./arbitrage";
import { UniswapV2, UniswapV2Pair } from "../exchanges/uniswap-v2";

import arbitrageABI from "../abi/arbitrage.json";
import erc20ABI from "../abi/erc20.json";
import { AbiCoder } from "ethers/lib/utils";
import { mulDivRoundingUp } from "../util/math";
import { DEX } from "../exchanges/types";
import { FlashbotsBundleProvider } from "@flashbots/ethers-provider-bundle";

export async function verifyFlashLoanArbitrage(
  provider: ethers.providers.JsonRpcBatchProvider,
  exchange: DEX,
  input: bigint,
  path: Arbitrage[],
  flashPool: string,
  isToken0: boolean,
  fee: number
): Promise<{
  profit: bigint;
  gas: bigint;
  args: any[];
}> {
  const ADDRESS = process.env.ADDRESS as string;
  const FLASH_CONTRACT = process.env.FLASH_CONTRACT as string;
  const owner = ADDRESS;

  const flash = new Contract(FLASH_CONTRACT, arbitrageABI, provider);
  const token = new Contract(path[0].token, erc20ABI, provider);

  const transactions: PopulatedTransaction[] = [];

  // ---------------------------------------

  const swapTx = await exchange.getSwapTx(provider, input, path, flash.address);

  const approveRouterTx = await token.populateTransaction.approve(
    swapTx.to,
    input
  );

  transactions.push(approveRouterTx);
  transactions.push(swapTx);

  // ---------------------------------------

  // Repay flash loan
  transactions.push(
    await token.populateTransaction.transfer(
      flashPool,
      input + Arbitrage.calculateFee(input, fee)
    )
  );

  const abiCoder = new AbiCoder();

  const data = abiCoder.encode(
    ["tuple(address to, uint256 value, bytes data)[]"],
    [transactions.map((tx) => [tx.to, 0, tx.data])]
  );

  const loan0 = isToken0 ? input : 0;
  const loan1 = !isToken0 ? input : 0;

  const args = [flashPool, token.address, 0, flash.address, loan0, loan1, data];

  // const tx = await flash.populateTransaction.uniswapV3Flash(...args);
  // const response = await provider.send("debug_traceCall", [tx]);
  // console.log(response);

  const profit: BigNumber = await flash.callStatic.uniswapV3Flash(...args, {
    from: owner,
  });

  const gas: BigNumber = await flash.estimateGas.uniswapV3Flash(...args, {
    from: owner,
  });

  return { profit: profit.toBigInt(), gas: gas.toBigInt(), args };
}

export async function executeFlashLoanArbitrage(
  provider: ethers.providers.BaseProvider,
  wallet: Wallet,
  args: any[],
  minProfit: bigint,
  block: number,
  gasLimit: bigint,
  gasPrice: bigint,
  minerReward: bigint
) {
  const FLASH_CONTRACT = process.env.FLASH_CONTRACT as string;

  const flash = new Contract(FLASH_CONTRACT, arbitrageABI, provider);

  args[2] = minProfit;

  const tx = await flash.populateTransaction.uniswapV3Flash(...args, {
    gasLimit: gasLimit,
    gasPrice: gasPrice,
    value: minerReward,
  });

  const flashbotsProvider = await FlashbotsBundleProvider.create(
    provider,
    wallet
  );

  const signedBundle = await flashbotsProvider.signBundle([
    {
      signer: wallet,
      transaction: tx,
    },
  ]);

  const receipt = await flashbotsProvider.sendRawBundle(signedBundle, block);

  const bundlePromises = [block, block + 2].map((targetBlockNumber) =>
    flashbotsProvider.sendRawBundle(signedBundle, targetBlockNumber)
  );
  const bundles: any[] = await Promise.all(bundlePromises);

  const results = await Promise.allSettled(
    bundles.map((bundle) => bundle.wait())
  );

  return results;
}
