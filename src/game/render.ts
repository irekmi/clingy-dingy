import { CFG, type Feedback, type Route } from '@sim';

export interface ClimberView {
  route: Route;
  hold: number;
  feedback: Feedback;
  feedbackAge: number; // ms od ostatniego komunikatu
  /** pierścień tylko dla lokalnego gracza: p = postęp 0..1+, dt = ms do idealnego momentu (ujemne = za wcześnie) */
  ring: { p: number; dt: number } | null;
  stunned: boolean;
  combo: number;
  showHints: boolean;
  timerMs: number;
  name: string;
  color: string;
  status?: string;
}

const FB_TEXT: Record<Feedback, string> = {
  none: '',
  perfect: 'PERFEKT!',
  good: 'OK',
  early: 'ZA WCZEŚNIE',
  wrong: 'ZŁA RĘKA!',
  miss: 'SPÓŹNIONE',
};
const FB_COLOR: Record<Feedback, string> = {
  none: '#fff',
  perfect: '#4ade80',
  good: '#facc15',
  early: '#f87171',
  wrong: '#f87171',
  miss: '#94a3b8',
};

export const fmtTime = (ms: number) => `${(ms / 1000).toFixed(2)} s`;

/** Rysuje jedną połowę ekranu: ścianę, chwyty i patyczaka. */
export class ClimbView {
  private ctx: CanvasRenderingContext2D;
  private w = 1;
  private h = 1;
  private dpr = 1;
  private vh = 0; // wygładzona (animowana) pozycja
  private cam = NaN;
  private prevHold = 0;
  private shakeUntil = 0;
  private ro: ResizeObserver;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.resize();
  }

  destroy() {
    this.ro.disconnect();
  }

  reset() {
    this.vh = 0;
    this.prevHold = 0;
    this.cam = NaN;
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
    const { ctx, w, h } = this;
    if (v.hold < this.prevHold) this.shakeUntil = now + 350;
    this.prevHold = v.hold;
    this.vh += (v.hold - this.vh) * (1 - Math.exp(-dt / 55));
    if (Math.abs(v.hold - this.vh) < 0.002) this.vh = v.hold;

    const u = Math.min(w / 260, h / 480);
    const SP = 60 * u; // odstęp między chwytami
    const cx = w / 2;
    const half = Math.min(w * 0.3, 95 * u);
    const route = v.route;
    const holdX = (i: number) => (i <= 0 ? cx : cx + (route.xs[i] / 100) * half);
    const holdY = (i: number) => -i * SP;
    const at = (f: number) => {
      const a = Math.max(0, Math.min(CFG.holds, Math.floor(f)));
      const b = Math.min(CFG.holds, a + 1);
      const fr = Math.min(1, Math.max(0, f - a));
      return { x: holdX(a) + (holdX(b) - holdX(a)) * fr, y: holdY(a) + (holdY(b) - holdY(a)) * fr };
    };

    // pozycje ciała
    const hA = at(this.vh);
    const hB = at(Math.max(0, this.vh - 1));
    const sh = { x: (hA.x + hB.x) / 2, y: Math.max(hA.y, hB.y) + SP * 0.55 };
    const groundY = SP * 1.42;

    // kamera
    const target = Math.min(sh.y - h * 0.6, groundY + SP * 0.6 - h);
    if (Number.isNaN(this.cam)) this.cam = target;
    else this.cam += (target - this.cam) * (1 - Math.exp(-dt / 110));
    const shake = now < this.shakeUntil ? Math.sin(now / 18) * 4 * u : 0;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#14161b';
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.translate(shake, -this.cam);
    const top = this.cam - SP;
    const bottom = this.cam + h + SP;

    // ściana
    const wallL = cx - half - 34 * u;
    const wallW = 2 * (half + 34 * u);
    ctx.fillStyle = '#20232b';
    ctx.fillRect(wallL, top, wallW, bottom - top);
    ctx.strokeStyle = '#2c303a';
    ctx.lineWidth = 1;
    ctx.font = `${Math.round(10 * u)}px system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#3a3f4b';
    for (let i = Math.floor(-bottom / SP); i <= Math.ceil(-top / SP); i++) {
      if (i < 0 || i > CFG.holds) continue;
      const y = holdY(i) + SP / 2;
      ctx.beginPath();
      ctx.moveTo(wallL, y);
      ctx.lineTo(wallL + wallW, y);
      ctx.stroke();
      if (i % 4 === 0 && i > 0) ctx.fillText(`${i} m`, wallL + 4 * u, holdY(i) + 4 * u);
    }

    // ziemia
    ctx.fillStyle = '#26332a';
    ctx.fillRect(0, groundY, w, Math.max(0, bottom - groundY));

    // szczyt
    const summitY = holdY(CFG.holds) - SP * 0.45;
    if (summitY > top) {
      ctx.fillStyle = '#2b3140';
      ctx.fillRect(wallL, top, wallW, summitY - top);
      ctx.strokeStyle = '#e5e7eb';
      ctx.lineWidth = 2 * u;
      ctx.beginPath();
      ctx.moveTo(cx, summitY);
      ctx.lineTo(cx, summitY - 42 * u);
      ctx.stroke();
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.moveTo(cx, summitY - 42 * u);
      ctx.lineTo(cx + 24 * u, summitY - 34 * u);
      ctx.lineTo(cx, summitY - 26 * u);
      ctx.fill();
    }

    // chwyty
    for (let i = 0; i <= CFG.holds; i++) {
      const y = holdY(i);
      if (y < top || y > bottom) continue;
      const x = holdX(i);
      ctx.fillStyle = i <= v.hold ? '#6b5a48' : '#c08a52';
      ctx.beginPath();
      ctx.ellipse(x, y, 9 * u, 7 * u, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // podpowiedzi stron (← / →) na kolejnych chwytach
    if (v.showHints) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `bold ${Math.round(13 * u)}px system-ui, sans-serif`;
      for (let k = 1; k <= 3; k++) {
        const i = v.hold + k;
        if (i > CFG.holds) break;
        ctx.globalAlpha = k === 1 ? 1 : k === 2 ? 0.45 : 0.2;
        ctx.fillStyle = '#fff';
        const side = route.sides[i];
        ctx.fillText(side === 0 ? '←' : '→', holdX(i) + (side === 0 ? -22 : 22) * u, holdY(i));
      }
      ctx.globalAlpha = 1;
      ctx.textBaseline = 'alphabetic';
    }

    // pierścień rytmu
    if (v.ring && v.hold < CFG.holds) {
      const nx = holdX(v.hold + 1);
      const ny = holdY(v.hold + 1);
      const rt = 12 * u;
      const rb = 48 * u;
      const p = Math.min(1, Math.max(0, v.ring.p));
      const r = rt + (rb - rt) * (1 - p);
      const adt = Math.abs(v.ring.dt);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1.5 * u;
      ctx.beginPath();
      ctx.arc(nx, ny, rt, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = adt <= CFG.perfectWin ? '#4ade80' : adt <= CFG.goodWin ? '#facc15' : 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 3 * u;
      ctx.beginPath();
      ctx.arc(nx, ny, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    // patyczak
    this.drawStickman(sh, hA, hB, SP, u, v.color, v.hold, v.stunned);

    // komunikat
    if (v.feedback !== 'none' && v.feedbackAge < 700) {
      ctx.globalAlpha = 1 - v.feedbackAge / 700;
      ctx.fillStyle = FB_COLOR[v.feedback];
      ctx.font = `bold ${Math.round(17 * u)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(FB_TEXT[v.feedback], sh.x, sh.y - SP * 0.85 - v.feedbackAge * 0.03 * u);
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    // HUD
    ctx.textAlign = 'left';
    ctx.fillStyle = v.color;
    ctx.font = 'bold 14px system-ui, sans-serif';
    ctx.fillText(v.name, 10, 22);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 22px ui-monospace, Consolas, monospace';
    ctx.fillText(fmtTime(v.timerMs), w - 16, 26);
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillStyle = '#94a3b8';
    if (v.combo > 1) ctx.fillText(`combo x${v.combo}`, w - 16, 44);
    if (v.status) {
      ctx.textAlign = 'left';
      ctx.fillText(v.status, 10, 40);
    }

    // pasek postępu
    const barH = h * 0.6;
    const barY = (h - barH) / 2;
    ctx.fillStyle = '#2c303a';
    ctx.fillRect(w - 6, barY, 3, barH);
    ctx.fillStyle = v.color;
    const frac = Math.min(1, this.vh / CFG.holds);
    ctx.fillRect(w - 6, barY + barH * (1 - frac), 3, barH * frac);
  }

  private drawStickman(
    sh: { x: number; y: number },
    hA: { x: number; y: number },
    hB: { x: number; y: number },
    SP: number,
    u: number,
    color: string,
    hold: number,
    stunned: boolean,
  ) {
    const { ctx } = this;
    const hip = { x: sh.x, y: sh.y + 0.45 * SP };
    const liftL = hold % 2 === 0 ? 0.14 * SP : 0;
    const liftR = hold % 2 === 1 ? 0.14 * SP : 0;
    const elbow = (hand: { x: number; y: number }) => {
      const dir = Math.sign(hand.x - sh.x) || -1;
      return { x: (sh.x + hand.x) / 2 + dir * 0.12 * SP, y: (sh.y + hand.y) / 2 + 0.05 * SP };
    };
    const eA = elbow(hA);
    const eB = elbow(hB.x === hA.x && hB.y === hA.y ? { x: hA.x - 1, y: hA.y } : hB);

    ctx.strokeStyle = stunned ? '#94a3b8' : color;
    ctx.lineWidth = 3.2 * u;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    // tułów + szyja
    ctx.moveTo(sh.x, sh.y - 0.12 * SP);
    ctx.lineTo(hip.x, hip.y);
    // ręce
    ctx.moveTo(sh.x, sh.y);
    ctx.lineTo(eA.x, eA.y);
    ctx.lineTo(hA.x, hA.y);
    ctx.moveTo(sh.x, sh.y);
    ctx.lineTo(eB.x, eB.y);
    ctx.lineTo(hB.x, hB.y);
    // nogi
    ctx.moveTo(hip.x, hip.y);
    ctx.lineTo(hip.x - 0.26 * SP, hip.y + 0.2 * SP - liftL);
    ctx.lineTo(hip.x - 0.22 * SP, hip.y + 0.42 * SP - liftL);
    ctx.moveTo(hip.x, hip.y);
    ctx.lineTo(hip.x + 0.26 * SP, hip.y + 0.2 * SP - liftR);
    ctx.lineTo(hip.x + 0.22 * SP, hip.y + 0.42 * SP - liftR);
    ctx.stroke();
    // głowa
    ctx.beginPath();
    ctx.arc(sh.x, sh.y - 0.24 * SP, 0.12 * SP, 0, Math.PI * 2);
    ctx.stroke();
  }
}
