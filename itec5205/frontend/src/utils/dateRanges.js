// Shared interval definitions for time-series charts (price history,
// portfolio performance). Cutoffs use calendar month/year arithmetic
// (Date.setMonth/setFullYear), not a fixed day-count approximation --
// "1M back from Sep 13" must land on Aug 13, not Aug 14.

export const INTERVALS = [
  { key: "1M", months: 1 },
  { key: "3M", months: 3 },
  { key: "6M", months: 6 },
  { key: "1Y", years: 1 },
  { key: "5Y", years: 5 },
  { key: "10Y", years: 10 },
  { key: "ALL" },
];

function cutoffFor(lastDate, interval) {
  if (!interval || (!interval.months && !interval.years)) return null; // ALL
  const cutoff = new Date(lastDate);
  if (interval.months) cutoff.setMonth(cutoff.getMonth() - interval.months);
  if (interval.years) cutoff.setFullYear(cutoff.getFullYear() - interval.years);
  return cutoff;
}

/** Filter a chronologically-sorted array of {date, ...} items to the given
 * interval, anchored on the array's own last date (not "now"). */
export function filterByInterval(items, intervalKey, dateKey = "date") {
  if (items.length === 0) return items;
  const interval = INTERVALS.find((iv) => iv.key === intervalKey);
  const lastDate = new Date(items[items.length - 1][dateKey]);
  const cutoff = cutoffFor(lastDate, interval);
  if (!cutoff) return items;
  return items.filter((item) => new Date(item[dateKey]) >= cutoff);
}
