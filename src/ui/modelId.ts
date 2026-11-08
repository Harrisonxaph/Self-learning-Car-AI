// A fresh id for a saved model (P3-05). It never touches a simulation or evolution random stream: it uses the browser's
// own `crypto.randomUUID`, or, where that is missing, `crypto.getRandomValues`, and as a last resort the clock and
// `Math.random`, which are unrelated to the seeded generator in utils/rng.
export interface IdCrypto {
  randomUUID?: () => string;
  getRandomValues?: (array: Uint8Array) => unknown;
}

export interface IdSources {
  readonly crypto?: IdCrypto | undefined;
  readonly now?: () => number;
  readonly random?: () => number;
}

export function newModelId(sources: IdSources = {}): string {
  const c: IdCrypto | undefined = sources.crypto ?? (typeof crypto === 'undefined' ? undefined : (crypto as unknown as IdCrypto));
  try {
    if (c?.randomUUID) return c.randomUUID();
  } catch {
    // Fall through: randomUUID needs a secure context in some browsers.
  }
  const bytes = new Uint8Array(16);
  try {
    if (c?.getRandomValues) {
      c.getRandomValues(bytes);
      return formatUuid(bytes);
    }
  } catch {
    // Fall through.
  }
  const random = sources.random ?? Math.random;
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(random() * 256);
  const now = (sources.now ?? Date.now)();
  bytes[0] = (now >>> 0) & 0xff;
  bytes[1] = (now >>> 8) & 0xff;
  return formatUuid(bytes);
}

/** Formats 16 bytes as a version 4 UUID. */
export function formatUuid(bytes: Uint8Array): string {
  const b = Uint8Array.from(bytes);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = [...b].map((v) => v.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
