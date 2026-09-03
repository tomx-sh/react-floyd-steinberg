import { useState } from "react";
import {
  BlueNoiseLenia,
  getLeniaScenePreset,
  getLeniaSpeciesPreset,
  isWebGpuSupported,
} from "../../index";
import { BackLink } from "./BackLink";

const pageSeed = crypto.getRandomValues(new Uint32Array(1))[0];
const pagePreset = getLeniaScenePreset("tricircium-inversus-solo");
const pageSpecies = getLeniaSpeciesPreset(pagePreset.species);
const pagePosition = { x: 2 / 3, y: 0.5 } as const;

export function BlueNoiseLeniaPage() {
  const [status, setStatus] = useState(
    isWebGpuSupported() ? `Seeding ${pageSpecies.name}…` : "WebGPU is unavailable.",
  );
  const [contrast, setContrast] = useState(1.1);

  return (
    <main>
      <BackLink />
      <header>
        <p className="eyebrow">Continuous cellular automaton</p>
        <h1>Blue-noise Lenia</h1>
        <p className="intro">
          A Lenia continuous cellular automaton evolves on the GPU and is
          rendered through a freshly seeded blue-noise dither. A threefold{" "}
          <i>{pageSpecies.name}</i> oscillator is vertically centered and
          one-third in from the right.
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
          simulationSize={192}
          preset={pagePreset.id}
          position={pagePosition}
          spatialScale={1.75}
          seed={pageSeed}
          contrast={contrast}
          dark="rgb(0,0,0)"
          light="rgb(255,255,255)"
          onReady={() => setStatus(`${pagePreset.name} · seed ${pageSeed}`)}
          onError={(error) => setStatus(error.message)}
        />
        <figcaption aria-live="polite">{status}</figcaption>
      </figure>
    </main>
  );
}
