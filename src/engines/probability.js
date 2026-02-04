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
    
    if (distance > 0.01) {           // Above target by >1%
      up += 8;
    } else if (distance > 0.005) {   // Above by 0.5-1%
      up += 6;
    } else if (distance > 0.002) {   // Above by 0.2-0.5%
      up += 4;
    } else if (distance > 0.0005) {  // Above by 0.05-0.2%
      up += 2;
    } else if (distance > 0) {       // Slightly above
      up += 1;
    } else if (distance < -0.01) {   // Below target by >1%
      down += 8;
    } else if (distance < -0.005) {  // Below by 0.5-1%
      down += 6;
    } else if (distance < -0.002) {  // Below by 0.2-0.5%
      down += 4;
    } else if (distance < -0.0005) { // Below by 0.05-0.2%
      down += 2;
    } else if (distance < 0) {       // Slightly below
      down += 1;
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
