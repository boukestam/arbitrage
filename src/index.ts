import { startServer } from "./bot/server";
import { createArbitrumBot } from "./networks/arbitrum";
import { createEthereumBot } from "./networks/ethereum";

process.on("uncaughtException", (exception) => {
  console.log("Unhandled Exception", exception);
});

process.on("unhandledRejection", (reason, p) => {
  console.log("Unhandled Rejection at: Promise ", p, " reason: ", reason);
});

async function main() {
  const ethereumBot = await createEthereumBot();
  //const arbitrumBot = await createArbitrumBot();

  const bots = [
    ethereumBot,
    //arbitrumBot
  ];

  const server = startServer(bots, 8080);

  process.on("exit", (code) => {
    server.close();
    console.log("Process exited with code", code);
  });

  console.log("Loading bots...");

  await Promise.all(bots.map((bot) => bot.load()));
  await Promise.all(bots.map((bot) => bot.init()));

  console.log("Loading done");
  console.log("Running bots...");

  await Promise.all(bots.map((bot) => bot.run()));
}

main();
