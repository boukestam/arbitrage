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

export async function verifyFlashLoanArbitrage(
  provider: ethers.providers.BaseProvider,
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

  tx.chainId = 1;
  tx.nonce = await provider.getTransactionCount(wallet.address, 'latest')

  const signedTx = await wallet.signTransaction(tx)

  const relays = [
    "https://0xa1559ace749633b997cb3fdacffb890aeebdb0f5a3b6aaa7eeeaf1a38af0a8fe88b9e4b1f61f236d2e64d95733327a62@relay.ultrasound.money",
    "https://relay.flashbots.net",
    "https://0xa7ab7a996c8584251c8f925da3170bdfd6ebc75d50f5ddc4050a6fdc77f2a3b5fce2cc750d0865e05d7228af97d69561@agnostic-relay.net",
    "https://0xad0a8bb54565c2211cee576363f3a347089d2f07cf72679d16911d740262694cadb62d7fd7483f27afd714ca0f1b9118@bloxroute.ethical.blxrbdn.com",
  ];

  const debug = await Promise.allSettled(
    relays.map((relay) => sendToRelay(relay, provider, wallet, signedTx, block))
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

  const blocks = [block, block + 1]

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

  const conflictPromises = blocks.map((targetBlockNumber) =>
    flashbotsProvider.getConflictingBundle([signedTx], targetBlockNumber)
  );

  const conflicts = await Promise.allSettled(conflictPromises);

  return { blocks, receipts, simulations, conflicts };
}

function encodeInput(index: number, outputStart: number, dataStart: number) {
  return (
    BigInt(index) +
    (BigInt(outputStart) << 8n) +
    ((4n + BigInt(dataStart)) << 24n) // 4 bytes for the function selector
  );
}
