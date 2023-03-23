import {
  ethers,
  BigNumber,
  Contract,
  Wallet,
  PopulatedTransaction,
  VoidSigner,
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

interface Action {
  input: bigint;
  tx: PopulatedTransaction;
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
  const voidSigner = new VoidSigner(constants.ADDRESS);

  const flash = new Contract(flashContract, arbitrageABI, provider);
  const token = new Contract(path[0].token, erc20ABI, voidSigner);

  const pairs = path.slice(1).map((arbitrage) => arbitrage.pair);

  let exchangePath = path.slice(0, 2);
  let exchange = pairs[0].exchange;
  let previousPath: Arbitrage[] | undefined;
  let previousAmountsIndex: number | undefined;

  const actions: Action[] = [];

  const transferTx = await token.populateTransaction.transfer(
    pairs[0].address,
    input
  );
  actions.push({
    input: 0n,
    tx: transferTx,
  });

  // <= in order to also do the last swap
  for (let i = 1; i <= pairs.length; i++) {
    if (exchange === pairs[i]?.exchange) {
      exchangePath.push(path[i + 1]);
    } else {
      const router = exchange.getContract(voidSigner);

      const amountsTx = await router.populateTransaction.getAmountsOut(
        input,
        exchangePath.map((arbitrage) => arbitrage.token)
      );
      // first 32 bytes length in bytes, second 32 bytes is array length
      const amountsInput = previousPath
        ? encodeInput(
            previousAmountsIndex,
            64 + (previousPath.length - 1) * 32,
            0
          )
        : 0n;
      actions.push({
        input: amountsInput,
        tx: amountsTx,
      });
      previousAmountsIndex = actions.length - 1;

      const exchangePairs = exchangePath
        .slice(1)
        .map((arbitrage) => arbitrage.pair);

      const swapTxs = await Promise.all(
        exchangePairs.map((pair, j, arr) => {
          const to =
            j < arr.length - 1
              ? arr[j + 1].address
              : i === pairs.length
              ? flashContract
              : pairs[i].address;
          return pair
            .getContract(voidSigner)
            .populateTransaction.swap(0, 0, to, "0x");
        })
      );
      actions.push(
        ...swapTxs.map((tx, txIndex) => ({
          input: encodeInput(
            previousAmountsIndex,
            64 + (txIndex + 1) * 32,
            exchangePairs[txIndex].token0 === exchangePath[txIndex + 1].token
              ? 0 // if the output token is token0, its amount0Out, the first argument
              : 32 // if the output token is not token0, its amount1Out, the second argument
          ),
          tx,
        }))
      );

      previousPath = exchangePath;
      exchangePath = path.slice(i, i + 2);
      exchange = pairs[i]?.exchange;
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

  const relays = [
    "https://relay.flashbots.net",
    "https://builder0x69.io",
    "https://rpc.beaverbuild.org",
    "https://rsync-builder.xyz",
    "https://buildai.net",
    "https://eth-builder.com",
    "https://mev.api.blxrbdn.com",
    "https://api.blocknative.com/v1/auction",
  ];

  const debug = await Promise.allSettled(
    relays.map((relay) =>
      sendToRelay(relay, provider, wallet, signedTx, latestBlock.number)
    )
  );

  try {
    const hash = ethers.utils.keccak256(signedTx);
    const receipt = await provider.waitForTransaction(hash, 1, 60000);

    return { success: true, tx, debug: receipt };
  } catch (e) {
    return { success: false, tx, debug: debug };
  }
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

  const blocks = [block + 1, block + 2];

  const bundlePromises = blocks.map((targetBlockNumber) =>
    flashbotsProvider.sendRawBundle([signedTx], targetBlockNumber)
  );
  const bundles: any[] = await Promise.allSettled(bundlePromises);

  return {
    relay: relay,
    blocks,
    bundles: bundles,
  };
}

function encodeInput(index: number, outputStart: number, dataStart: number) {
  return (
    BigInt(index) +
    (BigInt(outputStart) << 8n) +
    ((4n + BigInt(dataStart)) << 24n) // 4 bytes for the function selector
  );
}
