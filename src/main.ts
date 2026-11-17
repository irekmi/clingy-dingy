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
import { ClimbView, fmtTime } from './game/render';
import { LocalTransport } from './net/localTransport';
import { SupabaseTransport, submitResult, supabaseConfigured } from './net/supabase';
import type { PlayerMeta, RoomTransport } from './net/transport';
import { cleanNick, esc, randomId, roomCode, ROOM_CODE_RE } from './util';

const ME_COLOR = '#7dd3fc';
const OPP_COLOR = '#fb923c';
const COUNTDOWN_MS = 3000;

const USE_SUPABASE = supabaseConfigured && !new URLSearchParams(location.search).has('local');
// nowe id przy każdym otwarciu karty (w trybie lokalnym dwie karty muszą mieć różne id)
const PLAYER_ID = randomId();

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function getNick(): string {
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

type Phase = 'lobby' | 'countdown' | 'race' | 'finished' | 'results';

interface OppState {
  nick: string;
  hold: number;
  fb: Feedback;
  fbAt: number; // znacznik feedbacku po stronie przeciwnika
  fbRecv: number; // kiedy u nas odebrany
  elapsed: number;
  recvAt: number;
  ms: number | null;
  valid: boolean;
  left: boolean;
}
const freshOpp = (nick = ''): OppState => ({
  nick,
  hold: 0,
  fb: 'none',
  fbAt: -1,
  fbRecv: 0,
  elapsed: 0,
  recvAt: 0,
  ms: null,
  valid: false,
  left: false,
});

class Room {
  private t: RoomTransport;
  private me: PlayerMeta;
  private players: PlayerMeta[] = [];
  private phase: Phase = 'lobby';
  private matchId = '';
  private route: Route;
  private sim: SimState = initState();
  private inputs: InputEvent[] = [];
  private goAt = 0;
  private myMs: number | null = null;
  private opp = freshOpp();
  private usedTokens = new Set<string>();
  private verify: 'off' | 'pending' | 'ok' | 'bad' | 'error' = 'off';
  private lastSent = { hold: -1, fbAt: -1, at: 0 };
  private wins = { me: 0, opp: 0 };
  private connected = false;
  private error = '';
  private raf = 0;
  private lastFrame = performance.now();
  private overlayKey = '';
  private viewMe = new ClimbView($<HTMLCanvasElement>('cv-me'));
  private viewOpp = new ClimbView($<HTMLCanvasElement>('cv-opp'));

  constructor(readonly code: string) {
    this.route = routeFor(`lobby-${code}`);
    this.me = { id: PLAYER_ID, nick: getNick(), ready: null, joinedAt: Date.now() };
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
    window.addEventListener('keydown', this.onKey);
    $('panel-me').addEventListener('pointerdown', this.onPointer);
    this.raf = requestAnimationFrame(this.frame);
    this.refresh();
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKey);
    $('panel-me').removeEventListener('pointerdown', this.onPointer);
    this.viewMe.destroy();
    this.viewOpp.destroy();
    this.t.close();
    $('overlay').innerHTML = '';
  }

  // ---------- gracze / lobby ----------

  private active(): PlayerMeta[] {
    return this.players.slice(0, 2);
  }
  private inRoom() {
    return this.active().some((p) => p.id === this.me.id);
  }
  private opponent(): PlayerMeta | undefined {
    return this.inRoom() ? this.active().find((p) => p.id !== this.me.id) : undefined;
  }
  private isHost() {
    return this.active()[0]?.id === this.me.id;
  }

  private onPlayers(list: PlayerMeta[]) {
    const others = list
      .filter((p) => p && p.id !== this.me.id)
      .map((p) => ({ ...p, nick: cleanNick(p.nick) || '???' }));
    this.players = [...others, this.me].sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id));
    const opp = this.opponent();
    if (opp) this.opp.nick = opp.nick;
    const midMatch = this.phase === 'countdown' || this.phase === 'race' || this.phase === 'finished';
    if (!opp && midMatch) {
      this.opp.left = true;
      if (this.phase === 'countdown') this.phase = 'lobby';
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

  /** Host startuje mecz, gdy obaj gracze są gotowi. */
  private maybeStart() {
    if (!this.connected || !this.isHost() || (this.phase !== 'lobby' && this.phase !== 'results')) return;
    const a = this.active();
    if (a.length < 2 || !a.every((p) => p.ready && !this.usedTokens.has(p.ready))) return;
    a.forEach((p) => this.usedTokens.add(p.ready!));
    const payload = { m: randomId() };
    this.t.send('start', payload);
    this.onStart(payload);
  }

  // ---------- zdarzenia sieciowe ----------

  private onStart(p: { m?: unknown }) {
    if (typeof p?.m !== 'string' || (this.phase !== 'lobby' && this.phase !== 'results')) return;
    this.matchId = p.m;
    this.route = routeFor(p.m);
    this.sim = initState();
    this.inputs = [];
    this.myMs = null;
    this.verify = 'off';
    this.opp = freshOpp(this.opp.nick);
    this.lastSent = { hold: -1, fbAt: -1, at: 0 };
    this.me = { ...this.me, ready: null };
    this.t.setMeta(this.me);
    this.viewMe.reset();
    this.viewOpp.reset();
    this.phase = 'countdown';
    // lokalne odliczanie – opóźnienie sieci wpływa tylko na moment startu, nie na zmierzony czas
    this.goAt = performance.now() + COUNTDOWN_MS;
    this.refresh();
  }

  private onPos(p: { m?: unknown; h?: unknown; f?: unknown; fa?: unknown; e?: unknown }) {
    if (p?.m !== this.matchId || typeof p.h !== 'number' || typeof p.e !== 'number') return;
    this.opp.hold = Math.max(0, Math.min(CFG.holds, Math.floor(p.h)));
    if (typeof p.fa === 'number' && p.fa !== this.opp.fbAt && typeof p.f === 'string') {
      this.opp.fb = p.f as Feedback;
      this.opp.fbAt = p.fa;
      this.opp.fbRecv = performance.now();
    }
    this.opp.elapsed = p.e;
    this.opp.recvAt = performance.now();
  }

  private onFinish(p: { m?: unknown; ms?: unknown; inputs?: unknown }) {
    if (p?.m !== this.matchId || typeof p.ms !== 'number' || this.opp.ms !== null) return;
    // weryfikacja peer-to-peer: odtwarzamy bieg przeciwnika z jego logu wciśnięć
    let valid = false;
    try {
      valid = replay(this.route, p.inputs).finishedAt === p.ms;
    } catch {
      valid = false;
    }
    this.opp.ms = p.ms;
    this.opp.valid = valid;
    this.opp.hold = CFG.holds;
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
    this.t.send('finish', { m: this.matchId, ms, inputs: this.inputs });
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
        .then((r) => (this.verify = r.valid ? 'ok' : 'bad'))
        .catch(() => (this.verify = 'error'))
        .finally(() => this.refresh());
    }
    this.maybeResults();
    this.refresh();
  }

  private maybeResults() {
    if (this.phase !== 'finished' || (this.opp.ms === null && !this.opp.left)) return;
    this.phase = 'results';
    const r = this.outcome();
    if (r === 'win') this.wins.me++;
    else if (r === 'lose') this.wins.opp++;
  }

  private outcome(): 'win' | 'lose' | 'draw' {
    const me = this.myMs!;
    const o = this.opp;
    if (o.ms === null || !o.valid) return 'win';
    if (o.ms < me) return 'lose';
    if (o.ms > me) return 'win';
    return 'draw';
  }

  private sendPos(s: SimState, t: number, now: number) {
    this.lastSent = { hold: s.hold, fbAt: s.lastAt, at: now };
    this.t.send('pos', { m: this.matchId, h: s.hold, f: s.last, fa: s.lastAt, e: t });
  }

  // ---------- pętla gry ----------

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(100, now - this.lastFrame);
    this.lastFrame = now;
    this.updatePhase(now);
    if (this.phase === 'countdown') this.refresh();

    const racing = this.phase === 'race';
    const t = Math.max(0, Math.round(now - this.goAt));
    const disp = racing ? tick(this.sim, t) : this.sim; // tylko do wyświetlania – nie zmienia this.sim
    if (racing && (disp.hold !== this.lastSent.hold || disp.lastAt !== this.lastSent.fbAt || now - this.lastSent.at > 500)) {
      this.sendPos(disp, t, now);
    }
    const ring = racing && t >= disp.cycleStart ? { p: (t - disp.cycleStart) / disp.period, dt: t - (disp.cycleStart + disp.period) } : null;
    const myTimer = this.myMs ?? (racing ? t : 0);
    this.viewMe.draw(
      {
        route: this.route,
        hold: disp.hold,
        feedback: disp.last,
        feedbackAge: racing || this.phase === 'finished' ? (this.myMs ?? t) - disp.lastAt : 1e9,
        ring,
        stunned: racing && t < disp.cycleStart,
        combo: disp.combo,
        showHints: racing || this.phase === 'countdown',
        timerMs: myTimer,
        name: `${this.me.nick} (Ty)`,
        color: ME_COLOR,
      },
      now,
      dt,
    );

    const o = this.opp;
    const oppRunning = this.matchId && this.phase !== 'lobby' && o.recvAt > 0;
    const oppTimer = o.ms ?? (oppRunning && this.phase !== 'results' ? o.elapsed + (now - o.recvAt) : 0);
    const opp = this.opponent();
    this.viewOpp.draw(
      {
        route: this.route,
        hold: o.hold,
        feedback: o.fb,
        feedbackAge: o.fbRecv ? now - o.fbRecv : 1e9,
        ring: null,
        stunned: false,
        combo: 0,
        showHints: false,
        timerMs: oppTimer,
        name: opp?.nick ?? o.nick ?? 'Przeciwnik',
        color: OPP_COLOR,
        status: o.left ? 'opuścił grę' : !opp ? 'czekam na przeciwnika…' : o.ms !== null ? 'na szczycie!' : undefined,
      },
      now,
      dt,
    );
  };

  // ---------- nakładka UI ----------

  private refresh() {
    const ov = $('overlay');
    const html = this.overlayHtml();
    if (html === this.overlayKey) return;
    this.overlayKey = html;
    ov.innerHTML = html;
    ov.classList.toggle('empty', html === '');
  }

  private overlayHtml(): string {
    if (this.error) {
      return `<div class="card"><p class="err">${esc(this.error)}</p><button data-action="leave">Wróć</button></div>`;
    }
    switch (this.phase) {
      case 'countdown': {
        const n = Math.max(1, Math.ceil((this.goAt - performance.now()) / 1000));
        return `<div class="count">${n}</div>`;
      }
      case 'race':
        return '';
      case 'finished':
        return `<div class="banner">Szczyt! <b>${fmtTime(this.myMs!)}</b> – czekam na przeciwnika…</div>`;
      default:
        return `<div class="card">${this.phase === 'results' ? this.resultsHtml() : ''}${this.lobbyHtml()}</div>`;
    }
  }

  private resultsHtml(): string {
    const r = this.outcome();
    const title = r === 'win' ? 'Wygrana! 🏆' : r === 'lose' ? 'Przegrana' : 'Remis';
    const o = this.opp;
    const oppTime = o.ms === null ? (o.left ? 'opuścił grę' : '—') : o.valid ? fmtTime(o.ms) : `${fmtTime(o.ms)} ✖ odrzucony`;
    const verify =
      this.verify === 'pending'
        ? 'Serwer sprawdza wynik…'
        : this.verify === 'ok'
          ? 'Serwer: wynik zweryfikowany ✔'
          : this.verify === 'bad'
            ? 'Serwer: wynik odrzucony ✖'
            : this.verify === 'error'
              ? 'Serwer: nie udało się zapisać wyniku'
              : '';
    return `
      <h2 class="${r}">${title}</h2>
      <table class="res">
        <tr><td class="me">${esc(this.me.nick)}</td><td>${fmtTime(this.myMs!)}</td><td class="muted">perfekt ${this.sim.perfects}/${CFG.holds}</td></tr>
        <tr><td class="opp">${esc(o.nick || 'Przeciwnik')}</td><td>${esc(oppTime)}</td><td></td></tr>
      </table>
      <p class="muted">Bilans: ${this.wins.me} : ${this.wins.opp}${verify ? ` · ${verify}` : ''}</p>
      <hr/>`;
  }

  private lobbyHtml(): string {
    const players = this.active()
      .map(
        (p) =>
          `<li><span class="${p.id === this.me.id ? 'me' : 'opp'}">${esc(p.nick)}${p.id === this.me.id ? ' (Ty)' : ''}</span>` +
          `<span class="${p.ready ? 'ok' : 'muted'}">${p.ready ? 'gotowy ✔' : 'czeka'}</span></li>`,
      )
      .join('');
    const alone = this.active().length < 2;
    const full = !this.inRoom();
    const btn = full
      ? ''
      : `<button class="primary" data-action="ready" ${alone ? 'disabled' : ''}>${this.me.ready ? 'Anuluj gotowość' : this.phase === 'results' ? 'Rewanż!' : 'Gotowy!'}</button>`;
    const mode =
      this.t.kind === 'local'
        ? '<p class="mode">Tryb lokalny (bez serwera): otwórz link w drugim oknie <b>tej samej</b> przeglądarki.</p>'
        : '';
    return `
      <div class="room">Pokój <b>${esc(this.code)}</b> <button data-action="copy" class="small">Kopiuj link</button></div>
      ${this.connected ? '' : '<p class="muted">Łączenie…</p>'}
      <ul class="players">${players}</ul>
      ${full ? '<p class="err">Pokój jest pełny (max 2 graczy).</p>' : ''}
      ${alone && !full ? '<p class="muted">Wyślij link drugiej osobie – gra startuje, gdy obaj klikniecie „Gotowy”.</p>' : ''}
      ${btn}
      <button data-action="leave" class="ghost">Wyjdź</button>
      ${mode}`;
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

// ---------- aplikacja / routing ----------

let room: Room | null = null;

function showScreen(id: 'menu' | 'game') {
  $('menu').classList.toggle('hidden', id !== 'menu');
  $('game').classList.toggle('hidden', id !== 'game');
}

function route() {
  const m = location.hash.match(/^#\/r\/([A-Za-z0-9]{4,8})$/);
  if (m) {
    const code = m[1].toUpperCase();
    if (room?.code === code) return;
    room?.destroy();
    showScreen('game');
    room = new Room(code);
    if (import.meta.env.DEV) (window as unknown as { __room: Room }).__room = room; // tylko do debugowania
  } else {
    room?.destroy();
    room = null;
    showScreen('menu');
  }
}

function initMenu() {
  const nick = $<HTMLInputElement>('nick');
  nick.value = getNick();
  nick.addEventListener('change', () => {
    const n = cleanNick(nick.value);
    nick.value = n;
    if (n) saveNick(n);
  });
  const ensureNick = () => {
    const n = cleanNick(nick.value) || getNick();
    saveNick(n);
  };
  $('btn-create').addEventListener('click', () => {
    ensureNick();
    location.hash = `#/r/${roomCode()}`;
  });
  const join = () => {
    const code = $<HTMLInputElement>('join-code').value.trim().toUpperCase();
    if (!ROOM_CODE_RE.test(code)) {
      $<HTMLInputElement>('join-code').classList.add('bad');
      return;
    }
    ensureNick();
    location.hash = `#/r/${code}`;
  };
  $('btn-join').addEventListener('click', join);
  $('join-code').addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') join();
  });
  $('mode-info').innerHTML = USE_SUPABASE
    ? 'Online: Supabase Realtime ✔'
    : 'Tryb lokalny (brak konfiguracji Supabase) – gra w dwóch oknach tej samej przeglądarki.';

  $('overlay').addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (el && room) room.handleAction(el.dataset.action!, el);
  });
}

initMenu();
window.addEventListener('hashchange', route);
route();
