import { ethers, Contract } from "ethers";

export async function batch<I, O>(
  inputs: I[],
  f: (input: I) => Promise<O>,
  batchSize: number,
  log?: boolean
): Promise<O[]> {
  const allResults: O[] = [];

  for (let i = 0; i < inputs.length; i += batchSize) {
    if (log) console.log("Batch item: " + i);

    const batch = inputs.slice(i, i + batchSize);

    const results = await retry(() => {
      const promises = batch.map((item) => f(item));
      return Promise.all(promises);
    }, 3);

    for (const result of results) allResults.push(result);
  }

  return allResults;
}

export async function retry<T>(
  f: () => Promise<T>,
  maxRetries: number
): Promise<T> {
  let retry = 0;
  while (true) {
    try {
      return await f();
    } catch (e) {
      if (retry >= maxRetries) throw e;
      console.log("Error in async function, retry nr " + retry);
      retry++;
    }
  }
}

export function createMap<T>(
  items: T[],
  getKeys: (item: T) => string[]
): Map<string, T[]> {
  const map = new Map<string, T[]>();

  for (const item of items) {
    const keys = getKeys(item);
    for (const key of keys) {
      addItemToMap(map, item, key);
    }
  }

  return map;
}

function addItemToMap<T>(map: Map<string, T[]>, item: T, key: string) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(item);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(() => resolve(), ms));
}

export function bigintToHex(value: bigint, length: number) {
  const s = value.toString(16);
  return "0".repeat(length * 2 - s.length) + s;
}
