// Konta graczy: Supabase Auth (e-mail + hasło) i ranking najlepszych czasów.
import { getClient, supabaseConfigured } from './net/supabase';
import { CELEBRATIONS, sanitizeOutfit, type Celebration, type Outfit } from './game/render';
import { getMyOutfit, saveMyOutfit } from './outfit';

export interface Account {
  userId: string;
  email: string;
  nick: string;
}

export interface LeaderRow {
  nick: string;
  user_id: string;
  best_ms: number;
  achieved_at: string;
}

let current: Account | null = null;
const listeners = new Set<(a: Account | null) => void>();
const recoveryListeners = new Set<() => void>();

export const accountsEnabled = supabaseConfigured;
export const getAccount = () => current;

/**
 * A saved session is restored asynchronously (token refresh + profile query). Until that is done the UI would
 * flash the guest screen, so we know up front (from the stored token) that a login is on its way.
 */
function hasStoredSession(): boolean {
  if (!supabaseConfigured) return false;
  try {
    for (let i = 0; i < localStorage.length; i++) if (/^sb-.+-auth-token$/.test(localStorage.key(i) ?? '')) return true;
  } catch {
    /* no storage */
  }
  return false;
}
let pending = hasStoredSession();
const readyListeners = new Set<() => void>();
/** true while a saved login is still being restored */
export const accountPending = () => pending;
export function onAccountReady(cb: () => void) {
  readyListeners.add(cb);
  return () => readyListeners.delete(cb);
}
function settle() {
  if (!pending) return;
  pending = false;
  readyListeners.forEach((cb) => cb());
}

/** Użytkownik kliknął link „zresetuj hasło” z e-maila – trzeba pokazać formularz nowego hasła. */
export function onPasswordRecovery(cb: () => void) {
  recoveryListeners.add(cb);
  return () => recoveryListeners.delete(cb);
}

export function onAccountChange(cb: (a: Account | null) => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

async function loadProfile(userId: string, email: string): Promise<Account> {
  const { data } = await getClient().from('profiles').select('nick,outfit').eq('id', userId).maybeSingle();
  // the outfit follows the account: the saved one wins; a guest outfit is moved into a fresh profile
  const saved = sanitizeOutfit(data?.outfit);
  if (saved) saveMyOutfit(saved);
  else {
    const local = getMyOutfit();
    if (local) void getClient().from('profiles').update({ outfit: local }).eq('id', userId);
  }
  return { userId, email, nick: data?.nick ?? email.split('@')[0].slice(0, 16) };
}

function emit(a: Account | null) {
  current = a;
  pending = false;
  listeners.forEach((cb) => cb(a));
  readyListeners.forEach((cb) => cb());
  if (!a) setWallet(null);
  else if (!wallet) void refreshWallet();
}

/** Uruchamia nasłuch sesji (także po kliknięciu linku z e-maila). */
export function initAccounts() {
  if (!accountsEnabled) return;
  window.setTimeout(settle, 4000); // never keep the screen blank if the restore hangs
  getClient().auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') recoveryListeners.forEach((cb) => cb());
    const user = session?.user;
    if (!user) {
      if (current) emit(null);
      else settle();
      return;
    }
    if (current?.userId === user.id) return;
    // poza callbackiem – zapytanie do bazy w środku onAuthStateChange może się zakleszczyć
    setTimeout(() => {
      loadProfile(user.id, user.email ?? '').then(emit, () => emit({ userId: user.id, email: user.email ?? '', nick: 'Gracz' }));
    }, 0);
  });
}

const PL_ERRORS: [RegExp, string][] = [
  [/invalid login credentials/i, 'Invalid e-mail or password.'],
  [/email not confirmed/i, 'Please confirm your e-mail first (link in our message).'],
  [/already registered|already been registered/i, 'This e-mail already has an account – log in.'],
  [/password should be at least/i, 'Password must be at least 6 characters.'],
  [/rate limit|too many/i, 'Too many attempts – try again in a few minutes.'],
  [/duplicate key|profiles_nick_unique|23505/i, 'This nickname is already taken.'],
  [/new password should be different/i, 'The new password must differ from the previous one.'],
  [/invalid email|unable to validate email/i, 'Invalid e-mail address.'],
];
export function plError(e: unknown): string {
  const msg = String((e as { message?: string })?.message ?? e);
  for (const [re, pl] of PL_ERRORS) if (re.test(msg)) return pl;
  return `Error: ${msg}`;
}

export async function signIn(email: string, password: string) {
  const { error } = await getClient().auth.signInWithPassword({ email, password });
  if (error) throw error;
}

/** Rejestracja; zwraca true, gdy trzeba potwierdzić e-mail. */
export async function signUp(nick: string, email: string, password: string): Promise<boolean> {
  const { data, error } = await getClient().auth.signUp({
    email,
    password,
    options: { data: { nick }, emailRedirectTo: `${location.origin}${location.pathname}` },
  });
  if (error) throw error;
  return !data.session;
}

export async function signOut() {
  await getClient().auth.signOut();
  emit(null);
}

export async function fetchLeaderboard(limit = 20): Promise<LeaderRow[]> {
  const { data, error } = await getClient().from('leaderboard').select('nick,user_id,best_ms,achieved_at').limit(limit);
  if (error) throw error;
  return (data ?? []) as LeaderRow[];
}

/** Najlepszy czas i miejsce zalogowanego gracza (miejsce tylko w top 100). */
export async function fetchMyBest(userId: string): Promise<{ best: number | null; place: number | null }> {
  const { data } = await getClient()
    .from('race_results')
    .select('verified_ms')
    .eq('user_id', userId)
    .eq('valid', true)
    .order('verified_ms', { ascending: true })
    .limit(1);
  const best = (data?.[0]?.verified_ms as number | undefined) ?? null;
  if (best === null) return { best, place: null };
  const top = await fetchLeaderboard(100).catch(() => [] as LeaderRow[]);
  const idx = top.findIndex((r) => r.user_id === userId);
  return { best, place: idx >= 0 ? idx + 1 : null };
}

/** Wysyła e-mail z linkiem do ustawienia nowego hasła. */
export async function resetPassword(email: string) {
  const { error } = await getClient().auth.resetPasswordForEmail(email, {
    redirectTo: `${location.origin}${location.pathname}`,
  });
  if (error) throw error;
}

export async function updatePassword(password: string) {
  const { error } = await getClient().auth.updateUser({ password });
  if (error) throw error;
}

/** Zmiana nicku w profilu (unikalny, bez rozróżniania wielkości liter). */
export async function changeNick(nick: string) {
  if (!current) throw new Error('not signed in');
  const { error } = await getClient().from('profiles').update({ nick }).eq('id', current.userId);
  if (error) throw error;
  emit({ ...current, nick });
}

export interface HistoryRow {
  created_at: string;
  match_id: string;
  room_code: string;
  verified_ms: number | null;
  valid: boolean;
  suspect: boolean;
  perfects: number;
  won: boolean;
  players: number;
}

/** Ostatnie rundy zalogowanego gracza (widok my_results pokazuje tylko jego wiersze). */
export async function fetchHistory(limit = 30): Promise<HistoryRow[]> {
  const { data, error } = await getClient()
    .from('my_results')
    .select('created_at,match_id,room_code,verified_ms,valid,suspect,perfects,won,players')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as HistoryRow[];
}

// ---------- strój, waluta (chalk) i cieszynki ----------

export interface Wallet {
  chalk: number;
  /** the celebration I play at the top after a win */
  celebration: Celebration;
  /** bought celebrations ('clap' is free and not listed) */
  owned: Celebration[];
}
export const CELEB_PRICE = 200;

let wallet: Wallet | null = null;
const walletListeners = new Set<(w: Wallet | null) => void>();
export const getWallet = () => wallet;
export function onWalletChange(cb: (w: Wallet | null) => void) {
  walletListeners.add(cb);
  return () => walletListeners.delete(cb);
}
function setWallet(w: Wallet | null) {
  wallet = w;
  walletListeners.forEach((cb) => cb(w));
}
const asCeleb = (x: unknown): Celebration => (CELEBRATIONS.includes(x as Celebration) ? (x as Celebration) : 'clap');

/** my celebration (a guest always does the free one) */
export const myCelebration = (): Celebration => (current && wallet ? wallet.celebration : 'clap');

/** reads the balance, the equipped and the owned celebrations from the server (the client never changes them) */
export async function refreshWallet(): Promise<Wallet | null> {
  if (!current) {
    setWallet(null);
    return null;
  }
  const { data, error } = await getClient().rpc('my_wallet');
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return wallet;
  setWallet({
    chalk: Math.max(0, Number(row.chalk) || 0),
    celebration: asCeleb(row.celebration),
    owned: ((row.owned ?? []) as unknown[]).map(asCeleb).filter((c) => c !== 'clap'),
  });
  return wallet;
}

/** a known RPC error code (not_enough_chalk, already_owned, not_owned, …) or null */
export function rpcCode(e: unknown): string | null {
  const m = String((e as { message?: string })?.message ?? e).match(/not_enough_chalk|already_owned|not_owned|not_logged_in|unknown_item/);
  return m ? m[0] : null;
}

/** buys (and equips) a celebration; returns the new balance */
export async function buyCelebration(c: Celebration): Promise<number> {
  const { data, error } = await getClient().rpc('buy_celebration', { item: c });
  if (error) {
    void refreshWallet().catch(() => {});
    throw error;
  }
  await refreshWallet().catch(() => {});
  return Number(data) || 0;
}

export async function equipCelebration(c: Celebration) {
  const { error } = await getClient().rpc('equip_celebration', { item: c });
  if (error) throw error;
  await refreshWallet();
}

/** saves my outfit in the profile (logged in only; guests keep it in the browser) */
export async function saveOutfitRemote(o: Outfit) {
  if (!current) return;
  const { error } = await getClient().from('profiles').update({ outfit: o }).eq('id', current.userId);
  if (error) throw error;
}

/** the chalk I won in this match (null: none recorded yet) */
export async function fetchMatchReward(matchId: string): Promise<number | null> {
  if (!current) return null;
  const { data } = await getClient().from('chalk_ledger').select('delta').eq('match_id', matchId).eq('reason', 'win').maybeSingle();
  return data ? Number(data.delta) : null;
}

// ---------- ranking i profil ----------

export interface RankRow {
  user_id: string;
  nick: string;
  outfit: Outfit | null;
  /** best time in ms (FASTEST) or number of wins (MOST WINS) */
  value: number;
}

async function outfitsOf(ids: string[]): Promise<Map<string, Outfit | null>> {
  const map = new Map<string, Outfit | null>();
  if (!ids.length) return map;
  const { data } = await getClient().from('profiles').select('id,outfit').in('id', ids);
  for (const r of data ?? []) map.set(r.id as string, sanitizeOutfit(r.outfit));
  return map;
}

/** best verified time per climber (top 100) */
export async function fetchFastest(): Promise<RankRow[]> {
  const rows = await fetchLeaderboard(100);
  const outfits = await outfitsOf(rows.map((r) => r.user_id)).catch(() => new Map<string, Outfit | null>());
  return rows.map((r) => ({ user_id: r.user_id, nick: r.nick, outfit: outfits.get(r.user_id) ?? null, value: r.best_ms }));
}

/** verified room wins per climber (top 100, the wins that earned chalk) */
export async function fetchWins(): Promise<RankRow[]> {
  const { data, error } = await getClient().from('leaderboard_wins').select('user_id,nick,outfit,wins').limit(100);
  if (error) throw error;
  return (data ?? []).map((r) => ({ user_id: r.user_id as string, nick: r.nick as string, outfit: sanitizeOutfit(r.outfit), value: Number(r.wins) || 0 }));
}

/** my wins (reward entries in my ledger) */
export async function fetchMyWins(): Promise<number> {
  if (!current) return 0;
  const { count } = await getClient().from('chalk_ledger').select('id', { count: 'exact', head: true }).eq('reason', 'win');
  return count ?? 0;
}

export interface ProfileData {
  since: string | null;
  history: HistoryRow[];
  /** chalk won per match id */
  rewards: Map<string, number>;
  best: { best: number | null; place: number | null };
}

export async function fetchProfileData(): Promise<ProfileData> {
  if (!current) throw new Error('not signed in');
  const me = current;
  const [prof, history, best] = await Promise.all([
    getClient().from('profiles').select('created_at').eq('id', me.userId).maybeSingle(),
    fetchHistory(200),
    fetchMyBest(me.userId),
  ]);
  const rewards = new Map<string, number>();
  const ids = history.slice(0, 30).map((h) => h.match_id).filter(Boolean);
  if (ids.length) {
    const { data } = await getClient().from('chalk_ledger').select('match_id,delta').eq('reason', 'win').in('match_id', ids);
    for (const r of data ?? []) rewards.set(r.match_id as string, Number(r.delta) || 0);
  }
  return { since: (prof.data?.created_at as string | undefined) ?? null, history, rewards, best };
}

export interface LedgerRow {
  delta: number;
  reason: 'win' | 'purchase' | 'admin';
  item: string | null;
  created_at: string;
  /** climbers in the match (wins only) */
  players: number | null;
}

/** my latest chalk operations: wins and purchases */
export async function fetchLedger(limit = 5): Promise<LedgerRow[]> {
  if (!current) return [];
  const { data, error } = await getClient()
    .from('chalk_ledger')
    .select('delta,reason,item,match_id,created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  const rows = data ?? [];
  const ids = rows.map((r) => r.match_id as string | null).filter((x): x is string => !!x);
  const players = new Map<string, number>();
  if (ids.length) {
    const { data: m } = await getClient().from('matches').select('id,players').in('id', ids);
    for (const x of m ?? []) players.set(x.id as string, ((x.players as unknown[]) ?? []).length);
  }
  return rows.map((r) => ({
    delta: Number(r.delta) || 0,
    reason: r.reason as LedgerRow['reason'],
    item: (r.item as string | null) ?? null,
    created_at: r.created_at as string,
    players: r.match_id ? (players.get(r.match_id as string) ?? null) : null,
  }));
}
