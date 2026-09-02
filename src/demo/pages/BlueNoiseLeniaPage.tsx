import { useState } from "react";
import { BlueNoiseLenia, isWebGpuSupported } from "../../index";
import { BackLink } from "./BackLink";

export function BlueNoiseLeniaPage() {
  const [status, setStatus] = useState(
    isWebGpuSupported() ? "Seeding Lenia automaton…" : "WebGPU is unavailable.",
  );
  const [contrast, setContrast] = useState(1);

  return (
    <main>
      <BackLink />
      <header>
        <p className="eyebrow">Continuous cellular automaton</p>
        <h1>Blue-noise Lenia</h1>
        <p className="intro">
          A Lenia continuous cellular automaton evolves on the GPU and is
          dithered through the same fixed blue-noise tile. Three enlarged
          Orbium walkers start far apart so their shape and motion stay easy
          to follow; move the pointer across the canvas to perturb them.
        </p>
      </header>

      <section className="controls" aria-label="Lenia controls">
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
        <BlueNoiseLenia
          width={900}
          height={600}
          pixelScale={1}
          patternSize={64}
          simulationSize={128}
          contrast={contrast}
          dark="rgb(0,0,0)"
          light="rgb(255,255,255)"
          onReady={() => setStatus("Three Orbium walkers evolving in an isolated field.")}
          onError={(error) => setStatus(error.message)}
        />
        <figcaption aria-live="polite">{status}</figcaption>
      </figure>
    </main>
  );
}
