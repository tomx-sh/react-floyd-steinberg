import { StrictMode, useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BlueNoiseWave,
  FloydSteinberg,
  isWebGpuSupported,
  type FloydSteinbergFit,
  type FloydSteinbergRenderInfo,
  type FloydSteinbergSource,
} from "../index";
import "./styles.css";

const sampleSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="1" y2="1">
      <stop stop-color="#f6d365"/>
      <stop offset="0.5" stop-color="#fda085"/>
      <stop offset="1" stop-color="#5b86e5"/>
    </linearGradient>
    <radialGradient id="sun">
      <stop stop-color="#fff"/>
      <stop offset="1" stop-color="#ffd166"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="800" fill="url(#sky)"/>
  <circle cx="910" cy="215" r="125" fill="url(#sun)"/>
  <path d="M0 610 180 430 330 570 520 300 750 570 920 390 1200 620V800H0Z" fill="#203a43"/>
  <path d="M0 675 230 540 390 650 650 470 880 650 1080 520 1200 625V800H0Z" fill="#2c5364"/>
  <g fill="#fff" opacity=".82" font-family="ui-monospace, monospace">
    <text x="70" y="120" font-size="72" font-weight="700">FLOYD</text>
    <text x="70" y="190" font-size="72" font-weight="700">STEINBERG</text>
    <text x="75" y="245" font-size="26">WebGPU wavefront diffusion</text>
  </g>
</svg>`;

const defaultSource = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sampleSvg)}`;

function App() {
  const [source, setSource] = useState<FloydSteinbergSource>(defaultSource);
  const [randomness, setRandomness] = useState(0.35);
  const [threshold, setThreshold] = useState(0.5);
  const [pixelScale, setPixelScale] = useState(2);
  const [fit, setFit] = useState<FloydSteinbergFit>("contain");
  const [invert, setInvert] = useState(false);
  const [status, setStatus] = useState(isWebGpuSupported() ? "Loading image and GPU…" : "WebGPU is unavailable.");
  const [waveStatus, setWaveStatus] = useState(
    isWebGpuSupported() ? "Generating blue-noise pattern…" : "WebGPU is unavailable.",
  );

  const handleReady = useCallback((info: FloydSteinbergRenderInfo) => {
    setStatus(
      `Rendered ${info.logicalWidth} × ${info.logicalHeight} cells for a ${Math.round(info.cssWidth)} × ${Math.round(info.cssHeight)} CSS-pixel canvas.`,
    );
  }, []);

  const handleError = useCallback((error: Error) => {
    setStatus(error.message);
  }, []);

  return (
    <main>
      <header>
        <p className="eyebrow">React component playground</p>
        <h1>Stochastic Floyd–Steinberg</h1>
        <p className="intro">Choose an image, then tune the synchronized WebGPU error-diffusion shader.</p>
      </header>

      <section className="controls" aria-label="Dithering controls">
        <label className="file-control">
          <span>Source image</span>
          <input
            type="file"
            accept="image/*"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) setSource(file);
            }}
          />
        </label>

        <label>
          <span>Randomness <output>{randomness.toFixed(2)}</output></span>
          <input
            type="range"
            min="0"
            max="2"
            step="0.05"
            value={randomness}
            onChange={(event) => setRandomness(event.currentTarget.valueAsNumber)}
          />
        </label>

        <label>
          <span>Threshold <output>{threshold.toFixed(2)}</output></span>
          <input
            type="range"
            min="0.05"
            max="0.95"
            step="0.05"
            value={threshold}
            onChange={(event) => setThreshold(event.currentTarget.valueAsNumber)}
          />
        </label>

        <label>
          <span>Pixel scale</span>
          <select value={pixelScale} onChange={(event) => setPixelScale(Number(event.currentTarget.value))}>
            <option value="1">1×</option>
            <option value="2">2×</option>
            <option value="3">3×</option>
            <option value="4">4×</option>
          </select>
        </label>

        <label>
          <span>Image fit</span>
          <select value={fit} onChange={(event) => setFit(event.currentTarget.value as FloydSteinbergFit)}>
            <option value="contain">Contain</option>
            <option value="cover">Cover</option>
            <option value="stretch">Stretch</option>
          </select>
        </label>

        <label className="check-control">
          <input type="checkbox" checked={invert} onChange={(event) => setInvert(event.currentTarget.checked)} />
          <span>Invert luminance</span>
        </label>
      </section>

      <figure>
        <FloydSteinberg
          src={source}
          width={900}
          height={600}
          pixelScale={pixelScale}
          randomness={randomness}
          threshold={threshold}
          fit={fit}
          invert={invert}
          onReady={handleReady}
          onError={handleError}
        />
        <figcaption aria-live="polite">{status}</figcaption>
      </figure>

      <section className="example-heading">
        <p className="eyebrow">Stable threshold example</p>
        <h2>Blue-noise wave</h2>
        <p className="intro">A fixed tileable blue-noise pattern dithers the moving gradient without changing between frames.</p>
      </section>

      <figure>
        <BlueNoiseWave
          width={900}
          height={600}
          pixelScale={1}
          patternSize={128}
          dark="oklch(18% 0.03 255)"
          light="oklch(94% 0.04 90)"
          onReady={(info) => setWaveStatus(`Animating ${info.logicalWidth} × ${info.logicalHeight} cells.`)}
          onError={(error) => setWaveStatus(error.message)}
        />
        <figcaption aria-live="polite">{waveStatus}</figcaption>
      </figure>
    </main>
  );
}

const root = document.querySelector("#root");
if (!root) throw new Error("Missing #root element");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
