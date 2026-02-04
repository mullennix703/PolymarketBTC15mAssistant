import { clamp } from "../utils.js";

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
    failedVwapReclaim
  } = inputs;

  let up = 1;
  let down = 1;

  // Price-to-beat distance scoring (highest weight - most important factor)
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
