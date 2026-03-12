/**
 * Funding History Service
 * Checks whether a token's funding rate differential has been consistently wide
 * over the last 24 hours — not just at the current moment.
 *
 * Data sources:
 *   Delta  : cdn.india.deltaex.org/v2/chart/history  (FUNDING:{symbol}, 4h candles)
 *   Binance: fapi.binance.com/fapi/v1/fundingRate    (actual settled timestamps)
 *
 * Both are mapped by real timestamps, NOT by assuming fixed intervals.
 *
 * Rate units — everything is kept in PERCENT to match the rest of the bot:
 *   Delta chart API  → values already in percent  (e.g. 0.066 = 0.066%)
 *   Binance REST API → fundingRate is decimal      (e.g. 0.0001 → × 100 → 0.01%)
 */

import axios from "axios";

const DELTA_CHART_BASE = "https://cdn.india.deltaex.org/v2";
const BINANCE_BASE = "https://fapi.binance.com";

const LOOKBACK_HOURS = 28; // fetch slightly more than 24h for buffer
const CACHE_TTL_MS = 60 * 60 * 1000; // refresh cache every 60 minutes

// In-memory cache: `${deltaSymbol}|${binanceSymbol}` → { fetchedAt, deltaSlots, binanceHistory }
const historyCache = new Map();

// ─── HTTP helpers ─────────────────────────────────────────────────────────────
const deltaChartClient = axios.create({
  baseURL: DELTA_CHART_BASE,
  timeout: 8000,
});
const binanceClient = axios.create({ baseURL: BINANCE_BASE, timeout: 8000 });

async function fetchWithRetry(client, url, params = {}, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await client.get(url, { params });
      return res.data;
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
}

// ─── Delta: fetch last ~28h of 4h funding candles ────────────────────────────
// Returns array of { timeSec, rate (percent) } sorted ascending.
// "open" value = funding rate AT the settlement moment (start of that 4h period).
async function fetchDeltaFundingSlots(deltaSymbol) {
  const nowSec = Math.floor(Date.now() / 1000);
  const fromSec = nowSec - LOOKBACK_HOURS * 3600;

  try {
    const data = await fetchWithRetry(deltaChartClient, "/chart/history", {
      symbol: `FUNDING:${deltaSymbol}`,
      resolution: 240, // 4h in minutes
      from: fromSec,
      to: nowSec + 3600,
      cache_ttl: "10m",
    });

    const series = data?.result;
    if (!series || !Array.isArray(series.t) || !Array.isArray(series.o)) {
      return [];
    }

    const slots = [];
    for (let i = 0; i < series.t.length; i++) {
      const timeSec = Number(series.t[i]);
      const rate = Number(series.o[i]); // open = rate at settlement moment, already in percent
      if (Number.isFinite(timeSec) && Number.isFinite(rate)) {
        slots.push({ timeSec, rate });
      }
    }

    return slots.sort((a, b) => a.timeSec - b.timeSec);
  } catch {
    return [];
  }
}

// ─── Binance: fetch actual settled funding history ────────────────────────────
// Returns array of { fundingTimeSec, rate (percent) } sorted ascending.
// Returns null if the symbol is not listed on Binance futures (400 response).
async function fetchBinanceFundingHistory(binanceSymbol) {
  try {
    const data = await fetchWithRetry(binanceClient, "/fapi/v1/fundingRate", {
      symbol: binanceSymbol,
      limit: 10, // covers well past 24h regardless of settlement interval
    });

    if (!Array.isArray(data)) return [];

    return data
      .map((r) => ({
        fundingTimeSec: Math.floor(Number(r.fundingTime) / 1000),
        rate: parseFloat(r.fundingRate) * 100, // decimal → percent
      }))
      .filter(
        (r) => Number.isFinite(r.fundingTimeSec) && Number.isFinite(r.rate),
      )
      .sort((a, b) => a.fundingTimeSec - b.fundingTimeSec);
  } catch (err) {
    if (err.response?.status === 400) return null; // symbol not on Binance futures
    return [];
  }
}

// ─── Find Binance rate active at a given point in time ───────────────────────
// Uses actual timestamps — no assumption about interval length.
// Picks the LAST settled entry whose fundingTimeSec <= targetTimeSec.
function getBinanceRateAtTime(binanceHistory, targetTimeSec) {
  let chosen = null;
  for (const point of binanceHistory) {
    if (point.fundingTimeSec <= targetTimeSec) {
      chosen = point;
    } else {
      break; // list is sorted ascending; nothing after this will qualify
    }
  }
  return chosen ? chosen.rate : null;
}

// ─── Diff calculation (mirrors ArbitrageEngine.calculateFundingDifference) ───
function calcDiff(rateA, rateB) {
  const signA = Math.sign(rateA);
  const signB = Math.sign(rateB);
  if (signA === signB) {
    return Math.abs(Math.abs(rateA) - Math.abs(rateB));
  } else {
    return Math.abs(rateA) + Math.abs(rateB);
  }
}

// ─── Evaluate cached data against threshold ───────────────────────────────────
function evaluateHistory(deltaSlots, binanceHistory, threshold, deltaSymbol) {
  // Symbol not on Binance futures — skip the check gracefully
  if (binanceHistory === null) {
    return {
      pass: true,
      reason: `${deltaSymbol}: not on Binance futures — history check skipped`,
      skipped: true,
      slots: [],
    };
  }

  if (!deltaSlots.length || !binanceHistory.length) {
    return {
      pass: true,
      reason: `${deltaSymbol}: insufficient data (Δ=${deltaSlots.length} BNB=${binanceHistory.length}) — skipped`,
      skipped: true,
      slots: [],
    };
  }

  // Use ACTUAL Delta settlement timestamps (non-zero rate) within last 24h.
  // This naturally handles both 4h tokens (6 slots) and 8h tokens (3 slots)
  // without assuming a fixed grid — no more false 0.0000% at non-settlement times.
  const nowSec = Math.floor(Date.now() / 1000);
  const cutoffSec = nowSec - 24 * 3600;
  const recentDeltaSlots = deltaSlots.filter(
    (s) => s.timeSec >= cutoffSec && s.rate !== 0,
  );

  if (recentDeltaSlots.length < 3) {
    return {
      pass: true,
      reason: `${deltaSymbol}: only ${recentDeltaSlots.length} actual settlement slots in last 24h — skipped`,
      skipped: true,
      slots: [],
    };
  }

  const results = [];
  for (const slot of recentDeltaSlots) {
    const binanceRate = getBinanceRateAtTime(binanceHistory, slot.timeSec);
    if (binanceRate === null) {
      results.push({
        slotSec: slot.timeSec,
        deltaRate: slot.rate,
        binanceRate: null,
        diff: null,
        pass: null,
      });
      continue;
    }
    const diff = calcDiff(slot.rate, binanceRate);
    results.push({
      slotSec: slot.timeSec,
      deltaRate: slot.rate,
      binanceRate,
      diff,
      pass: diff >= threshold,
    });
  }

  // Only count slots where we had data on both sides
  const validResults = results.filter((r) => r.diff !== null);

  if (validResults.length < 3) {
    return {
      pass: true,
      reason: `${deltaSymbol}: only ${validResults.length} valid history slots — skipped`,
      skipped: true,
      slots: results,
    };
  }

  const passCount = validResults.filter((r) => r.pass).length;
  const allPass = validResults.every((r) => r.pass);

  const slotSummary = validResults
    .map(
      (r) =>
        `${new Date(r.slotSec * 1000 + 19800000).toISOString().slice(11, 16)}IST Δ=${r.deltaRate?.toFixed(4)}% BNB=${r.binanceRate?.toFixed(4)}% diff=${r.diff?.toFixed(4)}% ${r.pass ? "✓" : "✗"}`,
    )
    .join(" | ");

  return {
    pass: allPass,
    reason: allPass
      ? `24h history OK — ${passCount}/${validResults.length} slots ≥ ${threshold}% [${slotSummary}]`
      : `24h history FAIL — only ${passCount}/${validResults.length} slots ≥ ${threshold}% [${slotSummary}]`,
    skipped: false,
    slots: results,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────
/**
 * Check whether the funding rate differential for a token has been
 * consistently >= threshold over ALL data points in the last 24 hours.
 *
 * @param {string} deltaSymbol   - e.g. "BTCUSD"
 * @param {string} binanceSymbol - e.g. "BTCUSDT"
 * @param {number} threshold     - in percent (same unit as TH1/TH2), e.g. 0.06
 * @returns {Promise<{ pass: boolean, reason: string, skipped: boolean, slots: Array }>}
 */
export async function checkFundingHistory24h(
  deltaSymbol,
  binanceSymbol,
  threshold,
) {
  const cacheKey = `${deltaSymbol}|${binanceSymbol}`;
  const now = Date.now();

  const cached = historyCache.get(cacheKey);
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return evaluateHistory(
      cached.deltaSlots,
      cached.binanceHistory,
      threshold,
      deltaSymbol,
    );
  }

  // Fetch fresh data from both exchanges in parallel
  const [deltaSlots, binanceHistory] = await Promise.all([
    fetchDeltaFundingSlots(deltaSymbol),
    fetchBinanceFundingHistory(binanceSymbol),
  ]);

  historyCache.set(cacheKey, { fetchedAt: now, deltaSlots, binanceHistory });

  return evaluateHistory(deltaSlots, binanceHistory, threshold, deltaSymbol);
}

/** Force-clear cache (e.g. on config reload) */
export function clearHistoryCache() {
  historyCache.clear();
}
