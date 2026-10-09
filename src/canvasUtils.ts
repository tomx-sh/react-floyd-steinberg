import type { FloydSteinbergColor } from "./FloydSteinberg";

let cssColorContext: CanvasRenderingContext2D | undefined;

export function clamp(value: number, minimum: number, maximum: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
}

export function positiveInteger(value: number | undefined, fallback: number): number {
  return Math.max(1, Math.round(Number.isFinite(value) ? (value as number) : fallback));
}

function normalizedCssColor(color: string): readonly [number, number, number, number] {
  const value = color.trim();
  if (!cssColorContext) {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    cssColorContext = canvas.getContext("2d", { willReadFrequently: true }) ?? undefined;
  }
  if (!cssColorContext) {
    throw new Error("CSS colors could not be resolved because a 2D canvas context is unavailable.");
  }

  cssColorContext.fillStyle = "#010203";
  cssColorContext.fillStyle = value;
  const firstResult = cssColorContext.fillStyle;
  cssColorContext.fillStyle = "#040506";
  cssColorContext.fillStyle = value;
  if (!value || cssColorContext.fillStyle !== firstResult) {
    throw new Error(`Invalid CSS color: ${JSON.stringify(color)}.`);
  }

  cssColorContext.clearRect(0, 0, 1, 1);
  cssColorContext.fillRect(0, 0, 1, 1);
  const [red, green, blue, alpha] = cssColorContext.getImageData(0, 0, 1, 1).data;
  return [red / 255, green / 255, blue / 255, alpha / 255];
}

export function normalizedColor(color: FloydSteinbergColor): readonly [number, number, number, number] {
  if (typeof color === "string") return normalizedCssColor(color);
  return [
    clamp(color[0], 0, 1, 0),
    clamp(color[1], 0, 1, 0),
    clamp(color[2], 0, 1, 0),
    clamp(color[3] ?? 1, 0, 1, 1),
  ];
}

export function colorDependency(color: FloydSteinbergColor): string {
  return typeof color === "string" ? `css:${color}` : `tuple:${color.join(",")}`;
}

