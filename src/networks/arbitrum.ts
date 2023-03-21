import { ethers } from "ethers";
import { UniswapV2 } from "../exchanges/uniswap-v2";
import { Bot } from "../bot/bot";
import { UniswapV3 } from "../exchanges/uniswap-v3";
import { getStarters } from "../arbitrage/starters";

const provider = new ethers.providers.JsonRpcBatchProvider(
  "https://nd-345-995-096.p2pify.com/2710d9d40a95e95b5dea189abeb9a1bb"
);

export const blocked = new Set<string>([]);

const sushiSwap = new UniswapV2(
  "SushiSwap",
  "0xc35DADB65012eC5796536bD9864eD8773aBc74C4",
  "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506"
);

const uniswapV3 = new UniswapV3(
  "UniswapV3",
  "0x1F98431c8aD98523631AE4a59f267346ea31F984",
  "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
  165,
  70198712
);

export async function createArbitrumBot() {
  const stable = "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9";

  await uniswapV3.loadFromFile(provider, "arbitrum");

  const starters = getStarters(uniswapV3, stable);

  console.log("Found " + starters.length + " starters");

  return new Bot(
    "arbitrum",
    provider,
    provider,
    [sushiSwap],
    blocked,
    "0xA7DbD75c13f3d9a7175515e6f7D8F5e26951241C",
    stable,
    starters,
    1750000000n,
    false
  );
}
