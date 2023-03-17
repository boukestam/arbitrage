const RESOLUTION = 96n;
const Q32 = 2n ** 32n;
const Q96 = 2n ** 96n;
const MAX_UINT256 =
  0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffn;

const POWERS_OF_2 = [128n, 64n, 32n, 16n, 8n, 4n, 2n, 1n].map((pow) => [
  pow,
  2n ** pow,
]);

export function getAmount0ForLiquidity(
  sqrtRatioAX96: bigint,
  sqrtRatioBX96: bigint,
  liquidity: bigint
) {
  let sqrtRatioA = sqrtRatioAX96;
  let sqrtRatioB = sqrtRatioBX96;

  if (sqrtRatioA > sqrtRatioB) {
    sqrtRatioA = sqrtRatioB;
    sqrtRatioB = sqrtRatioA;
  }

  const leftShiftedLiquidity = liquidity << RESOLUTION;
  const sqrtDiff = sqrtRatioB - sqrtRatioA;
  const multipliedRes = leftShiftedLiquidity * sqrtDiff;
  const numerator = multipliedRes / sqrtRatioB;

  const amount0 = numerator / sqrtRatioA;

  return amount0;
}

export function getAmount1ForLiquidity(
  sqrtRatioAX96: bigint,
  sqrtRatioBX96: bigint,
  liquidity: bigint
) {
  let sqrtRatioA = sqrtRatioAX96;
  let sqrtRatioB = sqrtRatioBX96;

  if (sqrtRatioA > sqrtRatioB) {
    sqrtRatioA = sqrtRatioB;
    sqrtRatioB = sqrtRatioA;
  }

  const sqrtDiff = sqrtRatioB - sqrtRatioA;
  const multipliedRes = liquidity * sqrtDiff;

  const amount1 = multipliedRes / Q96;

  return amount1;
}

function mulShift(val: bigint, mulBy: bigint): bigint {
  return (val * mulBy) >> 128n;
}

export function getSqrtRatioAtTick(tick: bigint): bigint {
  const absTick = tick < 0n ? tick * -1n : tick;

  let ratio =
    (absTick & 0x1n) !== 0n
      ? BigInt("0xfffcb933bd6fad37aa2d162d1a594001")
      : BigInt("0x100000000000000000000000000000000");
  if ((absTick & 0x2n) !== 0n) {
    ratio = mulShift(ratio, 0xfff97272373d413259a46990580e213an);
  }
  if ((absTick & 0x4n) !== 0n) {
    ratio = mulShift(ratio, 0xfff2e50f5f656932ef12357cf3c7fdccn);
  }
  if ((absTick & 0x8n) !== 0n) {
    ratio = mulShift(ratio, 0xffe5caca7e10e4e61c3624eaa0941cd0n);
  }
  if ((absTick & 0x10n) !== 0n) {
    ratio = mulShift(ratio, 0xffcb9843d60f6159c9db58835c926644n);
  }
  if ((absTick & 0x20n) !== 0n) {
    ratio = mulShift(ratio, 0xff973b41fa98c081472e6896dfb254c0n);
  }
  if ((absTick & 0x40n) !== 0n) {
    ratio = mulShift(ratio, 0xff2ea16466c96a3843ec78b326b52861n);
  }
  if ((absTick & 0x80n) !== 0n) {
    ratio = mulShift(ratio, 0xfe5dee046a99a2a811c461f1969c3053n);
  }
  if ((absTick & 0x100n) !== 0n) {
    ratio = mulShift(ratio, 0xfcbe86c7900a88aedcffc83b479aa3a4n);
  }
  if ((absTick & 0x200n) !== 0n) {
    ratio = mulShift(ratio, 0xf987a7253ac413176f2b074cf7815e54n);
  }
  if ((absTick & 0x400n) !== 0n) {
    ratio = mulShift(ratio, 0xf3392b0822b70005940c7a398e4b70f3n);
  }
  if ((absTick & 0x800n) !== 0n) {
    ratio = mulShift(ratio, 0xe7159475a2c29b7443b29c7fa6e889d9n);
  }
  if ((absTick & 0x1000n) !== 0n) {
    ratio = mulShift(ratio, 0xd097f3bdfd2022b8845ad8f792aa5825n);
  }
  if ((absTick & 0x2000n) !== 0n) {
    ratio = mulShift(ratio, 0xa9f746462d870fdf8a65dc1f90e061e5n);
  }
  if ((absTick & 0x4000n) !== 0n) {
    ratio = mulShift(ratio, 0x70d869a156d2a1b890bb3df62baf32f7n);
  }
  if ((absTick & 0x8000n) !== 0n) {
    ratio = mulShift(ratio, 0x31be135f97d08fd981231505542fcfa6n);
  }
  if ((absTick & 0x10000n) !== 0n) {
    ratio = mulShift(ratio, 0x9aa508b5b7a84e1c677de54f3e99bc9n);
  }
  if ((absTick & 0x20000n) !== 0n) {
    ratio = mulShift(ratio, 0x5d6af8dedb81196699c329225ee604n);
  }
  if ((absTick & 0x40000n) !== 0n) {
    ratio = mulShift(ratio, 0x2216e584f5fa1ea926041bedfe98n);
  }
  if ((absTick & 0x80000n) !== 0n) {
    ratio = mulShift(ratio, 0x48a170391f7dc42444e8fa2n);
  }

  if (tick > 0) {
    ratio = MAX_UINT256 / ratio;
  }

  // back to Q96
  const result = ratio % Q32 > 0n ? ratio / Q32 + 1n : ratio / Q32;

  return result;
}

export function getTickAtSqrtRatio(sqrtRatioX96: bigint): bigint {
  const sqrtRatioX128 = sqrtRatioX96 << 32n;

  const msb = mostSignificantBit(sqrtRatioX128);

  let r = 0n;
  if (msb >= 128) {
    r = sqrtRatioX128 >> (msb - 127n);
  } else {
    r = sqrtRatioX128 << (127n - msb);
  }

  let log_2 = (msb - 128n) << 64n;

  for (let i = 0; i < 14; i += 1) {
    r = (r * r) >> 127n;
    const f = r >> 128n;
    log_2 = log_2 | (f << (63n - BigInt(i)));
    r = r >> f;
  }

  const log_sqrt10001 = log_2 * 255738958999603826347141n;

  const tickLow =
    (log_sqrt10001 - 3402992956809132418596140100660247210n) >> 128n;
  const tickHigh =
    (log_sqrt10001 + 291339464771989622907027621153398088495n) >> 128n;

  let result = tickLow;

  if (tickLow !== tickHigh && getSqrtRatioAtTick(tickHigh) <= sqrtRatioX96) {
    result = tickHigh;
  }

  return result;
}

function mostSignificantBit(x: bigint): bigint {
  let msb = 0n;
  for (const [power, min] of POWERS_OF_2) {
    if (x >= min) {
      x = x >> power;
      msb += power;
    }
  }
  return msb;
}
