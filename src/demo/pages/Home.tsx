const examples = [
  {
    href: "#/floyd-steinberg",
    eyebrow: "Image dithering",
    title: "Stochastic Floyd–Steinberg",
    description:
      "Choose an image, then tune the synchronized WebGPU error-diffusion shader.",
  },
  {
    href: "#/blue-noise-wave",
    eyebrow: "Stable threshold example",
    title: "Blue-noise wave",
    description:
      "A fixed tileable blue-noise pattern dithers the moving gradient without changing between frames.",
  },
  {
    href: "#/blue-noise-fluid",
    eyebrow: "Interactive example",
    title: "Blue-noise fluid",
    description:
      "A hot lower wall and cold upper wall drive convection plumes, dithered through the same fixed blue-noise tile.",
  },
  {
    href: "#/blue-noise-lenia",
    eyebrow: "Continuous cellular automaton",
    title: "Blue-noise Lenia",
    description:
      "A Lenium automaton evolves on the GPU and is dithered through the same fixed blue-noise tile.",
  },
];

export function Home() {
  return (
    <main>
      <header>
        <p className="eyebrow">React component playground</p>
        <h1>Stochastic Floyd–Steinberg</h1>
        <p className="intro">
          WebGPU dithering components for React. Pick an example to run it on
          its own page.
        </p>
      </header>

      <nav className="example-index" aria-label="Examples">
        {examples.map((example) => (
          <a key={example.href} className="example-card" href={example.href}>
            <p className="eyebrow">{example.eyebrow}</p>
            <h2>{example.title}</h2>
            <p className="intro">{example.description}</p>
          </a>
        ))}
      </nav>
    </main>
  );
}
