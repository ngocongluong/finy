// The owner's voice print: speaker embeddings (192 numbers each, from the
// speaker model in Finy's ears) of the samples recorded when the voice was
// enrolled, and how alike a new voice must be to count as the owner's.
// No React Native imports, so it can be tested.

export type Strictness = 'loose' | 'normal' | 'strict';

export interface VoicePrint {
  /** Average of the "Finy ơi" samples: compared with a short call. */
  wake: number[];
  /** Average of every sample: compared with longer speech. */
  voice: number[];
  /** Thresholds measured on the owner's own samples. */
  wakeT: number;
  voiceT: number;
  strictness: Strictness;
  /** When it was enrolled (ms). */
  at: number;
}

/** Added to the measured thresholds. */
export const STRICTNESS: Record<Strictness, { label: string; offset: number }> = {
  loose: { label: 'Dễ', offset: -0.07 },
  normal: { label: 'Vừa', offset: 0 },
  strict: { label: 'Khắt khe', offset: 0.05 },
};

/** Speech shorter than this is taken as just the name ("Finy ơi"). */
export const SHORT_MS = 1300;

export function normalize(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / n);
}

export function mean(vs: number[][]): number[] {
  const out = new Array<number>(vs[0].length).fill(0);
  for (const v of vs) for (let i = 0; i < v.length; i++) out[i] += v[i] / vs.length;
  return out;
}

/** Cosine similarity: 1 = the same direction (the same voice), near 0 = unrelated. */
export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

const round = (v: number[]) => v.map((x) => Math.round(x * 1e4) / 1e4);
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/**
 * How alike each sample is to the others (leave one out): the lowest is how
 * different the owner's own voice can sound, which sets the threshold.
 */
function selfSimilarity(samples: number[][]): number {
  return Math.min(...samples.map((s, i) => cosine(s, normalize(mean(samples.filter((_, j) => j !== i))))));
}

/**
 * The print from enrollment samples (at least 3 calls and 2 sentences); null
 * when there are too few. Thresholds sit a little below the owner's own
 * lowest likeness, within 0.40–0.75.
 */
export function buildPrint(wake: number[][], sentences: number[][], strictness: Strictness = 'normal', at = Date.now()): VoicePrint | null {
  if (wake.length < 3 || sentences.length < 2) return null;
  const all = [...wake, ...sentences];
  return {
    wake: round(normalize(mean(wake))),
    voice: round(normalize(mean(all))),
    wakeT: Math.round(clamp(selfSimilarity(wake) - 0.1, 0.4, 0.75) * 1000) / 1000,
    voiceT: Math.round(clamp(selfSimilarity(all) - 0.1, 0.4, 0.75) * 1000) / 1000,
    strictness,
    at,
  };
}

/** Whether a voice is the owner's: the best likeness to the print against the threshold for its length. */
export function verify(print: VoicePrint, embedding: number[], speechMs: number): { ok: boolean; score: number; threshold: number } {
  const score = Math.max(cosine(embedding, print.wake), cosine(embedding, print.voice));
  const threshold = (speechMs < SHORT_MS ? print.wakeT : print.voiceT) + STRICTNESS[print.strictness].offset;
  return { ok: score >= threshold, score: Math.round(score * 1000) / 1000, threshold: Math.round(threshold * 1000) / 1000 };
}

/** A stored print, checked: null when it is not one. */
export function parsePrint(raw: unknown): VoicePrint | null {
  const p = raw as Partial<VoicePrint> | null;
  const vec = (v: unknown) => Array.isArray(v) && v.length >= 16 && v.every((x) => typeof x === 'number' && Number.isFinite(x));
  if (!p || !vec(p.wake) || !vec(p.voice) || p.wake!.length !== p.voice!.length) return null;
  const t = (x: unknown) => (typeof x === 'number' && x > 0 && x < 1 ? x : 0.6);
  const strictness: Strictness = p.strictness === 'loose' || p.strictness === 'strict' ? p.strictness : 'normal';
  return { wake: p.wake!, voice: p.voice!, wakeT: t(p.wakeT), voiceT: t(p.voiceT), strictness, at: typeof p.at === 'number' ? p.at : 0 };
}
