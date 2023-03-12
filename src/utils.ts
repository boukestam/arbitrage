import { Contract, Log } from "ethers";

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
