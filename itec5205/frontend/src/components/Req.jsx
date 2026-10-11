// Red star after a mandatory field's label (color per theme: see `.req` in index.css).
export default function Req() {
  return (
    <span className="req" title="Required" aria-label="required">
      *
    </span>
  );
}
