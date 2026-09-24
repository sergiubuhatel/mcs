import { useEffect, useState } from "react";

// Manages a grid's column visibility + order, persisted per-viewer in
// localStorage. `defaultColumns` (the grid's own ordered column defs) is
// both the default order and the default "all visible" set -- exactly
// "what's currently in it". Columns marked `locked: true` (e.g. Ticker)
// always stay first, always visible, and are never reorderable.
export function useColumnConfig(storageKey, defaultColumns) {
  const lockedColumns = defaultColumns.filter((c) => c.locked);
  const reorderableColumns = defaultColumns.filter((c) => !c.locked);
  const defaultOrder = reorderableColumns.map((c) => c.key);
  const orderKey = `${storageKey}.order`;
  const hiddenKey = `${storageKey}.hidden`;

  const [order, setOrder] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(orderKey) || "null");
      if (Array.isArray(saved) && saved.length) {
        // Keep only keys that still exist on this grid, then append any
        // newer columns (not present in a stale saved order) at the end.
        const known = saved.filter((k) => defaultOrder.includes(k));
        const missing = defaultOrder.filter((k) => !known.includes(k));
        return [...known, ...missing];
      }
    } catch {
      // ignore -- fall back to default order
    }
    return defaultOrder;
  });

  const [hidden, setHidden] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(hiddenKey) || "null");
      if (Array.isArray(saved)) return saved.filter((k) => defaultOrder.includes(k));
    } catch {
      // ignore -- fall back to none hidden
    }
    return [];
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
    setHidden([]);
  };

  return { columns, visibleColumns, hidden, toggleVisible, moveColumn, reset };
}
