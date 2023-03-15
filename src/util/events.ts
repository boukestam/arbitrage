import { BigNumber, Contract, Event } from "ethers";

export async function getEvents(
  contract: Contract, 
  eventNames: string[], 
  fromBlock: number, 
  toBlock: number, 
  blocksPerRequest: number,
  requestsPerBatch: number,
  log?: boolean
) {
  const events: Event[] = [];
  
  let batchPromises: Promise<Event[]>[] = [];

  const eventFilters = eventNames.map(event => contract.filters[event]());

  for (let block = fromBlock; block <= toBlock; block += blocksPerRequest) {
    const endBlock = Math.min(block + blocksPerRequest - 1, toBlock);

    if (log) console.log("Getting events from block: " + block + " - " + endBlock);

    const promises = eventFilters.map(filter => contract.queryFilter(filter, Math.floor(block), Math.floor(endBlock)));

    for (const promise of promises) {
      batchPromises.push((async () => {
        try {
          return await promise;
        } catch (e) {
          console.error("Error in batch " + block + " - " + endBlock);
          throw e;
        }
      })());
    }

    if (batchPromises.length === requestsPerBatch * eventNames.length || block + blocksPerRequest > toBlock) {
      let batches;

      let retry = 0;
      while (true) {
        try {
          batches = await Promise.all(batchPromises);
          break;
        } catch (e) {
          if (retry >= 5) throw e;
          console.log("Error in batch, retry nr " + retry);
          retry++;
        }
      }

      const sortedEvents: Event[] = [];
      
      for (const batchEvents of batches) {
        for (const event of batchEvents) {
          sortedEvents.push(event);
        }
      }

      function compareEvents(a: Event, b: Event) {
        if (a.blockNumber < b.blockNumber) return -1;
        if (a.blockNumber > b.blockNumber) return 1;

        if (a.transactionIndex < b.transactionIndex) return -1;
        if (a.transactionIndex > b.transactionIndex) return 1;

        if (a.logIndex < b.logIndex) return -1;
        if (a.logIndex > b.logIndex) return 1;
        
        throw new Error("Double log");
      }

      sortedEvents.sort(compareEvents);
      for (const event of sortedEvents) {
        events.push(event);
      }

      batchPromises = [];
    }
  }

  return events;
}