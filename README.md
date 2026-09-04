# react-floyd-steinberg

A reusable React component that applies stochastic Floyd–Steinberg error diffusion to an image with a synchronized WebGPU compute wavefront.

The source can be an image URL, `File`/`Blob`, `ImageBitmap`, image element, or canvas. No source pixels are read back to JavaScript: the browser uploads the image to a GPU texture, the compute shader generates the binary result, and a render pass displays it.

## Install

```sh
npm install github:<github-user>/react-floyd-steinberg#v0.5.0
pnpm add github:<github-user>/react-floyd-steinberg#v0.5.0
bun add github:<github-user>/react-floyd-steinberg#v0.5.0
```

Replace `<github-user>` with the repository owner's GitHub username. The equivalent full Git URL works with all three package managers:

```sh
npm install git+https://github.com/<github-user>/react-floyd-steinberg.git#v0.5.0
```

A tag such as `#v0.5.0` is recommended so application installs remain reproducible. You can instead select:

- `#main` for the latest commit on the main branch.
- `#<commit-sha>` for one exact commit.
- No suffix for the repository's default branch.

The dependency will be stored in the consuming application's `package.json`, for example:

```json
{
  "dependencies": {
    "react-floyd-steinberg": "github:<github-user>/react-floyd-steinberg#v0.5.0"
  }
}
```

React and React DOM are peer dependencies, so the consuming application provides them. It must run in a browser with WebGPU support. Public repositories need no GitHub authentication; private repositories require suitable Git or GitHub credentials.

## Use

```tsx
import { FloydSteinberg } from "react-floyd-steinberg";

export function DitheredPhoto({ file }: { file: File }) {
  return (
    <FloydSteinberg
      src={file}
      width={960}
      pixelScale={2}
      randomness={0.35}
      threshold={0.5}
      fit="contain"
      dark="oklch(20% 0.03 260)"
      light="rgb(245 240 220)"
      style={{ width: "100%", height: "auto" }}
      onError={console.error}
    />
  );
}
```

If only `width` or `height` is supplied, the source aspect ratio is preserved. If neither is supplied, the source image dimensions are used.

`width` and `height` establish the canvas's intrinsic CSS size; they no longer fix the number of dither cells. The component observes its rendered content box, sizes its backing buffer for the current `devicePixelRatio`, and recomputes the diffusion grid whenever that box or ratio changes. Give responsive canvases an explicit CSS constraint, such as `style={{ width: "100%", height: "auto" }}`, so their layout size remains independent from the backing-buffer attributes.

`pixelScale` is measured in CSS pixels. For example, `pixelScale={2}` keeps complete dither cells at `2 × 2` CSS pixels as the component resizes. On a 2× display those cells occupy approximately `4 × 4` device pixels. The final cell on either edge may be clipped when the rendered size is not divisible by `pixelScale`.

Remote image URLs must allow cross-origin use. The component defaults to `crossOrigin="anonymous"`; a server without an appropriate CORS response cannot be copied into a WebGPU texture. Passing a user-selected `File` avoids that restriction.

## Main props

| Prop | Type | Default | Purpose |
| --- | --- | --- | --- |
| `src` | URL, `Blob`/`File`, `ImageBitmap`, image or canvas | required | Source image |
| `width`, `height` | `number` | source size | Intrinsic canvas size in CSS pixels; CSS may override it |
| `pixelScale` | `number` | `1` | CSS pixels per dither cell; larger values improve speed and emphasize the pattern |
| `randomness` | `0…2` | `0.35` | Stochastic coefficient perturbation; `0` is classic Floyd–Steinberg |
| `threshold` | `0…1` | `0.5` | Binary quantization threshold |
| `fit` | `"stretch" \| "cover" \| "contain"` | `"contain"` | Source-to-output mapping |
| `invert` | `boolean` | `false` | Invert luminance before diffusion |
| `seed` | `number` | deterministic | Random coefficient seed |
| `alphaBackground` | `0…1` | `1` | Luminance behind transparent pixels |
| `dark`, `light` | CSS color string or normalized RGB/RGBA tuple | black, white | Output colors |
| `onReady`, `onError` | callback | — | GPU completion and error notifications; ready info includes CSS, backing-buffer, and logical sizes |

Normal canvas attributes such as `className`, `style`, and ARIA attributes are also accepted. The canvas exposes `data-webgpu-status="loading|ready|error"`.

`dark` and `light` accept normalized tuples such as `[0.1, 0.2, 0.3]` as well as browser-supported CSS colors, including `rgb()` and `oklch()` strings. CSS colors are converted to sRGB before being sent to WebGPU:

```tsx
<FloydSteinberg
  src={file}
  dark="rgb(18 24 38 / 90%)"
  light="oklch(92% 0.08 85)"
/>
```

The package additionally exports `floydSteinbergShader`, `displayShader`, and `isWebGpuSupported`.

## Blue-noise wave example

`BlueNoiseWave` applies a fixed, tileable blue-noise threshold pattern to an animated procedural gradient. The pattern does not change between frames, so the wave moves without regenerating the dither arrangement. It does not accept arbitrary shaders and does not change the `FloydSteinberg` source API.

```tsx
import { BlueNoiseWave } from "react-floyd-steinberg";

export function DitheredWave() {
  return (
    <BlueNoiseWave
      width={900}
      height={600}
      pixelScale={2}
      patternSize={64}
      dark="oklch(18% 0.03 255)"
      light="oklch(94% 0.04 90)"
      style={{ width: "100%", height: "auto" }}
    />
  );
}
```

`patternSize` sets the width and height of the square pattern in dither cells and is clamped to `8…128`. Pattern generation wraps both axes as a torus, then the shader repeats that tile across the canvas. It starts with an exact rank permutation and refines nested threshold levels through several toroidal Gaussian cluster-to-void swap passes. Because `pixelScale` is measured in CSS pixels, both the dots and the complete tile keep a stable CSS size across display densities and responsive resizing. The pattern is deterministic for a given `patternSize` and `seed` and is cached after its first generation.

The component accepts the relevant sizing, color, inversion, seed, canvas, and callback props from `FloydSteinberg`. It omits image and error-diffusion props such as `src`, `fit`, `crossOrigin`, `alphaBackground`, `randomness`, and `threshold`.

## Interactive fluid example

`BlueNoiseFluid` runs a small projected velocity-and-temperature simulation, then applies the same fixed blue-noise threshold tile. Its perimeter is a hard, zero-velocity wall; the lower edge is hot, the upper edge is cold, and the left and right edges transition linearly between those temperatures. Buoyancy and tiny seeded variations in the plate produce convection plumes without changing randomly from frame to frame.

The `quantity` prop chooses the field used for output luminance and pointer interaction. Its default, `"velocity"`, makes faster regions lighter and lets the pointer stir the flow. Set it to `"temperature"` to make hotter regions lighter and paint heat into the fluid with the pointer.

The `contrast` prop (default `1`, clamped to `0.25…8`) applies a contrast post process to the selected field before dithering: values above `1` push luminance away from its midpoint and grow the colored areas, while values below `1` shrink them.

The `viscosity` prop (default `1`, clamped to `0…20`) controls velocity diffusion. Increasing it suppresses small eddies and thin turbulent structures, producing broader, smoother plumes. It changes the simulation itself, unlike `contrast`, which only changes the final thresholded appearance.

```tsx
import { BlueNoiseFluid } from "react-floyd-steinberg";

export function DitheredFluid() {
  return (
    <BlueNoiseFluid
      width={900}
      height={600}
      pixelScale={2}
      patternSize={64}
      simulationSize={192}
      viscosity={4}
      quantity="temperature"
      dark="oklch(18% 0.03 255)"
      light="oklch(94% 0.04 90)"
      style={{ width: "100%", height: "auto" }}
    />
  );
}
```

`simulationSize` controls the longest fluid-grid dimension independently from the canvas backing resolution and is clamped to `32…384`. `interactionRadius` controls the pointer influence in normalized canvas units. The defaults favor a subtle, responsive, and inexpensive simulation.

## Continuous cellular automaton example

`BlueNoiseLenia` runs a Lenia continuous cellular automaton on the GPU, then applies the same fixed blue-noise threshold tile. The reusable `LENIA_SPECIES_PRESETS` catalog stores species cells and dynamics, while `LENIA_SCENE_PRESETS` stores reusable arrangements and orientations. The demo advances the selected preset at four steps per second and interpolates the two latest states at display rate, keeping motion slow and smooth without destabilizing the creatures.

```tsx
import { BlueNoiseLenia } from "react-floyd-steinberg";

export function DitheredLenia() {
  return (
    <BlueNoiseLenia
      width={900}
      height={600}
      pixelScale={3}
      patternSize={64}
      simulationSize={192}
      preset="tricircium-inversus-solo"
      position={{ x: 2 / 3, y: 0.5 }}
      spatialScale={1.75}
      dark="oklch(18% 0.03 255)"
      light="oklch(94% 0.04 90)"
      style={{ width: "100%", height: "auto" }}
    />
  );
}
```

The `species` prop accepts any exported `LeniaSpeciesId`; omit it to use *Orbium unicaudatus*. A `preset` selects an exported `LeniaScenePresetId` and controls both species and placement. The catalog includes `orbium-unicaudatus-solo-up` and the two-band, polynomial-growth `tricircium-inversus-solo` oscillator. `position={{ x, y }}` overrides the first creature's normalized center, while `spatialScale` proportionally enlarges both its seed and kernel for higher simulation detail. Moving the pointer across the canvas injects a soft creature-sized blob into the field; `interactionRadius` controls its size in normalized canvas units. The `contrast` prop (default `1`, clamped to `0.25…8`) adjusts how much of the field is dithered to the light color. Set `dither={false}` to inspect the continuous field with bicubic reconstruction. `simulationSize` is clamped to `64…384`; lower values make each creature larger on screen, while higher values provide more room at proportionally higher GPU cost per frame. `pixelScale` independently controls the visible blue-noise dither-cell size.

## Local playground

```sh
npm install
npm run dev
```

Open the Vite URL, choose any local image, and tune randomness, threshold, pixel scale, fit, and inversion. Build the static demo with `npm run build:demo`.

## GitHub distribution

This package is distributed directly through GitHub rather than the npm registry. Its `package.json` is marked `private` to prevent accidental `npm publish`.

The package entry points reference `dist/`, and that directory is intentionally committed. This makes Git installation work consistently without asking consumers to trust or run dependency lifecycle scripts. Rebuild `dist/` before every release:

```sh
pnpm build
git add .
git commit -m "Initial release"
git tag v0.1.0
```

To create the public GitHub repository for the first time:

```sh
gh repo create react-floyd-steinberg --public --source=. --remote=origin --push
git push origin v0.1.0
```

For later versions, update `version` in `package.json`, rebuild, commit, create the matching tag, and push both the branch and tag:

```sh
pnpm version patch --no-git-tag-version
pnpm build
git add .
git commit -m "Release v0.1.1"
git tag v0.1.1
git push origin main v0.1.1
```

Consumers upgrade by changing the tag in their install command:

```sh
pnpm add github:<github-user>/react-floyd-steinberg#v0.1.1
```

npm, pnpm, and Bun all install the same Git repository package. The package manager lockfile resolves the selected tag or branch to a specific commit.

## How it works

Each compute workgroup assigns one invocation to each of up to 256 rows. Rows begin three phases apart and advance along a synchronized diagonal wavefront. A storage barrier after every phase ensures each pixel sees error from its causal neighbors and avoids concurrent writes to the same error-buffer cell.

The randomness parameter perturbs paired Floyd–Steinberg weights while preserving their total:

```text
right      = 7/16 + p·r₁    down       = 5/16 − p·r₁
down-left  = 3/16 + p·r₂    down-right = 1/16 − p·r₂
```

## License

MIT
