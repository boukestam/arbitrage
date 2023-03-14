import { batch } from "./utils";
import fs from "fs";

import erc20ABI from "./abi/erc20.json";
import ethers, { Contract } from "ethers";
import { Pair } from "./types";

export interface TokenInfo {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
}

export async function loadTokens(
  tokens: string[],
  provider: ethers.providers.JsonRpcBatchProvider
) {
  const file = "data/tokens.json";

  let items: any[] = [];
  const infos = new Map<string, TokenInfo>();

  if (fs.existsSync(file)) {
    items = JSON.parse(fs.readFileSync(file).toString());

    for (const item of items) {
      infos.set(item.address, {
        address: item.address,
        name: item.name || "Unknown",
        symbol: item.symbol || "---",
        decimals: item.decimals || 18,
      });
    }
  }

  tokens = tokens.filter((token) => !infos.has(token));

  if (tokens.length > 0) {
    console.log("Loading " + tokens.length + " tokens");

    const newInfos = await batch(
      tokens,
      async (token) => {
        const contract = new Contract(token, erc20ABI, provider);
        const info: any = {
          address: token,
        };

        try {
          const symbol = await contract.symbol();
          info.symbol = symbol;
        } catch {}

        try {
          const name = await contract.name();
          info.name = name;
        } catch {}

        try {
          const decimals = await contract.decimals();
          info.decimals = Number(decimals);
        } catch {}

        return info;
      },
      100,
      true
    );

    for (const info of newInfos) {
      items.push(info);
      infos.set(info.address, {
        address: info.address,
        name: info.name || "Unknown",
        symbol: info.symbol || "---",
        decimals: info.decimals || 18,
      });
    }

    fs.writeFileSync(file, JSON.stringify(items));
  }

  return infos;
}
