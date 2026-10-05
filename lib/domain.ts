// Pure business rules: no I/O, shared by server and UI.
export type Flag = 'GREEN' | 'YELLOW' | 'RED';
export type Role = 'cutting_supervisor' | 'cutting_verifier' | 'sewing_supervisor';

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export const expectedQty = (targetQty: number, piecesPerGarment: number) => targetQty * piecesPerGarment;

export const flagFor = (actual: number, expected: number): Flag =>
  actual === expected ? 'GREEN' : actual > expected ? 'YELLOW' : 'RED';

export const expectedFabric = (targetQty: number, stdYards: number) => targetQty * stdYards;

/** [(actual - expected) / expected] x 100, rounded to 2dp */
export const wastagePct = (actualYds: number, expectedYds: number) =>
  Math.round(((actualYds - expectedYds) / expectedYds) * 10000) / 100;

// Strict numeric guards: real JSON numbers only (no "12", no 1.5, no negatives).
export const isNonNegInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
export const isPosInt = (v: unknown): v is number => isNonNegInt(v) && v > 0;
export const isPosYards = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 && Math.round(v * 100) === v * 100 && v <= 1_000_000;
