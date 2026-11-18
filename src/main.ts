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
  accountPending,
  fetchFastest,
  fetchMatchReward,
  fetchMyWins,
  fetchProfileData,
  fetchWins,
  type ProfileData,
  type RankRow,
  buyCelebration,
  CELEB_PRICE,
  equipCelebration,
  getWallet,
  myCelebration,
  onWalletChange,
  refreshWallet,
  rpcCode,
  saveOutfitRemote,
  accountsEnabled,
  changeNick,
  fetchMyBest,
  getAccount,
  initAccounts,
  onAccountChange,
  onAccountReady,
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
import { CELEBRATIONS, ClimbView, DEFAULT_OUTFIT, drawClimberPreview, MAX_PLAYERS, OUTFIT_OPTIONS, PLAYER_COLORS, PLAYER_HAIR, sanitizeOutfit, shade, type Celebration, type Outfit } from './game/render';
import { getMyOutfit, OPTION_NAMES, PART_LABELS, saveMyOutfit } from './outfit';
import { INFO_LINKS, infoHtml, isInfoPage } from './pages';
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

/** 1st, 2nd, 3rd… */
const ord = (n: number) => `${n}${['TH', 'ST', 'ND', 'RD'][n % 10 > 3 || Math.floor((n % 100) / 10) === 1 ? 0 : n % 10]}`;

/** avatar: hair colour (background) + shirt (bottom stripe), the colours of the player's look */
const ava = (slot: number, sm = false, o: Outfit | null = null) =>
  `<span class="ava${sm ? ' sm' : ''}" style="--shirt:${o?.shirt ?? color(slot)};--hair:${o?.hair ?? PLAYER_HAIR[Math.max(0, slot) % PLAYER_HAIR.length]}"></span>`;

const svg = (inner: string, size = 20) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
const ICON_TROPHY = svg('<path d="M8 4h8v6a4 4 0 0 1-8 0z"/><path d="M8 6H4a3 3 0 0 0 4 4M16 6h4a3 3 0 0 1-4 4M12 14v4M8 20h8"/>');
const ICON_HELP = svg('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01"/>');
const ICON_GEAR = svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>');
const ICON_INFO = svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>', 18);

/** a note for guests (no session); nothing for a logged-in player */
const guestNote = (text: string) =>
  accountsEnabled && !accountPending() && !getAccount()
    ? `<div class="guest-note">${ICON_INFO}<span>${esc(text)}</span><a role="button" tabindex="0" data-action="view-login">Log in</a></div>`
    : '';

/** touch pads disappear once the player has finished three climbs */
const PADS_KEY = 'cd_pads_v1';
function padsDone(): number {
  try {
    return Number(localStorage.getItem(PADS_KEY)) || 0;
  } catch {
    return 0;
  }
}
function bumpPads() {
  try {
    localStorage.setItem(PADS_KEY, String(padsDone() + 1));
  } catch {
    /* ignore */
  }
}

function setTextEl(el: HTMLElement, text: string) {
  if (el.textContent !== text) el.textContent = text;
}

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
  tagHtml: string;
  view: ClimbView;
}
const oppPanels = new Map<string, OppPanel>();

/** Phone portrait: only my own wall; the others are shown as ranking capsules. */
const PHONE = window.matchMedia('(max-width: 640px)');
$('game').classList.toggle('touch', window.matchMedia('(pointer: coarse)').matches);

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
      tag.className = 'race-tag';
      el.append(cv, tag);
      grid.append(el);
      p = { el, tag, tagHtml: '', view: new ClimbView(cv) };
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
  let width: number;
  let bottom = false;
  let left = '50%';
  let space = 0;
  if (game.classList.contains('phone') || game.classList.contains('solo')) {
    width = window.innerWidth - 16;
  } else {
    const a = $('panel-me').getBoundingClientRect();
    width = 170;
    left = `${Math.round(a.left + a.width / 2)}px`;
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
  private reward: number | null = null;
  private rewardState: 'off' | 'wait' | 'done' = 'off';
  /** outfits of the others (from Presence, sanitized); kept after a player leaves */
  private outfits = new Map<string, Outfit | null>();
  private celebs = new Map<string, Celebration>();
  private celebOf(id: string): Celebration {
    return id === this.me.id ? myCelebration() : (this.celebs.get(id) ?? 'clap');
  }
  private offWallet: () => void;
  private outfitOf(id: string): Outfit | null {
    return id === this.me.id ? getMyOutfit() : (this.outfits.get(id) ?? null);
  }

  /** `solo`: one-player run (no room, no opponents) – starts at once and can be retried endlessly */
  constructor(
    readonly code: string,
    readonly solo = false,
  ) {
    this.route = routeFor(`lobby-${code}`);
    this.me = { id: PLAYER_ID, nick: getNick(), ready: null, joinedAt: Date.now(), acct: !!getAccount(), outfit: getMyOutfit(), celebration: myCelebration() };
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
    this.offWallet = onWalletChange(() => {
      if (this.me.celebration === myCelebration()) return;
      this.me = { ...this.me, celebration: myCelebration() };
      this.t.setMeta(this.me);
    });
    this.offAccount = onAccountChange((a) => {
      this.me = { ...this.me, nick: a?.nick ?? getNick(), acct: !!a };
      this.t.setMeta(this.me);
      this.refresh();
    });
    window.addEventListener('keydown', this.onKey);
    $('panel-me').addEventListener('pointerdown', this.onPointer);
    $('game').classList.toggle('solo', solo);
    meView.playWidth = solo ? 520 : Infinity;
    meView.reset();
    this.refresh();
  }

  destroy() {
    this.dead = true;
    meView.playWidth = Infinity;
    $('game').classList.remove('solo');
    $('hud-caps').innerHTML = '';
    this.removeCount();
    this.meCap?.remove();
    $('tap-pads').style.display = 'none';
    window.removeEventListener('keydown', this.onKey);
    $('panel-me').removeEventListener('pointerdown', this.onPointer);
    this.offAccount();
    this.offWallet();
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
    for (const p of others) {
      this.outfits.set(p.id, sanitizeOutfit(p.outfit));
      this.celebs.set(p.id, CELEBRATIONS.includes(p.celebration as Celebration) ? (p.celebration as Celebration) : 'clap');
    }
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
    this.reward = null;
    this.rewardState = 'off';
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
    const side: Side = e.clientX - r.left < r.width / 2 ? 0 : 1;
    const pad = document.querySelector<HTMLElement>(`#tap-pads i.${side === 0 ? 'l' : 'r'}`);
    if (pad) {
      pad.classList.add('on');
      window.setTimeout(() => pad.classList.remove('on'), 150);
    }
    this.onInput(side, e.timeStamp);
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
    bumpPads();
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
          if (acc && r.chalkAwarded) {
            this.reward = r.chalkAwarded;
            this.rewardState = 'done';
            void refreshWallet().catch(() => {});
          }
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
    window.setTimeout(() => this.startRewardPoll(), 0);
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
        outfit: getMyOutfit(),
        celebration: myCelebration(),
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
    const lr = inMatch ? this.liveRanks(disp) : null;
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
          outfit: id === '__empty' ? null : this.outfitOf(id),
          celebration: this.celebOf(id),
        },
        now,
        dt,
      );
      const rk = lr?.get(id);
      const tagHtml =
        id === '__empty'
          ? ''
          : live && rk !== undefined
            ? `<span class="pos${rk === 0 ? ' lead' : ''}">${rk + 1}</span>${esc(o.nick)}<span class="h">${o.left ? 'left' : o.ms !== null ? `${secs(o.ms)} s` : `${o.hold}/${CFG.holds}`}</span>`
            : esc(pl?.nick ?? '');
      if (panel.tagHtml !== tagHtml) {
        panel.tagHtml = tagHtml;
        panel.tag.innerHTML = tagHtml;
      }
      const bg = color(slot);
      if (panel.tag.style.getPropertyValue('--c') !== bg) panel.tag.style.setProperty('--c', bg);
    }
    this.updateHud(now, t, disp);
    this.updateCount(now);
    this.updatePads();
  }

  private updateHud(now: number, t: number, disp: SimState) {
    const show = this.phase === 'countdown' || this.phase === 'race' || this.phase === 'finished';
    $('hud').classList.toggle('hidden', !show);
    this.updateMeCap(disp, show);
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
      box.innerHTML = `<div class="cap height mine" style="--c:0;--r:0"><i id="solo-bar"></i><b class="pos">▲</b><span class="cn">Height</span><span class="cm" id="solo-m">0 m</span></div>
        <div class="cap" style="background:#3a3d4d;--c:1;--r:0"><b class="pos">★</b><span class="cn">Best</span><span class="cm">${best === null ? '—' : secs(best) + ' s'}</span></div>`;
    }
    setText('solo-m', `${disp.hold} / ${CFG.holds} m`);
    const w = `${(disp.hold / CFG.holds) * 100}%`;
    const bar = $('solo-bar');
    if (bar.style.width !== w) bar.style.width = w;
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

  // ---------- v2: odliczanie, przyciski dotyku, kapsuła postępu ----------

  private countEl: HTMLDivElement | null = null;
  private countN = 0;
  private countGo = false;
  private meCap: HTMLDivElement | null = null;

  /** place of every participant: finished (by time) first, then by height; ties keep the start order */
  private liveRanks(disp: SimState): Map<string, number> {
    const info = this.participants.map((id, i) => {
      if (id === this.me.id) return { id, i, hold: disp.hold, ms: this.myMs, left: false };
      const o = this.opps.get(id);
      return { id, i, hold: o?.hold ?? 0, ms: o?.ms ?? null, left: !!o?.left };
    });
    info.sort((a, b) => Number(a.left) - Number(b.left) || (a.ms ?? Infinity) - (b.ms ?? Infinity) || b.hold - a.hold || a.i - b.i);
    return new Map(info.map((p, k) => [p.id, k]));
  }

  private removeCount() {
    this.countEl?.remove();
    this.countEl = null;
  }

  /** The countdown disc is created once (so the ring drains smoothly for 3 s); only the digit is swapped. */
  private updateCount(now: number) {
    const counting = this.phase === 'countdown';
    const going = this.phase === 'race' && now - this.goAt < 700 && !this.countGo && !!this.countEl;
    if (!counting && !going) {
      if (this.countEl && !this.countEl.classList.contains('go')) this.removeCount();
      if (this.phase !== 'race' && this.phase !== 'finished') this.countGo = false;
      return;
    }
    if (!this.countEl) {
      const el = document.createElement('div');
      el.className = 'count2';
      el.setAttribute('aria-hidden', 'true');
      el.innerHTML =
        '<svg width="180" height="180" viewBox="0 0 180 180"><circle class="track" cx="90" cy="90" r="80"></circle><circle class="arc" cx="90" cy="90" r="80"></circle></svg><small>GET READY</small><b></b>';
      $('game').append(el);
      this.countEl = el;
      this.countN = 0;
      this.countGo = false;
    }
    const el = this.countEl;
    const r = $('panel-me').getBoundingClientRect();
    const left = `${Math.round(r.left + r.width / 2)}px`;
    if (el.style.left !== left) el.style.left = left;
    const restart = () => {
      el.style.animation = 'none';
      void el.offsetWidth;
      el.style.animation = '';
    };
    if (counting) {
      const n = Math.min(3, Math.max(1, Math.ceil((this.goAt - now) / 1000)));
      if (n !== this.countN) {
        this.countN = n;
        const b = document.createElement('b');
        b.textContent = String(n);
        el.querySelector('b')!.replaceWith(b);
        restart();
      }
    } else {
      this.countGo = true;
      el.classList.add('go');
      el.querySelector('small')!.textContent = 'CLIMB!';
      const b = document.createElement('b');
      b.textContent = 'START!';
      el.querySelector('b')!.replaceWith(b);
      el.addEventListener('animationend', (e) => {
        if (e.target !== el) return;
        if (this.countEl === el) this.removeCount();
        else el.remove();
      });
      window.setTimeout(() => {
        if (this.countEl === el) this.removeCount();
      }, 900);
    }
  }

  /** touch pads (phone / touch solo): shown while climbing, hidden once the player has finished 3 climbs */
  private updatePads() {
    const show = (this.phase === 'countdown' || this.phase === 'race' || this.phase === 'finished') && padsDone() < 3;
    const el = $('tap-pads');
    const d = show ? '' : 'none';
    if (el.style.display !== d) el.style.display = d;
  }

  /** my bottom capsule in rooms (not solo / phone): place, name and progress */
  private updateMeCap(disp: SimState, show: boolean) {
    const want = show && !this.solo && !PHONE.matches && this.inMatch();
    if (!want) {
      this.meCap?.remove();
      this.meCap = null;
      return;
    }
    if (!this.meCap) {
      const el = document.createElement('div');
      el.className = 'me-cap';
      el.innerHTML = '<i></i><div><span class="pos"></span><span style="flex:1">You</span><span class="mh"></span></div>';
      $('panel-me').append(el);
      this.meCap = el;
    }
    const el = this.meCap;
    const c = color(this.slotOf(this.me.id));
    if (el.style.getPropertyValue('--me') !== c) {
      el.style.setProperty('--me', c);
      el.style.setProperty('--me-dark', `color-mix(in srgb, ${c} 40%, #14141c)`);
    }
    const rk = this.liveRanks(disp).get(this.me.id) ?? 0;
    const pos = el.querySelector<HTMLElement>('.pos')!;
    setTextEl(pos, String(rk + 1));
    pos.classList.toggle('lead', rk === 0);
    setTextEl(el.querySelector<HTMLElement>('.mh')!, `${disp.hold} / ${CFG.holds} m`);
    const w = `${(disp.hold / CFG.holds) * 100}%`;
    const bar = el.querySelector<HTMLElement>('i')!;
    if (bar.style.width !== w) bar.style.width = w;
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
      case 'countdown':
      case 'race':
        return '';
      case 'finished': {
        if (this.solo) return `<div class="banner"><span>Summit! <b>${secs(this.myMs!)} s</b></span></div>`;
        const waiting = [...this.opps.values()].filter((o) => o.ms === null && !o.left).length;
        return `<div class="banner"><span>Summit! <b>${secs(this.myMs!)} s</b> – waiting for ${waiting > 1 ? `${waiting} players` : 'your opponent'}…</span></div>`;
      }
      default:
        return this.studioHtml();
    }
  }

  /** reklamy tylko poza wyścigiem */
  adsAllowed(): boolean {
    return this.phase === 'lobby' || this.phase === 'results';
  }

  /** the chalk row on the duel results (amount only from the server) */
  private rewardRowHtml(st: Standing[]): string {
    if (!USE_SUPABASE) return '';
    const n = st.filter((x) => x.valid).length;
    const prize = 10 + 5 * Math.max(0, n - 2);
    if (st[0]?.me && st[0].valid && n >= 2) {
      if (!getAccount()) return `<div class="reward-row win">${CHALK_ICO}<span>A win here is worth +${prize} chalk – log in to collect it.</span><b>+0</b></div>`;
      const v = this.reward !== null ? `+${this.reward}` : this.rewardState === 'done' ? '+0' : '…';
      return `<div class="reward-row win">${CHALK_ICO}<span>Win reward · ${n} climbers</span><b>${v}</b></div>`;
    }
    return `<div class="reward-row">${CHALK_ICO}<span>Only the winner earns chalk – get them in the rematch!</span><b>+0</b></div>`;
  }

  /** the winner's reward may be recorded by another player's submit: read it from my ledger */
  private startRewardPoll() {
    if (!USE_SUPABASE || this.solo || !getAccount() || this.rewardState !== 'off') return;
    const st = this.standings();
    if (!st[0]?.me || !st[0].valid || st.filter((x) => x.valid).length < 2) return;
    this.rewardState = 'wait';
    const match = this.matchId;
    let tries = 0;
    const tick = async () => {
      if (this.dead || this.matchId !== match || this.rewardState !== 'wait') return;
      const v = await fetchMatchReward(match).catch(() => null);
      if (this.dead || this.matchId !== match) return;
      if (v !== null) {
        this.reward = v;
        this.rewardState = 'done';
        void refreshWallet().catch(() => {});
        this.refresh();
      } else if (++tries >= 10) {
        this.rewardState = 'done';
        this.refresh();
      } else window.setTimeout(tick, 1500);
    };
    window.setTimeout(tick, 800);
  }

  private verifyPill(): string {
    if (!USE_SUPABASE) return '';
    switch (this.verify) {
      case 'ok':
        return '<span class="pill ok">VERIFIED ✓</span>';
      case 'bad':
        return '<span class="pill bad">REJECTED BY SERVER</span>';
      case 'suspect':
        return '<span class="pill bad">UNDER REVIEW · NOT RANKED</span>';
      case 'error':
        return '<span class="pill bad">NOT SAVED</span>';
      default:
        return '<span class="pill muted">CHECKING…</span>';
    }
  }

  private accountLine(): string {
    if (!accountsEnabled || !USE_SUPABASE) return '';
    const acc = getAccount();
    if (!acc) return '';
    if (this.myRecord?.best != null) {
      return `Your record: <b>${secs(this.myRecord.best)} s</b>${this.myRecord.place ? ` · rank <b>#${this.myRecord.place}</b>` : ''}`;
    }
    return '';
  }

  /** Solo: the result of a run, the earlier attempts, retry. */
  private soloHtml(): string {
    const results = this.phase === 'results' && this.myMs !== null && this.soloRes;
    if (!results) {
      return `<div class="dim"></div><div class="studio">${belka('solo run', ['PLAYERS', '1'])}<p class="hint">${this.error ? `<span class="err">${esc(this.error)}</span>` : 'Get ready…'}</p></div>`;
    }
    const r = this.soloRes!;
    const ms = this.myMs!;
    const best = r.stats.best ?? ms;
    const first = r.prevBest === null;
    const big = 'style="font-size:13px;padding:4px 12px"';
    const delta = first
      ? `<span class="pill ready" ${big}>First run!</span>`
      : r.record
        ? `<span class="pill ready" ${big}>New best · −${secs(r.prevBest! - ms)} s</span>`
        : `<span class="pill warn">+${secs(ms - best)} s off your best (${secs(best)} s)</span>`;
    const earlier = r.stats.recent
      .slice(1, 4)
      .map((t) => `<span class="pill ${t === best ? 'best' : 'muted'}">${t === best ? '★ ' : ''}${secs(t)} s</span>`)
      .join('');
    const acct = this.accountLine();
    const guest = guestNote(r.record ? 'New record on this device – log in so it counts in the ranking.' : "Guest times don't count in the ranking.");
    return `<div class="dim"></div><div class="studio">
      ${r.record ? confettiHtml() : ''}
      <div class="b-wrap">
        <div class="result-banner ${r.record ? 'win' : 'draw'}">${r.record ? 'NEW RECORD!' : 'SUMMIT!'}</div>
        <div class="b-card has-banner${r.record ? ' gold-ring' : ''}">
          <div class="res-center">
            <div><span class="res-label">SOLO RUN #${r.stats.attempts}</span> ${this.verifyPill()}</div>
            <span class="res-time">${secs(ms)} s</span>
            ${delta}
            <div><span class="pill ok">PERFECT ${this.sim.perfects}/${CFG.holds}</span> ${this.sim.errors ? `<span class="pill bad">MISTAKES ${this.sim.errors}</span>` : ''}</div>
          </div>
          ${earlier && !first ? `<div class="earlier"><span>Earlier</span>${earlier}</div>` : ''}
          <div class="res-actions">
            <button class="btn green" data-action="retry">Try again <kbd>Space</kbd></button>
            <button class="btn ghost" data-action="leave">Menu</button>
          </div>
          ${guest}
          ${acct ? `<p class="room-status">${acct}</p>` : ''}
        </div>
      </div></div>`;
  }

  private studioHtml(): string {
    if (this.solo) return this.soloHtml();
    const results = this.phase === 'results' && this.myMs !== null;
    const inRoom = this.inRoom();
    const full = this.connected && !inRoom;
    const a = this.active();
    const alone = a.length < 2;
    const readyN = a.filter((p) => p.ready).length;

    const readyBtn = (label: string, pill = '') =>
      !inRoom
        ? ''
        : this.me.ready
          ? '<button class="btn green big outline-ok" data-action="ready">Ready ✓ &nbsp;(tap to cancel)</button>'
          : `<button class="btn green big" data-action="ready" ${alone ? 'disabled' : ''}>${label}${pill}</button>`;

    if (results) {
      const st = this.standings();
      const place = st.findIndex((s) => s.me) + 1;
      const draw = place > 1 && st[0].ms !== null && st[0].ms === this.myMs;
      const label = place === 1 ? 'YOU WIN!' : draw ? 'DRAW' : `${ord(place)} PLACE`;
      const cls = place === 1 ? 'win' : draw || place === 2 ? 'draw' : 'third';
      const rows = st
        .map((s, i) => {
          const t = s.ms === null ? (s.left ? 'LEFT' : 'DNF') : `${secs(s.ms)} s`;
          let v = '';
          if (s.ms !== null) {
            if (s.me) v = this.verify === 'ok' ? '<span class="v">✓</span>' : this.verify === 'bad' || this.verify === 'suspect' || this.verify === 'error' ? '<span class="v rej">✗</span>' : '';
            else v = s.valid ? '<span class="v">✓</span>' : '<span class="v rej">✗</span>';
          }
          return `<div class="rank-row${i === 0 && s.valid ? ' first' : ''}${s.me ? ' me' : ''}"><span class="pos">${i + 1}</span>${ava(s.slot, true, this.outfitOf(s.id))}<span class="nm">${esc(s.nick)}${s.me ? ' (you)' : ''}</span>${v}<span class="t">${t}</span></div>`;
        })
        .join('');
      const tally = this.session.size
        ? `<div class="room-tally"><span>This room · ${this.round} ${this.round === 1 ? 'race' : 'races'}</span>${[...this.session.entries()]
            .sort((x, y) => y[1].wins - x[1].wins || (x[1].best ?? Infinity) - (y[1].best ?? Infinity))
            .map(([id, r]) => `<span class="w" style="--shirt:${color(r.slot)}"><i></i>${id === this.me.id ? 'You' : esc(r.nick)} <b>${r.wins}</b></span>`)
            .join('')}</div>`
        : '';
      const acct = this.accountLine();
      return `<div class="dim"></div><div class="studio">
        ${place === 1 ? confettiHtml() : ''}
        <div class="b-wrap">
          <div class="result-banner ${cls}">${label}</div>
          <div class="b-card has-banner" style="gap:8px">
            ${rows}${this.rewardRowHtml(st)}${tally}
            <div class="res-actions">
              ${readyBtn('Rematch', `<span class="pill dark" style="margin-left:10px">${readyN}/${a.length} ready</span>`) || ''}
              <button class="btn ghost" data-action="leave">Leave</button>
            </div>
            ${guestNote("Guests don't earn chalk and don't count in the global ranking.")}
            ${acct ? `<p class="room-status">${acct}</p>` : ''}
          </div>
        </div></div>`;
    }

    // waiting room
    const me = this.slotOf(this.me.id);
    const slots = Array.from({ length: MAX_PLAYERS }, (_, i) => {
      const p = a[i];
      if (!p) return `<div class="slot free">${ava(i)}Free lane</div>`;
      const isMe = p.id === this.me.id;
      return `<div class="slot${p.ready ? ' ready' : ''}${isMe ? ' me' : ''}">${ava(i, false, this.outfitOf(p.id))}<div class="nm"><b>${esc(p.nick)}${isMe ? ' (you)' : ''}</b>${p.ready ? '<span class="pill ready">READY</span>' : '<span class="pill wait">WAITING</span>'}</div></div>`;
    }).join('');
    let status: string;
    let go = false;
    if (!this.connected) status = 'Connecting…';
    else if (full) status = `<span class="err">The room is full (max ${MAX_PLAYERS} players).</span>`;
    else if (alone) status = `Share the code or the link – up to ${MAX_PLAYERS - 1} friends can join.`;
    else if (readyN === a.length) {
      go = true;
      status = 'Everyone is ready – starting in 3…';
    } else status = `${readyN} of ${a.length} ready · the race starts when everyone is ready`;
    const extra: string[] = [];
    if (this.phase === 'lobby' && this.participants.length && !this.participants.includes(this.me.id)) extra.push('A round is in progress – you will join the next one.');
    if (MODE_NOTE) extra.push(esc(MODE_NOTE));
    return `<div class="dim"></div><div class="studio menu2">
      <div class="topbar2"><button class="btn small ghost" data-action="leave">← Leave room</button><span class="who2" style="margin-left:auto;margin-right:0">${ava(me, true, getMyOutfit())}${esc(this.me.nick)}</span></div>
      <div class="b-wrap">
        <div class="b-card">
          <div class="room-code"><div><small>ROOM CODE</small><b>${esc(this.code)}</b></div><button data-action="copy">Copy link</button></div>
          <div class="slots" aria-label="Players (${a.length}/${MAX_PLAYERS})">${slots}</div>
          <p class="room-status${go ? ' go' : ''}">${status}</p>
          ${USE_SUPABASE && a.length >= 2 ? `<p class="room-status"><span class="pill prize">${CHALK_ICO}Winner +${10 + 5 * (a.length - 2)}</span></p>` : ''}
          ${extra.map((x) => `<p class="room-status">${x}</p>`).join('')}
          ${readyBtn("I'm ready")}
          ${guestNote('As a guest you race, but you don\'t earn chalk or enter the ranking.')}
        </div>
      </div></div>`;
  }


  handleAction(action: string, el: HTMLElement) {
    if (action === 'ready' || action === 'retry') this.toggleReady();
    else if (action === 'leave') location.hash = '#/';
    else if (action === 'view-login') {
      pendingView = 'login';
      location.hash = '#/';
    }
    else if (action === 'copy') {
      const link = `${location.origin}${location.pathname}${location.search}#/r/${this.code}`;
      navigator.clipboard?.writeText(link).then(
        () => {
          el.textContent = 'Link copied ✓';
          el.classList.add('copied');
          window.setTimeout(() => {
            if (el.isConnected) {
              el.textContent = 'Copy link';
              el.classList.remove('copied');
            }
          }, 2000);
        },
        () => prompt('Copy link:', link),
      );
    }
  }
}


// ---------- edytor postaci (#/climber, #/climber/victory) ----------

type Part = keyof typeof OUTFIT_OPTIONS;
const editor = {
  outfit: { ...DEFAULT_OUTFIT } as Outfit,
  tab: 'look' as 'look' | 'victory',
  sel: 'clap' as Celebration,
  confirm: false,
  busy: false,
  msg: '',
  err: '',
};

const PEN = svg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/>', 14);
const NO_BAND = svg('<circle cx="12" cy="12" r="8"/><path d="M6.5 17.5l11-11"/>', 22);
const LOCK = svg('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>', 12);
const CHALK_ICO = `<svg class="chalk-ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="#f4f1e8" stroke="#c9b28a" stroke-width="2"/><circle cx="9" cy="10" r="1.3" fill="#c9b28a"/><circle cx="14" cy="14.5" r="1.1" fill="#c9b28a"/><circle cx="14.8" cy="8.6" r="0.9" fill="#c9b28a"/></svg>`;
const CELEB_NAMES: Record<Celebration, string> = { clap: 'Classic', chalk: 'Chalk bomb', flex: 'Flex', disco: 'Disco', flip: 'Backflip' };

const chalkChip = () => {
  const w = getWallet();
  return getAccount() && w ? `<span class="chalk-chip" title="Your chalk">${CHALK_ICO}${w.chalk}</span>` : '';
};
const ownsCeleb = (c: Celebration) => c === 'clap' || !!getWallet()?.owned.includes(c);

/** a small head with the hair style, in the current hair and skin colours */
function hairIcon(style: string, hair: string, skin: string): string {
  const line = shade(hair, 0.45);
  const curls =
    style === 'curly'
      ? [[11, 12], [15, 9], [21, 9], [25, 12], [27, 17], [9, 17]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3.6" fill="${hair}"/>`).join('')
      : '';
  const neck = `<rect x="15" y="24" width="6" height="8" rx="2" fill="${skin}"/>`;
  const ears = `<ellipse cx="9" cy="19" rx="2.2" ry="3" fill="${skin}"/><ellipse cx="27" cy="19" rx="2.2" ry="3" fill="${skin}"/>`;
  const head = `<circle cx="18" cy="18" r="9" fill="${hair}" stroke="${line}" stroke-width="1.5"/>`;
  const long = style === 'long' ? `<path d="M9 18 Q7 27 10 32 Q18 35 26 32 Q29 27 27 18Z" fill="${hair}" stroke="${line}" stroke-width="1.5"/>` : '';
  const pony = style === 'pony' ? `<path d="M16.5 23 Q15 30 18 34 Q21 30 19.5 23Z" fill="${hair}" stroke="${line}" stroke-width="1.2"/>` : '';
  return `<svg width="30" height="30" viewBox="0 0 36 36" aria-hidden="true">${curls}${neck}${ears}${head}${long}${pony}</svg>`;
}

function lookHtml(): string {
  const o = editor.outfit;
  return `<div class="opt-grid">${PART_LABELS.map(([part, label]) => {
    const opts = OUTFIT_OPTIONS[part] as readonly (string | null)[];
    const cur = opts.indexOf(o[part] as string | null);
    const tiles = opts
      .map((v, i) => {
        const name = OPTION_NAMES[part][i];
        let inner = '';
        let style = v ? `style="--c:${v}"` : '';
        if (part === 'hairStyle') {
          inner = hairIcon(v!, o.hair, o.skin);
          style = '';
        } else if (part === 'band' && v === null) inner = NO_BAND;
        return `<button class="tile${part === 'hairStyle' ? ' style' : ''}" ${style} aria-pressed="${i === cur}" aria-label="${label} ${name}" title="${name}" data-action="ed-opt" data-part="${part}" data-i="${i}">${inner}</button>`;
      })
      .join('');
    return `<div class="opt"><span>${label} · <b>${OPTION_NAMES[part][Math.max(0, cur)]}</b></span><div class="tiles">${tiles}</div></div>`;
  }).join('')}</div>`;
}

function victoryActionHtml(): string {
  const c = editor.sel;
  const name = CELEB_NAMES[c];
  const acc = getAccount();
  const w = getWallet();
  const note = (t: string, cls = '') => `<p class="win-note${cls ? ' ' + cls : ''}">${t}</p>`;
  const extra = (editor.msg ? note(esc(editor.msg), 'ok') : '') + (editor.err ? note(esc(editor.err), 'err') : '');
  if (!acc) {
    if (c === 'clap') return `<div class="win-action">${note("✓ Equipped – you'll do this after your next win.", 'ok')}</div>`;
    return `<div class="win-action">${note(accountsEnabled ? 'Log in to earn chalk from wins and unlock celebrations.' : 'Celebrations unlock with an online account.')}${accountsEnabled ? '<button class="btn blue" data-action="ed-login">Log in</button>' : ''}</div>`;
  }
  if (!w) return `<div class="win-action">${note('Loading your chalk…')}</div>`;
  const dis = editor.busy ? 'disabled' : '';
  if (ownsCeleb(c)) {
    if (w.celebration === c) return `<div class="win-action">${extra || note("✓ Equipped – you'll do this after your next win.", 'ok')}</div>`;
    return `<div class="win-action"><button class="btn blue" data-action="ed-equip" ${dis}>Equip ${esc(name)}</button>${extra}</div>`;
  }
  if (w.chalk >= CELEB_PRICE) {
    if (editor.confirm) {
      return `<div class="win-action">${note(`Spend ${CELEB_PRICE} chalk on ${esc(name)}? You'll have ${w.chalk - CELEB_PRICE} left.`)}
        <div class="res-actions"><button class="btn green" data-action="ed-buy" ${dis}>${editor.busy ? 'Unlocking…' : 'Unlock'}</button><button class="btn ghost" data-action="ed-cancel" ${dis}>Cancel</button></div>${extra}</div>`;
    }
    return `<div class="win-action"><button class="btn gold" data-action="ed-unlock">Unlock for ${CHALK_ICO} ${CELEB_PRICE}</button>${extra}</div>`;
  }
  return `<div class="win-action"><button class="btn need" disabled>${CHALK_ICO} ${CELEB_PRICE} · need ${CELEB_PRICE - w.chalk} more</button>
    ${note('Win races to earn chalk: +10 for a win, +5 for every extra climber in the room.')}${extra}</div>`;
}

function victoryHtml(): string {
  const equipped = myCelebration();
  const cards = CELEBRATIONS.map((c, i) => {
    const owned = ownsCeleb(c);
    const tag = equipped === c ? '<span class="tag equipped">EQUIPPED</span>' : owned ? `<span class="tag owned">${c === 'clap' ? 'FREE' : 'OWNED'}</span>` : `<span class="tag price">${CHALK_ICO}${CELEB_PRICE}</span>`;
    return `<button class="win-card${i === 0 ? ' wide' : ''}${owned ? '' : ' locked'}" aria-pressed="${editor.sel === c}" data-action="ed-celeb" data-c="${c}">
      <span class="thumb"><canvas class="celeb-cv" data-c="${c}"></canvas>${owned ? '' : `<span class="lock">${LOCK}</span>`}</span>
      <span class="wc-txt"><b>${CELEB_NAMES[c]}</b>${tag}</span></button>`;
  }).join('');
  return `<div class="win-head"><span>Your move at the top after a win.</span>${chalkChip()}</div>
    <div class="win-grid">${cards}</div>${victoryActionHtml()}`;
}

function editorHtml(): string {
  const nick = getAccount()?.nick ?? getNick();
  const v = editor.tab === 'victory';
  const caption = v ? `▶ ${CELEB_NAMES[editor.sel]} · ${ownsCeleb(editor.sel) ? 'preview' : 'locked preview'}` : esc(nick);
  return `<div class="dim"></div><div class="studio sheet-wrap"><div class="sheet sheet-editor" role="dialog" aria-label="Your climber">
    <div class="sheet-head"><button class="btn small ghost" data-action="ed-back">← Back</button><span class="ed-title">YOUR CLIMBER</span><button class="btn small blue" data-action="ed-random">Random</button></div>
    <div class="editor">
      <div class="editor-preview"><div class="floor"></div><canvas id="climber-cv" aria-label="Your climber"></canvas><span class="caption" style="border-color:${color(0)}">${caption}</span></div>
      <div class="b-card ed-card">
        <div class="seg" role="tablist"><button role="tab" aria-selected="${!v}" data-action="ed-tab" data-tab="look">LOOK</button><button role="tab" aria-selected="${v}" data-action="ed-tab" data-tab="victory">VICTORY</button></div>
        ${v ? victoryHtml() : lookHtml()}
        <div class="res-actions"><button class="btn green" data-action="ed-save">Save</button><button class="btn ghost" data-action="ed-reset">Reset</button></div>
      </div>
    </div></div></div>`;
}

function renderEditor() {
  const scroll = document.querySelector('.ed-card')?.scrollTop ?? 0;
  paintOverlay(editorHtml(), 'climber');
  const card = document.querySelector('.ed-card');
  if (card) card.scrollTop = scroll;
}

function openEditor(tab: 'look' | 'victory') {
  editor.outfit = { ...(getMyOutfit() ?? DEFAULT_OUTFIT) };
  editor.tab = tab;
  editor.sel = myCelebration();
  editor.confirm = false;
  editor.msg = editor.err = '';
  renderEditor();
  if (getAccount()) void refreshWallet().catch(() => {});
}

async function editorRpc(fn: () => Promise<unknown>, ok: string) {
  editor.busy = true;
  editor.err = editor.msg = '';
  renderEditor();
  try {
    await fn();
    editor.msg = ok;
    editor.confirm = false;
  } catch (e) {
    const code = rpcCode(e);
    editor.confirm = false;
    if (code === 'not_enough_chalk') editor.err = 'Not enough chalk.';
    else if (code === 'already_owned') editor.err = 'You already own it.';
    else editor.err = plError(e);
    await refreshWallet().catch(() => {});
  }
  editor.busy = false;
  if (location.hash.startsWith('#/climber')) renderEditor();
}

function editorAction(action: string, el?: HTMLElement): boolean {
  switch (action) {
    case 'ed-opt': {
      const part = el?.dataset.part as Part | undefined;
      const i = Number(el?.dataset.i);
      if (!part || !(part in OUTFIT_OPTIONS)) return true;
      const v = (OUTFIT_OPTIONS[part] as readonly unknown[])[i];
      if (v === undefined) return true;
      editor.outfit = { ...editor.outfit, [part]: v } as Outfit;
      renderEditor();
      return true;
    }
    case 'ed-tab':
      editor.tab = el?.dataset.tab === 'victory' ? 'victory' : 'look';
      editor.confirm = false;
      editor.msg = editor.err = '';
      renderEditor();
      return true;
    case 'ed-celeb': {
      const c = el?.dataset.c as Celebration | undefined;
      if (c && CELEBRATIONS.includes(c)) editor.sel = c;
      editor.confirm = false;
      editor.msg = editor.err = '';
      renderEditor();
      return true;
    }
    case 'ed-unlock':
      editor.confirm = true;
      editor.msg = editor.err = '';
      renderEditor();
      return true;
    case 'ed-cancel':
      editor.confirm = false;
      renderEditor();
      return true;
    case 'ed-buy': {
      const c = editor.sel;
      void editorRpc(() => buyCelebration(c), 'Unlocked and equipped!');
      return true;
    }
    case 'ed-equip': {
      const c = editor.sel;
      void editorRpc(() => equipCelebration(c), "Equipped – you'll do this after your next win.");
      return true;
    }
    case 'ed-login':
      pendingView = 'login';
      location.hash = '#/';
      return true;
    case 'ed-random': {
      const pick = <T>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)];
      const O = OUTFIT_OPTIONS;
      editor.outfit = { skin: pick(O.skin), hairStyle: pick(O.hairStyle), hair: pick(O.hair), band: pick(O.band), shirt: pick(O.shirt), pants: pick(O.pants), shoes: pick(O.shoes) };
      renderEditor();
      return true;
    }
    case 'ed-reset':
      editor.outfit = { ...DEFAULT_OUTFIT };
      renderEditor();
      return true;
    case 'ed-save':
      saveMyOutfit(editor.outfit);
      if (getAccount()) void saveOutfitRemote(editor.outfit).catch((e) => console.error(e));
      location.hash = '#/';
      return true;
    case 'ed-back':
      location.hash = '#/';
      return true;
    case 'rk-tab':
      screens.rankTab = el?.dataset.tab === 'wins' ? 'wins' : 'fast';
      renderRanking();
      return true;
  }
  return false;
}

function fitCanvas(cv: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const w = cv.clientWidth;
  const h = cv.clientHeight;
  if (!w || !h) return null;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
  }
  const ctx = cv.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return ctx;
}

/** the live previews in the editor (called every frame) */
function drawEditorPreview(now: number) {
  const cv = document.getElementById('climber-cv') as HTMLCanvasElement | null;
  const ctx = cv ? fitCanvas(cv) : null;
  if (cv && ctx) drawClimberPreview(ctx, cv.clientWidth, cv.clientHeight - 30, editor.outfit, 0, editor.tab === 'victory' ? editor.sel : null, now);
  document.querySelectorAll<HTMLCanvasElement>('canvas.celeb-cv').forEach((t) => {
    const c = t.dataset.c as Celebration;
    const tctx = fitCanvas(t);
    if (tctx) drawClimberPreview(tctx, t.clientWidth, t.clientHeight + 6, editor.outfit, 0, c, now);
  });
}

// ---------- ranking (#/ranking) i profil (#/profile) ----------

const screens = {
  rankTab: 'fast' as 'fast' | 'wins',
  fast: null as RankRow[] | null,
  wins: null as RankRow[] | null,
  myWins: null as number | null,
  myBest: null as { best: number | null; place: number | null } | null,
  rankErr: '',
  profile: null as ProfileData | null,
  profileErr: '',
};

const topbarScreen = (title: string, right = '') =>
  `<div class="sheet-head"><button class="btn small ghost" data-action="ed-back">← Menu</button><span class="ed-title">${title}</span>${right || '<span class="topbar-spacer"></span>'}</div>`;

function rankRowHtml(pos: number | null, r: { nick: string; outfit: Outfit | null }, value: string, mine: boolean): string {
  const posCls = pos === 1 ? '' : pos === 2 || pos === 3 ? ' silver' : '';
  return `<div class="rank-row${pos === 1 ? ' first' : ''}${mine ? ' mine' : ''}"><span class="pos${posCls}">${pos ?? '–'}</span>${ava(((pos ?? 1) - 1) % 6, true, r.outfit)}<span class="nm">${esc(r.nick)}${mine ? ' (you)' : ''}</span><span class="t">${value}</span></div>`;
}

function rankingHtml(): string {
  const acc = getAccount();
  const fast = screens.rankTab === 'fast';
  const rows = fast ? screens.fast : screens.wins;
  const fmt = (v: number) => (fast ? `${secs(v)} s` : `${v} ${v === 1 ? 'win' : 'wins'}`);
  let list: string;
  if (screens.rankErr) list = `<p class="room-status err">${esc(screens.rankErr)}</p>`;
  else if (!rows) list = '<p class="room-status">Loading…</p>';
  else if (!rows.length) list = `<p class="room-status">${fast ? 'No verified times yet – be the first!' : 'No room wins yet – win a race with friends!'}</p>`;
  else {
    const myIdx = acc ? rows.findIndex((r) => r.user_id === acc.userId) : -1;
    const top = rows.slice(0, 7).map((r, i) => rankRowHtml(i + 1, r, fmt(r.value), i === myIdx));
    if (acc && myIdx >= 7) top.push('<div class="rank-gap" aria-hidden="true">⋮</div>', rankRowHtml(myIdx + 1, rows[myIdx], fmt(rows[myIdx].value), true));
    else if (acc && myIdx < 0) {
      const v = fast ? screens.myBest?.best ?? null : screens.myWins;
      if (v) top.push('<div class="rank-gap" aria-hidden="true">⋮</div>', rankRowHtml(fast ? screens.myBest?.place ?? null : null, { nick: acc.nick, outfit: getMyOutfit() }, fmt(v), true));
    }
    list = `<div class="rank-list">${top.join('')}</div>`;
  }
  return `<div class="dim"></div><div class="studio sheet-wrap"><div class="sheet sheet-rank" role="dialog" aria-label="Ranking">
    ${topbarScreen('RANKING', chalkChip())}
    <div class="rank-body">
      <div class="seg" role="tablist"><button role="tab" aria-selected="${fast}" data-action="rk-tab" data-tab="fast">FASTEST</button><button role="tab" aria-selected="${!fast}" data-action="rk-tab" data-tab="wins">MOST WINS</button></div>
      <p class="res-label" style="text-align:left">${fast ? 'Best verified time per climber · solo and rooms' : 'Verified room wins · every win also earns chalk'}</p>
      ${list}
      ${guestNote('Log in to appear in the ranking.')}
    </div></div></div>`;
}

function renderRanking() {
  paintOverlay(rankingHtml(), 'ranking');
}

async function openRankingScreen() {
  screens.rankErr = '';
  renderRanking();
  const acc = getAccount();
  try {
    const [fast, wins, myBest, myWins] = await Promise.all([
      fetchFastest(),
      fetchWins(),
      acc ? fetchMyBest(acc.userId) : Promise.resolve(null),
      acc ? fetchMyWins() : Promise.resolve(null),
    ]);
    Object.assign(screens, { fast, wins, myBest, myWins });
  } catch (e) {
    screens.rankErr = plError(e);
  }
  if (location.hash === '#/ranking') renderRanking();
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const days = Math.round((new Date(today.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yest.';
  if (days < 7) return d.toLocaleDateString('en-GB', { weekday: 'short' });
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

function shortEmail(e: string): string {
  const [user, domain] = e.split('@');
  if (!domain) return e;
  return `${user.length > 3 ? user.slice(0, 3) + '…' : user}@${domain}`;
}

function profileHtml(): string {
  const acc = getAccount();
  if (!acc) {
    return `<div class="dim"></div><div class="studio sheet-wrap"><div class="sheet sheet-rank" role="dialog" aria-label="Your profile">${topbarScreen('YOUR PROFILE')}
      <div class="rank-body"><p class="room-status">Log in to see your profile.</p><button class="btn blue" data-action="ed-login">Log in</button></div></div></div>`;
  }
  const w = getWallet();
  const p = screens.profile;
  const h = p?.history ?? [];
  const room = h.filter((r) => r.players > 1 && r.valid);
  const wins = room.filter((r) => r.won).length;
  const stats = p
    ? `<div class="stat-grid">
        <div><b>${wins}</b><small>room wins</small></div>
        <div><b>${room.length ? Math.round((wins / room.length) * 100) + '%' : '—'}</b><small>win rate</small></div>
        <div><b>${p.best.best === null ? '—' : secs(p.best.best)}</b><small>best time${p.best.place ? ` · #${p.best.place}` : ''}</small></div>
        <div><b>${h.filter((r) => r.valid).length}</b><small>climbs</small></div>
      </div>`
    : `<p class="room-status">${screens.profileErr ? `<span class="err">${esc(screens.profileErr)}</span>` : 'Loading…'}</p>`;
  const owned = CELEBRATIONS.filter((c) => ownsCeleb(c)).length;
  const celebs = CELEBRATIONS.map((c) => {
    const own = ownsCeleb(c);
    const eq = myCelebration() === c;
    const title = own ? (eq ? 'Equipped' : 'Owned') : `Locked · ${CELEB_PRICE} chalk`;
    return `<span class="cchip${eq ? ' eq' : ''}${own ? '' : ' locked'}" title="${title}">${eq ? '★ ' : ''}${CELEB_NAMES[c]}${own ? '' : LOCK}</span>`;
  }).join('');
  const races = p
    ? h.length
      ? h
          .slice(0, 6)
          .map((r) => {
            const pill = !r.valid ? '<span class="pill bad">rejected</span>' : r.players <= 1 ? '<span class="pill solo">solo</span>' : r.won ? '<span class="pill best">1st</span>' : '<span class="pill muted">lost</span>';
            const gain = p.rewards.get(r.match_id);
            return `<div class="history-row"><span class="when">${dayLabel(r.created_at)}</span><span class="mode">${pill} ${r.players > 1 ? `Room · ${r.players} climbers` : 'Solo run'}</span><span class="tm">${r.valid && r.verified_ms !== null ? secs(r.verified_ms) + ' s' : '—'}</span><span class="gain${gain ? '' : ' none'}">${gain ? '+' + gain : '–'}</span></div>`;
          })
          .join('')
      : '<p class="room-status">No races yet – play one and it will show up here.</p>'
    : '';
  const err = menu.error ? `<p class="win-note err">${esc(menu.error)}</p>` : '';
  const note = menu.note ? `<p class="win-note ok">${esc(menu.note)}</p>` : '';
  return `<div class="dim"></div><div class="studio sheet-wrap"><div class="sheet sheet-profile" role="dialog" aria-label="Your profile">
    ${topbarScreen('YOUR PROFILE', '<button class="btn small orange" data-action="logout">Log out</button>')}
    <div class="profile">
      <div class="b-card">
        <div class="prof-head">${ava(0, false, getMyOutfit()).replace('class="ava"', 'class="ava lg"')}<div><b>${esc(acc.nick)}</b><small>${esc(shortEmail(acc.email))}</small>${p?.since ? `<small>since ${new Date(p.since).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</small>` : ''}</div></div>
        <a class="btn blue small" href="#/climber">Edit climber</a>
        <div class="chalk-box">${CHALK_ICO}<div><small>CHALK</small><b>${w ? w.chalk : '…'}</b></div><span>+10 per win<br>+5 per extra climber</span></div>
        ${stats}
        <div class="sec-title"><span>SETTINGS</span></div>
        <label class="nick-row">Nickname <input id="f-nick" maxlength="16" value="${esc(menu.nick || acc.nick)}" data-enter="save-nick"></label>
        <div class="res-actions"><button class="btn small blue" data-action="save-nick" ${menu.busy ? 'disabled' : ''}>Save nickname</button><button class="btn small ghost" data-action="send-reset" title="We e-mail you a link">Change password</button></div>
        ${err}${note}
      </div>
      <div class="b-card">
        <div class="sec-title"><span>CELEBRATIONS · ${owned} OF ${CELEBRATIONS.length}</span><a href="#/climber/victory">Get more →</a></div>
        <div class="celeb-chips">${celebs}</div>
        <div class="sec-title"><span>RECENT RACES</span></div>
        <div class="history">${races}</div>
      </div>
    </div></div></div>`;
}

function renderProfile() {
  paintOverlay(profileHtml(), 'profile');
}

async function openProfileScreen() {
  screens.profile = null;
  screens.profileErr = '';
  menu.error = menu.note = menu.nick = '';
  editor.outfit = { ...(getMyOutfit() ?? DEFAULT_OUTFIT) }; // the celebration thumbnails wear my outfit
  renderProfile();
  if (!getAccount()) return;
  void refreshWallet().catch(() => {});
  try {
    screens.profile = await fetchProfileData();
  } catch (e) {
    screens.profileErr = plError(e);
  }
  if (location.hash === '#/profile') renderProfile();
}

// ---------- menu, konto, ranking ----------

type MenuView = 'main' | 'login' | 'register' | 'check' | 'ranking' | 'account' | 'forgot' | 'recovery';
let pendingView: MenuView | null = null;
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
  const how = '<a class="btn ghost small" href="#/info/how-to-play">How to play</a>';
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

/** v2 top bar: who I am, ranking, help, log in / my account */
function topbar2Html(): string {
  const acc = getAccount();
  const who = `<a class="who2" href="#/climber" title="Edit your climber">${ava(0, true, getMyOutfit())}${esc(acc?.nick ?? getNick())}${acc ? '' : '<i>GUEST</i>'}<span class="pen">${PEN}</span></a>`;
  const help = `<a class="icon-btn" href="#/info/how-to-play" aria-label="How to play">${ICON_HELP}</a>`;
  if (!accountsEnabled) return `<div class="topbar2">${who}${help}</div>`;
  const rank = `<a class="icon-btn" href="#/ranking" aria-label="Ranking">${ICON_TROPHY}</a>`;
  const login = acc
    ? `<span class="chalk-chip" title="Your chalk">${CHALK_ICO}${getWallet()?.chalk ?? '…'}</span><a class="icon-btn" href="#/profile" aria-label="Profile and settings" title="Profile and settings">${ICON_GEAR}</a>`
    : '<button class="btn small blue" data-action="view-login">Log in</button>';
  return acc ? `<div class="topbar2">${who}${login}${rank}${help}</div>` : `<div class="topbar2">${who}${rank}${help}${login}</div>`;
}

function footPillHtml(): string {
  const links = INFO_LINKS.filter(([slug]) => slug !== 'how-to-play')
    .map(([slug, title]) => `<a href="#/info/${slug}">${title}</a>`)
    .join('');
  return `<div class="foot-pill"><span class="online${USE_SUPABASE ? '' : ' off'}">${USE_SUPABASE ? 'Online' : 'Local mode'}</span>${links}</div>`;
}

function menuHtml(): string {
  const acc = getAccount();
  const wrap = (inner: string, foot = false) => `<div class="dim"></div><div class="studio menu2">${topbar2Html()}${belka('rhythm climbing · up to 6 players')}${inner}${foot ? footPillHtml() : ''}</div>`;
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
      <div class="row2"><button class="btn small blue" data-action="view-register">No account? Sign up</button><button class="btn small ghost" data-action="view-forgot">Forgot password</button><button class="btn small ghost" data-action="view-main">Back</button></div>
    </div>`);
  }
  if (menu.view === 'forgot') {
    return wrap(`<div class="form" role="form" aria-label="Reset password">
      <h2>Reset password</h2>
      <p class="msg">Enter your account e-mail – we will send a link to set a new password.</p>
      <label>E-mail<input id="f-email" type="email" autocomplete="email" value="${esc(menu.email)}" data-enter="do-forgot"></label>
      ${err}${note}
      <button class="btn blue" data-action="do-forgot" ${dis}>${menu.busy ? 'Sending…' : 'Send link'}</button>
      <div class="row2"><button class="btn small ghost" data-action="view-login">Back to login</button></div>
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
      <div class="row2"><button class="btn small blue" data-action="view-login">I have an account – log in</button><button class="btn small ghost" data-action="view-main">Back</button></div>
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
  const rec = getSolo();
  return wrap(
    `
    ${note ? `<div class="form">${note}</div>` : ''}
    <div class="b-wrap">
      <div class="b-card">
        ${acc ? '' : `<label class="nick-row">Nickname <input id="nick" maxlength="16" value="${esc(getNick())}" autocomplete="off" spellcheck="false"></label>`}
        <button class="btn green row" data-action="solo">Solo run${rec.best === null ? '' : `<span class="pill dark">Record ${secs(rec.best)} s</span>`}</button>
        <button class="btn blue row" data-action="create">Play with friends <span class="pill dark">up to ${MAX_PLAYERS}</span></button>
        <div class="code-row">
          <span>Have a code?</span>
          <input id="join-code" placeholder="CODE" maxlength="8" aria-label="Room code" autocomplete="off" spellcheck="false" data-enter="join">
          <button class="btn orange" data-action="join">Join</button>
        </div>
        ${guestNote("Guests don't earn chalk and don't count in the ranking.")}
      </div>
    </div>`,
    true,
  );
}

function renderMenu() {
  if (location.hash.startsWith('#/info/')) return;
  if (location.hash.startsWith('#/climber')) return renderEditor();
  if (location.hash === '#/profile') return renderProfile();
  if (location.hash === '#/ranking') return renderRanking();
  if (!room && !accountPending()) paintOverlay(menuHtml(), 'menu-' + menu.view); // wait for a saved login, no guest flash
}

const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value ?? '';

function readNick() {
  if (getAccount()) return;
  const n = cleanNick(val('nick')) || getNick();
  saveNick(n);
}

async function menuAction(action: string, el?: HTMLElement) {
  if (editorAction(action, el)) return;
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
      location.hash = '#/ranking';
      return;
    case 'view-account':
      location.hash = '#/profile';
      return;
    case 'logout':
      await signOut();
      menu.view = 'main';
      if (location.hash === '#/profile') location.hash = '#/';
      else renderMenu();
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
  } else if (location.hash === '#/ranking' || location.hash === '#/profile') {
    room?.destroy();
    room = null;
    if (location.hash === '#/ranking') void openRankingScreen();
    else void openProfileScreen();
  } else if (location.hash === '#/climber' || location.hash === '#/climber/victory') {
    room?.destroy();
    room = null;
    openEditor(location.hash.endsWith('/victory') ? 'victory' : 'look');
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
    menu.view = pendingView ?? 'main';
    pendingView = null;
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
    $('tap-pads').style.display = 'none';
    const idle = { route: IDLE_ROUTE, hold: 0, feedback: 'none' as Feedback, feedbackAge: 1e9, ring: null, showHints: false, present: true, finished: false };
    meView.draw({ ...idle, look: 0, outfit: getMyOutfit() }, now, dt);
    drawEditorPreview(now);
    oppPanels.get('__idle')?.view.draw({ ...idle, look: 1 }, now, dt);
  }
  setAdsVisible(room ? room.adsAllowed() : true);
  layoutHud();
}

const overlay = $('overlay');
overlay.addEventListener('click', (e) => {
  if (!room && (e.target as HTMLElement).classList?.contains('sheet-wrap')) {
    location.hash = '#/';
    return;
  }
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
  if (!el || (el as HTMLButtonElement).disabled) return;
  const action = el.dataset.action!;
  if (room) room.handleAction(action, el);
  else void menuAction(action, el);
});
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || room) return;
  if (/^#\/(climber|profile|ranking|info\/)/.test(location.hash)) {
    e.preventDefault();
    location.hash = '#/';
  } else if (menu.view !== 'main' && menu.view !== 'recovery') void menuAction('view-main');
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
  if (!room && (menu.view === 'main' || location.hash === '#/ranking' || location.hash === '#/profile')) renderMenu();
});
onPasswordRecovery(() => {
  menu.view = 'recovery';
  menu.error = '';
  if (!room) renderMenu();
});
onAccountReady(() => (room ? room.refresh() : location.hash.startsWith('#/info/') ? route() : renderMenu()));
onWalletChange(() => {
  if (!room) renderMenu();
});
initAccounts();
window.addEventListener('hashchange', route);
route();
requestAnimationFrame(loop);
