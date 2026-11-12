// Draws the track editor (P4-02): the working area, the derived road when the loop is closed, the control points
// and the keyboard crosshair. Reads the editor state and changes nothing. The world is always fitted to the view
// (no zoom or pan; that is P4-07), so the transform depends only on the canvas size.
import { EDITOR_LIMITS, buildTrack, centreSamples, type EditorState } from '../editor/trackEditor';
import type { Vec2 } from '../sim/track';
import { TRACK_COLOURS } from './trackLayer';
import { fitBounds, trackMargin, worldToScreen, type WorldToScreen } from './trackView';
import type { ViewportSize } from './viewport';

export const EDITOR_COLOURS = Object.freeze({
  grid: 'rgba(255, 255, 255, 0.07)',
  area: 'rgba(255, 255, 255, 0.25)',
  centre: 'rgba(138, 180, 255, 0.8)',
  point: '#8ab4ff',
  first: '#5fd0a8',
  selected: '#ffd250',
  problem: '#ff5a5a',
  crosshair: '#ffffff',
  draft: 'rgba(138, 180, 255, 0.9)',
});

/** Radius of a drawn control point, and of the touch target around it, in CSS pixels. */
export const POINT_RADIUS_PX = 8;
export const TOUCH_RADIUS_PX = 22;

/** The fixed transform of the working area for a canvas size (always fits, never zooms). */
export function editorView(size: ViewportSize): WorldToScreen {
  const a = EDITOR_LIMITS.workArea;
  return fitBounds({ minX: -a, minY: -a, maxX: a, maxY: a }, size.cssWidth, size.cssHeight, trackMargin(size.cssWidth, size.cssHeight));
}

/** The world point in a validator message like "near (12, -3)", or null. Used to ring the place a problem is. */
export function problemLocation(message: string): Vec2 | null {
  const found = /\((-?\d+(?:\.\d+)?), (-?\d+(?:\.\d+)?)\)/.exec(message);
  return found ? { x: Number(found[1]), y: Number(found[2]) } : null;
}

export interface EditorDrawing {
  readonly state: EditorState;
  readonly selected: number;
  readonly crosshair: Vec2;
  readonly showCrosshair: boolean;
  readonly problems: readonly string[];
}

export function drawEditor(ctx: CanvasRenderingContext2D, size: ViewportSize, view: WorldToScreen, d: EditorDrawing): void {
  ctx.setTransform(size.pixelRatio, 0, 0, size.pixelRatio, 0, 0);
  ctx.clearRect(0, 0, size.cssWidth, size.cssHeight);
  ctx.fillStyle = TRACK_COLOURS.background;
  ctx.fillRect(0, 0, size.cssWidth, size.cssHeight);
  const area = EDITOR_LIMITS.workArea;
  const to = (p: Vec2): Vec2 => worldToScreen(view, p);
  const path = (points: readonly Vec2[], close: boolean): void => {
    ctx.beginPath();
    points.forEach((p, i) => {
      const s = to(p);
      if (i === 0) ctx.moveTo(s.x, s.y);
      else ctx.lineTo(s.x, s.y);
    });
    if (close) ctx.closePath();
  };

  // Grid every 50 m and the working-area border.
  ctx.lineWidth = 1;
  ctx.strokeStyle = EDITOR_COLOURS.grid;
  for (let g = -area; g <= area; g += 50) {
    path([{ x: g, y: -area }, { x: g, y: area }], false);
    ctx.stroke();
    path([{ x: -area, y: g }, { x: area, y: g }], false);
    ctx.stroke();
  }
  ctx.strokeStyle = EDITOR_COLOURS.area;
  path([{ x: -area, y: -area }, { x: area, y: -area }, { x: area, y: area }, { x: -area, y: area }], true);
  ctx.stroke();

  const { state } = d;
  if (state.closed) {
    const built = buildTrack(state);
    if (!('message' in built)) {
      const doc = built.document as { outer: Vec2[]; inner: Vec2[]; gates: { a: Vec2; b: Vec2 }[]; start: { position: Vec2; heading: number } };
      ctx.fillStyle = TRACK_COLOURS.road;
      path(doc.outer, true);
      ctx.fill();
      ctx.fillStyle = TRACK_COLOURS.background;
      path(doc.inner, true);
      ctx.fill();
      ctx.lineJoin = 'round';
      ctx.strokeStyle = TRACK_COLOURS.boundary;
      ctx.lineWidth = 2;
      path(doc.outer, true);
      ctx.stroke();
      path(doc.inner, true);
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.strokeStyle = TRACK_COLOURS.gate;
      doc.gates.slice(1).forEach((g) => {
        path([g.a, g.b], false);
        ctx.stroke();
      });
      const finish = doc.gates[0];
      if (finish) {
        ctx.strokeStyle = TRACK_COLOURS.startLine;
        ctx.lineWidth = 3;
        path([finish.a, finish.b], false);
        ctx.stroke();
      }
      const { position, heading } = doc.start;
      ctx.strokeStyle = TRACK_COLOURS.startPose;
      ctx.lineWidth = 3;
      path([position, { x: position.x + Math.cos(heading) * 6, y: position.y + Math.sin(heading) * 6 }], false);
      ctx.stroke();
      const s = to(position);
      ctx.fillStyle = TRACK_COLOURS.startPose;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    const centre = centreSamples(state);
    if (centre.length > 0) {
      ctx.strokeStyle = EDITOR_COLOURS.centre;
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 4]);
      path(centre, true);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  } else if (state.points.length > 1) {
    ctx.strokeStyle = EDITOR_COLOURS.draft;
    ctx.lineWidth = 2;
    path(state.points, false);
    ctx.stroke();
  }

  state.points.forEach((p, i) => {
    const s = to(p);
    const isSelected = i === d.selected;
    ctx.beginPath();
    ctx.arc(s.x, s.y, isSelected ? POINT_RADIUS_PX + 2 : POINT_RADIUS_PX, 0, Math.PI * 2);
    ctx.fillStyle = isSelected ? EDITOR_COLOURS.selected : i === 0 ? EDITOR_COLOURS.first : EDITOR_COLOURS.point;
    ctx.fill();
    ctx.strokeStyle = '#0b1118';
    ctx.lineWidth = 2;
    ctx.stroke();
  });

  for (const problem of d.problems) {
    const at = problemLocation(problem);
    if (!at) continue;
    const s = to(at);
    ctx.beginPath();
    ctx.arc(s.x, s.y, 14, 0, Math.PI * 2);
    ctx.strokeStyle = EDITOR_COLOURS.problem;
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  if (d.showCrosshair) {
    const c = to(d.crosshair);
    ctx.strokeStyle = EDITOR_COLOURS.crosshair;
    ctx.lineWidth = 2;
    path([{ x: d.crosshair.x - 4, y: d.crosshair.y }, { x: d.crosshair.x + 4, y: d.crosshair.y }], false);
    ctx.stroke();
    path([{ x: d.crosshair.x, y: d.crosshair.y - 4 }, { x: d.crosshair.x, y: d.crosshair.y + 4 }], false);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(c.x, c.y, 12, 0, Math.PI * 2);
    ctx.stroke();
  }
}
