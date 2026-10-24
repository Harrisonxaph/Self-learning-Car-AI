import { describe, expect, it } from 'vitest';
import { debugRaysEnabled } from '../../src/ui/debugFlags';

describe('debugRaysEnabled', () => {
  it.each(['?debug=rays', '?debug=rays&x=1', '?x=1&debug=rays', '?debug=grid,rays', '?debug=other&debug=rays', '?debug=%20rays'])(
    'is on for %s',
    (search) => expect(debugRaysEnabled(search)).toBe(true),
  );

  it.each(['', '?', '?debug', '?debug=', '?debug=ray', '?debug=raysx', '?rays=debug', '?debug=RAYS'])('is off for "%s"', (search) =>
    expect(debugRaysEnabled(search)).toBe(false),
  );
});
