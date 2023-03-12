import { JsonRpcProvider } from "ethers";
import { DEX } from "./types";
import { UniswapV2 } from "./uniswap-v2";
import { Bot } from "./bot";

const provider = new JsonRpcProvider(
  //"https://nd-497-196-530.p2pify.com/b5baf29f386396a64b054628ba0e8dbc"
  "http://127.0.0.1:8545"
);

const dexes: DEX[] = [
  new UniswapV2("UniswapV2", "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f"),
];

const stable = "0xdAC17F958D2ee523a2206206994597C13D831ec7"; // USDT

const bot = new Bot(provider, dexes, stable);

process.on("uncaughtException", (exception) => {
  console.log("Unhandled Exception", exception);
});

process.on("unhandledRejection", (reason, p) => {
  console.log("Unhandled Rejection at: Promise ", p, " reason: ", reason);
});

process.on("exit", (code) => {
  console.log("Process exited with code", code);
});

bot
  .load()
  .then(() => bot.run())
  .then(() => console.log("Bot finished"))
  .catch(console.error);
