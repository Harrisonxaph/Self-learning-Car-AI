// Debug views switched on from the page address, for example `?debug=rays`. Off by default, so the normal
// page, its layout and its controls are unchanged.

/** True if the query string's `debug` parameter lists `rays` (several views may be comma-separated). */
export function debugRaysEnabled(search: string): boolean {
  return new URLSearchParams(search)
    .getAll('debug')
    .flatMap((value) => value.split(','))
    .some((name) => name.trim() === 'rays');
}
