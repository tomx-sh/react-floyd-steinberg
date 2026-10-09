import { useState } from "react";
import { BlueNoiseInk, isWebGpuSupported } from "../../index";
import { BackLink } from "./BackLink";

export function BlueNoiseInkPage() {
  const [status, setStatus] = useState(isWebGpuSupported() ? "Starting ink simulation…" : "WebGPU is unavailable.");
  const [contrast, setContrast] = useState(1.75);
  const [pixelScale, setPixelScale] = useState(2);
  const [simulationSpeed, setSimulationSpeed] = useState(0.6);
  const [viscosity, setViscosity] = useState(20);
  const [version, setVersion] = useState(0);
  return <main>
    <BackLink />
    <header>
      <p className="eyebrow">Interactive fluid</p>
      <h1>Blue-noise ink</h1>
      <p className="intro">Two moving sources release ink into swirling currents. Move your pointer or drag to stir and paint.</p>
    </header>
    <section className="controls" aria-label="Ink controls">
      <label>
        <span>Speed <output>{simulationSpeed.toFixed(2)}×</output></span>
        <input type="range" min="0" max="2" step="0.05" value={simulationSpeed}
          onChange={event => setSimulationSpeed(event.currentTarget.valueAsNumber)} />
      </label>
      <label>
        <span>Viscosity <output>{viscosity.toFixed(1)}</output></span>
        <input type="range" min="0" max="20" step="0.5" value={viscosity}
          onChange={event => setViscosity(event.currentTarget.valueAsNumber)} />
      </label>
      <label>
        <span>Contrast <output>{contrast.toFixed(2)}</output></span>
        <input type="range" min="0.25" max="8" step="0.05" value={contrast}
          onChange={event => setContrast(event.currentTarget.valueAsNumber)} />
      </label>
      <label>
        <span>Pixel scale <output>{pixelScale}</output></span>
        <input type="range" min="1" max="6" step="1" value={pixelScale}
          onChange={event => setPixelScale(event.currentTarget.valueAsNumber)} />
      </label>
      <button type="button" onClick={() => {
        setStatus("Starting ink simulation…");
        setVersion(current => current + 1);
      }}>Reset ink</button>
    </section>
    <figure>
      <BlueNoiseInk key={version} width={960} height={540} pixelScale={pixelScale} contrast={contrast} simulationSize={32}
        simulationSpeed={simulationSpeed} viscosity={viscosity}
        onReady={info => setStatus(`Simulating and dithering ${info.logicalWidth} × ${info.logicalHeight} cells.`)}
        onError={error => setStatus(error.message)} />
      <figcaption aria-live="polite">{status}</figcaption>
    </figure>
  </main>;
}
