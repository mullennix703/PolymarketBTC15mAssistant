import { clamp } from "../utils.js";

function normalCdf(x) {
  // Abramowitz & Stegun approximation for erf
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * ax);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const erf = sign * (1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-ax * ax));
  return 0.5 * (1 + erf);
}

function mean(xs) {
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stddev(xs) {
  if (xs.length < 2) return null;
  const m = mean(xs);
  let v = 0;
  for (const x of xs) v += (x - m) ** 2;
  v /= (xs.length - 1);
  return Math.sqrt(v);
}

export function estimateMinuteLogReturnVolatility(closes, lookbackMinutes = 60) {
  if (!Array.isArray(closes) || closes.length < 3) return { sigma: null, mu: null, n: 0 };

  const lookback = Math.max(2, Math.min(lookbackMinutes, closes.length - 1));
  const start = closes.length - lookback;
  const rets = [];
  for (let i = start; i < closes.length; i += 1) {
    const prev = closes[i - 1];
    const cur = closes[i];
    if (!Number.isFinite(prev) || !Number.isFinite(cur) || prev <= 0 || cur <= 0) continue;
    rets.push(Math.log(cur / prev));
  }

  return {
    sigma: stddev(rets),
    mu: mean(rets),
    n: rets.length
  };
}

export function probFinishAboveStrike({ currentPrice, priceToBeat, remainingMinutes, sigmaPerMinute, muPerMinute = 0 }) {
  if (currentPrice === null || priceToBeat === null) return null;
  if (!Number.isFinite(currentPrice) || !Number.isFinite(priceToBeat) || currentPrice <= 0 || priceToBeat <= 0) return null;
  if (remainingMinutes === null || remainingMinutes === undefined || !Number.isFinite(remainingMinutes)) return null;

  const t = Math.max(0, remainingMinutes);
  if (t === 0) {
    if (currentPrice > priceToBeat) return 1;
    if (currentPrice < priceToBeat) return 0;
    return 0.5;
  }

  if (sigmaPerMinute === null || !Number.isFinite(sigmaPerMinute) || sigmaPerMinute <= 0) {
    // Fall back to a simple distance-based step.
    if (currentPrice > priceToBeat) return 0.75;
    if (currentPrice < priceToBeat) return 0.25;
    return 0.5;
  }

  const sigmaT = sigmaPerMinute * Math.sqrt(t);
  if (sigmaT < 1e-6) {
    if (currentPrice > priceToBeat) return 1;
    if (currentPrice < priceToBeat) return 0;
    return 0.5;
  }

  const drift = muPerMinute * t;
  const d = (Math.log(currentPrice / priceToBeat) + drift) / sigmaT;
  return clamp(normalCdf(d), 0, 1);
}

export function blendTaWithStrikeProb({ taUp, strikeUp, remainingMinutes, windowMinutes, alpha = 1.75 }) {
  if (taUp === null || taUp === undefined) return { blendedUp: strikeUp ?? null, wTa: 0, wStrike: 1 };
  if (strikeUp === null || strikeUp === undefined) return { blendedUp: taUp ?? null, wTa: 1, wStrike: 0 };

  const wTa = clamp(remainingMinutes / windowMinutes, 0, 1);
  const wStrike = 1 - wTa;

  // Use strike probability as the base (it encodes distance-to-strike + time-to-expiry).
  // TA becomes a bounded tilt in log-odds space that naturally decays as settlement approaches.
  const eps = 1e-6;
  const pStrike = clamp(strikeUp, eps, 1 - eps);
  const pTa = clamp(taUp, 0, 1);

  const logit = Math.log(pStrike / (1 - pStrike));
  const tilt = (pTa - 0.5) * 2; // [-1, +1]
  const z = logit + alpha * tilt * wTa;
  const blendedUp = clamp(1 / (1 + Math.exp(-z)), 0, 1);
  return { blendedUp, wTa, wStrike };
}

export function scoreDirection(inputs) {
  const {
    price,
    priceToBeat,
    currentPrice,
    vwap,
    vwapSlope,
    rsi,
    rsiSlope,
    macd,
    heikenColor,
    heikenCount,
    failedVwapReclaim,
    usePriceToBeatDistance = true
  } = inputs;

  let up = 1;
  let down = 1;

  // Optional: price-to-beat distance scoring.
  // When using a volatility-based strike probability model, you typically want this OFF to avoid double-counting.
  if (usePriceToBeatDistance) {
    const priceForTarget = currentPrice ?? price;
    if (priceForTarget !== null && priceToBeat !== null && Number.isFinite(priceForTarget) && Number.isFinite(priceToBeat)) {
      const distance = (priceForTarget - priceToBeat) / priceToBeat;
      const absDistance = Math.abs(distance);

      // For 15min markets, even small distances matter significantly
      // Use exponential scoring to make distance dominant
      if (distance > 0) {
        // Price is ABOVE target - favors UP
        if (absDistance > 0.01) {           // >1%
          up += 20;
        } else if (absDistance > 0.005) {   // 0.5-1%
          up += 15;
        } else if (absDistance > 0.002) {   // 0.2-0.5%
          up += 12;
        } else if (absDistance > 0.001) {   // 0.1-0.2%
          up += 10;
        } else if (absDistance > 0.0005) {  // 0.05-0.1%
          up += 8;
        } else if (absDistance > 0.0002) {  // 0.02-0.05%
          up += 6;
        } else {                             // <0.02%
          up += 4;
        }
      } else if (distance < 0) {
        // Price is BELOW target - favors DOWN
        if (absDistance > 0.01) {           // >1%
          down += 20;
        } else if (absDistance > 0.005) {   // 0.5-1%
          down += 15;
        } else if (absDistance > 0.002) {   // 0.2-0.5%
          down += 12;
        } else if (absDistance > 0.001) {   // 0.1-0.2%
          down += 10;
        } else if (absDistance > 0.0005) {  // 0.05-0.1%
          down += 8;
        } else if (absDistance > 0.0002) {  // 0.02-0.05%
          down += 6;
        } else {                             // <0.02%
          down += 4;
        }
      }
      // distance === 0: no bonus either way
    }
  }

  if (price !== null && vwap !== null) {
    if (price > vwap) up += 2;
    if (price < vwap) down += 2;
  }

  if (vwapSlope !== null) {
    if (vwapSlope > 0) up += 2;
    if (vwapSlope < 0) down += 2;
  }

  if (rsi !== null && rsiSlope !== null) {
    if (rsi > 55 && rsiSlope > 0) up += 2;
    if (rsi < 45 && rsiSlope < 0) down += 2;
  }

  if (macd?.hist !== null && macd?.histDelta !== null) {
    const expandingGreen = macd.hist > 0 && macd.histDelta > 0;
    const expandingRed = macd.hist < 0 && macd.histDelta < 0;
    if (expandingGreen) up += 2;
    if (expandingRed) down += 2;

    if (macd.macd > 0) up += 1;
    if (macd.macd < 0) down += 1;
  }

  if (heikenColor) {
    if (heikenColor === "green" && heikenCount >= 2) up += 1;
    if (heikenColor === "red" && heikenCount >= 2) down += 1;
  }

  if (failedVwapReclaim === true) down += 3;

  const rawUp = up / (up + down);
  return { upScore: up, downScore: down, rawUp };
}

export function applyTimeAwareness(rawUp, remainingMinutes, windowMinutes) {
  const timeDecay = clamp(remainingMinutes / windowMinutes, 0, 1);
  const adjustedUp = clamp(0.5 + (rawUp - 0.5) * timeDecay, 0, 1);
  return { timeDecay, adjustedUp, adjustedDown: 1 - adjustedUp };
}
