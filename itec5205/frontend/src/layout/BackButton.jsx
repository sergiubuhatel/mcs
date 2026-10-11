import { useLocation, useNavigate } from "react-router-dom";
import { CloseIcon } from "./icons";

// Top-right X on every page: back to the previously visited page, or to the
// home page (Stock Screener) when this page was the first one opened. Hidden
// on the home page when nothing was visited before it.
export default function BackButton() {
  const navigate = useNavigate();
  const { pathname } = useLocation(); // re-renders on every navigation
  // BrowserRouter keeps the in-app history position in history.state.idx (0 = first page).
  const canGoBack = (window.history.state?.idx ?? 0) > 0;
  if (!canGoBack && pathname === "/") return null;

  const back = () => (canGoBack ? navigate(-1) : navigate("/", { replace: true }));
  const label = canGoBack ? "Back to the previous page" : "Back to the Stock Screener";
  return (
    <button className="close-btn" style={{ position: "static" }} onClick={back} title={label} aria-label={label}>
      <CloseIcon width={18} height={18} />
    </button>
  );
}
