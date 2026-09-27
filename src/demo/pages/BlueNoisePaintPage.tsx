import { useState } from "react";
import { BlueNoisePaint, isWebGpuSupported, type BlueNoisePaintQuantity } from "../../index";
import { BackLink } from "./BackLink";

export function BlueNoisePaintPage() {
  const [status, setStatus] = useState(
    isWebGpuSupported() ? "Starting paint simulation…" : "WebGPU is unavailable.",
  );
  const [contrast, setContrast] = useState(1);
  const [viscosity, setViscosity] = useState(2);
  const [swirlStrength, setSwirlStrength] = useState(1);
  const [quantity, setQuantity] = useState<BlueNoisePaintQuantity>("pigment");
  const [version, setVersion] = useState(0);

  return (
    <main>
      <BackLink />
      <header>
        <p className="eyebrow">Fluid experiment</p>
        <h1>Paint in a box</h1>
        <p className="intro">
          Slow eddies fold and swirl paint inside closed walls. Move your pointer
          to stir and add pigment, or switch to velocity to see the currents.
          The canvas edges act as solid walls that keep the flow inside the box.
        </p>
      </header>

      <section className="controls" aria-label="Paint controls">
        <label>
          <span>Quantity</span>
          <select value={quantity} onChange={(event) => setQuantity(event.currentTarget.value as BlueNoisePaintQuantity)}>
            <option value="pigment">Pigment</option>
            <option value="velocity">Velocity</option>
          </select>
        </label>
        <label>
          <span>Swirl <output>{swirlStrength.toFixed(1)}</output></span>
          <input type="range" min="0" max="3" step="0.1" value={swirlStrength}
            onChange={(event) => setSwirlStrength(event.currentTarget.valueAsNumber)} />
        </label>
        <label>
          <span>Viscosity <output>{viscosity.toFixed(1)}</output></span>
          <input type="range" min="0" max="20" step="0.5" value={viscosity}
            onChange={(event) => setViscosity(event.currentTarget.valueAsNumber)} />
        </label>
        <label>
          <span>Contrast <output>{contrast.toFixed(2)}</output></span>
          <input type="range" min="0.25" max="8" step="0.05" value={contrast}
            onChange={(event) => setContrast(event.currentTarget.valueAsNumber)} />
        </label>
        <button type="button" onClick={() => {
          setStatus("Starting paint simulation…");
          setVersion((current) => current + 1);
        }}>Reset paint</button>
      </section>

      <figure>
        <BlueNoisePaint
          key={version}
          width={900}
          height={600}
          pixelScale={2}
          patternSize={64}
          simulationSize={192}
          quantity={quantity}
          viscosity={viscosity}
          contrast={contrast}
          swirlStrength={swirlStrength}
          dark="rgb(0,0,0)"
          light="rgb(255,255,255)"
          onReady={(info) => setStatus(`Simulating and dithering ${info.logicalWidth} × ${info.logicalHeight} cells.`)}
          onError={(error) => setStatus(error.message)}
        />
        <figcaption aria-live="polite">{status}</figcaption>
      </figure>
    </main>
  );
}
