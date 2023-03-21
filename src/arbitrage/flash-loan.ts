import {
  ethers,
  BigNumber,
  Contract,
  Wallet,
  PopulatedTransaction,
} from "ethers";
import { Arbitrage } from "./arbitrage";
import { AbiCoder } from "ethers/lib/utils";
import { FlashbotsBundleProvider } from "@flashbots/ethers-provider-bundle";
import { constants } from "../bot/config";

import arbitrageABI from "../abi/arbitrage.json";
import erc20ABI from "../abi/erc20.json";

export type FlashDebug = PromiseSettledResult<{
  receipts: PromiseSettledResult<any>[];
  simulations: PromiseSettledResult<any>[];
}>[];

export interface VerificationResult {
  profit: bigint;
  gas: bigint;
  args: any[];
}

export async function verifyFlashLoanArbitrage(
  provider: ethers.providers.BaseProvider,
  flashContract: string,
  input: bigint,
  path: Arbitrage[],
  flashPool: string,
  isToken0: boolean,
  fee: bigint
): Promise<VerificationResult> {
  const flash = new Contract(flashContract, arbitrageABI, provider);
  const token = new Contract(path[0].token, erc20ABI, provider);

  const actions: {
    input: bigint;
    tx: PopulatedTransaction;
  }[] = [];

  const exchanges = path.slice(1).map((arbitrage) => arbitrage.pair.exchange);

  let exchangePath = path.slice(0, 2);
  let exchange = exchanges[0];
  let previousPath: Arbitrage[] | undefined;

  // <= in order to also do the last swap
  for (let i = 1; i <= exchanges.length; i++) {
    if (exchange === exchanges[i]) {
      exchangePath.push(path[i + 1]);
    } else {
      const swapTx = await exchange.getSwapTx(
        provider,
        input,
        0n, // TODO: calculate min output
        exchangePath,
        flash.address
      );

      const approveRouterTx = await token.populateTransaction.approve(
        swapTx.to,
        input
      );

      let approveInput = 0n;
      let swapInput = 0n;

      if (previousPath) {
        const outputStart = 32 + (previousPath.length - 2) * 32; // first 32 bytes is array length;

        approveInput = encodeInput(
          actions.length - 1,
          outputStart,
          32 // first 32 bytes is spender address
        );

        swapInput = encodeInput(actions.length - 1, outputStart, 0);
      }

      actions.push({
        input: approveInput,
        tx: approveRouterTx,
      });
      actions.push({
        input: swapInput,
        tx: swapTx,
      });

      previousPath = exchangePath;
      exchangePath = path.slice(i, i + 2);
      exchange = exchanges[i];
    }
  }

  // Repay flash loan
  const repayTx = await token.populateTransaction.transfer(
    flashPool,
    input + Arbitrage.calculateFee(input, fee)
  );
  actions.push({
    input: 0n,
    tx: repayTx,
  });

  const abiCoder = new AbiCoder();

  const data = abiCoder.encode(
    ["tuple(uint64 input, address to, uint256 value, bytes data)[]"],
    [actions.map((action) => [action.input, action.tx.to, 0, action.tx.data])]
  );

  const loan0 = isToken0 ? input : 0;
  const loan1 = !isToken0 ? input : 0;

  const args = [
    flashPool,
    token.address,
    0,
    Math.floor(Date.now() / 1000) + 60,
    flash.address,
    loan0,
    loan1,
    data,
  ];

  const profit: BigNumber = await flash.callStatic.uniswapV3Flash(...args, {
    from: constants.ADDRESS,
  });

  const gas: BigNumber = await flash.estimateGas.uniswapV3Flash(...args, {
    from: constants.ADDRESS,
  });

  return { profit: profit.toBigInt(), gas: gas.toBigInt(), args };
}

export async function executeFlashLoanArbitrageRPC(
  provider: ethers.providers.BaseProvider,
  executionProvider: ethers.providers.BaseProvider,
  wallet: Wallet,
  flashContract: string,
  args: any[],
  minProfit: bigint,
  latestBlock: ethers.providers.Block,
  gasLimit: bigint,
  gasPrice: bigint,
  minerReward: bigint
) {
  const flash = new Contract(flashContract, arbitrageABI, provider);

  args[2] = minProfit;

  const tx = await flash.populateTransaction.uniswapV3Flash(...args, {
    gasLimit: gasLimit,
    gasPrice: gasPrice,
    value: minerReward,
  });

  tx.chainId = 1;
  tx.nonce = await provider.getTransactionCount(wallet.address, "latest");

  const signedTx = await wallet.signTransaction(tx);

  const response = await executionProvider.sendTransaction(signedTx);

  try {
    const receipt = await executionProvider.waitForTransaction(
      response.hash,
      1,
      60000
    );

    return { success: true, tx, debug: receipt };
  } catch (e) {
    return { success: false, tx, debug: e };
  }
}

export async function executeFlashLoanArbitrage(
  provider: ethers.providers.BaseProvider,
  wallet: Wallet,
  flashContract: string,
  args: any[],
  minProfit: bigint,
  latestBlock: ethers.providers.Block,
  gasLimit: bigint,
  gasPrice: bigint,
  minerReward: bigint
) {
  const flash = new Contract(flashContract, arbitrageABI, provider);

  args[2] = minProfit;

  const tx = await flash.populateTransaction.uniswapV3Flash(...args, {
    gasLimit: gasLimit,
    gasPrice: gasPrice,
    value: minerReward,
  });

  tx.chainId = 1;
  tx.nonce = await provider.getTransactionCount(wallet.address, "latest");

  const signedTx = await wallet.signTransaction(tx);

  const relays = ["https://relay.flashbots.net", "https://builder0x69.io"];

  const debug = await Promise.allSettled(
    relays.map((relay) =>
      sendToRelay(relay, provider, wallet, signedTx, latestBlock.number)
    )
  );

  const success = debug.some(
    (result) =>
      result.status === "fulfilled" &&
      result.value.receipts.some(
        (receipt) =>
          receipt.status === "fulfilled" &&
          receipt.value &&
          receipt.value.status === 1
      )
  );

  return { success, tx, debug };
}

async function sendToRelay(
  relay: string,
  provider: ethers.providers.BaseProvider,
  wallet: Wallet,
  signedTx: string,
  block: number
) {
  const flashbotsProvider = await FlashbotsBundleProvider.create(
    provider,
    wallet,
    relay,
    1
  );

  const blocks = [block + 1, block + 2, block + 3, block + 4];

  const bundlePromises = blocks.map((targetBlockNumber) =>
    flashbotsProvider.sendRawBundle([signedTx], targetBlockNumber)
  );
  const bundles: any[] = await Promise.all(bundlePromises);

  const simulations = await Promise.allSettled(
    bundles.map((bundle) => bundle.simulate())
  );

  const receipts = await Promise.allSettled(
    bundles.map((bundle) => bundle.receipts())
  );

  return {
    blocks,
    bundles: bundles.map((bundle) => bundle.bundleHash),
    receipts,
    simulations,
  };
}

function encodeInput(index: number, outputStart: number, dataStart: number) {
  return (
    BigInt(index) +
    (BigInt(outputStart) << 8n) +
    ((4n + BigInt(dataStart)) << 24n) // 4 bytes for the function selector
  );
}
