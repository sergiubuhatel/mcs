import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

import Sidebar from "./layout/Sidebar";
import TopBar from "./layout/TopBar";
import BottomBar from "./layout/BottomBar";

import ScreenerPage from "./pages/ScreenerPage";
import PoolsPage from "./pages/PoolsPage";
import PortfoliosPage from "./pages/PortfoliosPage";
import PredictionPage from "./pages/PredictionPage";
import CompanyDetailPage from "./pages/CompanyDetailPage";
import PortfolioDetailPage from "./pages/PortfolioDetailPage";
import PoliciesPage from "./pages/PoliciesPage";
import CriteriaPage from "./pages/CriteriaPage";
import DataPage from "./pages/DataPage";
import SettingsPage from "./pages/SettingsPage";
import OrderCalculatorPage from "./pages/OrderCalculatorPage";
import LoadingSpinner from "./components/LoadingSpinner";
import { loadSettings } from "./features/settings/settings";

export default function App() {
  const darkMode = useSelector((s) => s.theme.darkMode);
  const [collapsed, setCollapsed] = useState(false);
  const dispatch = useDispatch();
  // Pages read their initial values from the Settings page, so they render
  // only once those are loaded (built-in defaults if the backend is down).
  const [settingsReady, setSettingsReady] = useState(false);

  useEffect(() => {
    loadSettings(dispatch).finally(() => setSettingsReady(true));
  }, [dispatch]);

  useEffect(() => {
    document.body.classList.toggle("dark", darkMode);
  }, [darkMode]);

  return (
    <div className="flex h-full w-full overflow-hidden">
      <Sidebar collapsed={collapsed} />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar sidebarCollapsed={collapsed} onToggleSidebar={() => setCollapsed((c) => !c)} />

        <main className="min-h-0 flex-1 overflow-auto p-4">
          {!settingsReady ? (
            <LoadingSpinner />
          ) : (
          <Routes>
            <Route path="/" element={<ScreenerPage />} />
            <Route path="/data" element={<DataPage />} />
            <Route path="/policies" element={<PoliciesPage />} />
            <Route path="/criteria/:kind" element={<CriteriaPage />} />
            <Route path="/pools" element={<PoolsPage />} />
            <Route path="/portfolio" element={<PortfoliosPage />} />
            <Route path="/prediction" element={<PredictionPage />} />
            <Route path="/companies/:ticker" element={<CompanyDetailPage />} />
            <Route path="/portfolios/:id" element={<PortfolioDetailPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/orders" element={<OrderCalculatorPage />} />
            {/* Home is the Stock Screener; unknown URLs go there instead of a blank page. */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          )}
        </main>

        <BottomBar />
      </div>

      <ToastContainer position="bottom-right" autoClose={3000} theme={darkMode ? "dark" : "light"} />
    </div>
  );
}
