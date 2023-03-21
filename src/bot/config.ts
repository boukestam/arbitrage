require("dotenv").config();

export const constants = {
  ADDRESS: process.env.ADDRESS as string,
  PRIVATE_KEY: process.env.PRIVATE_KEY as string,

  MIN_LIQUIDITY_IN_USDT: BigInt(process.env.MIN_LIQUIDITY_IN_USDT as string),
};
