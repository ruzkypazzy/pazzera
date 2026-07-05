import React from 'react';
import Image from 'next/image';

/**
 * Pazzera logo — uses the official 3D-rendered PNG (cropped to remove padding).
 * Source file lives at apps/web/public/pazzera-logo.png.
 *
 * The image contains the full brand mark + "PAZZERA" wordmark already,
 * so we render it directly without any text overlay.
 *
 * IMPORTANT: do NOT swap this for an SVG / text approximation.
 * The user explicitly required the exact 3D render.
 *
 * Source image is landscape (784 x 429, aspect 1.83:1) after cropping.
 * `size` is the rendered HEIGHT in CSS pixels; width is derived.
 */
const ASPECT = 784 / 429; // 1.83:1 landscape

export function PazzeraLogo({
  size = 38,
  showWord = true,
}: {
  size?: number;
  showWord?: boolean;
  size_t?: 'sm' | 'md' | 'lg';
}) {
  const width = Math.round(size * ASPECT);
  return (
    <Image
      src="/pazzera-logo.png"
      alt="Pazzera"
      width={width}
      height={size}
      priority
      style={{
        height: size,
        width,
        objectFit: 'contain',
      }}
    />
  );
}

export function PazzeraLogoMark({ size = 32 }: { size?: number }) {
  const width = Math.round(size * ASPECT);
  return (
    <Image
      src="/pazzera-logo.png"
      alt="Pazzera"
      width={width}
      height={size}
      style={{ objectFit: 'contain', height: size, width }}
    />
  );
}