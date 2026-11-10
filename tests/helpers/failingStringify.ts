// A deterministic serialization failure for tests. A value nested "deep enough" overflows the stack on one runtime and
// serializes fine on another (the limit depends on the worker's stack size), so tests that need `JSON.stringify` to fail
// must not rely on depth. While installed, `JSON.stringify` throws the same RangeError a stack overflow gives whenever the
// value being written out is an object carrying the marker field; everything else is serialized normally.
export const FAIL_MARKER = '__failSerialization';

/** Installs the failing `JSON.stringify` and returns the function that restores the real one. */
export function installFailingStringify(): () => void {
  const real = JSON.stringify;
  JSON.stringify = ((...args: Parameters<typeof JSON.stringify>) => {
    const [value] = args;
    if (typeof value === 'object' && value !== null && (value as Record<string, unknown>)[FAIL_MARKER] === true) throw new RangeError('Maximum call stack size exceeded');
    return real(...args);
  }) as typeof JSON.stringify;
  return () => {
    JSON.stringify = real;
  };
}
