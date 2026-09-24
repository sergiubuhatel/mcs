import { SpinnerIcon } from "../layout/icons";

export default function LoadingSpinner({ message = "Loading..." }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px 0" }}>
      <SpinnerIcon className="spin" width={36} height={36} style={{ color: "var(--color-text-accent)", marginBottom: 12 }} />
      <h3 style={{ margin: 0 }}>{message}</h3>
    </div>
  );
}
