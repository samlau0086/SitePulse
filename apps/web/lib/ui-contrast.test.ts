import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(
  new URL('../app/globals.css', import.meta.url),
  'utf8',
);
const tokens: Record<string, string> = Object.fromEntries(
  [...css.matchAll(/--([\w-]+):\s*(#[\da-f]{6});/gi)].map((match) => [
    match[1],
    match[2],
  ]),
);

function luminance(token: string) {
  const color = tokens[token];
  if (!color) throw new Error(`Missing color token: ${token}`);
  function channel(offset: number) {
    const value = parseInt(color!.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }
  return channel(1) * 0.2126 + channel(3) * 0.7152 + channel(5) * 0.0722;
}

function contrast(a: string, b: string) {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

describe('shared UI contrast', () => {
  it.each([
    'canvas',
    'surface-soft',
    'surface-card',
    'product-background',
    'product-surface',
  ])('keeps text and controls readable on %s', (surface) => {
    for (const ink of ['ink', 'body', 'muted']) {
      expect(
        contrast(ink, surface),
        `${ink} on ${surface}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast('border-control', surface)).toBeGreaterThanOrEqual(3);
    expect(contrast('info-ink', surface)).toBeGreaterThanOrEqual(3);
  });

  it.each(['product-primary', 'product-primary-hover'])(
    'keeps product actions readable on %s',
    (surface) =>
      expect(contrast('product-surface', surface)).toBeGreaterThanOrEqual(4.5),
  );

  it.each(['info', 'success', 'warning', 'danger'])(
    'keeps %s feedback text and borders distinct',
    (kind) => {
      expect(contrast(`${kind}-ink`, `${kind}-surface`)).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(contrast(`${kind}-ink`, 'canvas')).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(['ink', 'ink-deep', 'surface-dark-elevated', 'danger-ink'])(
    'keeps primary button labels readable on %s',
    (surface) =>
      expect(contrast('canvas', surface)).toBeGreaterThanOrEqual(4.5),
  );
});
