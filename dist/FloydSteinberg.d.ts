import { CanvasHTMLAttributes } from 'react';
export type FloydSteinbergColor = string | readonly [number, number, number] | readonly [number, number, number, number];
export type FloydSteinbergFit = "stretch" | "cover" | "contain";
export type FloydSteinbergSource = string | Blob | ImageBitmap | HTMLImageElement | HTMLCanvasElement | OffscreenCanvas;
export interface FloydSteinbergRenderInfo {
    canvas: HTMLCanvasElement;
    device: GPUDevice;
    /** Canvas backing-buffer width in device pixels. */
    width: number;
    /** Canvas backing-buffer height in device pixels. */
    height: number;
    /** Rendered canvas content width in CSS pixels. */
    cssWidth: number;
    /** Rendered canvas content height in CSS pixels. */
    cssHeight: number;
    /** Device-pixel ratio used for the backing buffer. */
    devicePixelRatio: number;
    logicalWidth: number;
    logicalHeight: number;
}
export interface FloydSteinbergProps extends Omit<CanvasHTMLAttributes<HTMLCanvasElement>, "children" | "height" | "onError" | "width"> {
    /** A URL, Blob/File, ImageBitmap, image element, or canvas containing the source image. */
    src: FloydSteinbergSource;
    /** Intrinsic canvas width in CSS pixels. Defaults to the source width. CSS may override it. */
    width?: number;
    /** Intrinsic canvas height in CSS pixels. Defaults to the source height. CSS may override it. */
    height?: number;
    /** Size of each dither cell in CSS pixels. */
    pixelScale?: number;
    /** Perturbs paired diffusion coefficients without changing their total. 0 is classic Floyd–Steinberg. */
    randomness?: number;
    /** Binary quantization threshold from 0 to 1. */
    threshold?: number;
    /** How the source image maps into an explicitly sized output. */
    fit?: FloydSteinbergFit;
    /** Inverts source luminance before dithering. */
    invert?: boolean;
    /** Deterministic seed used by stochastic coefficient perturbation. */
    seed?: number;
    /** Luminance behind transparent source pixels, from 0 to 1. */
    alphaBackground?: number;
    /** A CSS color string or RGB/RGBA values in the 0–1 range for dark output pixels. */
    dark?: FloydSteinbergColor;
    /** A CSS color string or RGB/RGBA values in the 0–1 range for light output pixels. */
    light?: FloydSteinbergColor;
    /** Cross-origin mode used when src is a URL. */
    crossOrigin?: "" | "anonymous" | "use-credentials";
    /** Adapter power preference. */
    powerPreference?: GPUPowerPreference;
    /** Called once the submitted GPU work has completed. */
    onReady?: (info: FloydSteinbergRenderInfo) => void;
    /** Called when image loading, WebGPU setup, shader compilation, or rendering fails. */
    onError?: (error: Error) => void;
}
export declare function isWebGpuSupported(): boolean;
export declare const FloydSteinberg: import('react').ForwardRefExoticComponent<FloydSteinbergProps & import('react').RefAttributes<HTMLCanvasElement>>;
