import { describe, expect, it } from 'vitest';
import { debugFpsEnabled, debugRaysEnabled } from '../../src/ui/debugFlags';

describe('debugRaysEnabled', () => {
  it.each(['?debug=rays', '?debug=rays&x=1', '?x=1&debug=rays', '?debug=grid,rays', '?debug=other&debug=rays', '?debug=%20rays'])(
    'is on for %s',
    (search) => expect(debugRaysEnabled(search)).toBe(true),
  );

  it.each(['', '?', '?debug', '?debug=', '?debug=ray', '?debug=raysx', '?rays=debug', '?debug=RAYS'])('is off for "%s"', (search) =>
    expect(debugRaysEnabled(search)).toBe(false),
  );
});

describe('debugFpsEnabled', () => {
  it.each(['?debug=fps', '?debug=rays,fps', '?mode=train&debug=fps', '?debug=rays&debug=fps'])('is on for %s', (search) =>
    expect(debugFpsEnabled(search)).toBe(true),
  );
  it.each(['', '?debug=rays', '?debug=fpsx', '?fps=1', '?debug='])('is off for %s', (search) => expect(debugFpsEnabled(search)).toBe(false));
});
