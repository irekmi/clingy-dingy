import '@fontsource/nunito/700.css';
import '@fontsource/nunito/800.css';
import '@fontsource/nunito/900.css';
import './style.css';
import {
  CFG,
  initState,
  press,
  replay,
  routeFor,
  tick,
  type Feedback,
  type InputEvent,
  type Route,
  type Side,
  type SimState,
} from '@sim';
import {
  accountsEnabled,
  changeNick,
  fetchHistory,
  fetchLeaderboard,
  fetchMyBest,
  getAccount,
  initAccounts,
  onAccountChange,
  onPasswordRecovery,
  plError,
  resetPassword,
  signIn,
  signOut,
  signUp,
  updatePassword,
  type HistoryRow,
  type LeaderRow,
} from './account';
import { setAdsVisible } from './ads';
import { ClimbView, fmtTime, MAX_PLAYERS, PLAYER_COLORS } from './game/render';
import { footerLinksHtml, infoHtml, isInfoPage } from './pages';
import { LocalTransport } from './net/localTransport';
import { SupabaseTransport, createMatch, submitResult, supabaseConfigured } from './net/supabase';
import { SoloTransport } from './net/soloTransport';
import { getSolo, recordSolo, type SoloStats } from './solo';
import type { PlayerMeta, RoomTransport } from './net/transport';
import { cleanNick, esc, randomId, roomCode, ROOM_CODE_RE } from './util';

const COUNTDOWN_MS = 3000;
const USE_SUPABASE = supabaseConfigured && !new URLSearchParams(location.search).has('local');
// nowe id przy każdym otwarciu karty (w trybie lokalnym karty muszą mieć różne id)
const PLAYER_ID = randomId();

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/**
 * Paints the overlay. Entrance animations (data-anim="1") play only when the SCREEN changes,
 * not on every re-render of the same screen (e.g. an opponent toggling ready in the lobby).
 */
let lastScreen = '';
function paintOverlay(html: string, screen: string) {
  const el = $('overlay');
  el.dataset.anim = screen !== lastScreen ? '1' : '0';
  lastScreen = screen;
  el.innerHTML = html;
}

function confettiHtml(): string {
  const cols = ['#f2c94c', '#2fbf71', '#5b8fd1', '#e5484d', '#ffffff', '#8b6cc9'];
  return `<div class="confetti" aria-hidden="true">${Array.from({ length: 30 }, (_, i) => `<i style="--x:${(i * 37) % 100}%;--d:${((i * 53) % 90) / 100}s;--t:${1.8 + ((i * 17) % 10) / 10}s;--c:${cols[i % cols.length]};--r:${(i * 47) % 360}deg"></i>`).join('')}</div>`;
}

function getNick(): string {
  const acc = getAccount();
  if (acc) return acc.nick;
  let n = '';
  try {
    n = cleanNick(localStorage.getItem('pc_nick'));
  } catch {
    /* brak dostępu do storage */
  }
  if (n) return n;
  n = `Player${Math.floor(100 + Math.random() * 900)}`;
  saveNick(n); // keep the generated nickname so every place in the UI shows the same one
  return n;
}
function saveNick(n: string) {
  try {
    localStorage.setItem('pc_nick', n);
  } catch {
    /* ignore */
  }
}

const MODE_NOTE = USE_SUPABASE
  ? ''
  : 'Local mode (no server): other players open the link in other windows of the same browser.';

const color = (slot: number) => PLAYER_COLORS[Math.max(0, slot) % PLAYER_COLORS.length];
const secs = (ms: number) => (ms / 1000).toFixed(2);

const belka = (sub: string, opp: [string, string] = ['UP TO', '6']) => `
  <header class="belka">
    <div class="tor me"><small>LANE</small>1</div>
    <div class="title"><h1>CLINGY DINGY</h1><span>${esc(sub)}</span></div>
    <div class="tor opp"><small>${esc(opp[0])}</small>${esc(opp[1])}</div>
  </header>`;

const TROPHY = `<svg width="28" height="28" viewBox="0 0 30 30" role="img" aria-label="Winner"><path d="M8 4 H22 V11 Q22 18 15 18 Q8 18 8 11 Z" fill="#f2c94c" stroke="#a37a12" stroke-width="2"></path><path d="M8 7 H4 Q4 13 9 13 M22 7 H26 Q26 13 21 13" fill="none" stroke="#f2c94c" stroke-width="2.5"></path><rect x="13" y="18" width="4" height="5" fill="#f2c94c"></rect><rect x="9" y="23" width="12" height="4" rx="1.5" fill="#f2c94c" stroke="#a37a12" stroke-width="1.5"></rect></svg>`;

function setText(id: string, text: string) {
  const el = $(id);
  if (el.textContent !== text) el.textContent = text;
}

// ---------- scena: moja ściana + siatka przeciwników ----------

const meView = new ClimbView($<HTMLCanvasElement>('cv-me'));
const IDLE_ROUTE = routeFor('clingy-dingy-menu');

interface OppPanel {
  el: HTMLDivElement;
  tag: HTMLDivElement;
  view: ClimbView;
}
const oppPanels = new Map<string, OppPanel>();

/** Phone portrait: only my own wall; the others are shown as ranking capsules. */
const PHONE = window.matchMedia('(max-width: 640px)');

/** Tworzy/usuwa ściany przeciwników (1–5) i układa je w siatce. */
function syncOppPanels(ids: string[], standings = false) {
  const grid = $('opp-grid');
  const phone = PHONE.matches;
  if (phone) {
    ids = [];
    standings = false;
  }
  $('game').classList.toggle('phone', phone);
  for (const [id, p] of oppPanels) {
    if (!ids.includes(id)) {
      p.view.destroy();
      p.el.remove();
      oppPanels.delete(id);
    }
  }
  for (const id of ids) {
    let p = oppPanels.get(id);
    if (!p) {
      const el = document.createElement('div');
      el.className = 'panel';
      const cv = document.createElement('canvas');
      cv.setAttribute('aria-label', 'Opponent wall');
      const tag = document.createElement('div');
      tag.className = 'tag';
      el.append(cv, tag);
      grid.append(el);
      p = { el, tag, view: new ClimbView(cv) };
      oppPanels.set(id, p);
    }
    grid.append(p.el); // kolejność jak w ids
  }
  const n = ids.length;
  // 1 opponent: one wall; 2–3: two columns; 4–5: three columns
  const cols = n <= 1 ? 1 : n <= 3 ? 2 : 3;
  const key = `repeat(${cols}, minmax(0, 1fr))`;
  if (grid.style.gridTemplateColumns !== key) grid.style.gridTemplateColumns = key;
  // the live standings fill the free grid cells (3 opponents: 1 cell, 4: 2 cells, 5: 1 cell)
  let st = document.getElementById('standings');
  if (standings) {
    if (!st) {
      st = document.createElement('div');
      st.id = 'standings';
      st.className = 'standings';
    }
    const rows = Math.ceil((n + 1) / cols);
    st.style.gridColumn = `span ${cols * rows - n}`;
    grid.append(st);
  } else st?.remove();
  const game = $('game');
  game.classList.toggle('multi', n >= 2);
  game.classList.toggle('many-opp', n >= 3);
  game.classList.toggle('has-standings', standings);
}

let hudLayoutKey = '';
/**
 * HUD nie może zasłaniać torów:
 *  - 1 przeciwnik: w przerwie między ścianami (albo na dole, gdy przerwy brak – telefon),
 *  - 2+ przeciwników: na górze prawej połowy, a siatka przeciwników zjeżdża pod niego.
 */
function layoutHud() {
  const game = $('game');
  const hud = $('hud');
  let width: number;
  let bottom = false;
  let left = '50%';
  let space = 0;
  if (game.classList.contains('phone') || game.classList.contains('solo')) {
    width = window.innerWidth - 16;
  } else if (game.classList.contains('multi')) {
    const a = $('opp-area').getBoundingClientRect();
    width = Math.min(328, Math.floor(a.width - 16));
    left = `${Math.round(a.left + a.width / 2)}px`;
    space = hud.classList.contains('hidden') ? 0 : hud.offsetHeight + 16;
  } else {
    const m = meView.metrics;
    const gap = m.width + 4 - m.wallPx;
    if (gap >= 230) width = Math.min(328, Math.floor(gap - 12));
    else {
      bottom = true;
      width = Math.min(328, window.innerWidth - 24);
    }
  }
  const key = `${width}|${bottom}|${left}|${space}`;
  if (key === hudLayoutKey) return;
  hudLayoutKey = key;
  game.style.setProperty('--belka-w', `${width}px`);
  game.style.setProperty('--hud-left', left);
  game.style.setProperty('--hud-space', `${space}px`);
  game.classList.toggle('hud-bottom', bottom);
  game.classList.toggle('hud-compact', width < 260);
}

// ---------- pokój ----------

type Phase = 'lobby' | 'countdown' | 'race' | 'finished' | 'results';

interface OppState {
  nick: string;
  hold: number;
  fb: Feedback;
  fbAt: number;
  fbRecv: number;
  elapsed: number;
  recvAt: number;
  ms: number | null;
  valid: boolean;
  perfects: number;
  left: boolean;
}
const freshOpp = (nick: string): OppState => ({
  nick,
  hold: 0,
  fb: 'none',
  fbAt: -1,
  fbRecv: 0,
  elapsed: 0,
  recvAt: 0,
  ms: null,
  valid: false,
  perfects: 0,
  left: false,
});

interface Standing {
  id: string;
  nick: string;
  slot: number;
  me: boolean;
  ms: number | null;
  valid: boolean;
  perfects: number;
  left: boolean;
}

interface SessionRow {
  nick: string;
  slot: number;
  best: number | null;
  wins: number;
  rounds: number;
}

class Room {
  private t: RoomTransport;
  private me: PlayerMeta;
  private players: PlayerMeta[] = [];
  private phase: Phase = 'lobby';
  private matchId = '';
  private round = 0;
  private route: Route;
  private sim: SimState = initState();
  private inputs: InputEvent[] = [];
  private goAt = 0;
  private myMs: number | null = null;
  /** uczestnicy bieżącej/ostatniej rundy (ustala host), kolejność = kolory */
  private participants: string[] = [];
  private opps = new Map<string, OppState>();
  private session = new Map<string, SessionRow>();
  private usedTokens = new Set<string>();
  private verify: 'off' | 'pending' | 'ok' | 'bad' | 'suspect' | 'error' = 'off';
  private myRecord: { best: number | null; place: number | null } | null = null;
  private lastSent = { hold: -1, fbAt: -1, at: 0 };
  private connected = false;
  private error = '';
  private overlayKey = '';
  private raceRowsKey = '';
  private offAccount: () => void;
  private dead = false;
  private starting = false;
  private finishAt = 0;
  private soloRes: { record: boolean; prevBest: number | null; stats: SoloStats } | null = null;

  /** `solo`: one-player run (no room, no opponents) – starts at once and can be retried endlessly */
  constructor(
    readonly code: string,
    readonly solo = false,
  ) {
    this.route = routeFor(`lobby-${code}`);
    this.me = { id: PLAYER_ID, nick: getNick(), ready: null, joinedAt: Date.now(), acct: !!getAccount() };
    this.t = solo ? new SoloTransport() : USE_SUPABASE ? new SupabaseTransport(code) : new LocalTransport(code);
    this.t.on('start', (p) => this.onStart(p));
    this.t.on('pos', (p) => this.onPos(p));
    this.t.on('finish', (p) => this.onFinish(p));
    this.t.onPlayers((list) => this.onPlayers(list));
    this.t
      .connect(this.me)
      .then(() => {
        this.connected = true;
        if (this.solo) this.startSolo();
        this.refresh();
      })
      .catch((e) => {
        this.error = `Could not connect to the game server (${e?.message ?? e}).`;
        this.refresh();
      });
    this.offAccount = onAccountChange((a) => {
      this.me = { ...this.me, nick: a?.nick ?? getNick(), acct: !!a };
      this.t.setMeta(this.me);
      this.refresh();
    });
    window.addEventListener('keydown', this.onKey);
    $('panel-me').addEventListener('pointerdown', this.onPointer);
    $('game').classList.toggle('solo', solo);
    meView.reset();
    this.refresh();
  }

  destroy() {
    this.dead = true;
    $('game').classList.remove('solo');
    $('hud-caps').innerHTML = '';
    window.removeEventListener('keydown', this.onKey);
    $('panel-me').removeEventListener('pointerdown', this.onPointer);
    this.offAccount();
    this.t.close();
    $('hud').classList.add('hidden');
    meView.reset();
  }

  // ---------- gracze ----------

  private active(): PlayerMeta[] {
    return this.players.slice(0, MAX_PLAYERS);
  }
  private inRoom() {
    return this.active().some((p) => p.id === this.me.id);
  }
  private inMatch() {
    return this.phase !== 'lobby' && this.participants.includes(this.me.id);
  }
  private isHost() {
    return this.active()[0]?.id === this.me.id;
  }
  private slotOf(id: string): number {
    if (this.inMatch()) return Math.max(0, this.participants.indexOf(id));
    return Math.max(0, this.active().findIndex((p) => p.id === id));
  }
  /** czyje ściany pokazać po prawej */
  private shownOpps(): string[] {
    if (this.inMatch()) return this.participants.filter((id) => id !== this.me.id);
    return this.inRoom() ? this.active().filter((p) => p.id !== this.me.id).map((p) => p.id) : [];
  }

  private onPlayers(list: PlayerMeta[]) {
    const others = list
      .filter((p) => p && p.id !== this.me.id)
      .map((p) => ({ ...p, nick: cleanNick(p.nick) || '???' }));
    this.players = [...others, this.me].sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id));
    const present = new Set(this.players.map((p) => p.id));
    for (const p of this.players) {
      const o = this.opps.get(p.id);
      if (o) o.nick = p.nick;
    }
    if (this.inMatch() && this.phase !== 'results') {
      for (const [id, o] of this.opps) if (!present.has(id)) o.left = true;
      const remaining = [...this.opps.values()].filter((o) => !o.left).length;
      if (this.phase === 'countdown' && remaining === 0 && !this.solo) this.phase = 'lobby';
    }
    this.maybeStart();
    this.maybeResults();
    this.refresh();
  }

  /** Solo: no lobby – every run (first and retries) is a fresh match, created on the server when online. */
  private startSolo() {
    if (!this.solo || this.dead || this.starting || (this.phase !== 'lobby' && this.phase !== 'results')) return;
    this.starting = true;
    void (async () => {
      const m = (USE_SUPABASE ? await createMatch(this.code, [this.me.id]) : null) ?? randomId();
      this.starting = false;
      if (!this.dead) this.onStart({ m, p: [this.me.id] });
    })();
  }

  private toggleReady() {
    if (this.solo) return this.startSolo();
    if (!this.inRoom() || (this.phase !== 'lobby' && this.phase !== 'results')) return;
    this.me = { ...this.me, ready: this.me.ready ? null : randomId() };
    this.t.setMeta(this.me);
    this.players = this.players.map((p) => (p.id === this.me.id ? this.me : p));
    this.maybeStart();
    this.refresh();
  }

  /** Host startuje rundę, gdy wszyscy w pokoju (2–6) są gotowi. */
  private maybeStart() {
    if (!this.connected || !this.isHost() || (this.phase !== 'lobby' && this.phase !== 'results')) return;
    const a = this.active();
    if (a.length < 2 || !a.every((p) => p.ready && !this.usedTokens.has(p.ready))) return;
    a.forEach((p) => this.usedTokens.add(p.ready!));
    const ids = a.map((p) => p.id);
    // online: identyfikator meczu nadaje serwer (inaczej wynik nie trafi do rankingu); lokalnie losowy
    void (async () => {
      const m = (USE_SUPABASE ? await createMatch(this.code, ids) : null) ?? randomId();
      const payload = { m, p: ids };
      this.t.send('start', payload);
      this.onStart(payload);
    })();
  }

  // ---------- zdarzenia sieciowe ----------

  private onStart(p: { m?: unknown; p?: unknown }) {
    if (typeof p?.m !== 'string' || (this.phase !== 'lobby' && this.phase !== 'results')) return;
    const ids = Array.isArray(p.p) ? p.p.filter((x): x is string => typeof x === 'string').slice(0, MAX_PLAYERS) : [];
    if (!ids.includes(this.me.id)) return; // runda bez nas (dołączyliśmy w trakcie) – czekamy w lobby
    this.participants = ids;
    this.matchId = p.m;
    this.round++;
    this.route = routeFor(p.m);
    this.sim = initState();
    this.inputs = [];
    this.myMs = null;
    this.verify = 'off';
    this.myRecord = null;
    this.opps = new Map(
      ids.filter((id) => id !== this.me.id).map((id) => [id, freshOpp(this.players.find((x) => x.id === id)?.nick ?? '???')]),
    );
    this.lastSent = { hold: -1, fbAt: -1, at: 0 };
    this.raceRowsKey = '';
    this.capsKey = '';
    this.me = { ...this.me, ready: null };
    this.t.setMeta(this.me);
    meView.reset();
    oppPanels.forEach((op) => op.view.reset());
    this.phase = 'countdown';
    // lokalne odliczanie – opóźnienie sieci wpływa tylko na moment startu, nie na zmierzony czas
    this.goAt = performance.now() + COUNTDOWN_MS;
    this.refresh();
  }

  private onPos(p: { m?: unknown; id?: unknown; h?: unknown; f?: unknown; fa?: unknown; e?: unknown }) {
    if (p?.m !== this.matchId || typeof p.id !== 'string' || typeof p.h !== 'number' || typeof p.e !== 'number') return;
    const o = this.opps.get(p.id);
    if (!o || o.ms !== null) return;
    o.hold = Math.max(0, Math.min(CFG.holds, Math.floor(p.h)));
    if (typeof p.fa === 'number' && p.fa !== o.fbAt && typeof p.f === 'string') {
      o.fb = p.f as Feedback;
      o.fbAt = p.fa;
      o.fbRecv = performance.now();
    }
    o.elapsed = p.e;
    o.recvAt = performance.now();
  }

  private onFinish(p: { m?: unknown; id?: unknown; ms?: unknown; inputs?: unknown }) {
    if (p?.m !== this.matchId || typeof p.id !== 'string' || typeof p.ms !== 'number') return;
    const o = this.opps.get(p.id);
    if (!o || o.ms !== null) return;
    // weryfikacja peer-to-peer: odtwarzamy bieg przeciwnika z jego logu wciśnięć
    try {
      const s = replay(this.route, p.inputs);
      o.valid = s.finishedAt === p.ms;
      o.perfects = s.perfects;
    } catch {
      o.valid = false;
    }
    o.ms = p.ms;
    o.hold = CFG.holds;
    this.maybeResults();
    this.refresh();
  }

  // ---------- sterowanie ----------

  private onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement) return;
    let side: Side | null = null;
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') side = 0;
    else if (e.code === 'ArrowRight' || e.code === 'KeyD') side = 1;
    else if ((e.code === 'Space' || e.code === 'Enter') && !e.repeat) {
      if (this.phase === 'lobby' || this.phase === 'results') {
        e.preventDefault();
        this.toggleReady(); // solo: "try again"
      }
      return;
    }
    if (side === null) return;
    e.preventDefault();
    if (!e.repeat) this.onInput(side, e.timeStamp);
  };

  private onPointer = (e: PointerEvent) => {
    if (this.phase !== 'race' && this.phase !== 'countdown') return;
    const r = $('panel-me').getBoundingClientRect();
    this.onInput(e.clientX - r.left < r.width / 2 ? 0 : 1, e.timeStamp);
  };

  private onInput(side: Side, ts: number) {
    const now = performance.now();
    if (!(ts > 0) || Math.abs(ts - now) > 1000) ts = now;
    this.updatePhase(now);
    if (this.phase !== 'race') return;
    let t = Math.round(ts - this.goAt);
    if (t < 0) return;
    const last = this.inputs.length ? this.inputs[this.inputs.length - 1][0] : 0;
    if (t < last) t = last;
    if (this.inputs.length >= CFG.maxInputs) return;
    this.inputs.push([t, side]);
    this.sim = press(this.sim, this.route, t, side);
    if (this.sim.finishedAt !== null) this.finishMe();
    // pozycja wysyłana też przy wciśnięciu – działa nawet gdy karta jest w tle (brak klatek animacji)
    else this.sendPos(this.sim, t, now);
  }

  private updatePhase(now: number) {
    if (this.phase === 'countdown' && now >= this.goAt) {
      this.phase = 'race';
      this.refresh();
    }
  }

  private finishMe() {
    const ms = this.sim.finishedAt!;
    this.myMs = ms;
    this.phase = 'finished';
    this.finishAt = performance.now();
    if (this.solo) this.soloRes = recordSolo(ms);
    this.sendPos(this.sim, ms, performance.now());
    this.t.send('finish', { m: this.matchId, id: this.me.id, ms, inputs: this.inputs });
    if (USE_SUPABASE) {
      this.verify = 'pending';
      submitResult({
        matchId: this.matchId,
        room: this.code,
        playerId: this.me.id,
        nick: this.me.nick,
        claimedMs: ms,
        inputs: this.inputs,
      })
        .then(async (r) => {
          this.verify = !r.valid ? 'bad' : r.suspect ? 'suspect' : 'ok';
          const acc = getAccount();
          if (r.ranked && acc) this.myRecord = await fetchMyBest(acc.userId).catch(() => null);
        })
        .catch(() => (this.verify = 'error'))
        .finally(() => this.refresh());
    }
    this.maybeResults();
    this.refresh();
  }

  private maybeResults() {
    if (this.phase !== 'finished') return;
    if (this.solo && performance.now() - this.finishAt < 2200) return; // let the climber celebrate first
    if (![...this.opps.values()].every((o) => o.ms !== null || o.left)) return;
    this.phase = 'results';
    // ranking pokoju (sesja): najlepszy czas, wygrane, rozegrane rundy
    const st = this.standings();
    st.forEach((s, i) => {
      const row = this.session.get(s.id) ?? { nick: s.nick, slot: s.slot, best: null, wins: 0, rounds: 0 };
      row.nick = s.nick;
      row.slot = s.slot;
      if (s.ms !== null && s.valid) {
        row.rounds++;
        row.best = row.best === null ? s.ms : Math.min(row.best, s.ms);
        if (i === 0) row.wins++;
      }
      this.session.set(s.id, row);
    });
  }

  /** wyniki rundy: najpierw zweryfikowane czasy rosnąco, potem reszta */
  private standings(): Standing[] {
    const list: Standing[] = [
      {
        id: this.me.id,
        nick: this.me.nick,
        slot: this.slotOf(this.me.id),
        me: true,
        ms: this.myMs,
        valid: this.myMs !== null,
        perfects: this.sim.perfects,
        left: false,
      },
      ...[...this.opps.entries()].map(([id, o]) => ({
        id,
        nick: o.nick,
        slot: this.slotOf(id),
        me: false,
        ms: o.ms,
        valid: o.ms !== null && o.valid,
        perfects: o.perfects,
        left: o.left,
      })),
    ];
    const key = (s: Standing) => (s.valid && s.ms !== null ? s.ms : Number.MAX_SAFE_INTEGER - (s.ms === null ? 0 : 1));
    return list.sort((a, b) => key(a) - key(b));
  }

  private sendPos(s: SimState, t: number, now: number) {
    this.lastSent = { hold: s.hold, fbAt: s.lastAt, at: now };
    this.t.send('pos', { m: this.matchId, id: this.me.id, h: s.hold, f: s.last, fa: s.lastAt, e: t });
  }

  // ---------- klatka ----------

  frame(now: number, dt: number) {
    this.updatePhase(now);
    if (this.phase === 'countdown' || (this.phase === 'race' && now - this.goAt < 800)) this.refresh();

    const racing = this.phase === 'race';
    const t = Math.max(0, Math.round(now - this.goAt));
    const disp = racing ? tick(this.sim, t) : this.sim; // tylko do wyświetlania – nie zmienia this.sim
    if (racing && (disp.hold !== this.lastSent.hold || disp.lastAt !== this.lastSent.fbAt || now - this.lastSent.at > 500)) {
      this.sendPos(disp, t, now);
    }
    const ring = racing && t >= disp.cycleStart ? { p: (t - disp.cycleStart) / disp.period, dt: t - (disp.cycleStart + disp.period) } : null;
    const inMatch = this.inMatch();
    const chalkUp = this.phase === 'countdown';
    const ranks = this.phase === 'results' ? new Map(this.standings().map((s, i) => [s.id, i])) : null;
    meView.draw(
      {
        route: this.route,
        hold: disp.hold,
        feedback: inMatch ? disp.last : 'none',
        feedbackAge: racing || this.phase === 'finished' ? (this.myMs ?? t) - disp.lastAt : 1e9,
        ring,
        showHints: racing || this.phase === 'countdown',
        look: this.slotOf(this.me.id),
        present: true,
        finished: this.myMs !== null,
        combo: racing ? disp.combo : 0,
        chalkUp,
        rank: ranks?.get(this.me.id) ?? null,
      },
      now,
      dt,
    );

    const shown = this.shownOpps();
    syncOppPanels(this.solo ? [] : shown.length ? shown : ['__empty'], inMatch && shown.length >= 3);
    if (this.solo && this.phase === 'finished') {
      this.maybeResults();
      if ((this.phase as Phase) === 'results') this.refresh();
    }
    for (const [id, panel] of oppPanels) {
      const o = this.opps.get(id);
      const pl = this.players.find((p) => p.id === id);
      const slot = this.slotOf(id);
      const live = inMatch && o;
      panel.view.draw(
        {
          route: this.route,
          hold: live ? o.hold : 0,
          feedback: live ? o.fb : 'none',
          feedbackAge: live && o.fbRecv ? now - o.fbRecv : 1e9,
          ring: null,
          showHints: false,
          look: slot,
          present: id !== '__empty' && (live ? !o.left : !!pl),
          finished: !!live && o.ms !== null,
          chalkUp,
          rank: ranks?.get(id) ?? null,
        },
        now,
        dt,
      );
      const tagText = id === '__empty' ? '' : live ? `${o.nick} · ${o.left ? 'left' : o.ms !== null ? secs(o.ms) + ' s' : o.hold + ' m'}` : pl?.nick ?? '';
      if (panel.tag.textContent !== tagText) panel.tag.textContent = tagText;
      const bg = color(slot);
      if (panel.tag.style.background !== bg) panel.tag.style.background = bg;
    }
    this.updateHud(now, t, disp);
  }

  private updateHud(now: number, t: number, disp: SimState) {
    const show = this.phase === 'countdown' || this.phase === 'race' || this.phase === 'finished';
    $('hud').classList.toggle('hidden', !show);
    if (!show) return;
    const myTime = this.myMs ?? (this.phase === 'race' ? t : 0);
    if (this.solo) {
      setText('hud-time', secs(myTime));
      this.updateSoloCaps(disp);
      return;
    }
    const oppTime = (o: OppState) => o.ms ?? (o.recvAt > 0 ? o.elapsed + (now - o.recvAt) : 0);
    // po prawej: prowadzący spośród przeciwników
    let leaderId = '';
    let leader: OppState | null = null;
    for (const [id, o] of this.opps) {
      if (o.left) continue;
      if (!leader || o.hold > leader.hold || (o.hold === leader.hold && (o.ms ?? Infinity) < (leader.ms ?? Infinity))) {
        leader = o;
        leaderId = id;
      }
    }
    const meHud = $('hud-me');
    const meBg = color(this.slotOf(this.me.id));
    if (meHud.style.background !== meBg) meHud.style.background = meBg;
    setText('hud-me-name', this.me.nick);
    setText('hud-me-sub', `${disp.hold} m${disp.combo > 1 ? ` · ×${disp.combo}` : ''}`);
    setText('hud-time', secs(myTime));
    const opHud = $('hud-op');
    if (leader) {
      const bg = color(this.slotOf(leaderId));
      if (opHud.style.background !== bg) opHud.style.background = bg;
      setText('hud-op-name', this.opps.size > 1 ? `▲ ${leader.nick}` : leader.nick);
      setText('hud-op-sub', `${leader.hold} m · ${secs(oppTime(leader))}`);
    } else {
      setText('hud-op-name', 'Opponent');
      setText('hud-op-sub', 'left');
    }
    if (PHONE.matches) {
      this.updateCapsules(disp);
      return;
    }
    // paski wyścigu: wszyscy uczestnicy w kolejności miejsc startowych
    const board = document.getElementById('standings');
    const race = board ?? $('hud-race');
    const ids = this.participants;
    const rowsKey = `${ids.join()}|${board ? 'b' : 'h'}`;
    if (this.raceRowsKey !== rowsKey) {
      this.raceRowsKey = rowsKey;
      race.innerHTML = board
        ? `<div class="st-title">LIVE STANDINGS</div>` +
          ids
            .map((id) => {
              const nick = id === this.me.id ? this.me.nick : this.opps.get(id)?.nick ?? '?';
              const c = color(this.slotOf(id));
              return `<div class="st-row${id === this.me.id ? ' mine' : ''}" data-row="${esc(id)}"><span class="rn"><span class="dot" style="background:${c}"></span>${esc(nick)}</span><span data-m="${esc(id)}">0 m</span><div class="track"><i data-bar="${esc(id)}" style="background:${c}"></i></div></div>`;
            })
            .join('')
        : ids
            .map((id) => {
              const nick = id === this.me.id ? this.me.nick : this.opps.get(id)?.nick ?? '?';
              return `<span class="rn">${esc(nick)}</span><div class="track"><i data-bar="${esc(id)}" style="background:${color(this.slotOf(id))}"></i></div><span data-m="${esc(id)}">0 m</span>`;
            })
            .join('');
    }
    const heights = new Map<string, number>();
    for (const id of ids) {
      const h = id === this.me.id ? disp.hold : this.opps.get(id)?.hold ?? 0;
      heights.set(id, h);
      const bar = race.querySelector<HTMLElement>(`[data-bar="${CSS.escape(id)}"]`);
      const m = race.querySelector<HTMLElement>(`[data-m="${CSS.escape(id)}"]`);
      if (bar) bar.style.width = `${(h / CFG.holds) * 100}%`;
      if (m && m.textContent !== `${h} m`) m.textContent = `${h} m`;
    }
    if (board) {
      // leaders first, without moving DOM nodes (CSS order)
      [...ids].sort((a, b) => heights.get(b)! - heights.get(a)!).forEach((id, i) => {
        const row = board.querySelector<HTMLElement>(`[data-row="${CSS.escape(id)}"]`);
        if (row && row.style.order !== String(i)) row.style.order = String(i);
      });
    }
  }

  private capsKey = '';
  /** Solo HUD: the height and the personal best as two capsules. */
  private updateSoloCaps(disp: SimState) {
    const box = $('hud-caps');
    const best = getSolo().best;
    const key = `solo|${best}`;
    if (this.capsKey !== key) {
      this.capsKey = key;
      box.style.setProperty('--cols', '2');
      box.style.setProperty('--rows', '1');
      $('game').style.setProperty('--caps-h', '30px');
      box.innerHTML = `<div class="cap mine" style="background:${color(0)};--c:0;--r:0"><b class="pos">▲</b><span class="cn">Height</span><span class="cm" id="solo-m">0 m</span></div>
        <div class="cap" style="background:#3a3d4d;--c:1;--r:0"><b class="pos">★</b><span class="cn">Best</span><span class="cm">${best === null ? '—' : secs(best) + ' s'}</span></div>`;
    }
    setText('solo-m', `${disp.hold} / ${CFG.holds} m`);
  }

  private capRank = new Map<string, number>();

  /** Phone: one capsule per player, sliding into place as the lead changes. */
  private updateCapsules(disp: SimState) {
    const box = $('hud-caps');
    const ids = this.participants;
    const n = ids.length;
    const cols = n <= 2 ? n : 2;
    const key = `${ids.join()}|${cols}`;
    if (this.capsKey !== key) {
      this.capsKey = key;
      this.capRank.clear();
      box.style.setProperty('--cols', String(cols));
      const rows = Math.ceil(n / cols);
      box.style.setProperty('--rows', String(rows));
      // the "waiting" banner sits just above the capsules
      $('game').style.setProperty('--caps-h', `${rows * 30 + (rows - 1) * 5}px`);
      box.innerHTML = ids
        .map((id) => {
          const nick = id === this.me.id ? this.me.nick : this.opps.get(id)?.nick ?? '?';
          return `<div class="cap${id === this.me.id ? ' mine' : ''}" data-cap="${esc(id)}" style="background:${color(this.slotOf(id))}"><b class="pos"></b><span class="cn">${esc(nick)}</span><span class="cm"></span></div>`;
        })
        .join('');
    }
    const info = ids.map((id) => {
      if (id === this.me.id) return { id, hold: disp.hold, ms: this.myMs, left: false };
      const o = this.opps.get(id);
      return { id, hold: o?.hold ?? 0, ms: o?.ms ?? null, left: !!o?.left };
    });
    // finished first (by time), then by height; ties keep the previous order so capsules don't flicker
    const prev = (id: string) => this.capRank.get(id) ?? ids.indexOf(id);
    info.sort(
      (a, b) =>
        Number(a.left) - Number(b.left) ||
        (a.ms ?? Infinity) - (b.ms ?? Infinity) ||
        b.hold - a.hold ||
        prev(a.id) - prev(b.id),
    );
    info.forEach((p, i) => {
      const el = box.querySelector<HTMLElement>(`[data-cap="${CSS.escape(p.id)}"]`);
      if (!el) return;
      const old = this.capRank.get(p.id);
      if (old !== i) {
        this.capRank.set(p.id, i);
        el.style.setProperty('--c', String(i % cols));
        el.style.setProperty('--r', String(Math.floor(i / cols)));
        el.classList.toggle('lead', i === 0);
        if (old !== undefined && i < old) {
          el.classList.remove('up');
          void el.offsetWidth; // restart the animation
          el.classList.add('up');
        }
        el.querySelector('.pos')!.textContent = String(i + 1);
      }
      const txt = p.left ? 'left' : p.ms !== null ? `${secs(p.ms)} s` : `${p.hold} m`;
      const cm = el.querySelector<HTMLElement>('.cm')!;
      if (cm.textContent !== txt) cm.textContent = txt;
      el.classList.toggle('done', p.ms !== null);
      el.classList.toggle('gone', p.left);
    });
  }

  // ---------- nakładki ----------

  refresh() {
    const html = this.overlayHtml();
    if (html === this.overlayKey) return;
    this.overlayKey = html;
    paintOverlay(html, `${this.error ? 'err' : this.phase}-${this.round}`);
  }

  private overlayHtml(): string {
    if (this.error) {
      return `<div class="dim"></div><div class="studio">${belka(`room ${this.code}`)}
        <section class="actions"><div class="abar"><p class="hint err" style="flex:1">${esc(this.error)}</p>
        <button class="btn ghost" data-action="leave">Back</button></div></section></div>`;
    }
    switch (this.phase) {
      case 'countdown': {
        const n = Math.max(1, Math.ceil((this.goAt - performance.now()) / 1000));
        return `<div class="count">${n}</div>`;
      }
      case 'race':
        return performance.now() - this.goAt < 700 ? '<div class="count go">START!</div>' : '';
      case 'finished': {
        if (this.solo) return `<div class="banner"><span>Summit! <b>${fmtTime(this.myMs!)}</b></span></div>`;
        const waiting = [...this.opps.values()].filter((o) => o.ms === null && !o.left).length;
        return `<div class="banner"><span>Summit! <b>${fmtTime(this.myMs!)}</b> – waiting for ${waiting > 1 ? `${waiting} players` : 'your opponent'}…</span></div>`;
      }
      default:
        return this.studioHtml();
    }
  }

  /** reklamy tylko poza wyścigiem */
  adsAllowed(): boolean {
    return this.phase === 'lobby' || this.phase === 'results';
  }

  private readyBadge(p?: PlayerMeta) {
    return p?.ready ? '<span class="badge ready">READY ✓</span>' : '<span class="badge wait">waiting…</span>';
  }

  private verifyHtml(): string {
    if (!USE_SUPABASE) return '<span class="sub">local mode</span>';
    switch (this.verify) {
      case 'ok':
        return '<span class="verified">verified ✓</span>';
      case 'bad':
        return '<span class="rejected">rejected by server ✖</span>';
      case 'suspect':
        return '<span class="rejected">under review – not ranked</span>';
      case 'error':
        return '<span class="rejected">could not save the result</span>';
      default:
        return '<span class="sub">server is checking…</span>';
    }
  }

  private lobbyCards(): string {
    const a = this.active();
    const sessionWins = (id: string) => this.session.get(id)?.wins ?? 0;
    if (a.length <= 2) {
      const opp = a.find((p) => p.id !== this.me.id);
      const meCard = `<div class="pcard slot" style="--c:${color(this.slotOf(this.me.id))}"><div class="lbl"><span>YOU</span></div>
        <div class="row"><span class="name">${esc(this.me.nick)}${this.me.acct ? '<span class="acct">ACCOUNT ✓</span>' : ''}</span>${this.readyBadge(this.me)}</div>
        <span class="sub">Wins in room: ${sessionWins(this.me.id)}</span></div>`;
      const oppCard = opp
        ? `<div class="pcard slot" style="--c:${color(this.slotOf(opp.id))}"><div class="lbl"><span>OPPONENT</span></div>
          <div class="row"><span class="name">${esc(opp.nick)}${opp.acct ? '<span class="acct">ACCOUNT ✓</span>' : ''}</span>${this.readyBadge(opp)}</div>
          <span class="sub">Wins in room: ${sessionWins(opp.id)}</span></div>`
        : `<div class="pcard empty"><div class="lbl"><span>OPPONENT</span></div>
          <span class="name">Free lane</span><span class="sub">Share the link – up to ${MAX_PLAYERS} players can join.</span></div>`;
      return `<section class="cards" aria-label="Players">${meCard}<div class="vs">VS</div>${oppCard}</section>`;
    }
    const cards = a.map((p) => {
      const isMe = p.id === this.me.id;
      return `<div class="pcard slot" style="--c:${color(this.slotOf(p.id))}"><div class="lbl"><span>${isMe ? 'YOU' : `LANE ${this.slotOf(p.id) + 1}`}</span></div>
        <div class="row"><span class="name">${esc(p.nick)}${p.acct ? '<span class="acct">✓</span>' : ''}</span>${this.readyBadge(p)}</div>
        <span class="sub">Wins: ${sessionWins(p.id)}</span></div>`;
    });
    if (a.length < MAX_PLAYERS) {
      cards.push(`<div class="pcard free"><div class="lbl"><span>FREE SLOT</span></div><span class="sub">${MAX_PLAYERS - a.length} more ${MAX_PLAYERS - a.length === 1 ? 'player' : 'players'}</span></div>`);
    }
    return `<section class="cards many" aria-label="Players (${a.length}/${MAX_PLAYERS})">${cards.join('')}</section>`;
  }

  private resultCards(st: Standing[]): string {
    // pojedynek 1 na 1: duże karty jak w projekcie 5C
    const me = st.find((s) => s.me)!;
    const op = st.find((s) => !s.me)!;
    const meWin = st[0].me;
    const opCard = (s: Standing) => {
      const state = s.ms === null ? (s.left ? 'left the game' : '') : s.valid ? '<span class="verified">checked ✓</span>' : '<span class="rejected">result rejected ✖</span>';
      return `<div class="pcard slot${!meWin ? ' winner' : ''}" style="--c:${color(s.slot)}">
        <div class="lbl"><span>OPPONENT · ${esc(s.nick.toUpperCase())}</span>${!meWin ? TROPHY : ''}</div>
        <span class="time">${s.ms === null ? '—' : fmtTime(s.ms)}</span>
        <span class="sub">${s.ms !== null ? `perfect ${s.perfects}/${CFG.holds}` : ''}</span>${state}</div>`;
    };
    let mid = '<div class="vs">VS</div>';
    if (op.ms !== null && op.valid && me.ms !== null && op.ms !== me.ms) {
      mid = `<div class="vs"><small>${meWin ? 'faster by' : 'slower by'}</small><b>${secs(Math.abs(op.ms - me.ms))} s</b></div>`;
    }
    return `<section class="cards" aria-label="Results">
      <div class="pcard slot${meWin ? ' winner' : ''}" style="--c:${color(me.slot)}">
        <div class="lbl"><span>YOU · ${esc(me.nick.toUpperCase())}</span>${meWin ? TROPHY : ''}</div>
        <span class="time">${fmtTime(me.ms!)}</span>
        <span class="sub">perfect ${me.perfects}/${CFG.holds}</span>${this.verifyHtml()}</div>
      ${mid}${opCard(op)}</section>`;
  }

  private roundTable(st: Standing[]): string {
    const rows = st
      .map((s, i) => {
        const time = s.ms === null ? (s.left ? 'left' : '—') : s.valid ? `${secs(s.ms)} s` : 'rejected';
        const extra = s.me ? this.verifyHtml().replace(/<[^>]+>/g, '') : s.ms !== null && s.valid ? `perfect ${s.perfects}` : '';
        return `<tr class="${s.me ? 'mine' : ''} ${i === 0 && s.valid ? 'gold' : ''}"><td class="pl">${i + 1}.</td>
          <td><span class="dot" style="background:${color(s.slot)}"></span>${esc(s.nick)}${s.me ? ' (Ty)' : ''}</td>
          <td class="s">${esc(extra)}</td><td class="t">${time}</td></tr>`;
      })
      .join('');
    return `<div class="tbl"><h2>ROUND ${this.round} RESULTS</h2><table>${rows}</table></div>`;
  }

  private sessionTable(): string {
    const rows = [...this.session.entries()]
      .sort((a, b) => b[1].wins - a[1].wins || (a[1].best ?? Infinity) - (b[1].best ?? Infinity))
      .map(
        ([id, r], i) => `<tr class="${id === this.me.id ? 'mine' : ''}"><td class="pl">${i + 1}.</td>
          <td><span class="dot" style="background:${color(r.slot)}"></span>${esc(r.nick)}</td>
          <td class="s">${r.wins} ${r.wins === 1 ? 'win' : 'wins'} · ${r.rounds} ${r.rounds === 1 ? 'round' : 'rounds'}</td>
          <td class="t">${r.best === null ? '—' : `${secs(r.best)} s`}</td></tr>`,
      )
      .join('');
    return `<div class="tbl"><h2>ROOM RANKING · BEST TIMES</h2>${rows ? `<table>${rows}</table>` : '<p class="empty">Nobody has finished a round yet.</p>'}</div>`;
  }

  private accountLine(): string {
    if (!accountsEnabled || !USE_SUPABASE) return '';
    const acc = getAccount();
    if (!acc) return 'Playing as a guest – log in from the menu to get your times ranked.';
    if (this.myRecord?.best != null) {
      return `Your record: <b>${secs(this.myRecord.best)} s</b>${this.myRecord.place ? ` · rank <b>#${this.myRecord.place}</b>` : ''}`;
    }
    return '';
  }

  /** Solo: the result of a run next to the personal best, the latest attempts, retry. */
  private soloHtml(): string {
    const results = this.phase === 'results' && this.myMs !== null && this.soloRes;
    if (!results) {
      return `<div class="dim"></div><div class="studio">${belka('solo run', ['PLAYERS', '1'])}<p class="hint">${this.error ? `<span class="err">${esc(this.error)}</span>` : 'Get ready…'}</p></div>`;
    }
    const r = this.soloRes!;
    const ms = this.myMs!;
    const best = r.stats.best ?? ms;
    let mid = `<div class="vs"><small>first run</small><b>★</b></div>`;
    if (r.prevBest !== null) {
      mid = r.record
        ? `<div class="vs"><small>faster by</small><b>${secs(r.prevBest - ms)} s</b></div>`
        : `<div class="vs"><small>off best by</small><b>${secs(ms - best)} s</b></div>`;
    }
    const recent = r.stats.recent
      .map((t, i) => `<tr class="${i === 0 ? 'mine' : ''} ${t === best ? 'gold' : ''}"><td class="pl">${r.stats.attempts - i}.</td><td class="s">${i === 0 ? 'this run' : ''}${t === best ? (i === 0 ? ' · ' : '') + 'personal best' : ''}</td><td class="t">${secs(t)} s</td></tr>`)
      .join('');
    const head = `<div class="result-banner ${r.record ? 'win' : 'draw'}">${r.record ? 'NEW RECORD!' : 'SUMMIT!'}</div>${r.record ? confettiHtml() : ''}`;
    const cards = `<section class="cards" aria-label="Result">
      <div class="pcard slot${r.record ? ' winner' : ''}" style="--c:${color(0)}">
        <div class="lbl"><span>RUN #${r.stats.attempts} · ${esc(this.me.nick.toUpperCase())}</span>${r.record ? TROPHY : ''}</div>
        <span class="time">${fmtTime(ms)}</span>
        <span class="sub">perfect ${this.sim.perfects}/${CFG.holds}${this.sim.errors ? ` · mistakes ${this.sim.errors}` : ''}</span>${this.verifyHtml()}</div>
      ${mid}
      <div class="pcard slot" style="--c:#c9a227">
        <div class="lbl"><span>PERSONAL BEST</span></div>
        <span class="time">${fmtTime(best)}</span>
        <span class="sub">on this device</span></div></section>`;
    const acct = this.accountLine();
    return `<div class="dim"></div><div class="studio">
      ${belka(`solo run · attempt ${r.stats.attempts}`, ['PLAYERS', '1'])}
      ${head}
      ${cards}
      <div class="panels"><div class="tbl"><h2>LAST ATTEMPTS</h2><table>${recent}</table></div></div>
      <section class="actions">
        <div class="abar"><button class="btn green grow" data-action="retry">Try again</button><button class="btn ghost" data-action="leave">Menu</button></div>
        <p class="hint">Space = try again</p>
        ${acct ? `<p class="hint small">${acct}</p>` : ''}
      </section>
    </div>`;
  }

  private studioHtml(): string {
    if (this.solo) return this.soloHtml();
    const results = this.phase === 'results' && this.myMs !== null;
    const full = !this.inRoom();
    const a = this.active();
    const alone = a.length < 2;

    let head = '';
    let body = '';
    if (results) {
      const st = this.standings();
      const place = st.findIndex((s) => s.me) + 1;
      const first = st[0];
      const draw = place > 1 && first.ms !== null && first.ms === this.myMs;
      const label = place === 1 ? 'YOU WIN!' : draw ? 'DRAW' : st.length === 2 ? 'YOU LOSE' : `PLACE #${place}`;
      const cls = place === 1 ? 'win' : draw ? 'draw' : 'lose';
      head = `<div class="result-banner ${cls}">${label}</div>${place === 1 ? confettiHtml() : ''}`;
      body =
        st.length === 2
          ? `${this.resultCards(st)}<div class="panels">${this.sessionTable()}</div>`
          : `<div class="panels">${this.roundTable(st)}${this.sessionTable()}</div>`;
    } else {
      body = this.lobbyCards() + (this.session.size ? `<div class="panels">${this.sessionTable()}</div>` : '');
    }

    const readyLabel = this.me.ready ? (results ? 'Cancel rematch' : 'Cancel ready') : results ? 'Rematch!' : 'Ready!';
    const readyBtn = full
      ? ''
      : `<button class="btn ${this.me.ready ? 'green' : 'blue'} grow" data-action="ready" ${alone ? 'disabled' : ''}>${readyLabel}</button>`;
    const middle = `<div class="code-box"><div class="lbl"><small>ROOM CODE · ${a.length}/${MAX_PLAYERS}</small><b>${esc(this.code)}</b></div><button data-action="copy">Copy link</button></div>`;

    const hints: string[] = [];
    if (!this.connected) hints.push('Connecting…');
    if (full) hints.push(`<span class="err">The room is full (max ${MAX_PLAYERS} players).</span>`);
    else if (alone) hints.push(`Share the link – up to ${MAX_PLAYERS} players can join. The round starts when everyone is ready.`);
    else {
      const notReady = a.filter((p) => !p.ready).length;
      hints.push(notReady ? `Starts when everyone is ready (waiting: ${notReady}) · Space = ready` : 'Starting!');
    }
    if (this.phase === 'lobby' && this.participants.length && !this.participants.includes(this.me.id)) hints.push('A round is in progress – you will join the next one.');
    const acct = results ? this.accountLine() : '';

    return `<div class="dim"></div><div class="studio">
      ${belka(results ? `round ${this.round} · room ${this.code}` : `room ${this.code}`)}
      ${head}
      ${body}
      <section class="actions">
        <div class="abar">${readyBtn}${middle}<button class="btn ghost" data-action="leave">Leave</button></div>
        ${hints.map((h) => `<p class="hint">${h}</p>`).join('')}
        ${acct ? `<p class="hint small">${acct}</p>` : ''}
        ${MODE_NOTE ? `<p class="hint small">${esc(MODE_NOTE)}</p>` : ''}
      </section>
    </div>`;
  }

  handleAction(action: string, el: HTMLElement) {
    if (action === 'ready' || action === 'retry') this.toggleReady();
    else if (action === 'leave') location.hash = '#/';
    else if (action === 'copy') {
      const link = `${location.origin}${location.pathname}${location.search}#/r/${this.code}`;
      navigator.clipboard?.writeText(link).then(
        () => (el.textContent = 'Copied!'),
        () => prompt('Copy link:', link),
      );
    }
  }
}

// ---------- menu, konto, ranking ----------

type MenuView = 'main' | 'login' | 'register' | 'check' | 'ranking' | 'account' | 'forgot' | 'recovery';
const menu = {
  view: 'main' as MenuView,
  busy: false,
  error: '',
  note: '',
  email: '',
  nick: '',
  ranking: null as LeaderRow[] | null,
  rankingError: '',
  myBest: null as { best: number | null; place: number | null } | null,
  history: null as HistoryRow[] | null,
  historyError: '',
};

/** Pasek u góry menu: logowanie i ranking zawsze na widoku, dużymi przyciskami. */
function topbarHtml(): string {
  if (!accountsEnabled) return '';
  const acc = getAccount();
  const how = '<a class="btn ghost small" href="#/info/jak-grac">How to play</a>';
  if (acc) {
    return `<nav class="topbar" aria-label="Account">
      <span class="welcome">Welcome, <b>${esc(acc.nick)}</b></span>
      <button class="btn blue small" data-action="view-account">My account</button>
      <button class="btn orange small" data-action="view-ranking">Ranking</button>${how}</nav>`;
  }
  return `<nav class="topbar" aria-label="Account">
    <span class="welcome">Welcome, <b>${esc(getNick())}</b><i>guest</i></span>
    <button class="btn blue small" data-action="view-login">Log in</button>
    <button class="btn orange small" data-action="view-register">Sign up</button>
    <button class="btn ghost small" data-action="view-ranking">Ranking</button>${how}</nav>`;
}

function dateStr(iso: string) {
  return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function accountHtml(): string {
  const acc = getAccount();
  if (!acc) return '';
  const rows = menu.history;
  const valid = (rows ?? []).filter((r) => r.valid && r.verified_ms !== null);
  const ranked = valid.filter((r) => !r.suspect);
  const best = ranked.length ? Math.min(...ranked.map((r) => r.verified_ms!)) : null;
  const wins = (rows ?? []).filter((r) => r.won).length;
  const stats = rows
    ? `<div class="stats">
        <div><b>${valid.length}</b><small>rounds</small></div>
        <div><b>${wins}</b><small>wins</small></div>
        <div><b>${best === null ? '—' : secs(best)}</b><small>best (s)</small></div>
        <div><b>${menu.myBest?.place ? '#' + menu.myBest.place : '—'}</b><small>rank</small></div>
      </div>`
    : '';
  const table = menu.historyError
    ? `<p class="empty err">${esc(menu.historyError)}</p>`
    : rows === null
      ? '<p class="empty">Loading…</p>'
      : rows.length === 0
        ? '<p class="empty">No online rounds yet. Play one and it will show up here.</p>'
        : `<table>${rows
            .map((r) => {
              const status = !r.valid ? 'rejected' : r.suspect ? 'under review' : r.won ? 'win' : r.players > 1 ? `of ${r.players} players` : '';
              return `<tr class="${r.won ? 'gold' : ''}"><td class="s">${dateStr(r.created_at)}</td><td>${esc(r.room_code)}</td>
                <td class="s">${status}</td><td class="t">${r.valid && r.verified_ms !== null ? secs(r.verified_ms) + ' s' : '—'}</td></tr>`;
            })
            .join('')}</table>`;
  const err = menu.error ? `<p class="msg err">${esc(menu.error)}</p>` : '';
  const note = menu.note ? `<p class="msg ok">${esc(menu.note)}</p>` : '';
  return `<div class="form wide2" role="region" aria-label="My account">
      <h2>My account</h2>
      <p class="msg">${esc(acc.email)}</p>
      ${stats}
      <label>Nickname (shown in the ranking)
        <span class="inline"><input id="f-nick" maxlength="16" value="${esc(menu.nick || acc.nick)}" data-enter="save-nick"><button class="btn blue small" data-action="save-nick" ${menu.busy ? 'disabled' : ''}>Save</button></span>
      </label>
      ${err}${note}
      <div class="tbl"><h2>RECENT ROUNDS</h2>${table}</div>
      <div class="row2"><button class="linkbtn" data-action="send-reset">Change password (we e-mail you a link)</button><button class="linkbtn" data-action="logout">Log out</button><button class="linkbtn" data-action="view-main">Back</button></div>
    </div>`;
}

function menuHtml(): string {
  const acc = getAccount();
  const wrap = (inner: string) => `<div class="dim"></div><div class="studio">${topbarHtml()}${belka('timed climbing · up to 6 players')}${inner}</div>`;
  const err = menu.error ? `<p class="msg err">${esc(menu.error)}</p>` : '';
  const note = menu.note ? `<p class="msg ok">${esc(menu.note)}</p>` : '';
  const dis = menu.busy ? 'disabled' : '';

  if (menu.view === 'login') {
    return wrap(`<div class="form" role="form" aria-label="Logowanie">
      <h2>Log in</h2>
      <label>E-mail<input id="f-email" type="email" autocomplete="email" value="${esc(menu.email)}" data-enter="do-login"></label>
      <label>Password<input id="f-pass" type="password" autocomplete="current-password" data-enter="do-login"></label>
      ${err}${note}
      <button class="btn blue" data-action="do-login" ${dis}>${menu.busy ? 'Logging in…' : 'Log in'}</button>
      <div class="row2"><button class="linkbtn" data-action="view-register">No account? Sign up</button><button class="linkbtn" data-action="view-forgot">Forgot password</button><button class="linkbtn" data-action="view-main">Back</button></div>
    </div>`);
  }
  if (menu.view === 'forgot') {
    return wrap(`<div class="form" role="form" aria-label="Reset password">
      <h2>Reset password</h2>
      <p class="msg">Enter your account e-mail – we will send a link to set a new password.</p>
      <label>E-mail<input id="f-email" type="email" autocomplete="email" value="${esc(menu.email)}" data-enter="do-forgot"></label>
      ${err}${note}
      <button class="btn blue" data-action="do-forgot" ${dis}>${menu.busy ? 'Sending…' : 'Send link'}</button>
      <div class="row2"><button class="linkbtn" data-action="view-login">Back to login</button></div>
    </div>`);
  }
  if (menu.view === 'recovery') {
    return wrap(`<div class="form" role="form" aria-label="New password">
      <h2>Set a new password</h2>
      <label>New password (min. 6 characters)<input id="f-pass" type="password" autocomplete="new-password" data-enter="do-recovery"></label>
      ${err}
      <button class="btn blue" data-action="do-recovery" ${dis}>${menu.busy ? 'Saving…' : 'Save password'}</button>
    </div>`);
  }
  if (menu.view === 'register') {
    return wrap(`<div class="form" role="form" aria-label="Rejestracja">
      <h2>Create account</h2>
      <label>Nickname (shown in the ranking)<input id="f-nick" maxlength="16" autocomplete="nickname" value="${esc(menu.nick || getNick())}" data-enter="do-register"></label>
      <label>E-mail<input id="f-email" type="email" autocomplete="email" value="${esc(menu.email)}" data-enter="do-register"></label>
      <label>Password (min. 6 characters)<input id="f-pass" type="password" autocomplete="new-password" data-enter="do-register"></label>
      ${err}
      <button class="btn blue" data-action="do-register" ${dis}>${menu.busy ? 'Creating…' : 'Create account'}</button>
      <div class="row2"><button class="linkbtn" data-action="view-login">I have an account – log in</button><button class="linkbtn" data-action="view-main">Back</button></div>
    </div>`);
  }
  if (menu.view === 'check') {
    return wrap(`<div class="form">
      <h2>Check your inbox</h2>
      <p class="msg ok">We sent an activation link to <b>${esc(menu.email)}</b>. Click it – you will be back in the game, already logged in.</p>
      <p class="msg">Can't see the e-mail? Check your spam folder.</p>
      <button class="btn ghost" data-action="view-main">Back to menu</button>
    </div>`);
  }
  if (menu.view === 'account') {
    return wrap(acc ? accountHtml() : '<div class="form"><p class="msg">Log in to see your account.</p><button class="btn blue" data-action="view-login">Log in</button></div>');
  }
  if (menu.view === 'ranking') {
    const rows = menu.ranking;
    const table = menu.rankingError
      ? `<p class="empty err">${esc(menu.rankingError)}</p>`
      : rows === null
        ? '<p class="empty">Loading…</p>'
        : rows.length === 0
          ? '<p class="empty">The ranking is still empty – be the first!</p>'
          : `<table>${rows
              .map(
                (r, i) => `<tr class="${acc?.userId === r.user_id ? 'mine' : ''} ${i < 3 ? 'gold' : ''}"><td class="pl">${i + 1}.</td><td>${esc(r.nick)}</td>
                <td class="s">${new Date(r.achieved_at).toLocaleDateString('en-GB')}</td><td class="t">${secs(r.best_ms)} s</td></tr>`,
              )
              .join('')}</table>`;
    const mine = acc
      ? menu.myBest?.best != null
        ? `<p class="hint small">Your record: <b>${secs(menu.myBest.best)} s</b>${menu.myBest.place ? ` · rank #${menu.myBest.place}` : ''}</p>`
        : '<p class="hint small">You have no verified time yet – play a round!</p>'
      : '<p class="hint small">Log in to get your times into the ranking.</p>';
    return wrap(`<div class="tbl wide"><h2>GLOBAL RANKING · BEST TIMES</h2>${table}</div>${mine}
      <button class="btn ghost" data-action="view-main">Back</button>`);
  }

  const nickField = acc
    ? `<div class="row"><span class="name">${esc(acc.nick)}</span><span class="acct">ACCOUNT ✓</span></div><span class="sub">Your times go to the ranking.</span>`
    : `<label>Your nickname<input id="nick" maxlength="16" value="${esc(getNick())}" autocomplete="off" spellcheck="false"></label>`;
  return wrap(`
    ${note ? `<div class="form">${note}</div>` : ''}
    <section class="cards" aria-label="Players">
      <div class="pcard slot" style="--c:${color(0)}"><div class="lbl"><span>YOU</span></div>${nickField}</div>
      <div class="vs">VS</div>
      <div class="pcard empty"><div class="lbl"><span>OPPONENTS</span></div>
        <span class="name">Free lanes</span><span class="sub">Create a room and share the link – up to ${MAX_PLAYERS} players.</span></div>
    </section>
    <section class="actions">
      <div class="abar solo-bar">
        <button class="btn green grow" data-action="solo">Solo run</button>
        <span class="solo-best">${getSolo().best === null ? 'Beat the clock on your own – set your record' : `Your record: <b>${secs(getSolo().best!)} s</b> · ${getSolo().attempts} ${getSolo().attempts === 1 ? 'run' : 'runs'}`}</span>
      </div>
      <div class="abar">
        <button class="btn blue grow" data-action="create">Create room</button>
        <span class="or">or</span>
        <label class="sr" for="join-code">Room code</label>
        <input id="join-code" class="code-in" placeholder="CODE" maxlength="8" autocomplete="off" spellcheck="false" data-enter="join">
        <button class="btn orange" data-action="join">Join</button>
      </div>
      ${!acc && accountsEnabled ? '<p class="hint">Playing as a guest – <button class="linkbtn big" data-action="view-login">log in</button> to get your times into the ranking.</p>' : ''}
      <p class="hint">The ring closes on the <span class="blue">blue</span> hold → press ← / → (A / D) when it closes → your own time counts</p>
      <p class="hint small">${esc(MODE_NOTE || 'Online: Supabase Realtime ✓')}</p>
      ${footerLinksHtml()}
    </section>`);
}

function renderMenu() {
  if (!room) paintOverlay(menuHtml(), 'menu-' + menu.view);
}

const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value ?? '';

function readNick() {
  if (getAccount()) return;
  const n = cleanNick(val('nick')) || getNick();
  saveNick(n);
}

async function openRanking() {
  menu.view = 'ranking';
  menu.ranking = null;
  menu.rankingError = '';
  menu.myBest = null;
  renderMenu();
  try {
    menu.ranking = await fetchLeaderboard(20);
    const acc = getAccount();
    if (acc) menu.myBest = await fetchMyBest(acc.userId);
  } catch (e) {
    menu.rankingError = plError(e);
  }
  if (menu.view === 'ranking') renderMenu();
}

async function openAccount() {
  menu.view = 'account';
  menu.history = null;
  menu.historyError = '';
  menu.nick = '';
  menu.error = '';
  menu.note = '';
  renderMenu();
  const acc = getAccount();
  if (!acc) return;
  try {
    [menu.history, menu.myBest] = await Promise.all([fetchHistory(30), fetchMyBest(acc.userId)]);
  } catch (e) {
    menu.historyError = plError(e);
  }
  if (menu.view === 'account') renderMenu();
}

async function menuAction(action: string) {
  // z podstrony informacyjnej wracamy do menu bez przeładowania widoku
  if (location.hash.startsWith('#/info/')) history.replaceState(null, '', location.pathname + location.search);
  menu.error = '';
  if (action !== 'view-main') menu.note = '';
  switch (action) {
    case 'create':
      readNick();
      location.hash = `#/r/${roomCode()}`;
      return;
    case 'solo':
      readNick();
      location.hash = '#/solo';
      return;
    case 'join': {
      const input = document.getElementById('join-code') as HTMLInputElement | null;
      const code = (input?.value ?? '').trim().toUpperCase();
      if (!ROOM_CODE_RE.test(code)) {
        input?.classList.add('bad');
        input?.focus();
        return;
      }
      readNick();
      location.hash = `#/r/${code}`;
      return;
    }
    case 'view-main':
    case 'view-login':
    case 'view-register':
    case 'view-forgot':
      menu.email = val('f-email') || menu.email;
      menu.view = action.slice(5) as MenuView;
      renderMenu();
      return;
    case 'view-ranking':
      void openRanking();
      return;
    case 'view-account':
      void openAccount();
      return;
    case 'logout':
      await signOut();
      menu.view = 'main';
      renderMenu();
      return;
    case 'do-login': {
      menu.email = val('f-email').trim();
      const pass = val('f-pass');
      if (!menu.email || !pass) {
        menu.error = 'Enter your e-mail and password.';
        renderMenu();
        return;
      }
      menu.busy = true;
      renderMenu();
      try {
        await signIn(menu.email, pass);
        menu.view = 'main';
      } catch (e) {
        menu.error = plError(e);
      }
      menu.busy = false;
      renderMenu();
      return;
    }
    case 'do-register': {
      menu.nick = cleanNick(val('f-nick'));
      menu.email = val('f-email').trim();
      const pass = val('f-pass');
      if (!menu.nick || !menu.email || pass.length < 6) {
        menu.error = 'Enter a nickname, e-mail and password (min. 6 characters).';
        renderMenu();
        return;
      }
      menu.busy = true;
      renderMenu();
      try {
        const needsConfirm = await signUp(menu.nick, menu.email, pass);
        menu.view = needsConfirm ? 'check' : 'main';
      } catch (e) {
        menu.error = plError(e);
      }
      menu.busy = false;
      renderMenu();
      return;
    }
    case 'do-forgot': {
      menu.email = val('f-email').trim();
      if (!menu.email) {
        menu.error = 'Enter your e-mail address.';
        renderMenu();
        return;
      }
      menu.busy = true;
      renderMenu();
      try {
        await resetPassword(menu.email);
        menu.note = `If an account for ${menu.email} exists, we sent a password-reset link to it. Check spam too.`;
      } catch (e) {
        menu.error = plError(e);
      }
      menu.busy = false;
      renderMenu();
      return;
    }
    case 'do-recovery': {
      const pass = val('f-pass');
      if (pass.length < 6) {
        menu.error = 'Password must be at least 6 characters.';
        renderMenu();
        return;
      }
      menu.busy = true;
      renderMenu();
      try {
        await updatePassword(pass);
        menu.view = 'main';
        menu.note = 'Password changed. You are logged in.';
      } catch (e) {
        menu.error = plError(e);
      }
      menu.busy = false;
      renderMenu();
      return;
    }
    case 'save-nick': {
      const n = cleanNick(val('f-nick'));
      menu.nick = n;
      if (!n) {
        menu.error = 'Nickname cannot be empty.';
        renderMenu();
        return;
      }
      menu.busy = true;
      renderMenu();
      try {
        await changeNick(n);
        menu.note = 'Nickname saved.';
        menu.nick = '';
      } catch (e) {
        menu.error = plError(e);
      }
      menu.busy = false;
      renderMenu();
      return;
    }
    case 'send-reset': {
      const acc = getAccount();
      if (!acc) return;
      try {
        await resetPassword(acc.email);
        menu.note = `We sent a password-reset link to ${acc.email}.`;
      } catch (e) {
        menu.error = plError(e);
      }
      renderMenu();
      return;
    }
  }
}

// ---------- aplikacja / routing / pętla ----------

let room: Room | null = null;

function route() {
  const m = location.hash.match(/^#\/r\/([A-Za-z0-9]{4,8})$/);
  if (location.hash === '#/solo') {
    if (room?.solo) return;
    room?.destroy();
    room = new Room(roomCode(), true);
    if (import.meta.env.DEV) (window as unknown as { __room: Room }).__room = room;
  } else if (m) {
    const code = m[1].toUpperCase();
    if (room?.code === code) return;
    room?.destroy();
    room = new Room(code);
    if (import.meta.env.DEV) (window as unknown as { __room: Room }).__room = room; // tylko do debugowania
  } else if (/^#\/info\/[a-z-]+$/.test(location.hash) && isInfoPage(location.hash.slice(7))) {
    room?.destroy();
    room = null;
    paintOverlay(infoHtml(location.hash.slice(7), topbarHtml()), 'info-' + location.hash.slice(7));
    $('overlay').querySelector('.studio')?.scrollTo(0, 0);
  } else {
    if (location.hash.includes('access_token') || location.hash.includes('error_description')) {
      if (!$('overlay').innerHTML) renderMenu(); // tokeny obsłuży Supabase Auth
      return;
    }
    room?.destroy();
    room = null;
    menu.view = 'main';
    renderMenu();
  }
}

let last = performance.now();
function loop(now: number) {
  requestAnimationFrame(loop);
  const dt = Math.min(100, now - last);
  last = now;
  if (room) room.frame(now, dt);
  else {
    syncOppPanels(['__idle']);
    const idle = { route: IDLE_ROUTE, hold: 0, feedback: 'none' as Feedback, feedbackAge: 1e9, ring: null, showHints: false, present: true, finished: false };
    meView.draw({ ...idle, look: 0 }, now, dt);
    oppPanels.get('__idle')?.view.draw({ ...idle, look: 1 }, now, dt);
  }
  setAdsVisible(room ? room.adsAllowed() : true);
  layoutHud();
}

const overlay = $('overlay');
overlay.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
  if (!el || (el as HTMLButtonElement).disabled) return;
  const action = el.dataset.action!;
  if (room) room.handleAction(action, el);
  else void menuAction(action);
});
overlay.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement;
  if (e.key !== 'Enter' || room) return;
  if (target.dataset.enter) void menuAction(target.dataset.enter);
  else if (target.id === 'nick') void menuAction('create');
});
overlay.addEventListener('change', (e) => {
  const target = e.target as HTMLInputElement;
  if (target.id === 'nick') {
    const n = cleanNick(target.value);
    target.value = n;
    if (n) saveNick(n);
  }
});

onAccountChange(() => {
  if (!room && (menu.view === 'main' || menu.view === 'account')) renderMenu();
});
onPasswordRecovery(() => {
  menu.view = 'recovery';
  menu.error = '';
  if (!room) renderMenu();
});
initAccounts();
window.addEventListener('hashchange', route);
route();
requestAnimationFrame(loop);
