// Shared Recharts <Tooltip> styling so it follows the light/dark theme
// tokens -- Recharts' default tooltip is a hardcoded white box, unreadable
// against a dark background.
export const tooltipProps = {
  contentStyle: {
    background: "var(--color-bg-primary)",
    border: "1px solid var(--color-divider)",
    borderRadius: 6,
    fontSize: "0.78rem",
    padding: "6px 10px",
  },
  labelStyle: { color: "var(--color-text-secondary)", marginBottom: 2 },
  itemStyle: { color: "var(--color-text-primary)", padding: 0 },
};
