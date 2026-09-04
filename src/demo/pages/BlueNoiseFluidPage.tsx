import { useState } from "react";
import { BlueNoiseFluid, isWebGpuSupported, type BlueNoiseFluidQuantity } from "../../index";
import { BackLink } from "./BackLink";

export function BlueNoiseFluidPage() {
  const [status, setStatus] = useState(
    isWebGpuSupported() ? "Starting fluid simulation…" : "WebGPU is unavailable.",
  );
  const [contrast, setContrast] = useState(1);
  const [viscosity, setViscosity] = useState(4);
  const [quantity, setQuantity] = useState<BlueNoiseFluidQuantity>("velocity");

  return (
    <main>
      <BackLink />
      <header>
        <p className="eyebrow">Interactive example</p>
        <h1>Blue-noise fluid</h1>
        <p className="intro">
          A hot lower wall and cold upper wall drive convection plumes, with a
          gradual temperature along the side walls. Choose velocity to stir the
          flow, or temperature to reveal the thermal field and paint heat with
          the pointer.
        </p>
      </header>

      <section className="controls" aria-label="Fluid controls">
        <label>
          <span>Quantity</span>
          <select
            value={quantity}
            onChange={(event) => setQuantity(event.currentTarget.value as BlueNoiseFluidQuantity)}
          >
            <option value="velocity">Velocity</option>
            <option value="temperature">Temperature</option>
          </select>
        </label>
        <label>
          <span>
            Viscosity <output>{viscosity.toFixed(1)}</output>
          </span>
          <input
            type="range"
            min="0"
            max="20"
            step="0.5"
            value={viscosity}
            onChange={(event) => setViscosity(event.currentTarget.valueAsNumber)}
          />
        </label>
        <label>
          <span>
            Contrast <output>{contrast.toFixed(2)}</output>
          </span>
          <input
            type="range"
            min="0.25"
            max="8"
            step="0.05"
            value={contrast}
            onChange={(event) => setContrast(event.currentTarget.valueAsNumber)}
          />
        </label>
      </section>

      <figure>
        <BlueNoiseFluid
          width={900}
          height={600}
          pixelScale={1}
          patternSize={64}
          simulationSize={192}
          quantity={quantity}
          viscosity={viscosity}
          contrast={contrast}
          dark="rgb(0,0,0)"
          light="rgb(255,255,255)"
          onReady={(info) =>
            setStatus(`Simulating and dithering ${info.logicalWidth} × ${info.logicalHeight} cells.`)
          }
          onError={(error) => setStatus(error.message)}
        />
        <figcaption aria-live="polite">{status}</figcaption>
      </figure>
    </main>
  );
}
