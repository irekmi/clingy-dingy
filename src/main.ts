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
  fetchLeaderboard,
  fetchMyBest,
  getAccount,
  initAccounts,
  onAccountChange,
  plError,
  signIn,
  signOut,
  signUp,
  type LeaderRow,
} from './account';
import { setAdsVisible } from './ads';
import { ClimbView, fmtTime, MAX_PLAYERS, PLAYER_COLORS } from './game/render';
import { footerLinksHtml, infoHtml, isInfoPage } from './pages';
import { LocalTransport } from './net/localTransport';
import { SupabaseTransport, submitResult, supabaseConfigured } from './net/supabase';
import type { PlayerMeta, RoomTransport } from './net/transport';
import { cleanNick, esc, randomId, roomCode, ROOM_CODE_RE } from './util';

const COUNTDOWN_MS = 3000;
const USE_SUPABASE = supabaseConfigured && !new URLSearchParams(location.search).has('local');
// nowe id przy każdym otwarciu karty (w trybie lokalnym karty muszą mieć różne id)
const PLAYER_ID = randomId();

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function getNick(): string {
  const acc = getAccount();
  if (acc) return acc.nick;
  let n = '';
  try {
    n = cleanNick(localStorage.getItem('pc_nick'));
  } catch {
    /* brak dostępu do storage */
  }
  return n || `Gracz${Math.floor(100 + Math.random() * 900)}`;
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
  : 'Tryb lokalny (bez serwera): pozostali gracze otwierają link w innych oknach tej samej przeglądarki.';

const color = (slot: number) => PLAYER_COLORS[Math.max(0, slot) % PLAYER_COLORS.length];
const secs = (ms: number) => (ms / 1000).toFixed(2);

const belka = (sub: string) => `
  <header class="belka">
    <div class="tor me"><small>TOR</small>1</div>
    <div class="title"><h1>CLINGY DINGY</h1><span>${esc(sub)}</span></div>
    <div class="tor opp"><small>DO</small>6</div>
  </header>`;

const TROPHY = `<svg width="28" height="28" viewBox="0 0 30 30" role="img" aria-label="Zwycięzca"><path d="M8 4 H22 V11 Q22 18 15 18 Q8 18 8 11 Z" fill="#f2c94c" stroke="#a37a12" stroke-width="2"></path><path d="M8 7 H4 Q4 13 9 13 M22 7 H26 Q26 13 21 13" fill="none" stroke="#f2c94c" stroke-width="2.5"></path><rect x="13" y="18" width="4" height="5" fill="#f2c94c"></rect><rect x="9" y="23" width="12" height="4" rx="1.5" fill="#f2c94c" stroke="#a37a12" stroke-width="1.5"></rect></svg>`;

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

/** Tworzy/usuwa ściany przeciwników (1–5) i układa je w siatce. */
function syncOppPanels(ids: string[]) {
  const grid = $('opp-grid');
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
      cv.setAttribute('aria-label', 'Ściana przeciwnika');
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
  const cols = n <= 1 ? 1 : n <= 4 ? 2 : 3;
  const key = `repeat(${cols}, minmax(0, 1fr))`;
  if (grid.style.gridTemplateColumns !== key) grid.style.gridTemplateColumns = key;
  $('game').classList.toggle('multi', n >= 2);
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
  if (game.classList.contains('multi')) {
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
  private verify: 'off' | 'pending' | 'ok' | 'bad' | 'error' = 'off';
  private myRecord: { best: number | null; place: number | null } | null = null;
  private lastSent = { hold: -1, fbAt: -1, at: 0 };
  private connected = false;
  private error = '';
  private overlayKey = '';
  private raceRowsKey = '';
  private offAccount: () => void;

  constructor(readonly code: string) {
    this.route = routeFor(`lobby-${code}`);
    this.me = { id: PLAYER_ID, nick: getNick(), ready: null, joinedAt: Date.now(), acct: !!getAccount() };
    this.t = USE_SUPABASE ? new SupabaseTransport(code) : new LocalTransport(code);
    this.t.on('start', (p) => this.onStart(p));
    this.t.on('pos', (p) => this.onPos(p));
    this.t.on('finish', (p) => this.onFinish(p));
    this.t.onPlayers((list) => this.onPlayers(list));
    this.t
      .connect(this.me)
      .then(() => {
        this.connected = true;
        this.refresh();
      })
      .catch((e) => {
        this.error = `Nie udało się połączyć z serwerem gry (${e?.message ?? e}).`;
        this.refresh();
      });
    this.offAccount = onAccountChange((a) => {
      this.me = { ...this.me, nick: a?.nick ?? getNick(), acct: !!a };
      this.t.setMeta(this.me);
      this.refresh();
    });
    window.addEventListener('keydown', this.onKey);
    $('panel-me').addEventListener('pointerdown', this.onPointer);
    meView.reset();
    this.refresh();
  }

  destroy() {
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
      if (this.phase === 'countdown' && remaining === 0) this.phase = 'lobby';
    }
    this.maybeStart();
    this.maybeResults();
    this.refresh();
  }

  private toggleReady() {
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
    const payload = { m: randomId(), p: a.map((p) => p.id) };
    this.t.send('start', payload);
    this.onStart(payload);
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
        this.toggleReady();
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
          this.verify = r.valid ? 'ok' : 'bad';
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
      },
      now,
      dt,
    );

    const shown = this.shownOpps();
    syncOppPanels(shown.length ? shown : ['__empty']);
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
        },
        now,
        dt,
      );
      const tagText = id === '__empty' ? '' : live ? `${o.nick} · ${o.left ? 'wyszedł' : o.ms !== null ? secs(o.ms) + ' s' : o.hold + ' m'}` : pl?.nick ?? '';
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
      setText('hud-op-name', 'Przeciwnik');
      setText('hud-op-sub', 'wyszedł');
    }
    // paski wyścigu: wszyscy uczestnicy w kolejności miejsc startowych
    const race = $('hud-race');
    const ids = this.participants;
    if (this.raceRowsKey !== ids.join()) {
      this.raceRowsKey = ids.join();
      race.innerHTML = ids
        .map((id) => {
          const nick = id === this.me.id ? this.me.nick : this.opps.get(id)?.nick ?? '?';
          return `<span class="rn">${esc(nick)}</span><div class="track"><i data-bar="${esc(id)}" style="background:${color(this.slotOf(id))}"></i></div><span data-m="${esc(id)}">0 m</span>`;
        })
        .join('');
    }
    for (const id of ids) {
      const h = id === this.me.id ? disp.hold : this.opps.get(id)?.hold ?? 0;
      const bar = race.querySelector<HTMLElement>(`[data-bar="${CSS.escape(id)}"]`);
      const m = race.querySelector<HTMLElement>(`[data-m="${CSS.escape(id)}"]`);
      if (bar) bar.style.width = `${(h / CFG.holds) * 100}%`;
      if (m && m.textContent !== `${h} m`) m.textContent = `${h} m`;
    }
  }

  // ---------- nakładki ----------

  refresh() {
    const html = this.overlayHtml();
    if (html === this.overlayKey) return;
    this.overlayKey = html;
    $('overlay').innerHTML = html;
  }

  private overlayHtml(): string {
    if (this.error) {
      return `<div class="dim"></div><div class="studio">${belka(`pokój ${this.code}`)}
        <section class="actions"><div class="abar"><p class="hint err" style="flex:1">${esc(this.error)}</p>
        <button class="btn ghost" data-action="leave">Wróć</button></div></section></div>`;
    }
    switch (this.phase) {
      case 'countdown': {
        const n = Math.max(1, Math.ceil((this.goAt - performance.now()) / 1000));
        return `<div class="count">${n}</div>`;
      }
      case 'race':
        return performance.now() - this.goAt < 700 ? '<div class="count go">START!</div>' : '';
      case 'finished': {
        const waiting = [...this.opps.values()].filter((o) => o.ms === null && !o.left).length;
        return `<div class="banner"><span>Szczyt! <b>${fmtTime(this.myMs!)}</b> – czekam na ${waiting > 1 ? `${waiting} graczy` : 'przeciwnika'}…</span></div>`;
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
    return p?.ready ? '<span class="badge ready">GOTOWY ✓</span>' : '<span class="badge wait">czeka…</span>';
  }

  private verifyHtml(): string {
    if (!USE_SUPABASE) return '<span class="sub">tryb lokalny</span>';
    switch (this.verify) {
      case 'ok':
        return '<span class="verified">zweryfikowany ✓</span>';
      case 'bad':
        return '<span class="rejected">odrzucony przez serwer ✖</span>';
      case 'error':
        return '<span class="rejected">nie udało się zapisać wyniku</span>';
      default:
        return '<span class="sub">serwer sprawdza…</span>';
    }
  }

  private lobbyCards(): string {
    const a = this.active();
    const sessionWins = (id: string) => this.session.get(id)?.wins ?? 0;
    if (a.length <= 2) {
      const opp = a.find((p) => p.id !== this.me.id);
      const meCard = `<div class="pcard slot" style="--c:${color(this.slotOf(this.me.id))}"><div class="lbl"><span>TY</span></div>
        <div class="row"><span class="name">${esc(this.me.nick)}${this.me.acct ? '<span class="acct">KONTO ✓</span>' : ''}</span>${this.readyBadge(this.me)}</div>
        <span class="sub">Wygrane w pokoju: ${sessionWins(this.me.id)}</span></div>`;
      const oppCard = opp
        ? `<div class="pcard slot" style="--c:${color(this.slotOf(opp.id))}"><div class="lbl"><span>PRZECIWNIK</span></div>
          <div class="row"><span class="name">${esc(opp.nick)}${opp.acct ? '<span class="acct">KONTO ✓</span>' : ''}</span>${this.readyBadge(opp)}</div>
          <span class="sub">Wygrane w pokoju: ${sessionWins(opp.id)}</span></div>`
        : `<div class="pcard empty"><div class="lbl"><span>PRZECIWNIK</span></div>
          <span class="name">Wolny tor</span><span class="sub">Wyślij link – do pokoju wejdzie do ${MAX_PLAYERS} osób.</span></div>`;
      return `<section class="cards" aria-label="Gracze">${meCard}<div class="vs">VS</div>${oppCard}</section>`;
    }
    const cards = a.map((p) => {
      const isMe = p.id === this.me.id;
      return `<div class="pcard slot" style="--c:${color(this.slotOf(p.id))}"><div class="lbl"><span>${isMe ? 'TY' : `TOR ${this.slotOf(p.id) + 1}`}</span></div>
        <div class="row"><span class="name">${esc(p.nick)}${p.acct ? '<span class="acct">✓</span>' : ''}</span>${this.readyBadge(p)}</div>
        <span class="sub">Wygrane: ${sessionWins(p.id)}</span></div>`;
    });
    if (a.length < MAX_PLAYERS) {
      cards.push(`<div class="pcard free"><div class="lbl"><span>WOLNE MIEJSCE</span></div><span class="sub">jeszcze ${MAX_PLAYERS - a.length} ${MAX_PLAYERS - a.length === 1 ? 'osoba' : 'osoby'}</span></div>`);
    }
    return `<section class="cards many" aria-label="Gracze (${a.length}/${MAX_PLAYERS})">${cards.join('')}</section>`;
  }

  private resultCards(st: Standing[]): string {
    // pojedynek 1 na 1: duże karty jak w projekcie 5C
    const me = st.find((s) => s.me)!;
    const op = st.find((s) => !s.me)!;
    const meWin = st[0].me;
    const opCard = (s: Standing) => {
      const state = s.ms === null ? (s.left ? 'opuścił grę' : '') : s.valid ? '<span class="verified">sprawdzony ✓</span>' : '<span class="rejected">wynik odrzucony ✖</span>';
      return `<div class="pcard slot${!meWin ? ' winner' : ''}" style="--c:${color(s.slot)}">
        <div class="lbl"><span>PRZECIWNIK · ${esc(s.nick.toUpperCase())}</span>${!meWin ? TROPHY : ''}</div>
        <span class="time">${s.ms === null ? '—' : fmtTime(s.ms)}</span>
        <span class="sub">${s.ms !== null ? `perfekt ${s.perfects}/${CFG.holds}` : ''}</span>${state}</div>`;
    };
    let mid = '<div class="vs">VS</div>';
    if (op.ms !== null && op.valid && me.ms !== null && op.ms !== me.ms) {
      mid = `<div class="vs"><small>${meWin ? 'szybciej o' : 'wolniej o'}</small><b>${secs(Math.abs(op.ms - me.ms))} s</b></div>`;
    }
    return `<section class="cards" aria-label="Wyniki">
      <div class="pcard slot${meWin ? ' winner' : ''}" style="--c:${color(me.slot)}">
        <div class="lbl"><span>TY · ${esc(me.nick.toUpperCase())}</span>${meWin ? TROPHY : ''}</div>
        <span class="time">${fmtTime(me.ms!)}</span>
        <span class="sub">perfekt ${me.perfects}/${CFG.holds}</span>${this.verifyHtml()}</div>
      ${mid}${opCard(op)}</section>`;
  }

  private roundTable(st: Standing[]): string {
    const rows = st
      .map((s, i) => {
        const time = s.ms === null ? (s.left ? 'wyszedł' : '—') : s.valid ? `${secs(s.ms)} s` : 'odrzucony';
        const extra = s.me ? this.verifyHtml().replace(/<[^>]+>/g, '') : s.ms !== null && s.valid ? `perfekt ${s.perfects}` : '';
        return `<tr class="${s.me ? 'mine' : ''} ${i === 0 && s.valid ? 'gold' : ''}"><td class="pl">${i + 1}.</td>
          <td><span class="dot" style="background:${color(s.slot)}"></span>${esc(s.nick)}${s.me ? ' (Ty)' : ''}</td>
          <td class="s">${esc(extra)}</td><td class="t">${time}</td></tr>`;
      })
      .join('');
    return `<div class="tbl"><h2>WYNIKI RUNDY ${this.round}</h2><table>${rows}</table></div>`;
  }

  private sessionTable(): string {
    const rows = [...this.session.entries()]
      .sort((a, b) => b[1].wins - a[1].wins || (a[1].best ?? Infinity) - (b[1].best ?? Infinity))
      .map(
        ([id, r], i) => `<tr class="${id === this.me.id ? 'mine' : ''}"><td class="pl">${i + 1}.</td>
          <td><span class="dot" style="background:${color(r.slot)}"></span>${esc(r.nick)}</td>
          <td class="s">${r.wins} ${r.wins === 1 ? 'wygrana' : 'wygr.'} · ${r.rounds} rund</td>
          <td class="t">${r.best === null ? '—' : `${secs(r.best)} s`}</td></tr>`,
      )
      .join('');
    return `<div class="tbl"><h2>RANKING POKOJU · NAJLEPSZE CZASY</h2>${rows ? `<table>${rows}</table>` : '<p class="empty">Jeszcze nikt nie ukończył rundy.</p>'}</div>`;
  }

  private accountLine(): string {
    if (!accountsEnabled || !USE_SUPABASE) return '';
    const acc = getAccount();
    if (!acc) return 'Grasz jako gość – zaloguj się w menu, a Twoje czasy trafią do rankingu.';
    if (this.myRecord?.best != null) {
      return `Twój rekord: <b>${secs(this.myRecord.best)} s</b>${this.myRecord.place ? ` · miejsce <b>#${this.myRecord.place}</b> w rankingu` : ''}`;
    }
    return '';
  }

  private studioHtml(): string {
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
      const label = place === 1 ? 'WYGRANA!' : draw ? 'REMIS' : st.length === 2 ? 'PRZEGRANA' : `${place}. MIEJSCE`;
      const cls = place === 1 ? 'win' : draw ? 'draw' : 'lose';
      head = `<div class="result-banner ${cls}">${label}</div>`;
      body =
        st.length === 2
          ? `${this.resultCards(st)}<div class="panels">${this.sessionTable()}</div>`
          : `<div class="panels">${this.roundTable(st)}${this.sessionTable()}</div>`;
    } else {
      body = this.lobbyCards() + (this.session.size ? `<div class="panels">${this.sessionTable()}</div>` : '');
    }

    const readyLabel = this.me.ready ? (results ? 'Anuluj rewanż' : 'Anuluj gotowość') : results ? 'Rewanż!' : 'Gotowy!';
    const readyBtn = full
      ? ''
      : `<button class="btn ${this.me.ready ? 'green' : 'blue'} grow" data-action="ready" ${alone ? 'disabled' : ''}>${readyLabel}</button>`;
    const middle = `<div class="code-box"><div class="lbl"><small>KOD POKOJU · ${a.length}/${MAX_PLAYERS}</small><b>${esc(this.code)}</b></div><button data-action="copy">Kopiuj link</button></div>`;

    const hints: string[] = [];
    if (!this.connected) hints.push('Łączenie…');
    if (full) hints.push(`<span class="err">Pokój jest pełny (max ${MAX_PLAYERS} graczy).</span>`);
    else if (alone) hints.push(`Wyślij link – do pokoju wejdzie do ${MAX_PLAYERS} osób. Start, gdy wszyscy będą gotowi.`);
    else {
      const notReady = a.filter((p) => !p.ready).length;
      hints.push(notReady ? `Start, gdy wszyscy będą gotowi (czeka: ${notReady}) · Spacja = gotowy` : 'Startujemy!');
    }
    if (this.phase === 'lobby' && this.participants.length && !this.participants.includes(this.me.id)) hints.push('Trwa runda – dołączysz do następnej.');
    const acct = results ? this.accountLine() : '';

    return `<div class="dim"></div><div class="studio">
      ${belka(results ? `runda ${this.round} · pokój ${this.code}` : `pokój ${this.code}`)}
      ${head}
      ${body}
      <section class="actions">
        <div class="abar">${readyBtn}${middle}<button class="btn ghost" data-action="leave">Wyjdź</button></div>
        ${hints.map((h) => `<p class="hint">${h}</p>`).join('')}
        ${acct ? `<p class="hint small">${acct}</p>` : ''}
        ${MODE_NOTE ? `<p class="hint small">${esc(MODE_NOTE)}</p>` : ''}
      </section>
    </div>`;
  }

  handleAction(action: string, el: HTMLElement) {
    if (action === 'ready') this.toggleReady();
    else if (action === 'leave') location.hash = '#/';
    else if (action === 'copy') {
      const link = `${location.origin}${location.pathname}${location.search}#/r/${this.code}`;
      navigator.clipboard?.writeText(link).then(
        () => (el.textContent = 'Skopiowano!'),
        () => prompt('Skopiuj link:', link),
      );
    }
  }
}

// ---------- menu, konto, ranking ----------

type MenuView = 'main' | 'login' | 'register' | 'check' | 'ranking';
const menu = {
  view: 'main' as MenuView,
  busy: false,
  error: '',
  email: '',
  nick: '',
  ranking: null as LeaderRow[] | null,
  rankingError: '',
  myBest: null as { best: number | null; place: number | null } | null,
};

function menuHtml(): string {
  const acc = getAccount();
  const wrap = (inner: string) => `<div class="dim"></div><div class="studio">${belka('wspinaczka na czas · do 6 graczy')}${inner}</div>`;
  const err = menu.error ? `<p class="msg err">${esc(menu.error)}</p>` : '';
  const dis = menu.busy ? 'disabled' : '';

  if (menu.view === 'login') {
    return wrap(`<div class="form" role="form" aria-label="Logowanie">
      <h2>Zaloguj się</h2>
      <label>E-mail<input id="f-email" type="email" autocomplete="email" value="${esc(menu.email)}" data-enter="do-login"></label>
      <label>Hasło<input id="f-pass" type="password" autocomplete="current-password" data-enter="do-login"></label>
      ${err}
      <button class="btn blue" data-action="do-login" ${dis}>${menu.busy ? 'Logowanie…' : 'Zaloguj'}</button>
      <div class="row2"><button class="linkbtn" data-action="view-register">Nie masz konta? Załóż</button><button class="linkbtn" data-action="view-main">Wróć</button></div>
    </div>`);
  }
  if (menu.view === 'register') {
    return wrap(`<div class="form" role="form" aria-label="Rejestracja">
      <h2>Załóż konto</h2>
      <label>Nick (widoczny w rankingu)<input id="f-nick" maxlength="16" autocomplete="nickname" value="${esc(menu.nick || getNick())}" data-enter="do-register"></label>
      <label>E-mail<input id="f-email" type="email" autocomplete="email" value="${esc(menu.email)}" data-enter="do-register"></label>
      <label>Hasło (min. 6 znaków)<input id="f-pass" type="password" autocomplete="new-password" data-enter="do-register"></label>
      ${err}
      <button class="btn blue" data-action="do-register" ${dis}>${menu.busy ? 'Zakładanie…' : 'Załóż konto'}</button>
      <div class="row2"><button class="linkbtn" data-action="view-login">Mam konto – zaloguj</button><button class="linkbtn" data-action="view-main">Wróć</button></div>
    </div>`);
  }
  if (menu.view === 'check') {
    return wrap(`<div class="form">
      <h2>Sprawdź skrzynkę</h2>
      <p class="msg ok">Wysłaliśmy link aktywacyjny na <b>${esc(menu.email)}</b>. Kliknij go – wrócisz do gry już zalogowany.</p>
      <p class="msg">Nie widzisz wiadomości? Zajrzyj do spamu.</p>
      <button class="btn ghost" data-action="view-main">Wróć do menu</button>
    </div>`);
  }
  if (menu.view === 'ranking') {
    const rows = menu.ranking;
    const table = menu.rankingError
      ? `<p class="empty err">${esc(menu.rankingError)}</p>`
      : rows === null
        ? '<p class="empty">Wczytywanie…</p>'
        : rows.length === 0
          ? '<p class="empty">Ranking jest jeszcze pusty – bądź pierwszy!</p>'
          : `<table>${rows
              .map(
                (r, i) => `<tr class="${acc?.userId === r.user_id ? 'mine' : ''} ${i < 3 ? 'gold' : ''}"><td class="pl">${i + 1}.</td><td>${esc(r.nick)}</td>
                <td class="s">${new Date(r.achieved_at).toLocaleDateString('pl-PL')}</td><td class="t">${secs(r.best_ms)} s</td></tr>`,
              )
              .join('')}</table>`;
    const mine = acc
      ? menu.myBest?.best != null
        ? `<p class="hint small">Twój rekord: <b>${secs(menu.myBest.best)} s</b>${menu.myBest.place ? ` · miejsce #${menu.myBest.place}` : ''}</p>`
        : '<p class="hint small">Nie masz jeszcze zweryfikowanego czasu – zagraj rundę!</p>'
      : '<p class="hint small">Zaloguj się, żeby Twoje czasy trafiały do rankingu.</p>';
    return wrap(`<div class="tbl wide"><h2>RANKING OGÓLNY · NAJLEPSZE CZASY</h2>${table}</div>${mine}
      <button class="btn ghost" data-action="view-main">Wróć</button>`);
  }

  const acctBar = !accountsEnabled
    ? ''
    : acc
      ? `<div class="acct-bar">Zalogowano jako <b>${esc(acc.nick)}</b><button class="linkbtn" data-action="view-ranking">Ranking</button><button class="linkbtn" data-action="logout">Wyloguj</button></div>`
      : `<div class="acct-bar">Grasz jako gość<button class="linkbtn" data-action="view-login">Zaloguj się</button><button class="linkbtn" data-action="view-register">Załóż konto</button><button class="linkbtn" data-action="view-ranking">Ranking</button></div>`;
  const nickField = acc
    ? `<div class="row"><span class="name">${esc(acc.nick)}</span><span class="acct">KONTO ✓</span></div><span class="sub">Twoje czasy trafiają do rankingu.</span>`
    : `<label>Twój nick<input id="nick" maxlength="16" value="${esc(getNick())}" autocomplete="off" spellcheck="false"></label>`;
  return wrap(`
    <section class="cards" aria-label="Gracze">
      <div class="pcard slot" style="--c:${color(0)}"><div class="lbl"><span>TY</span></div>${nickField}</div>
      <div class="vs">VS</div>
      <div class="pcard empty"><div class="lbl"><span>PRZECIWNICY</span></div>
        <span class="name">Wolne tory</span><span class="sub">Utwórz pokój i wyślij link – zagra do ${MAX_PLAYERS} osób.</span></div>
    </section>
    <section class="actions">
      <div class="abar">
        <button class="btn blue grow" data-action="create">Utwórz pokój</button>
        <span class="or">lub</span>
        <label class="sr" for="join-code">Kod pokoju</label>
        <input id="join-code" class="code-in" placeholder="KOD" maxlength="8" autocomplete="off" spellcheck="false" data-enter="join">
        <button class="btn orange" data-action="join">Dołącz</button>
      </div>
      ${acctBar}
      <p class="hint">Pierścień na <span class="blue">niebieskim</span> chwycie → gdy się zamknie, wciśnij ← / → (A / D) → liczy się Twój czas</p>
      <p class="hint small">${esc(MODE_NOTE || 'Online: Supabase Realtime ✓')}</p>
      ${footerLinksHtml()}
    </section>`);
}

function renderMenu() {
  if (!room) $('overlay').innerHTML = menuHtml();
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

async function menuAction(action: string) {
  menu.error = '';
  switch (action) {
    case 'create':
      readNick();
      location.hash = `#/r/${roomCode()}`;
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
      menu.email = val('f-email') || menu.email;
      menu.view = action.slice(5) as MenuView;
      renderMenu();
      return;
    case 'view-ranking':
      void openRanking();
      return;
    case 'logout':
      await signOut();
      renderMenu();
      return;
    case 'do-login': {
      menu.email = val('f-email').trim();
      const pass = val('f-pass');
      if (!menu.email || !pass) {
        menu.error = 'Podaj e-mail i hasło.';
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
        menu.error = 'Podaj nick, e-mail i hasło (min. 6 znaków).';
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
  }
}

// ---------- aplikacja / routing / pętla ----------

let room: Room | null = null;

function route() {
  const m = location.hash.match(/^#\/r\/([A-Za-z0-9]{4,8})$/);
  if (m) {
    const code = m[1].toUpperCase();
    if (room?.code === code) return;
    room?.destroy();
    room = new Room(code);
    if (import.meta.env.DEV) (window as unknown as { __room: Room }).__room = room; // tylko do debugowania
  } else if (/^#\/info\/[a-z-]+$/.test(location.hash) && isInfoPage(location.hash.slice(7))) {
    room?.destroy();
    room = null;
    $('overlay').innerHTML = infoHtml(location.hash.slice(7));
    $('overlay').querySelector('.studio')?.scrollTo(0, 0);
  } else {
    if (location.hash.includes('access_token') || location.hash.includes('error_description')) return; // obsłuży Supabase Auth
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
  if (!room && menu.view === 'main') renderMenu();
});
initAccounts();
window.addEventListener('hashchange', route);
route();
requestAnimationFrame(loop);
