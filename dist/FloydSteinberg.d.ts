import { CanvasHTMLAttributes } from 'react';
export type FloydSteinbergColor = readonly [number, number, number] | readonly [number, number, number, number];
export type FloydSteinbergFit = "stretch" | "cover" | "contain";
export type FloydSteinbergSource = string | Blob | ImageBitmap | HTMLImageElement | HTMLCanvasElement | OffscreenCanvas;
export interface FloydSteinbergRenderInfo {
    canvas: HTMLCanvasElement;
    device: GPUDevice;
    width: number;
    height: number;
    logicalWidth: number;
    logicalHeight: number;
}
export interface FloydSteinbergProps extends Omit<CanvasHTMLAttributes<HTMLCanvasElement>, "children" | "height" | "onError" | "width"> {
    /** A URL, Blob/File, ImageBitmap, image element, or canvas containing the source image. */
    src: FloydSteinbergSource;
    /** Output canvas width in pixels. Defaults to the source width. */
    width?: number;
    /** Output canvas height in pixels. Defaults to the source height. */
    height?: number;
    /** Size of each dither cell in output pixels. */
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
    /** RGBA values in the 0–1 range for dark output pixels. */
    dark?: FloydSteinbergColor;
    /** RGBA values in the 0–1 range for light output pixels. */
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
