import { ContractRunner } from "ethers";
import { CircularArbitrager } from "./arbitrage";
import { DEX, Pair } from "./types";
import fs from "fs";
import { loadTokens, TokenInfo } from "./tokens";
import { batch } from "./utils";
import { findLiquidPairs } from "./liquidity";

const taxed = new Set<string>([
  "0xCc802c45B55581713cEcd1Eb17BE9Ab7fcCb0844", // BHNY
  "0x131157c6760f78f7dDF877C0019Eba175BA4b6F6", // BigSB
  "0x73A83269b9bbAFC427E76Be0A2C1a1db2a26f4C2", // CIV
  "0x7101a9392EAc53B01e7c07ca3baCa945A56EE105", // X7101
  "0x7102DC82EF61bfB0410B1b1bF8EA74575bf0A105", // X7102
  "0x7103eBdbF1f89be2d53EFF9B3CF996C9E775c105", // X7103
  "0x7104D1f179Cc9cc7fb5c79Be6Da846E3FBC4C105", // X7104
  "0x7105FAA4a26eD1c67B8B2b41BEc98F06Ee21D105", // X7105
]);

export class Bot {
  provider: ContractRunner;
  dexes: DEX[];
  stable: string;

  pairs: Pair[] = [];
  tokens = new Map<string, TokenInfo>();

  constructor(provider: ContractRunner, dexes: DEX[], stable: string) {
    this.provider = provider;
    this.dexes = dexes;
    this.stable = stable;
  }

  async load() {
    for (const dex of this.dexes) {
      const file = "data/" + dex.name + ".json";

      console.log("Loading dex: " + dex.name + "...");

      if (fs.existsSync(file)) {
        const json = JSON.parse(fs.readFileSync(file).toString());
        dex.fromJSON(json);
      } else {
        await dex.load(this.provider);
        const json = dex.toJSON();
        fs.writeFileSync(file, JSON.stringify(json));
      }

      for (const pair of dex.getPairs()) {
        this.pairs.push(pair);
      }
    }

    const tokens = new Set<string>();
    for (const pair of this.pairs) {
      tokens.add(pair.token0);
      tokens.add(pair.token1);
    }

    console.log("Loading tokens...");

    this.tokens = await loadTokens(Array.from(tokens.values()), this.provider);
  }

  async run() {
    console.log("Finding liquid pairs");
    this.pairs = findLiquidPairs(this.pairs, this.stable, 100000000000n);
    console.log("Liquid pairs: " + this.pairs.length);

    console.log("Finding taxes...");
    const taxes = await batch(
      this.pairs,
      (pair) => pair.hasTax(this.provider),
      10
    );
    this.pairs = this.pairs.filter((pair, index) => !taxes[index]);
    console.log("Untaxed pairs: " + this.pairs.length);

    const arbitrage = new CircularArbitrager(this.pairs);

    console.log("Reloading arbitrage...");

    await arbitrage.reload(this.provider);

    console.log("Finding arbitrages...");

    const arbitrages = arbitrage.find();

    console.log("Found " + arbitrages.length + " arbitrages");

    arbitrages.sort(
      (a, b) => b.getProfitPercentage() - a.getProfitPercentage()
    );

    for (const arbitrage of arbitrages.splice(0, 10)) {
      console.log(arbitrage.toString(this.tokens));
    }
  }
}
