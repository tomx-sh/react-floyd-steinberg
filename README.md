# react-floyd-steinberg

A reusable React component that applies stochastic Floyd–Steinberg error diffusion to an image with a synchronized WebGPU compute wavefront.

The source can be an image URL, `File`/`Blob`, `ImageBitmap`, image element, or canvas. No source pixels are read back to JavaScript: the browser uploads the image to a GPU texture, the compute shader generates the binary result, and a render pass displays it.

## Install

```sh
npm install github:<github-user>/react-floyd-steinberg#v0.1.0
pnpm add github:<github-user>/react-floyd-steinberg#v0.1.0
bun add github:<github-user>/react-floyd-steinberg#v0.1.0
```

Replace `<github-user>` with the repository owner's GitHub username. The equivalent full Git URL works with all three package managers:

```sh
npm install git+https://github.com/<github-user>/react-floyd-steinberg.git#v0.1.0
```

A tag such as `#v0.1.0` is recommended so application installs remain reproducible. You can instead select:

- `#main` for the latest commit on the main branch.
- `#<commit-sha>` for one exact commit.
- No suffix for the repository's default branch.

The dependency will be stored in the consuming application's `package.json`, for example:

```json
{
  "dependencies": {
    "react-floyd-steinberg": "github:<github-user>/react-floyd-steinberg#v0.1.0"
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
      style={{ width: "100%", height: "auto" }}
      onError={console.error}
    />
  );
}
```

If only `width` or `height` is supplied, the source aspect ratio is preserved. If neither is supplied, the source image dimensions are used.

Remote image URLs must allow cross-origin use. The component defaults to `crossOrigin="anonymous"`; a server without an appropriate CORS response cannot be copied into a WebGPU texture. Passing a user-selected `File` avoids that restriction.

## Main props

| Prop | Type | Default | Purpose |
| --- | --- | --- | --- |
| `src` | URL, `Blob`/`File`, `ImageBitmap`, image or canvas | required | Source image |
| `width`, `height` | `number` | source size | Output canvas size |
| `pixelScale` | `number` | `1` | Output pixels per dither cell; larger values improve speed and emphasize the pattern |
| `randomness` | `0…2` | `0.35` | Stochastic coefficient perturbation; `0` is classic Floyd–Steinberg |
| `threshold` | `0…1` | `0.5` | Binary quantization threshold |
| `fit` | `"stretch" \| "cover" \| "contain"` | `"contain"` | Source-to-output mapping |
| `invert` | `boolean` | `false` | Invert luminance before diffusion |
| `seed` | `number` | deterministic | Random coefficient seed |
| `alphaBackground` | `0…1` | `1` | Luminance behind transparent pixels |
| `dark`, `light` | normalized RGB/RGBA tuple | black, white | Output colors |
| `onReady`, `onError` | callback | — | GPU completion and error notifications |

Normal canvas attributes such as `className`, `style`, and ARIA attributes are also accepted. The canvas exposes `data-webgpu-status="loading|ready|error"`.

The package additionally exports `floydSteinbergShader`, `displayShader`, and `isWebGpuSupported`.

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
