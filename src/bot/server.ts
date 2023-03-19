import { BigNumber } from "ethers";
import http from "http";
import { Bot } from "./bot";

const DEFAULT_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function startServer(bot: Bot, port: number) {
  return http
    .createServer(function (req, res) {
      try {
        const history = bot.history.map((batch) =>
          batch.map((execution) => execution.toObject(bot.tokens))
        );
        const executed = bot.executed.map((execution) =>
          execution.toObject(bot.tokens)
        );
        const json = JSON.stringify({ history, executed }, (key, value) => {
          // Convert bigints to strings
          if (typeof value === "bigint" || value instanceof BigNumber)
            return value.toString();

          // Trim large strings
          if (typeof value === "string" && value.length > 1000)
            return value.substring(0, 1000) + "...";

          return value;
        });

        res.writeHead(200, {
          ...DEFAULT_HEADERS,
          "Content-Type": "application/json",
        });
        res.write(json);
        res.end();
      } catch (e) {
        console.error(e);
        res.writeHead(500, {
          ...DEFAULT_HEADERS,
          "Content-Type": "text/plain",
        });
        res.write("Internal server error: " + e.toString());
        res.end();
      }
    })
    .listen(port);
}
