import { useEffect, useState } from "react";

// Manages a grid's column visibility + order, persisted per-viewer in
// localStorage. `defaultColumns` (the grid's own ordered column defs) is
// both the default order and the default visible set -- exactly "what's
// currently in it" -- except columns marked `hiddenByDefault: true` (e.g. a
// field newly added to the grid that wasn't there before), which start
// hidden until the user opts in. Columns marked `locked: true` (e.g.
// Ticker) always stay first, always visible, and are never reorderable.
export function useColumnConfig(storageKey, defaultColumns) {
  const lockedColumns = defaultColumns.filter((c) => c.locked);
  const reorderableColumns = defaultColumns.filter((c) => !c.locked);
  const defaultOrder = reorderableColumns.map((c) => c.key);
  const defaultHiddenByKey = Object.fromEntries(reorderableColumns.map((c) => [c.key, !!c.hiddenByDefault]));
  const orderKey = `${storageKey}.order`;
  const hiddenKey = `${storageKey}.hidden`;

  // Keys this grid didn't have the last time this viewer saved state --
  // computed once (order/hidden below both need it) so a column newly
  // added to the grid's defs picks up its own `hiddenByDefault` instead of
  // silently becoming visible just because it's absent from a stale save.
  let savedOrderRaw = null;
  try {
    savedOrderRaw = JSON.parse(localStorage.getItem(orderKey) || "null");
  } catch {
    savedOrderRaw = null;
  }
  const newlySeenKeys =
    Array.isArray(savedOrderRaw) && savedOrderRaw.length
      ? defaultOrder.filter((k) => !savedOrderRaw.includes(k))
      : [];

  const [order, setOrder] = useState(() => {
    if (Array.isArray(savedOrderRaw) && savedOrderRaw.length) {
      const known = savedOrderRaw.filter((k) => defaultOrder.includes(k));
      return [...known, ...newlySeenKeys];
    }
    return defaultOrder;
  });

  const [hidden, setHidden] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(hiddenKey) || "null");
      if (Array.isArray(saved)) {
        const known = saved.filter((k) => defaultOrder.includes(k));
        const newlyHidden = newlySeenKeys.filter((k) => defaultHiddenByKey[k]);
        return [...new Set([...known, ...newlyHidden])];
      }
    } catch {
      // ignore -- fall back to the plain defaults below
    }
    return reorderableColumns.filter((c) => c.hiddenByDefault).map((c) => c.key);
  });

  useEffect(() => {
    try {
      localStorage.setItem(orderKey, JSON.stringify(order));
    } catch {
      // ignore -- just won't persist across reloads
    }
  }, [orderKey, order]);

  useEffect(() => {
    try {
      localStorage.setItem(hiddenKey, JSON.stringify(hidden));
    } catch {
      // ignore
    }
  }, [hiddenKey, hidden]);

  const byKey = Object.fromEntries(reorderableColumns.map((c) => [c.key, c]));
  const orderedReorderable = order.map((k) => byKey[k]).filter(Boolean);

  // Locked columns always lead, in their defined order; the rest follow in
  // whatever order the user has chosen.
  const columns = [...lockedColumns, ...orderedReorderable];
  const visibleColumns = [...lockedColumns, ...orderedReorderable.filter((c) => !hidden.includes(c.key))];

  const toggleVisible = (key) => {
    if (lockedColumns.some((c) => c.key === key)) return;
    setHidden((h) => (h.includes(key) ? h.filter((k) => k !== key) : [...h, key]));
  };

  const moveColumn = (key, direction) => {
    if (lockedColumns.some((c) => c.key === key)) return;
    setOrder((o) => {
      const idx = o.indexOf(key);
      const swapWith = idx + direction;
      if (idx === -1 || swapWith < 0 || swapWith >= o.length) return o;
      const next = [...o];
      [next[idx], next[swapWith]] = [next[swapWith], next[idx]];
      return next;
    });
  };

  const reset = () => {
    setOrder(defaultOrder);
    setHidden(reorderableColumns.filter((c) => c.hiddenByDefault).map((c) => c.key));
  };

  return { columns, visibleColumns, hidden, toggleVisible, moveColumn, reset };
}
