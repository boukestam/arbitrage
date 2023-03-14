import { ethers } from "ethers";
import { UniswapV2 } from "./uniswap-v2";
import { Bot } from "./bot";

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

const uniswapBot = new Bot(
  provider,
  [new UniswapV2("UniswapV2", "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f")],
  process.env.STABLE_COIN as string
);

uniswapBot.load().then(() => uniswapBot.run());
