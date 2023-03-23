import { ethers } from "ethers";
import { UniswapV2 } from "../exchanges/uniswap-v2";
import { Bot } from "../bot/bot";
import { UniswapV3 } from "../exchanges/uniswap-v3";
import { getStarters } from "../arbitrage/starters";

const provider = new ethers.providers.JsonRpcBatchProvider(
  //"http://127.0.0.1:8545"
  "https://nd-497-196-530.p2pify.com/b5baf29f386396a64b054628ba0e8dbc"
);

export const blocked = new Set<string>([
  // Taxed
  "0xCc802c45B55581713cEcd1Eb17BE9Ab7fcCb0844", // BHNY
  "0x131157c6760f78f7dDF877C0019Eba175BA4b6F6", // BigSB
  "0x73A83269b9bbAFC427E76Be0A2C1a1db2a26f4C2", // CIV
  "0x7101a9392EAc53B01e7c07ca3baCa945A56EE105", // X7101
  "0x7102DC82EF61bfB0410B1b1bF8EA74575bf0A105", // X7102
  "0x7103eBdbF1f89be2d53EFF9B3CF996C9E775c105", // X7103
  "0x7104D1f179Cc9cc7fb5c79Be6Da846E3FBC4C105", // X7104
  "0x7105FAA4a26eD1c67B8B2b41BEc98F06Ee21D105", // X7105
  "0xd5De579f8324E3625bDC5E8C6F3dB248614a41C5", // SHIBONE
  "0xFeeeef4D7b4Bf3cc8BD012D02D32Ba5fD3D51e31", // TAIL
  "0xBfB2b6870501a6Ff17121D676A0A45a38c9eeD1e", // TOAD
  "0x616ef40D55C0D2c506f4d6873Bda8090b79BF8fC", // KTO
  "0x33D203FA03bb30b133De0fE2d6533C268bA286B6", // MANDOX

  // Weird
  "0xd233D1f6FD11640081aBB8db125f722b5dc729dc", // Old USD
  "0x9EA3b5b4EC044b70375236A281986106457b20EF", // DELTA
]);

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
  "0xE592427A0AEce92De3Edee1F18E0157C05861564",
  12369621,
  16772418
);

export async function createEthereumBot() {
  const stable = "0xdAC17F958D2ee523a2206206994597C13D831ec7";

  await uniswapV3.loadFromFile(provider, "ethereum");

  const starters = getStarters(uniswapV3, stable);

  console.log("Found " + starters.length + " starters");

  const flashbotsProvider = new ethers.providers.JsonRpcProvider(
    "https://rpc.flashbots.net"
  );

  return new Bot(
    "ethereum",
    provider,
    flashbotsProvider,
    [
      uniswapV2,
      sushiSwap,
      shibaSwap,
      // fraxSwap,
      // uniswapV3,
    ],
    blocked,
    "0x7d68D27905550C22B0547A6838A2651A0db662df",
    stable,
    starters,
    1750000000n,
    true
  );
}
