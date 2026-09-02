import { useState } from "react";
import { BlueNoiseWave, isWebGpuSupported } from "../../index";
import { BackLink } from "./BackLink";

export function BlueNoiseWavePage() {
  const [status, setStatus] = useState(
    isWebGpuSupported() ? "Generating blue-noise pattern…" : "WebGPU is unavailable.",
  );

  return (
    <main>
      <BackLink />
      <header>
        <p className="eyebrow">Stable threshold example</p>
        <h1>Blue-noise wave</h1>
        <p className="intro">
          A fixed tileable blue-noise pattern dithers the moving gradient
          without changing between frames.
        </p>
      </header>

      <figure>
        <BlueNoiseWave
          width={900}
          height={600}
          pixelScale={1}
          patternSize={128}
          //dark="oklch(18% 0.03 255)"
          light="oklch(94% 0.04 90)"
          onReady={(info) =>
            setStatus(`Animating ${info.logicalWidth} × ${info.logicalHeight} cells.`)
          }
          onError={(error) => setStatus(error.message)}
        />
        <figcaption aria-live="polite">{status}</figcaption>
      </figure>
    </main>
  );
}
