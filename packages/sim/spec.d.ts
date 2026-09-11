export const SPEC_VERSION: string;
export const ENGINE_VERSION: string;
export const SPEC: Readonly<{
  DT: number;
  ENERGY_MAX: number;
  MATCH_DURATION: number;
  [constant: string]: number;
}>;
export function halfExtent(t: number): number;
export function wrap(a: number): number;
export function clamp(v: number, lo: number, hi: number): number;
export function mulberry32(seed: number): () => number;
