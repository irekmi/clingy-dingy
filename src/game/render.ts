import { CFG, type Feedback, type Route } from '@sim';

// Renderer jednej połowy ekranu: hala o zachodzie słońca (scena A), ściana z trasą w jednym
// kolorze i zaciskanym pierścieniem (3A), wspinacz „z detalami” (2C) w pozach: start, wspinanie,
// ześlizg, szczyt. Wszystko rysujemy w „jednostkach projektu” (jak na kanwie Design: odstęp
// chwytów = 100) i skalujemy do rozmiaru canvasa.

/** Numer miejsca w pokoju (0–5) – wyznacza kolory i wygląd wspinacza. */
export type Look = number;

export interface ClimberView {
  route: Route;
  hold: number;
  feedback: Feedback;
  feedbackAge: number; // ms od ostatniego komunikatu
  /** pierścień tylko dla lokalnego gracza: p = postęp 0..1+, dt = ms do idealnego momentu */
  ring: { p: number; dt: number } | null;
  showHints: boolean;
  look: Look;
  /** czy rysować wspinacza (np. pusty tor w lobby) */
  present: boolean;
  finished: boolean;
}

export const fmtTime = (ms: number) => `${(ms / 1000).toFixed(2)} s`;

const SP = 100; // odstęp chwytów
const WALL_HALF = 150; // połowa szerokości ściany
const SPREAD = 105; // maks. odchylenie chwytu od środka ściany
const FLOOR_Y = 200;
const PAD_TOP = 176;
const LEDGE_Y = -CFG.holds * SP - 80;
const PARALLAX = 0.55;
/** szerokość ściany w jednostkach projektu – do rozmieszczenia HUD-u */
export const WALL_UNITS = WALL_HALF * 2;

type P = { x: number; y: number };
const pt = (x: number, y: number): P => ({ x, y });

interface Colors {
  skin: string;
  skinLine: string;
  shirt: string;
  shirtLine: string;
  legs: string;
  legsLine: string;
  shoe: string;
  shoeLine: string;
  hair: string;
  hairLine: string;
  band: string | null;
  curls: boolean;
}

const LOOKS: Colors[] = [
  {
    skin: '#d39a62', skinLine: '#7d4f2c', shirt: '#2563a8', shirtLine: '#173f6e',
    legs: '#2b3150', legsLine: '#151826', shoe: '#f2b233', shoeLine: '#a87412',
    hair: '#3a2a20', hairLine: '#22170f', band: '#e5484d', curls: false,
  },
  {
    skin: '#a8693d', skinLine: '#5e3a1f', shirt: '#e2672f', shirtLine: '#9c3f17',
    legs: '#3a2e48', legsLine: '#1d1626', shoe: '#e5484d', shoeLine: '#9e2a2e',
    hair: '#1d1a18', hairLine: '#0d0b0a', band: null, curls: true,
  },
  {
    skin: '#e3b48c', skinLine: '#9a6a45', shirt: '#2f9e5a', shirtLine: '#1d6b3c',
    legs: '#2d3a33', legsLine: '#141b17', shoe: '#5b8fd1', shoeLine: '#2f5d97',
    hair: '#c9a04a', hairLine: '#8a6a2a', band: '#2563a8', curls: false,
  },
  {
    skin: '#8a5532', skinLine: '#4f2f1a', shirt: '#7c4dbd', shirtLine: '#50307f',
    legs: '#2b2b33', legsLine: '#141418', shoe: '#f2c94c', shoeLine: '#a37a12',
    hair: '#2a1a12', hairLine: '#120b07', band: null, curls: true,
  },
  {
    skin: '#f0c9a4', skinLine: '#a77e5a', shirt: '#d6457f', shirtLine: '#93284f',
    legs: '#2b3150', legsLine: '#151826', shoe: '#2fbf71', shoeLine: '#1b7a47',
    hair: '#a5462a', hairLine: '#6b2a17', band: '#2fbf71', curls: false,
  },
  {
    skin: '#c48a5a', skinLine: '#7a5432', shirt: '#1f9aa6', shirtLine: '#126770',
    legs: '#3a2e48', legsLine: '#1d1626', shoe: '#e2672f', shoeLine: '#9c3f17',
    hair: '#111111', hairLine: '#000000', band: null, curls: true,
  },
];
/** kolory graczy (koszulki) – do UI */
export const PLAYER_COLORS = LOOKS.map((l) => l.shirt);
export const MAX_PLAYERS = LOOKS.length;

const PATH = {
  torso: new Path2D('M-14 -3 Q0 -7 14 -3 L17 29 Q16 51 0 53 Q-16 51 -17 29 Z'),
  racer: new Path2D('M-11 -3 Q0 19 11 -3 Q0 -6 -11 -3 Z'),
  pony: new Path2D('M-3 -15 Q-7 -1 0 9 Q7 -1 3 -15 Z'),
  jug: new Path2D('M-17 -5 Q0 -15 17 -5 Q15 9 0 11 Q-15 9 -17 -5 Z'),
  slo: new Path2D('M-15 3 Q-14 -11 0 -12 Q15 -11 15 3 Q10 12 0 12 Q-10 12 -15 3 Z'),
  drop: new Path2D('M0 -16 Q14 -4 10 8 Q0 16 -10 8 Q-14 -4 0 -16 Z'),
  crimp: new Path2D('M-14 -3 Q0 -9 14 -3 Q12 5 0 6 Q-12 5 -14 -3 Z'),
};
const ROUTE_SHAPES = [PATH.jug, PATH.slo, PATH.jug, PATH.drop];
const DECOR_SHAPES = [PATH.crimp, PATH.slo, PATH.jug, PATH.crimp];
const DECOR_COLORS: [string, string][] = [
  ['#3fa66b', '#23704a'],
  ['#e0603a', '#a63a1d'],
  ['#f0c23b', '#b08914'],
  ['#8b6cc9', '#5a3f8f'],
];
const ROUTE_FILL = '#5b8fd1';
const ROUTE_LINE = '#2f5d97';

const FB_TEXT: Record<Feedback, string> = {
  none: '',
  perfect: 'PERFECT!',
  good: 'OK',
  early: 'TOO EARLY',
  wrong: 'WRONG HAND!',
  miss: 'TOO LATE',
};
const FB_COLOR: Record<Feedback, string> = {
  none: '#ffffff',
  perfect: '#1fa463',
  good: '#e0a10f',
  early: '#f08a24',
  wrong: '#e5484d',
  miss: '#6b6e7a',
};

interface Part {
  x: number;
  y: number;
  vx: number;
  vy: number;
  g: number;
  life: number;
  max: number;
  r: number;
  color: string;
  shape: 'dot' | 'star' | 'rect';
}

/** deterministyczny „los” dla ozdobnych chwytów */
function rnd(seed: number, i: number, j: number): number {
  let x = (seed ^ Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(j + 7, 0x85ebca6b)) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x2c1b3c6d);
  x ^= x >>> 12;
  x = Math.imul(x, 0x297a2d39);
  x ^= x >>> 15;
  return (x >>> 0) / 4294967296;
}

// ---------- pozy wspinacza (współrzędne względem środka barków S) ----------

interface Pose {
  S: P;
  angle: number; // obrót tułowia i głowy
  arms: [P, P, P][]; // bark → łokieć → dłoń
  legs: [P, P, P][]; // biodro → kolano → stopa
}

const elbow = (s: P, h: P): P => {
  const dir = Math.sign(h.x - s.x) || 1;
  return pt((s.x + h.x) / 2 + dir * 6, (s.y + h.y) / 2 + 3);
};
const mirror = (a: [P, P, P]): [P, P, P] => a.map((q) => pt(-q.x, q.y)) as [P, P, P];

function poseHang(h0: P): Pose {
  const arm: [P, P, P] = [pt(12, 3), pt(30, -38), pt(34, -78)];
  const leg: [P, P, P] = [pt(7, 49), pt(12, 73), pt(10, 100)];
  return { S: pt(h0.x, h0.y + 78), angle: 0, arms: [arm, mirror(arm)], legs: [leg, mirror(leg)] };
}

function poseClimb(hA: P, hB: P, parity: number): Pose {
  const S = pt((hA.x + hB.x) / 2, Math.max(hA.y, hB.y) + 55);
  const right = hA.x >= hB.x ? hA : hB;
  const left = right === hA ? hB : hA;
  const rl = pt(right.x - S.x, right.y - S.y);
  const ll = pt(left.x - S.x, left.y - S.y);
  const sR = pt(12, 3);
  const sL = pt(-12, 3);
  const legs: [P, P, P][] =
    parity === 0
      ? [
          [pt(-7, 49), pt(-29, 63), pt(-20, 89)],
          [pt(7, 49), pt(24, 77), pt(18, 107)],
        ]
      : [
          [pt(-7, 49), pt(-24, 77), pt(-18, 107)],
          [pt(7, 49), pt(29, 63), pt(20, 89)],
        ];
  return {
    S,
    angle: 0,
    arms: [
      [sR, elbow(sR, rl), rl],
      [sL, elbow(sL, ll), ll],
    ],
    legs,
  };
}

function poseSlip(grip: P, side: 1 | -1): Pose {
  const base: Pose = {
    S: pt(0, 0),
    angle: (20 * Math.PI) / 180,
    arms: [
      [pt(10, 7), pt(28, -36), pt(34, -80)],
      [pt(-12, -1), pt(-50, -10), pt(-80, -30)],
    ],
    legs: [
      [pt(-23, 44), pt(-50, 60), pt(-66, 82)],
      [pt(-10, 48), pt(-8, 78), pt(-26, 98)],
    ],
  };
  const S = pt(grip.x - 34 * side, grip.y + 80);
  if (side === 1) return { ...base, S };
  return { S, angle: -base.angle, arms: base.arms.map(mirror), legs: base.legs.map(mirror) };
}

function poseTop(cx: number): Pose {
  const arm: [P, P, P] = [pt(12, 3), pt(30, -36), pt(46, -72)];
  const leg: [P, P, P] = [pt(7, 49), pt(10, 76), pt(12, 102)];
  return { S: pt(cx, LEDGE_Y - 108), angle: 0, arms: [arm, mirror(arm)], legs: [leg, mirror(leg)] };
}

// ---------- rysowanie ----------

function fillStroke(ctx: CanvasRenderingContext2D, path: Path2D, fill: string, stroke: string, lw: number) {
  ctx.fillStyle = fill;
  ctx.fill(path);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lw;
  ctx.stroke(path);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

function polyline(ctx: CanvasRenderingContext2D, a: P, b: P) {
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
}

function drawLimbs(ctx: CanvasRenderingContext2D, limbs: [P, P, P][], w1: number, w2: number, outer: string, inner: string) {
  for (const [color, d] of [
    [outer, 4],
    [inner, 0],
  ] as const) {
    ctx.strokeStyle = color;
    ctx.lineWidth = w1 + d;
    ctx.beginPath();
    for (const l of limbs) polyline(ctx, l[0], l[1]);
    ctx.stroke();
    ctx.lineWidth = w2 + d;
    ctx.beginPath();
    for (const l of limbs) polyline(ctx, l[1], l[2]);
    ctx.stroke();
  }
}

function drawTop(ctx: CanvasRenderingContext2D, c: Colors) {
  fillStroke(ctx, PATH.torso, c.shirt, c.shirtLine, 2.5);
  fillStroke(ctx, PATH.racer, c.skin, c.shirtLine, 1.5);
  ctx.strokeStyle = '#1f2433';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-16, 47);
  ctx.quadraticCurveTo(0, 54, 16, 47);
  ctx.stroke();
  roundRect(ctx, -7, 49, 15, 16, 4); // woreczek na magnezję
  ctx.fillStyle = '#e9e2cf';
  ctx.fill();
  ctx.strokeStyle = '#8c7f63';
  ctx.lineWidth = 2;
  ctx.stroke();
  roundRect(ctx, -5, -17, 10, 14, 4); // szyja
  ctx.fillStyle = c.skin;
  ctx.fill();
  ctx.strokeStyle = c.skinLine;
  ctx.stroke();
  for (const ex of [-15, 15]) {
    ctx.beginPath();
    ctx.ellipse(ex, -25, 3.5, 5, 0, 0, Math.PI * 2);
    ctx.fillStyle = c.skin;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = c.skinLine;
    ctx.stroke();
  }
  if (c.curls) {
    ctx.fillStyle = c.hair;
    for (const [x, y, r] of [
      [-11, -37, 5.5], [-4, -41, 5.5], [4, -41, 5.5], [11, -37, 5.5], [14, -29, 5], [-14, -29, 5],
    ]) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.beginPath();
  ctx.arc(0, -27, 15, 0, Math.PI * 2);
  ctx.fillStyle = c.hair;
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = c.hairLine;
  ctx.stroke();
  if (c.band) {
    ctx.strokeStyle = c.band;
    ctx.lineWidth = 4.5;
    ctx.beginPath();
    ctx.moveTo(-14.5, -33);
    ctx.quadraticCurveTo(0, -40, 14.5, -33);
    ctx.stroke();
  }
  if (!c.curls) fillStroke(ctx, PATH.pony, c.hair, c.hairLine, 2);
}

function drawClimber(ctx: CanvasRenderingContext2D, c: Colors, pose: Pose) {
  ctx.save();
  ctx.translate(pose.S.x, pose.S.y);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  drawLimbs(ctx, pose.legs, 13, 9, c.legsLine, c.legs);
  for (const l of pose.legs) {
    ctx.beginPath();
    ctx.ellipse(l[2].x, l[2].y + 3, 10, 6.5, 0, 0, Math.PI * 2);
    ctx.fillStyle = c.shoe;
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = c.shoeLine;
    ctx.stroke();
  }
  drawLimbs(ctx, pose.arms, 11, 8, c.skinLine, c.skin);
  for (const a of pose.arms) {
    ctx.beginPath();
    ctx.arc(a[2].x, a[2].y, 7, 0, Math.PI * 2);
    ctx.fillStyle = c.skin;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = c.skinLine;
    ctx.stroke();
  }
  ctx.rotate(pose.angle);
  drawTop(ctx, c);
  ctx.restore();
}

function drawWindow(ctx: CanvasRenderingContext2D, x: number, y: number, variant: number) {
  const bands: [number, string][] = [
    [92, '#7b4842'], [70, '#904e3d'], [60, '#a4573b'], [56, '#b7623c'], [258, '#c46e3e'],
  ];
  let yy = y;
  for (const [h, col] of bands) {
    ctx.fillStyle = col;
    ctx.fillRect(x, yy, 134, h + 0.5);
    yy += h;
  }
  const m = variant
    ? [0, 276, 32, 256, 68, 294, 112, 246, 134, 268]
    : [0, 306, 32, 276, 68, 310, 104, 264, 134, 282];
  ctx.fillStyle = '#33252a';
  ctx.beginPath();
  ctx.moveTo(x + m[0], y + m[1]);
  for (let i = 2; i < m.length; i += 2) ctx.lineTo(x + m[i], y + m[i + 1]);
  ctx.lineTo(x + 134, y + 536);
  ctx.lineTo(x, y + 536);
  ctx.fill();
  ctx.fillStyle = '#3a4a2f';
  ctx.beginPath();
  ctx.moveTo(x, y + 506);
  for (let i = 0; i <= 11; i++) ctx.lineTo(x + i * 12.2, y + (i % 2 ? 492 : 504));
  ctx.lineTo(x + 134, y + 536);
  ctx.lineTo(x, y + 536);
  ctx.fill();
  ctx.strokeStyle = '#f7f7f9';
  ctx.lineWidth = 8;
  ctx.strokeRect(x, y, 134, 536);
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(x, y + 276);
  ctx.lineTo(x + 134, y + 276);
  ctx.stroke();
}

/** Rysuje jedną połowę ekranu. */
export class ClimbView {
  private ctx: CanvasRenderingContext2D;
  private w = 1;
  private h = 1;
  private dpr = 1;
  private vh = 0;
  private cam = NaN;
  private prevHold = 0;
  private shakeUntil = 0;
  private bolts: CanvasPattern | null = null;
  private ro: ResizeObserver;
  private parts: Part[] = [];
  private lastStamp = -1e9;
  private wasFinished = false;
  /** chalk-dust motes drifting over the wall (screen space, 0..1) */
  private motes = Array.from({ length: 16 }, (_, i) => ({ x: rnd(7, i, 1), y: rnd(7, i, 2), s: 0.3 + rnd(7, i, 3) * 0.7, p: rnd(7, i, 4) * 6.28 }));
  /** skala: piksele CSS na jednostkę projektu */
  scale = 1;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.resize();
    const off = document.createElement('canvas');
    off.width = 40;
    off.height = 40;
    const o = off.getContext('2d')!;
    o.fillStyle = '#b3a482';
    o.beginPath();
    o.arc(20, 20, 1.7, 0, Math.PI * 2);
    o.fill();
    this.bolts = this.ctx.createPattern(off, 'repeat');
  }

  /** szerokość połowy ekranu i ściany w pikselach CSS */
  get metrics() {
    return { width: this.w, wallPx: WALL_UNITS * this.scale };
  }

  destroy() {
    this.ro.disconnect();
  }

  reset() {
    this.vh = 0;
    this.prevHold = 0;
    this.cam = NaN;
    this.parts = [];
    this.wasFinished = false;
    this.lastStamp = -1e9;
  }

  private burst(kind: Feedback, at: P) {
    const n = kind === 'perfect' ? 14 : kind === 'good' ? 7 : kind === 'wrong' ? 9 : 5;
    const cols = kind === 'perfect' ? ['#ffe27a', '#ffffff', '#7be3a4'] : kind === 'wrong' ? ['#9aa0b8', '#c9ccd8'] : ['#ffffff', '#e8e4d4'];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (kind === 'perfect' ? 90 : 55) + Math.random() * 80;
      this.parts.push({
        x: at.x,
        y: at.y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 30,
        g: kind === 'wrong' ? 420 : 160,
        life: 600,
        max: 600,
        r: 2 + Math.random() * 3,
        color: cols[i % cols.length],
        shape: kind === 'perfect' && i % 3 === 0 ? 'star' : 'dot',
      });
    }
  }

  private confetti(at: P) {
    const cols = ['#f2c94c', '#2fbf71', '#5b8fd1', '#e5484d', '#ffffff', '#8b6cc9'];
    for (let i = 0; i < 46; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
      const sp = 120 + Math.random() * 200;
      this.parts.push({
        x: at.x,
        y: at.y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        g: 300,
        life: 2200,
        max: 2200,
        r: 3 + Math.random() * 3,
        color: cols[i % cols.length],
        shape: 'rect',
      });
    }
  }

  private stepParticles(ctx: CanvasRenderingContext2D, dt: number) {
    if (!this.parts.length) return;
    const s = dt / 1000;
    this.parts = this.parts.filter((p) => p.life > 0);
    for (const p of this.parts) {
      p.life -= dt;
      p.vy += p.g * s;
      p.x += p.vx * s;
      p.y += p.vy * s;
      ctx.globalAlpha = Math.min(1, (p.life / p.max) * 1.6);
      ctx.fillStyle = p.color;
      if (p.shape === 'rect') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.life * 0.01 + p.r);
        ctx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r);
        ctx.restore();
      } else if (p.shape === 'star') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.life * 0.008);
        ctx.beginPath();
        for (let k = 0; k < 8; k++) {
          const rr = k % 2 ? p.r * 0.5 : p.r * 1.6;
          const an = (k * Math.PI) / 4;
          ctx.lineTo(Math.cos(an) * rr, Math.sin(an) * rr);
        }
        ctx.fill();
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  private resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
  }

  draw(v: ClimberView, now: number, dt: number) {
    const { ctx } = this;
    const k = Math.min(this.h / 720, this.w / 360);
    this.scale = k;
    const Hd = this.h / k;
    const Wd = this.w / k;
    const cx = Wd / 2;
    const route = v.route;

    if (v.hold < this.prevHold) this.shakeUntil = now + 350;
    this.prevHold = v.hold;
    this.vh += (v.hold - this.vh) * (1 - Math.exp(-dt / 55));
    if (Math.abs(v.hold - this.vh) < 0.002) this.vh = v.hold;

    const hx = (i: number) => (i <= 0 ? cx : cx + (route.xs[i] / 100) * SPREAD);
    const hy = (i: number) => -i * SP;
    const at = (f: number) => {
      const a = Math.max(0, Math.min(CFG.holds, Math.floor(f)));
      const b = Math.min(CFG.holds, a + 1);
      const fr = Math.min(1, Math.max(0, f - a));
      return pt(hx(a) + (hx(b) - hx(a)) * fr, hy(a) + (hy(b) - hy(a)) * fr);
    };

    let pose: Pose;
    let still = false; // hanging at the start or standing on top: gentle breathing sway
    if (v.finished && this.vh > CFG.holds - 0.05) {
      pose = poseTop(cx);
      still = true;
    } else if (v.feedback === 'wrong' && v.feedbackAge < 600) {
      const g = at(this.vh);
      pose = poseSlip(g, g.x >= cx ? 1 : -1);
    } else if (this.vh < 0.5) {
      pose = poseHang(pt(cx, 0));
      still = true;
    } else pose = poseClimb(at(this.vh), at(this.vh - 1), Math.round(this.vh) % 2);

    const camMax = FLOOR_Y + 30 - Hd;
    const target = Math.max(LEDGE_Y - 200, Math.min(pose.S.y - Hd * 0.62, camMax));
    if (Number.isNaN(this.cam)) this.cam = target;
    else this.cam += (target - this.cam) * (1 - Math.exp(-dt / 110));
    const shake = now < this.shakeUntil ? Math.sin(now / 18) * 4 : 0;
    if (still) {
      pose = {
        ...pose,
        S: pt(pose.S.x, pose.S.y + Math.sin(now / 650 + v.look * 1.7) * 2.4),
        angle: pose.angle + Math.sin(now / 1000 + v.look) * 0.025,
      };
    }

    ctx.setTransform(this.dpr * k, 0, 0, this.dpr * k, 0, 0);
    ctx.fillStyle = '#e7e6ea';
    ctx.fillRect(0, 0, Wd, Hd);

    // okna z zachodem słońca (wolniejsza paralaksa)
    const camBg = camMax + (this.cam - camMax) * PARALLAX;
    ctx.save();
    ctx.translate(shake, -camBg);
    for (let n = 0; n < 80; n++) {
      const top = -396 - n * 640;
      if (top + 536 < camBg) break;
      if (top > camBg + Hd) continue;
      drawWindow(ctx, cx - 304, top, 0);
      drawWindow(ctx, cx + 170, top, 1);
    }
    ctx.restore();

    ctx.save();
    ctx.translate(shake, -this.cam);
    const top = this.cam - 60;
    const bottom = this.cam + Hd + 60;

    // podłoga
    if (bottom > FLOOR_Y - 10) {
      ctx.fillStyle = '#38383e';
      ctx.fillRect(-20, FLOOR_Y, Wd + 40, bottom - FLOOR_Y);
      ctx.fillStyle = '#2c2c31';
      ctx.fillRect(-20, FLOOR_Y - 4, Wd + 40, 8);
    }

    // ściana
    const wx = cx - WALL_HALF;
    const wTop = Math.max(top, LEDGE_Y);
    const wBot = Math.min(bottom, FLOOR_Y - 8);
    if (wBot > wTop) {
      ctx.fillStyle = '#cdbf9f';
      ctx.fillRect(wx, wTop, WALL_HALF * 2, wBot - wTop);
      if (this.bolts) {
        ctx.save();
        ctx.translate(wx, 0);
        ctx.fillStyle = this.bolts;
        ctx.fillRect(0, wTop, WALL_HALF * 2, wBot - wTop);
        ctx.restore();
      }
      ctx.strokeStyle = '#bfb08e';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let y = Math.ceil(wTop / 240) * 240; y < wBot; y += 240) polyline(ctx, pt(wx, y), pt(wx + WALL_HALF * 2, y));
      polyline(ctx, pt(cx, wTop), pt(cx, wBot));
      ctx.stroke();
      ctx.fillStyle = '#b1a27f';
      ctx.fillRect(wx, wTop, 6, wBot - wTop);
      ctx.fillRect(wx + WALL_HALF * 2 - 6, wTop, 6, wBot - wTop);
    }

    // szczyt: krawędź i flaga
    if (LEDGE_Y > top - 60 && LEDGE_Y < bottom) {
      ctx.fillStyle = '#b1a27f';
      ctx.fillRect(cx - 162, LEDGE_Y - 10, 324, 12);
      ctx.strokeStyle = '#4b4d57';
      ctx.lineWidth = 3;
      ctx.beginPath();
      polyline(ctx, pt(cx + 128, LEDGE_Y - 10), pt(cx + 128, LEDGE_Y - 62));
      ctx.stroke();
      ctx.fillStyle = '#e5484d';
      ctx.beginPath();
      ctx.moveTo(cx + 128, LEDGE_Y - 62);
      ctx.lineTo(cx + 160, LEDGE_Y - 52);
      ctx.lineTo(cx + 128, LEDGE_Y - 42);
      ctx.fill();
    }

    // ozdobne chwyty (inne kolory)
    const iMin = Math.max(0, Math.floor(-bottom / SP) - 1);
    const iMax = Math.min(CFG.holds, Math.ceil(-top / SP) + 1);
    for (let i = iMin; i <= iMax; i++) {
      const count = rnd(route.seed, i, 0) < 0.5 ? 1 : 2;
      for (let j = 1; j <= count; j++) {
        let x = cx + (rnd(route.seed, i, j) * 2 - 1) * 128;
        const rx = hx(i + 1);
        if (Math.abs(x - rx) < 48) x = x < rx ? x - 70 : x + 70;
        x = Math.max(wx + 22, Math.min(wx + WALL_HALF * 2 - 22, x));
        const y = hy(i) - 50 + (rnd(route.seed, i, j + 10) - 0.5) * 30;
        if (y < LEDGE_Y + 20 || y > FLOOR_Y - 40) continue;
        const [fill, line] = DECOR_COLORS[Math.floor(rnd(route.seed, i, j + 20) * 4)];
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate((rnd(route.seed, i, j + 30) - 0.5) * 0.6);
        const s = 0.75 + rnd(route.seed, i, j + 40) * 0.25;
        ctx.scale(s, s);
        fillStroke(ctx, DECOR_SHAPES[Math.floor(rnd(route.seed, i, j + 50) * 4)], fill, line, 2.5);
        ctx.restore();
      }
    }

    // trasa: niebieskie chwyty
    for (let i = iMin; i <= iMax; i++) {
      ctx.save();
      ctx.translate(hx(i), hy(i));
      if (i === 0) ctx.scale(2.6, 1.3);
      else ctx.rotate((rnd(route.seed, i, 99) - 0.5) * 0.35);
      fillStroke(ctx, i === 0 ? PATH.jug : ROUTE_SHAPES[i % 4], ROUTE_FILL, ROUTE_LINE, i === 0 ? 2 : 3);
      ctx.restore();
    }

    // pierścień rytmu (3A) i podpowiedzi stron
    const next = v.hold + 1;
    if (v.ring && next <= CFG.holds) {
      const nx = hx(next);
      const ny = hy(next);
      const p = Math.min(1, Math.max(0, v.ring.p));
      const r = 21 + (64 - 21) * (1 - p);
      const adt = Math.abs(v.ring.dt);
      ctx.setLineDash([4, 5]);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(nx, ny, 21, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(11, 61, 34, 0.25)';
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.arc(nx, ny, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = adt <= CFG.perfectWin ? '#2fbf71' : adt <= CFG.goodWin ? '#f2c94c' : '#ffffff';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(nx, ny, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (v.showHints) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let kk = 1; kk <= 2; kk++) {
        const i = v.hold + kk;
        if (i > CFG.holds) break;
        const side = route.sides[i];
        const bx = hx(i) + (side === 0 ? -46 : 46);
        const rr = kk === 1 ? 15 : 12;
        ctx.globalAlpha = kk === 1 ? 1 : 0.45;
        ctx.beginPath();
        ctx.arc(bx, hy(i), rr, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.strokeStyle = 'rgba(31, 32, 40, 0.15)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = '#1f2028';
        ctx.font = `900 ${kk === 1 ? 18 : 14}px Nunito, system-ui, sans-serif`;
        ctx.fillText(side === 0 ? '←' : '→', bx, hy(i) + 1);
      }
      ctx.globalAlpha = 1;
      ctx.textBaseline = 'alphabetic';
    }

    // materace
    for (const px of [cx - 170, cx + 4]) {
      roundRect(ctx, px, PAD_TOP, 166, 46, 9);
      ctx.fillStyle = '#4a4a50';
      ctx.fill();
      ctx.strokeStyle = '#2c2c31';
      ctx.lineWidth = 3;
      ctx.stroke();
      roundRect(ctx, px + 16, PAD_TOP + 7, 134, 7, 3);
      ctx.fillStyle = '#f2c94c';
      ctx.fill();
    }

    if (v.present) drawClimber(ctx, LOOKS[v.look % LOOKS.length], pose);

    // particle bursts: a puff of chalk / stars on each hit, dust on a slip, confetti at the summit
    const stamp = Math.round(now - v.feedbackAge);
    if (v.present && v.feedback !== 'none' && v.feedbackAge < 120 && Math.abs(stamp - this.lastStamp) > 60) {
      this.lastStamp = stamp;
      const hand = pt(pose.S.x + pose.arms[0][2].x, pose.S.y + pose.arms[0][2].y);
      this.burst(v.feedback, hand);
    }
    if (v.present && v.finished && !this.wasFinished) this.confetti(pt(cx, LEDGE_Y - 40));
    this.wasFinished = v.finished;
    this.stepParticles(ctx, dt);

    // komunikat w stylu komiksowym
    if (v.present && v.feedback !== 'none' && v.feedbackAge < 700) {
      ctx.save();
      ctx.globalAlpha = 1 - v.feedbackAge / 700;
      ctx.translate(pose.S.x, pose.S.y - 95 - v.feedbackAge * 0.03);
      ctx.rotate(v.look % 2 === 0 ? -0.1 : 0.09);
      ctx.font = '900 40px Nunito, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 8;
      ctx.strokeStyle = '#ffffff';
      ctx.strokeText(FB_TEXT[v.feedback], 0, 0);
      ctx.fillStyle = FB_COLOR[v.feedback];
      ctx.fillText(FB_TEXT[v.feedback], 0, 0);
      ctx.restore();
    }
    ctx.restore();

    // chalk dust drifting up over the wall (screen space)
    ctx.fillStyle = '#ffffff';
    for (const m of this.motes) {
      const x = cx - WALL_HALF + m.x * WALL_HALF * 2 + Math.sin(now / 1800 + m.p) * 8;
      const y = Hd - ((m.y * Hd + now * 0.018 * m.s) % Hd);
      ctx.globalAlpha = 0.18 + 0.16 * Math.sin(now / 900 + m.p);
      ctx.beginPath();
      ctx.arc(x, y, 1.2 + m.s * 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}
