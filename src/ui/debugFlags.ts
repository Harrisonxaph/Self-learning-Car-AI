// Debug views switched on from the page address, for example `?debug=rays` or `?debug=fps`. Off by default, so the
// normal page, its layout and its controls are unchanged.

/** True if the query string's `debug` parameter lists `name` (several views may be comma-separated). */
function debugFlag(search: string, name: string): boolean {
  return new URLSearchParams(search)
    .getAll('debug')
    .flatMap((value) => value.split(','))
    .some((entry) => entry.trim() === name);
}

/** True if the query string's `debug` parameter lists `rays`. */
export function debugRaysEnabled(search: string): boolean {
  return debugFlag(search, 'rays');
}

/** True if the query string's `debug` parameter lists `fps`: the training view then shows its frame-rate readout (P3-03). */
export function debugFpsEnabled(search: string): boolean {
  return debugFlag(search, 'fps');
}

/** True if the query string's `debug` parameter lists `drawtime`: the driving and training pages then show the camera draw-time readout (P4-07). */
export function debugDrawTimeEnabled(search: string): boolean {
  return debugFlag(search, 'drawtime');
}
