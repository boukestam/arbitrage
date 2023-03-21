import { ethers } from "ethers";
import { sleep } from "./utils";

export async function waitForBlock(
  provider: ethers.providers.BaseProvider,
  block: number
) {
  let currentBlock = await provider.getBlockNumber();
  while (currentBlock < block) {
    await sleep(1000);
    currentBlock = await provider.getBlockNumber();
  }
}
