import { DARK_CELL, DARK_MARGIN, type DarkMatter } from '../game/dark-matter';
import { FIELD } from '../sim/config';
import { traceDarkIso, type DarkIso } from './dark-iso';
import type { DarkMasks, LookPainter } from './looks/painter';

/** The aiming ship's clearing, in field units. */
const CLEARING = 44;

/** What the matter is to be drawn as this frame: whose field, how strong, and where the aiming ship keeps its clearing. */
export interface DarkFrame {
  /** The player whose field is shown. */
  who: number;
  /** 1 while the matter stands, falling to 0 as it lifts. */
  fade: number;
  clearing: { x: number; y: number } | null;
  /** The colour of the player whose field it is. */
  color: string;
  /** Seconds the renderer has run. */
  time: number;
}

interface PlayerMasks {
  body: HTMLCanvasElement;
  rim: HTMLCanvasElement;
  version: number;
  bounds: { x: number; y: number; w: number; h: number } | null;
}

/**
 * Anomaly Dark Matter on the screen: turns a player's field into the masks a look paints the matter through (kept until
 * a shot tears it again, the lines through it at most 30 times a second), and hands them to the painter. One per
 * canvas: the game's renderer and the tutorial's preview each keep their own.
 */
export class DarkView {
  private owner: DarkMatter | null = null;
  private players: PlayerMasks[] = [];
  private frame: { body: HTMLCanvasElement; rim: HTMLCanvasElement } | null = null;
  private isos = new Map<number, DarkIso>();
  private isoKey = '';
  private isoAt = 0;

  draw(ctx: CanvasRenderingContext2D, painter: LookPainter, dark: DarkMatter, f: DarkFrame): void {
    if (f.fade <= 0) return;
    const make = (): HTMLCanvasElement => Object.assign(document.createElement('canvas'), { width: dark.cols, height: dark.rows });
    if (this.owner !== dark) {
      this.owner = dark;
      this.players = dark.covers.map(() => ({ body: make(), rim: make(), version: -1, bounds: null }));
      this.frame ??= { body: make(), rim: make() };
    }
    const mine = this.players[f.who];
    const frame = this.frame!;
    if (!mine) return;
    const { who, fade, clearing } = f;
    const stamp = `${dark.id}:${who}:${dark.versions[who]}:${Math.round(fade * 20)}:${clearing ? `${Math.round(clearing.x)},${Math.round(clearing.y)}` : '-'}`;
    // The masks are made only if the look asks for them: a look that keeps its picture reads them on some frames only.
    let built = false;
    const build = (): void => {
      if (built) return;
      built = true;
      if (mine.version !== dark.versions[who]) this.paintPlayer(dark, who, mine);
      for (const part of ['body', 'rim'] as const) {
        const fc = frame[part].getContext('2d')!;
        fc.globalCompositeOperation = 'source-over';
        fc.clearRect(0, 0, dark.cols, dark.rows);
        fc.globalAlpha = fade;
        fc.drawImage(mine[part], 0, 0);
        fc.globalAlpha = 1;
        if (clearing) {
          const k = dark.cols / (FIELD.width + 2 * DARK_MARGIN);
          const hx = (clearing.x + DARK_MARGIN) * k;
          const hy = (clearing.y + DARK_MARGIN) * k;
          const r = CLEARING * k;
          const g = fc.createRadialGradient(hx, hy, r * 0.35, hx, hy, r);
          g.addColorStop(0, 'rgba(0,0,0,1)');
          g.addColorStop(1, 'rgba(0,0,0,0)');
          fc.globalCompositeOperation = 'destination-out';
          fc.fillStyle = g;
          fc.fillRect(0, 0, dark.cols, dark.rows);
          fc.globalCompositeOperation = 'source-over';
        }
      }
    };
    const masks: DarkMasks = {
      stamp,
      fade,
      color: f.color,
      clearing: clearing ? { ...clearing, r: CLEARING } : null,
      field: { id: `${dark.id}:${who}`, cover: dark.covers[who], cols: dark.cols, rows: dark.rows, version: dark.versions[who] },
      iso: (level) => this.iso(dark, who, level, f.time),
      get body() {
        build();
        return frame.body;
      },
      get rim() {
        build();
        return frame.rim;
      },
      get rimBounds() {
        build();
        return mine.bounds;
      },
    };
    painter.darkMatter(ctx, masks, f.time);
  }

  private paintPlayer(dark: DarkMatter, who: number, mine: PlayerMasks): void {
    const cover = dark.covers[who];
    const bctx = mine.body.getContext('2d')!;
    const rctx = mine.rim.getContext('2d')!;
    const body = bctx.createImageData(dark.cols, dark.rows);
    const rim = rctx.createImageData(dark.cols, dark.rows);
    let c0 = dark.cols;
    let c1 = -1;
    let r0 = dark.rows;
    let r1 = -1;
    for (let i = 0; i < cover.length; i++) {
      if (cover[i] < 0.995) {
        const cc = i % dark.cols;
        const rr = (i - cc) / dark.cols;
        if (cc < c0) c0 = cc;
        if (cc > c1) c1 = cc;
        if (rr < r0) r0 = rr;
        if (rr > r1) r1 = rr;
      }
      body.data[i * 4 + 3] = Math.round(cover[i] * 255);
      // Where the matter is half there, it is being torn: the edge runs through the middle values.
      rim.data[i * 4 + 3] = Math.round((4 * cover[i] * (1 - cover[i])) ** 0.8 * 255);
    }
    bctx.putImageData(body, 0, 0);
    rctx.putImageData(rim, 0, 0);
    mine.version = dark.versions[who];
    // two cells round the torn cells, for the softening
    mine.bounds = c1 < 0 ? null : { x: (c0 - 2) * DARK_CELL - DARK_MARGIN, y: (r0 - 2) * DARK_CELL - DARK_MARGIN, w: (c1 - c0 + 5) * DARK_CELL, h: (r1 - r0 + 5) * DARK_CELL };
  }

  private iso(dark: DarkMatter, who: number, level: number, time: number): DarkIso {
    const key = `${dark.id}:${who}:${dark.versions[who]}`;
    // A shot tears the matter every step; the lines follow at most 30 times a second.
    if (this.isoKey !== key && (!this.isoKey.startsWith(`${dark.id}:${who}:`) || time - this.isoAt >= 1 / 30 || time < this.isoAt)) {
      this.isoKey = key;
      this.isoAt = time;
      this.isos.clear();
    }
    let iso = this.isos.get(level);
    if (!iso) {
      iso = traceDarkIso(dark.covers[who], dark.cols, dark.rows, level);
      this.isos.set(level, iso);
    }
    return iso;
  }
}
