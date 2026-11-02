/*
 * Small helpers the worker's modules share: hex, SHA-256, unpredictable
 * random numbers and reading JSON that may not parse (Dev Plan item 19m
 * gathered them here from the modules that each had a copy).
 */

/** Bytes as lowercase hex. */
export const toHex = (bytes: Uint8Array): string => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

/** The SHA-256 of `text`, as hex. */
export async function sha256Hex(text: string): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))));
}

/** A random number in [0, 1) that nobody can predict, for codes and keys. */
export const secureRandom = (): number => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;

/** `text` parsed as JSON, or null if it doesn't parse. */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
