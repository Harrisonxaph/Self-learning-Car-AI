// A 2D context for chart tests that records the path it is asked to draw, tagged with the stroke style and dash in force.
import type { ChartContext } from '../../src/render/lineChart';

export type Op = [string, ...unknown[]];
/** A 2D context that records the path it is asked to draw, tagged with the stroke style and dash in force. */
export function recordingContext() {
  const ops: Op[] = [];
  const ctx = {
    strokeStyle: '' as string,
    fillStyle: '' as string,
    lineWidth: 1,
    font: '',
    textAlign: 'left' as CanvasTextAlign,
    textBaseline: 'alphabetic' as CanvasTextBaseline,
    dash: [] as number[],
    beginPath: () => ops.push(['beginPath']),
    moveTo: (x: number, y: number) => ops.push(['moveTo', x, y, ctx.strokeStyle, [...ctx.dash]]),
    lineTo: (x: number, y: number) => ops.push(['lineTo', x, y, ctx.strokeStyle, [...ctx.dash]]),
    stroke: () => ops.push(['stroke', ctx.strokeStyle]),
    fillText: (text: string) => ops.push(['fillText', text]),
    setLineDash: (dash: number[]) => {
      ctx.dash = [...dash];
    },
  };
  return { ctx: ctx as unknown as ChartContext, ops };
}
