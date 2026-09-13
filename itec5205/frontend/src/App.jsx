import { useEffect, useState } from "react";
import { Route, Routes } from "react-router-dom";
import { useSelector } from "react-redux";

import Sidebar from "./layout/Sidebar";
import TopBar from "./layout/TopBar";
import BottomBar from "./layout/BottomBar";

import ScreenerPage from "./pages/ScreenerPage";
import PortfolioPage from "./pages/PortfolioPage";
import PredictionPage from "./pages/PredictionPage";
import CompanyDetailPage from "./pages/CompanyDetailPage";

export default function App() {
  const darkMode = useSelector((s) => s.theme.darkMode);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    document.body.classList.toggle("dark", darkMode);
  }, [darkMode]);

  return (
    <div className="flex h-full w-full overflow-hidden">
      <Sidebar collapsed={collapsed} onToggleCollapsed={() => setCollapsed((c) => !c)} />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar />

        <main className="min-h-0 flex-1 overflow-auto p-4">
          <Routes>
            <Route path="/" element={<ScreenerPage />} />
            <Route path="/portfolio" element={<PortfolioPage />} />
            <Route path="/prediction" element={<PredictionPage />} />
            <Route path="/companies/:ticker" element={<CompanyDetailPage />} />
          </Routes>
        </main>

        <BottomBar />
      </div>
    </div>
  );
}
