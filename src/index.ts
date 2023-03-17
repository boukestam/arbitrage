import { ethers } from "ethers";
import { UniswapV2 } from "./exchanges/uniswap-v2";
import { Bot } from "./bot/bot";
import { UniswapV3 } from "./exchanges/uniswap-v3";
import { constants } from "./bot/config";
import { getStarters } from "./arbitrage/starters";

const provider = new ethers.providers.JsonRpcBatchProvider(
  constants.SCAN_RPC
);

process.on("uncaughtException", (exception) => {
  console.log("Unhandled Exception", exception);
});

process.on("unhandledRejection", (reason, p) => {
  console.log("Unhandled Rejection at: Promise ", p, " reason: ", reason);
});

process.on("exit", (code) => {
  console.log("Process exited with code", code);
});

const uniswapV2 = new UniswapV2(
  "UniswapV2",
  "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f",
  "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D"
);

const sushiSwap = new UniswapV2(
  "SushiSwap",
  "0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac",
  "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F"
);

const uniswapV3 = new UniswapV3(
  "UniswapV3",
  "0x1F98431c8aD98523631AE4a59f267346ea31F984",
  "0xE592427A0AEce92De3Edee1F18E0157C05861564"
);

async function main() {
  await uniswapV3.loadFromFile(provider);

  const starters = getStarters(uniswapV3);

  console.log("Found " + starters.length + " starters");

  const bot = new Bot(
    provider,
    [
      uniswapV2,
      sushiSwap,
      //uniswapV3,
    ],
    constants.STABLE_COIN,
    starters
  );

  await bot.load();
  await bot.run();
}

main();
