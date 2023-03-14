export interface StartToken {
  address: string;
  v3Pool: string;
  isToken0: boolean;
  fee: number;
}

export const blocked = new Set<string>([
  // Taxed
  "0xCc802c45B55581713cEcd1Eb17BE9Ab7fcCb0844", // BHNY
  "0x131157c6760f78f7dDF877C0019Eba175BA4b6F6", // BigSB
  "0x73A83269b9bbAFC427E76Be0A2C1a1db2a26f4C2", // CIV
  "0x7101a9392EAc53B01e7c07ca3baCa945A56EE105", // X7101
  "0x7102DC82EF61bfB0410B1b1bF8EA74575bf0A105", // X7102
  "0x7103eBdbF1f89be2d53EFF9B3CF996C9E775c105", // X7103
  "0x7104D1f179Cc9cc7fb5c79Be6Da846E3FBC4C105", // X7104
  "0x7105FAA4a26eD1c67B8B2b41BEc98F06Ee21D105", // X7105

  // Weird
  "0xd233D1f6FD11640081aBB8db125f722b5dc729dc", // Old USD
]);

export const starters: StartToken[] = [
  {
    address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // WETH
    v3Pool: "0x11b815efB8f581194ae79006d24E0d814B7697F6",
    isToken0: true,
    fee: 500,
  },
  {
    address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", // USDT
    v3Pool: "0x11b815efB8f581194ae79006d24E0d814B7697F6",
    isToken0: false,
    fee: 500,
  },

  {
    address: "0x6B175474E89094C44Da98b954EedeAC495271d0F", // DAI
    v3Pool: "0x5777d92f208679DB4b9778590Fa3CAB3aC9e2168",
    isToken0: true,
    fee: 100,
  },
  {
    address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC
    v3Pool: "0x5777d92f208679DB4b9778590Fa3CAB3aC9e2168",
    isToken0: false,
    fee: 100,
  },

  {
    address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", // WBTC
    v3Pool: "0x4585FE77225b41b697C938B018E2Ac67Ac5a20c0",
    isToken0: true,
    fee: 3000,
  },

  {
    address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984", // UNI
    v3Pool: "0x1d42064Fc4Beb5F8aAF85F4617AE8b3b5B8Bd801",
    isToken0: true,
    fee: 3000,
  },

  {
    address: "0x7D1AfA7B718fb893dB30A3aBc0Cfc608AaCfeBB0", // MATIC
    v3Pool: "0x290A6a7460B308ee3F19023D2D00dE604bcf5B42",
    isToken0: true,
    fee: 3000,
  },

  {
    address: "0x514910771AF9Ca656af840dff83E8264EcF986CA", // LINK
    v3Pool: "0xa6Cc3C2531FdaA6Ae1A3CA84c2855806728693e8",
    isToken0: true,
    fee: 3000,
  },
];
