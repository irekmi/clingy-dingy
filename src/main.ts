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
import { ClimbView, fmtTime } from './game/render';
import { LocalTransport } from './net/localTransport';
import { SupabaseTransport, submitResult, supabaseConfigured } from './net/supabase';
import type { PlayerMeta, RoomTransport } from './net/transport';
import { cleanNick, esc, randomId, roomCode, ROOM_CODE_RE } from './util';

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

const MODE_NOTE = USE_SUPABASE
  ? ''
  : 'Tryb lokalny (bez serwera): drugi gracz otwiera link w drugim oknie tej samej przeglądarki.';

const belka = (sub: string) => `
  <header class="belka">
    <div class="tor me"><small>TOR</small>1</div>
    <div class="title"><h1>CLINGY DINGY</h1><span>${esc(sub)}</span></div>
    <div class="tor opp"><small>TOR</small>2</div>
  </header>`;

const TROPHY = `<svg width="28" height="28" viewBox="0 0 30 30" role="img" aria-label="Zwycięzca"><path d="M8 4 H22 V11 Q22 18 15 18 Q8 18 8 11 Z" fill="#f2c94c" stroke="#a37a12" stroke-width="2"></path><path d="M8 7 H4 Q4 13 9 13 M22 7 H26 Q26 13 21 13" fill="none" stroke="#f2c94c" stroke-width="2.5"></path><rect x="13" y="18" width="4" height="5" fill="#f2c94c"></rect><rect x="9" y="23" width="12" height="4" rx="1.5" fill="#f2c94c" stroke="#a37a12" stroke-width="1.5"></rect></svg>`;

// ---------- scena (dwie połówki) i HUD ----------

const stage = { me: new ClimbView($<HTMLCanvasElement>('cv-me')), opp: new ClimbView($<HTMLCanvasElement>('cv-opp')) };
const IDLE_ROUTE = routeFor('clingy-dingy-menu');
let hudLayoutKey = '';

/** HUD ma się zmieścić w przerwie między ścianami; jeśli jej nie ma (telefon) – idzie na dół. */
function layoutHud() {
  const m = stage.me.metrics;
  const gap = m.width + 4 - m.wallPx;
  const game = $('game');
  let width: number;
  let bottom = false;
  if (gap >= 230) width = Math.min(328, Math.floor(gap - 12));
  else {
    bottom = true;
    width = Math.min(328, window.innerWidth - 24);
  }
  const key = `${width}|${bottom}`;
  if (key === hudLayoutKey) return;
  hudLayoutKey = key;
  game.style.setProperty('--belka-w', `${width}px`);
  game.classList.toggle('hud-bottom', bottom);
  game.classList.toggle('hud-compact', width < 260);
}

function setText(id: string, text: string) {
  const el = $(id);
  if (el.textContent !== text) el.textContent = text;
}

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
  perfects: 0,
  left: false,
});

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
  private opp = freshOpp();
  private usedTokens = new Set<string>();
  private verify: 'off' | 'pending' | 'ok' | 'bad' | 'error' = 'off';
  private lastSent = { hold: -1, fbAt: -1, at: 0 };
  private wins = { me: 0, opp: 0 };
  private connected = false;
  private error = '';
  private overlayKey = '';

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
    stage.me.reset();
    stage.opp.reset();
    this.refresh();
  }

  destroy() {
    window.removeEventListener('keydown', this.onKey);
    $('panel-me').removeEventListener('pointerdown', this.onPointer);
    this.t.close();
    $('hud').classList.add('hidden');
    stage.me.reset();
    stage.opp.reset();
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
    this.round++;
    this.route = routeFor(p.m);
    this.sim = initState();
    this.inputs = [];
    this.myMs = null;
    this.verify = 'off';
    this.opp = freshOpp(this.opp.nick);
    this.lastSent = { hold: -1, fbAt: -1, at: 0 };
    this.me = { ...this.me, ready: null };
    this.t.setMeta(this.me);
    stage.me.reset();
    stage.opp.reset();
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
    let perfects = 0;
    try {
      const s = replay(this.route, p.inputs);
      valid = s.finishedAt === p.ms;
      perfects = s.perfects;
    } catch {
      valid = false;
    }
    this.opp.ms = p.ms;
    this.opp.valid = valid;
    this.opp.perfects = perfects;
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
    const inMatch = this.phase !== 'lobby' && this.matchId !== '';
    stage.me.draw(
      {
        route: this.route,
        hold: disp.hold,
        feedback: inMatch ? disp.last : 'none',
        feedbackAge: racing || this.phase === 'finished' ? (this.myMs ?? t) - disp.lastAt : 1e9,
        ring,
        showHints: racing || this.phase === 'countdown',
        look: 'me',
        present: true,
        finished: this.myMs !== null,
      },
      now,
      dt,
    );

    const o = this.opp;
    const opp = this.opponent();
    stage.opp.draw(
      {
        route: this.route,
        hold: inMatch ? o.hold : 0,
        feedback: inMatch ? o.fb : 'none',
        feedbackAge: o.fbRecv ? now - o.fbRecv : 1e9,
        ring: null,
        showHints: false,
        look: 'opp',
        present: !!opp && !o.left,
        finished: o.ms !== null,
      },
      now,
      dt,
    );
    this.updateHud(now, t, disp);
  }

  private updateHud(now: number, t: number, disp: SimState) {
    const show = this.phase === 'countdown' || this.phase === 'race' || this.phase === 'finished';
    $('hud').classList.toggle('hidden', !show);
    if (!show) return;
    const o = this.opp;
    const myTime = this.myMs ?? (this.phase === 'race' ? t : 0);
    const oppTime = o.ms ?? (o.recvAt > 0 ? o.elapsed + (now - o.recvAt) : 0);
    setText('hud-me-name', this.me.nick);
    setText('hud-me-sub', `${disp.hold} m${disp.combo > 1 ? ` · ×${disp.combo}` : ''}`);
    setText('hud-time', (myTime / 1000).toFixed(2));
    setText('hud-op-name', o.nick || 'Przeciwnik');
    setText('hud-op-sub', o.left ? 'wyszedł' : `${o.hold} m · ${(oppTime / 1000).toFixed(2)}`);
    $('bar-me').style.width = `${(disp.hold / CFG.holds) * 100}%`;
    $('bar-op').style.width = `${(o.hold / CFG.holds) * 100}%`;
  }

  // ---------- nakładki (ekrany 5C) ----------

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
      case 'finished':
        return `<div class="banner"><span>Szczyt! <b>${fmtTime(this.myMs!)}</b> – czekam na przeciwnika…</span></div>`;
      default:
        return this.studioHtml();
    }
  }

  private studioHtml(): string {
    const results = this.phase === 'results';
    const r = results ? this.outcome() : null;
    const opp = this.opponent();
    const o = this.opp;
    const full = !this.inRoom();

    const meReady = this.me.ready ? '<span class="badge ready">GOTOWY ✓</span>' : '<span class="badge wait">czeka…</span>';
    const oppReady = opp?.ready ? '<span class="badge ready">GOTOWY ✓</span>' : '<span class="badge wait">czeka…</span>';

    let meCard: string;
    let oppCard: string;
    let mid = '<div class="vs">VS</div>';
    if (results) {
      const verify = !USE_SUPABASE
        ? '<span class="sub">tryb lokalny</span>'
        : this.verify === 'ok'
          ? '<span class="verified">zweryfikowany ✓</span>'
          : this.verify === 'bad'
            ? '<span class="rejected">odrzucony przez serwer ✖</span>'
            : this.verify === 'error'
              ? '<span class="rejected">nie udało się zapisać wyniku</span>'
              : '<span class="sub">serwer sprawdza…</span>';
      meCard = `<div class="pcard me${r === 'win' ? ' winner' : ''}">
        <div class="lbl"><span>TY · ${esc(this.me.nick.toUpperCase())}</span>${r === 'win' ? TROPHY : ''}</div>
        <span class="time">${fmtTime(this.myMs!)}</span>
        <span class="sub">perfekt ${this.sim.perfects}/${CFG.holds} · ${meReady}</span>${verify}</div>`;
      const oTime = o.ms === null ? '—' : fmtTime(o.ms);
      const oState = o.ms === null ? (o.left ? 'opuścił grę' : '') : o.valid ? '<span class="verified">sprawdzony ✓</span>' : '<span class="rejected">wynik odrzucony ✖</span>';
      oppCard = `<div class="pcard opp${r === 'lose' ? ' winner' : ''}">
        <div class="lbl"><span>PRZECIWNIK · ${esc((o.nick || '?').toUpperCase())}</span>${r === 'lose' ? TROPHY : ''}</div>
        <span class="time">${oTime}</span>
        <span class="sub">${o.ms !== null ? `perfekt ${o.perfects}/${CFG.holds}` : ''}${opp ? ` · ${oppReady}` : ''}</span>${oState}</div>`;
      if (o.ms !== null && o.valid && r !== 'draw') {
        mid = `<div class="vs"><small>${r === 'win' ? 'szybciej o' : 'wolniej o'}</small><b>${(Math.abs(o.ms - this.myMs!) / 1000).toFixed(2)} s</b></div>`;
      }
    } else {
      meCard = `<div class="pcard me"><div class="lbl"><span>TY</span></div>
        <div class="row"><span class="name">${esc(this.me.nick)}</span>${meReady}</div>
        <span class="sub">Bilans: ${this.wins.me}</span></div>`;
      oppCard = opp
        ? `<div class="pcard opp"><div class="lbl"><span>PRZECIWNIK</span></div>
          <div class="row"><span class="name">${esc(opp.nick)}</span>${oppReady}</div>
          <span class="sub">Bilans: ${this.wins.opp}</span></div>`
        : `<div class="pcard empty"><div class="lbl"><span>PRZECIWNIK</span></div>
          <span class="name">Wolny tor</span><span class="sub">Wyślij link drugiej osobie.</span></div>`;
    }

    const alone = !opp;
    const readyLabel = this.me.ready ? (results ? 'Anuluj rewanż' : 'Anuluj gotowość') : results ? 'Rewanż!' : 'Gotowy!';
    const readyBtn = full
      ? ''
      : `<button class="btn ${this.me.ready ? 'green' : 'blue'} grow" data-action="ready" ${alone ? 'disabled' : ''}>${readyLabel}</button>`;
    const middle = results
      ? `<div class="score"><small>BILANS</small><b><span style="color:#8fb6ea">${this.wins.me}</span> : <span style="color:#f4a57d">${this.wins.opp}</span></b></div>`
      : `<div class="code-box"><div class="lbl"><small>KOD POKOJU</small><b>${esc(this.code)}</b></div><button data-action="copy">Kopiuj link</button></div>`;

    const hints: string[] = [];
    if (!this.connected) hints.push('Łączenie…');
    if (full) hints.push('<span class="err">Pokój jest pełny (max 2 graczy).</span>');
    else if (alone) hints.push('Wyślij link drugiej osobie – start, gdy obaj będziecie gotowi.');
    else if (results && opp?.ready && !this.me.ready) hints.push(`${esc(opp.nick)} czeka na rewanż`);
    else hints.push('Start, gdy obaj będziecie gotowi · Spacja = gotowy');

    return `<div class="dim"></div><div class="studio">
      ${belka(results ? `runda ${this.round} · pokój ${this.code}` : `pokój ${this.code}`)}
      ${r ? `<div class="result-banner ${r}">${r === 'win' ? 'WYGRANA!' : r === 'lose' ? 'PRZEGRANA' : 'REMIS'}</div>` : ''}
      <section class="cards" aria-label="Gracze">${meCard}${mid}${oppCard}</section>
      <section class="actions">
        <div class="abar">${readyBtn}${middle}<button class="btn ghost" data-action="leave">Wyjdź</button></div>
        ${hints.map((h) => `<p class="hint">${h}</p>`).join('')}
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

// ---------- menu (ekran startowy 5C) ----------

function menuHtml(): string {
  return `<div class="dim"></div><div class="studio">
    ${belka('wspinaczka na czas · 1 na 1')}
    <section class="cards" aria-label="Gracze">
      <div class="pcard me"><div class="lbl"><span>TY</span></div>
        <label>Twój nick<input id="nick" maxlength="16" value="${esc(getNick())}" autocomplete="off" spellcheck="false"></label></div>
      <div class="vs">VS</div>
      <div class="pcard empty"><div class="lbl"><span>PRZECIWNIK</span></div>
        <span class="name">Wolny tor</span><span class="sub">Utwórz pokój i wyślij link znajomemu.</span></div>
    </section>
    <section class="actions">
      <div class="abar">
        <button class="btn blue grow" data-action="create">Utwórz pokój</button>
        <span class="or">lub</span>
        <label class="sr" for="join-code">Kod pokoju</label>
        <input id="join-code" class="code-in" placeholder="KOD" maxlength="8" autocomplete="off" spellcheck="false">
        <button class="btn orange" data-action="join">Dołącz</button>
      </div>
      <p class="hint">Pierścień na <span class="blue">niebieskim</span> chwycie → gdy się zamknie, wciśnij ← / → (A / D) → liczy się Twój czas</p>
      <p class="hint small">${esc(MODE_NOTE || 'Online: Supabase Realtime ✓')}</p>
    </section>
  </div>`;
}

function readNick() {
  const input = document.getElementById('nick') as HTMLInputElement | null;
  const n = cleanNick(input?.value) || getNick();
  saveNick(n);
}

function menuAction(action: string) {
  if (action === 'create') {
    readNick();
    location.hash = `#/r/${roomCode()}`;
  } else if (action === 'join') {
    const input = document.getElementById('join-code') as HTMLInputElement | null;
    const code = (input?.value ?? '').trim().toUpperCase();
    if (!ROOM_CODE_RE.test(code)) {
      input?.classList.add('bad');
      input?.focus();
      return;
    }
    readNick();
    location.hash = `#/r/${code}`;
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
  } else {
    room?.destroy();
    room = null;
    $('overlay').innerHTML = menuHtml();
  }
}

let last = performance.now();
function loop(now: number) {
  requestAnimationFrame(loop);
  const dt = Math.min(100, now - last);
  last = now;
  if (room) room.frame(now, dt);
  else {
    for (const [view, look] of [
      [stage.me, 'me'],
      [stage.opp, 'opp'],
    ] as const) {
      view.draw(
        { route: IDLE_ROUTE, hold: 0, feedback: 'none', feedbackAge: 1e9, ring: null, showHints: false, look, present: true, finished: false },
        now,
        dt,
      );
    }
  }
  layoutHud();
}

const overlay = $('overlay');
overlay.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
  if (!el || (el as HTMLButtonElement).disabled) return;
  const action = el.dataset.action!;
  if (room) room.handleAction(action, el);
  else menuAction(action);
});
overlay.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement;
  if (e.key === 'Enter' && target.id === 'join-code') menuAction('join');
  if (e.key === 'Enter' && target.id === 'nick') menuAction('create');
});
overlay.addEventListener('change', (e) => {
  const target = e.target as HTMLInputElement;
  if (target.id === 'nick') {
    const n = cleanNick(target.value);
    target.value = n;
    if (n) saveNick(n);
  }
});

window.addEventListener('hashchange', route);
route();
requestAnimationFrame(loop);
