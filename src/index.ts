import { ethers } from "ethers";
import { UniswapV2 } from "./exchanges/uniswap-v2";
import { Bot } from "./bot";
import { UniswapV3 } from "./exchanges/uniswap-v3";

require("dotenv").config();

const provider = new ethers.providers.JsonRpcBatchProvider(
  process.env.SCAN_RPC as string
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

const bot = new Bot(
  provider,
  [
    //new UniswapV2("UniswapV2", "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f", "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D"), 
    new UniswapV3("UniswapV3", "0x1F98431c8aD98523631AE4a59f267346ea31F984", "0xE592427A0AEce92De3Edee1F18E0157C05861564")
  ],
  process.env.STABLE_COIN as string
);

bot.load()//.then(() => bot.run());
