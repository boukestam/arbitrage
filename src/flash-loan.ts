import { Contract, ContractRunner } from "ethers";
import { Arbitrage } from "./arbitrage";

import uniswapV2RouterABI from "./abi/uniswap-v2-router.json";
import { UniswapV2Pair } from "./uniswap-v2";

async function verifyFlashLoanArbitrage(provider: ContractRunner, arbitrage: Arbitrage, pair: UniswapV2Pair): Promise<bigint> {
  const router = new Contract("0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D", uniswapV2RouterABI, provider);

  const path = arbitrage.getPath();
  
  router.getAmountsOut(path[0].amount, path.map((item) => item.pair.address)
}