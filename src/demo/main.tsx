import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BlueNoiseFluidPage } from "./pages/BlueNoiseFluidPage";
import { BlueNoisePaintPage } from "./pages/BlueNoisePaintPage";
import { BlueNoiseInkPage } from "./pages/BlueNoiseInkPage";
import { BlueNoiseLeniaPage } from "./pages/BlueNoiseLeniaPage";
import { BlueNoiseWavePage } from "./pages/BlueNoiseWavePage";
import { FloydSteinbergPage } from "./pages/FloydSteinbergPage";
import { Home } from "./pages/Home";
import "./styles.css";

const routes: Record<string, () => React.JSX.Element> = {
  "/": Home,
  "/floyd-steinberg": FloydSteinbergPage,
  "/blue-noise-wave": BlueNoiseWavePage,
  "/blue-noise-fluid": BlueNoiseFluidPage,
  "/blue-noise-paint": BlueNoisePaintPage,
  "/blue-noise-ink": BlueNoiseInkPage,
  "/blue-noise-lenia": BlueNoiseLeniaPage,
};

function currentRoute() {
  const hash = window.location.hash.replace(/^#/, "");
  return routes[hash] !== undefined ? hash : "/";
}

function useHashRoute() {
  const [route, setRoute] = useState(currentRoute);
  useEffect(() => {
    const onHashChange = () => setRoute(currentRoute());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  return route;
}

function App() {
  const route = useHashRoute();
  const Page = routes[route];
  return <Page />;
}

const root = document.querySelector("#root");
if (!root) throw new Error("Missing #root element");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
