import { ethers } from "ethers";
import { UniswapV2 } from "./exchanges/uniswap-v2";
import { Bot } from "./bot/bot";
import { UniswapV3 } from "./exchanges/uniswap-v3";
import { constants } from "./bot/config";
import { getStarters } from "./arbitrage/starters";
import { startServer } from "./bot/server";

const provider = new ethers.providers.JsonRpcBatchProvider(constants.SCAN_RPC);

process.on("uncaughtException", (exception) => {
  console.log("Unhandled Exception", exception);
});

process.on("unhandledRejection", (reason, p) => {
  console.log("Unhandled Rejection at: Promise ", p, " reason: ", reason);
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

const shibaSwap = new UniswapV2(
  "ShibaSwap",
  "0x115934131916C8b277DD010Ee02de363c09d037c",
  "0x03f7724180AA6b939894B5Ca4314783B0b36b329"
);

const fraxSwap = new UniswapV2(
  "FraxSwap",
  "0x43eC799eAdd63848443E2347C49f5f52e8Fe0F6f",
  "0xC14d550632db8592D1243Edc8B95b0Ad06703867"
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
      // sushiSwap,
      // shibaSwap,
      // fraxSwap,
      //uniswapV3,
    ],
    constants.STABLE_COIN,
    starters
  );

  const server = startServer(bot, 8080);

  process.on("exit", (code) => {
    server.close();
    console.log("Process exited with code", code);
  });

  await bot.load();
  await bot.run();
}

main();
