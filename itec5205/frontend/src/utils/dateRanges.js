// Shared interval definitions for time-series charts (price history,
// portfolio performance). Cutoffs use calendar day/month/year arithmetic
// (Date.setDate/setMonth/setFullYear), not a fixed day-count approximation --
// "1M back from Sep 13" must land on Aug 13, not Aug 14.
//
// The buttons each chart shows are a Settings value: text such as
// "1M, 3M, 1Y, ALL", where a range is a number + D (days), W (weeks),
// M (months) or Y (years), or ALL.

const UNITS = { D: "days", W: "weeks", M: "months", Y: "years" };
const UNIT_ORDER = { D: 1, W: 7, M: 30, Y: 365 };

/** "3M" -> {key: "3M", months: 3}; "ALL" -> {key: "ALL"}; null if invalid. */
export function parseInterval(text) {
  const key = String(text || "").trim().toUpperCase();
  if (key === "ALL") return { key };
  const m = /^(\d{1,3})([DWMY])$/.exec(key);
  if (!m || Number(m[1]) === 0) return null;
  return { key: `${Number(m[1])}${m[2]}`, [UNITS[m[2]]]: Number(m[1]) };
}

/** Comma/space-separated ranges -> {intervals (shortest first, ALL last, no
 * duplicates), invalid (the words that are not a range)}. */
export function parseIntervals(text) {
  const words = String(text || "").split(/[\s,;]+/).filter(Boolean);
  const invalid = words.filter((w) => !parseInterval(w));
  const byKey = new Map(words.map(parseInterval).filter(Boolean).map((iv) => [iv.key, iv]));
  const length = (iv) => (iv.key === "ALL" ? Infinity : Number(iv.key.slice(0, -1)) * UNIT_ORDER[iv.key.slice(-1)]);
  return { intervals: [...byKey.values()].sort((a, b) => length(a) - length(b)), invalid };
}

/** The buttons for a Settings ranges text, or `fallback` when none is valid. */
export function intervalsFrom(text, fallback) {
  const { intervals } = parseIntervals(text);
  return intervals.length ? intervals : parseIntervals(fallback).intervals;
}

function cutoffFor(lastDate, interval) {
  if (!interval || interval.key === "ALL") return null;
  const cutoff = new Date(lastDate);
  if (interval.days) cutoff.setDate(cutoff.getDate() - interval.days);
  if (interval.weeks) cutoff.setDate(cutoff.getDate() - interval.weeks * 7);
  if (interval.months) cutoff.setMonth(cutoff.getMonth() - interval.months);
  if (interval.years) cutoff.setFullYear(cutoff.getFullYear() - interval.years);
  return cutoff;
}

/** Filter a chronologically-sorted array of {date, ...} items to the given
 * interval, anchored on the array's own last date (not "now"). */
export function filterByInterval(items, intervalKey, dateKey = "date") {
  if (items.length === 0) return items;
  const lastDate = new Date(items[items.length - 1][dateKey]);
  const cutoff = cutoffFor(lastDate, parseInterval(intervalKey));
  if (!cutoff) return items;
  return items.filter((item) => new Date(item[dateKey]) >= cutoff);
}
