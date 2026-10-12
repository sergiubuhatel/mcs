// Order Calculator math for one account: from its cash (CAD), the units it
// already holds and the shared targets (USD price + target % per stock),
// work out how many shares to buy or sell. Prices are in USD; every CAD
// amount is USD × usdCad (CAD for 1 USD), as in "Price CAD = Price USD ×
// USD to CAD".

const MAX_LEFTOVER_STEPS = 20000;
// Targets typed with rounded percentages can add up to a bit over 100%
// (e.g. 100.01%); up to this much is treated as rounding and scaled to 100%.
const ROUNDING_SLACK = 0.5;

const toNum = (v) => (v === "" || v === null || v === undefined ? NaN : Number(v));
const floorTo = (x, digits) => Math.floor(x * 10 ** digits + 1e-9) / 10 ** digits;

/** CAD for 1 USD from a typed rate and its direction ("usd_cad": 1 USD = rate
 * CAD; "cad_usd": 1 CAD = rate USD). NaN when the rate isn't positive. */
export function usdCadRate(rate, direction) {
  const r = toNum(rate);
  if (!(r > 0)) return NaN;
  return direction === "cad_usd" ? 1 / r : r;
}

/**
 * @param {{cash, usdCad, rows: {ticker, price, alloc, qty}[], allowSell, fractional, spendLeftover}} input
 *   cash: CAD in the account besides its stocks; alloc: target % of the
 *   whole account (cash + stocks); qty: units held; price: USD.
 *   allowSell false = buy only (never sell; spend the cash on the stocks
 *   most below target). spendLeftover: whole shares rounded down leave cash
 *   over -- keep buying one share at a time, each time of the stock that
 *   leaves the allocation closest to the targets (least squared deviation),
 *   until even the cheapest target stock no longer fits the cash.
 * @returns {{lines, totals, errors}} `order` per line = units to buy (+) or
 *   sell (−), `status` BUY / SELL / HOLD; `errors` says why nothing could be
 *   computed.
 */
export function computeOrders({ cash, usdCad, rows, allowSell = true, fractional = false, spendLeftover = true }) {
  const errors = [];
  const rate = toNum(usdCad);
  const cashCad = Math.max(0, toNum(cash) || 0);
  if (!(rate > 0)) errors.push("Enter the exchange rate.");

  const notes = [];
  const allocSum = rows.reduce((s, r) => s + (toNum(r.alloc) || 0), 0);
  if (allocSum > 100 + ROUNDING_SLACK) errors.push(`The target percentages add up to ${+allocSum.toFixed(2)}% — more than 100%.`);
  const allocScale = allocSum > 100 ? 100 / allocSum : 1;
  if (allocScale < 1 && !errors.length) notes.push(`Targets add up to ${+allocSum.toFixed(3)}% (rounding); scaled to 100%.`);
  const noPrice = rows.filter((r) => !(toNum(r.price) > 0)).map((r) => r.ticker);
  if (noPrice.length) errors.push(`Enter a USD price for ${noPrice.join(", ")}.`);

  const digits = fractional ? 4 : 0;
  const base = rows.map((r) => {
    const price = toNum(r.price);
    const qty = Math.max(0, toNum(r.qty) || 0);
    const priceCad = price * rate;
    return { ...r, price, qty, alloc: (toNum(r.alloc) || 0) * allocScale, priceCad, valueCad: qty * priceCad };
  });
  const holdingsCad = base.reduce((s, r) => s + (Number.isFinite(r.valueCad) ? r.valueCad : 0), 0);
  const totalCad = cashCad + holdingsCad;
  const totals = { cashCad, holdingsCad, totalCad, allocSum };
  if (errors.length) return { lines: base, totals, errors, notes };

  const lines = base.map((r) => ({ ...r, targetCad: (totalCad * r.alloc) / 100 }));
  if (allowSell) {
    // Rebalance: hold as many units as the target value buys.
    for (const r of lines) r.newQty = floorTo(r.targetCad / r.priceCad, digits);
  } else {
    // Buy only: spend the cash on the shortfalls, scaled down if it's short.
    const shortfall = lines.map((r) => Math.max(0, r.targetCad - r.valueCad));
    const need = shortfall.reduce((s, x) => s + x, 0);
    const scale = need > 0 ? Math.min(1, cashCad / need) : 0;
    lines.forEach((r, i) => (r.newQty = r.qty + floorTo((shortfall[i] * scale) / r.priceCad, digits)));
  }

  let left = cashCad + lines.reduce((s, r) => s + (r.qty - r.newQty) * r.priceCad, 0);
  if (spendLeftover && !fractional) {
    for (let step = 0; step < MAX_LEFTOVER_STEPS; step += 1) {
      let best = null;
      for (const r of lines) {
        if (!(r.alloc > 0) || r.priceCad > left + 1e-9) continue;
        // Change in squared deviation from target if one more share is bought.
        const dev = r.newQty * r.priceCad - r.targetCad;
        const cost = (dev + r.priceCad) ** 2 - dev ** 2;
        if (!best || cost < best.cost) best = { r, cost };
      }
      if (!best) break;
      best.r.newQty += 1;
      left -= best.r.priceCad;
    }
  }

  let buysCad = 0;
  let sellsCad = 0;
  for (const r of lines) {
    r.order = +(r.newQty - r.qty).toFixed(digits);
    r.status = r.order > 0 ? "BUY" : r.order < 0 ? "SELL" : "HOLD";
    r.amountUsd = r.order * r.price;
    r.amountCad = r.order * r.priceCad;
    r.newValueCad = r.newQty * r.priceCad;
    r.newWeight = totalCad > 0 ? (100 * r.newValueCad) / totalCad : 0;
    if (r.order > 0) buysCad += r.amountCad;
    else sellsCad -= r.amountCad;
  }
  return {
    lines,
    totals: { ...totals, buysCad, sellsCad, cashAfterCad: Math.max(0, cashCad - buysCad + sellsCad) },
    errors,
    notes,
  };
}
