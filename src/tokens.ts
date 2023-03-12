import { batch } from "./utils";
import fs from "fs";

import erc20ABI from "./abi/erc20.json";
import { Contract, ContractRunner } from "ethers";
import { Pair } from "./types";

export interface TokenInfo {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
}

export async function loadTokens(tokens: string[], provider: ContractRunner) {
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
      (token) => {
        const contract = new Contract(token, erc20ABI, provider);
        const info: any = {
          address: token,
        };

        return new Promise<any>((resolve) => {
          const timer = setTimeout(() => resolve(info), 30000); // this is needed to prevent process exit

          contract
            .symbol()
            .then((symbol: any) => {
              info.symbol = symbol;
              return contract.name();
            })
            .then((name: any) => {
              info.name = name;
              return contract.decimals();
            })
            .then((decimals: any) => {
              info.decimals = Number(decimals);
              clearTimeout(timer);
              resolve(info);
            })
            .catch((e) => {
              clearTimeout(timer);
              resolve(info);
            });
        });
      },
      1000,
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
