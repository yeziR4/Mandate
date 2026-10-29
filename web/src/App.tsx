import { useEffect } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import Header from "./components/Header";
import Footer from "./components/Footer";
import { LedgerTape, VitalsRail } from "./components/Signals";
import Board from "./pages/Board";
import ModelPage from "./pages/ModelPage";
import Certificates from "./pages/Certificates";
import CertificatePage from "./pages/CertificatePage";
import Methodology from "./pages/Methodology";
import NotFound from "./pages/NotFound";

const TITLES: Record<string, string> = {
  "/": "Ten models, one policy each",
  "/certificates": "Certificates",
  "/methodology": "Methodology",
};

function RouteEffects() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
    const title =
      TITLES[pathname] ??
      (pathname.startsWith("/model/")
        ? "Model"
        : pathname.startsWith("/certificate/")
          ? "Certificate"
          : "Not found");
    document.title = `${title} — Mandate`;
  }, [pathname]);
  return null;
}

export default function App() {
  return (
    <>
      <RouteEffects />
      <div className="app">
        <Header />
        <VitalsRail />
        <main>
          <Routes>
            <Route path="/" element={<Board />} />
            <Route path="/model/:id" element={<ModelPage />} />
            <Route path="/certificates" element={<Certificates />} />
            <Route path="/certificate/:id" element={<CertificatePage />} />
            <Route path="/methodology" element={<Methodology />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
        <Footer />
        <LedgerTape />
      </div>
    </>
  );
}
