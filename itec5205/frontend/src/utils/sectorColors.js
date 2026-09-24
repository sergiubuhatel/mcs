// Consistent color per GICS sector, for the sector pill in the screener
// grid -- purely presentational (the sector value itself is unchanged,
// already-existing data), matching known S&P sector names with a hashed
// fallback for anything unrecognized.
const SECTOR_COLORS = {
  Technology: "#2563eb",
  "Communication Services": "#7c3aed",
  "Consumer Cyclical": "#16a34a",
  "Consumer Defensive": "#0d9488",
  "Financial Services": "#0891b2",
  Healthcare: "#dc2626",
  Industrials: "#ea580c",
  Energy: "#ca8a04",
  Utilities: "#4f46e5",
  "Real Estate": "#db2777",
  "Basic Materials": "#65a30d",
};

const FALLBACK_PALETTE = Object.values(SECTOR_COLORS);

export function sectorColor(sector) {
  if (!sector) return "#64748b";
  if (SECTOR_COLORS[sector]) return SECTOR_COLORS[sector];
  let hash = 0;
  for (let i = 0; i < sector.length; i++) hash = sector.charCodeAt(i) + ((hash << 5) - hash);
  return FALLBACK_PALETTE[Math.abs(hash) % FALLBACK_PALETTE.length];
}
