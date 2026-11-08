// P3-01: the dashboard's markup. `<output>` has an implicit status role that announces changes politely, so every
// dashboard output must opt out; the one polite announcement channel stays the status line. Read from the real
// index.html, in plain Node.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const html = readFileSync(join(__dirname, '../../index.html'), 'utf8');
const tag = (id: string) => new RegExp(`<[a-z]+[^>]*\\bid="${id}"[^>]*>`).exec(html)![0];

describe('index.html dashboard markup', () => {
  const outputs = [...html.matchAll(/<output\b[^>]*\bid="(dash-[a-z-]+)"[^>]*>/g)].map((m) => ({ id: m[1]!, tag: m[0] }));

  it('has the eleven dashboard outputs, and each one opts out of live announcements', () => {
    expect(outputs).toHaveLength(11);
    for (const output of outputs) expect(output.tag, output.id).toMatch(/\baria-live="off"/);
  });

  it('keeps the status line as the polite announcement channel, and puts no live region on the panel', () => {
    expect(tag('hud-message')).toMatch(/aria-live="polite"/);
    expect(tag('training-dashboard')).not.toMatch(/aria-live/);
    expect(tag('dash-note')).not.toMatch(/aria-live|role=/);
  });

  it('starts hidden, so the manual page is unchanged', () => {
    expect(tag('training-dashboard')).toMatch(/\bhidden\b/);
  });
});
