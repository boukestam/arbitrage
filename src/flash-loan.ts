import ethers, { BigNumber, Contract, Wallet } from "ethers";
import { Arbitrage } from "./arbitrage";
import { UniswapV2Pair } from "./uniswap-v2";

import uniswapV2RouterABI from "./abi/uniswap-v2-router.json";
import arbitrageABI from "./abi/arbitrage.json";
import erc20ABI from "./abi/erc20.json";
import { AbiCoder } from "ethers/lib/utils";
import { mulDivRoundingUp } from "./math";

export async function verifyFlashLoanArbitrage(
  provider: ethers.providers.JsonRpcBatchProvider,
  input: bigint,
  path: string[],
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
  const UNISWAP_V2_ROUTER_CONTRACT = process.env
    .UNISWAP_V2_ROUTER_CONTRACT as string;

  const owner = ADDRESS;
  const flash = new Contract(FLASH_CONTRACT, arbitrageABI, provider);
  const router = new Contract(
    UNISWAP_V2_ROUTER_CONTRACT,
    uniswapV2RouterABI,
    provider
  );

  const token = new Contract(path[0], erc20ABI, provider);

  const approveRouterTx = await token.populateTransaction.approve(
    router.address,
    input
  );

  const swapTx = await router.populateTransaction.swapExactTokensForTokens(
    input,
    input,
    path,
    flash.address,
    Math.floor(Date.now() / 1000) + 600 // 10 minutes from now
  );

  const feeAmount = Arbitrage.calculateFee(input, fee);

  const repayTx = await token.populateTransaction.transfer(
    flashPool,
    input + feeAmount
  );

  const abiCoder = new AbiCoder();

  const data = abiCoder.encode(
    ["tuple(address to, uint256 value, bytes data)[]"],
    [
      [
        [approveRouterTx.to, 0, approveRouterTx.data],
        [swapTx.to, 0, swapTx.data],
        [repayTx.to, 0, repayTx.data],
      ],
    ]
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
  provider: Wallet,
  args: any[],
  minProfit: bigint,
  gasLimit: bigint,
  gasPrice: bigint
) {
  const FLASH_CONTRACT = process.env.FLASH_CONTRACT as string;

  const flash = new Contract(FLASH_CONTRACT, arbitrageABI, provider);

  args[2] = minProfit;

  const tx = await flash.uniswapV3Flash(...args, {
    gasLimit: gasLimit,
    gasPrice: gasPrice,
  });
  const receipt = await provider.provider.waitForTransaction(
    tx.hash,
    1,
    360000
  ); // 6 minutes

  return receipt;
}
