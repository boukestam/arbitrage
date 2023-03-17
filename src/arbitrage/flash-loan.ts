import {
  ethers,
  BigNumber,
  Contract,
  Wallet,
  PopulatedTransaction,
} from "ethers";
import { Arbitrage } from "./arbitrage";
import { AbiCoder } from "ethers/lib/utils";
import { DEX } from "../exchanges/types";
import { FlashbotsBundleProvider } from "@flashbots/ethers-provider-bundle";
import { constants } from "../bot/config";

import arbitrageABI from "../abi/arbitrage.json";
import erc20ABI from "../abi/erc20.json";

export async function verifyFlashLoanArbitrage(
  provider: ethers.providers.BaseProvider,
  exchange: DEX,
  input: bigint,
  path: Arbitrage[],
  flashPool: string,
  isToken0: boolean,
  fee: bigint
): Promise<{
  profit: bigint;
  gas: bigint;
  args: any[];
}> {
  const flash = new Contract(constants.FLASH_CONTRACT, arbitrageABI, provider);
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
    from: constants.ADDRESS,
  });

  const gas: BigNumber = await flash.estimateGas.uniswapV3Flash(...args, {
    from: constants.ADDRESS,
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
  const flash = new Contract(constants.FLASH_CONTRACT, arbitrageABI, provider);

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

  const bundlePromises = [block, block + 1].map((targetBlockNumber) =>
    flashbotsProvider.sendRawBundle(signedBundle, targetBlockNumber)
  );
  const bundles: any[] = await Promise.all(bundlePromises);

  const results = await Promise.allSettled(
    bundles.map((bundle) => bundle.wait())
  );

  return results;
}
