// Konta graczy: Supabase Auth (e-mail + hasło) i ranking najlepszych czasów.
import { getClient, supabaseConfigured } from './net/supabase';

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
  const { data } = await getClient().from('profiles').select('nick').eq('id', userId).maybeSingle();
  return { userId, email, nick: data?.nick ?? email.split('@')[0].slice(0, 16) };
}

function emit(a: Account | null) {
  current = a;
  listeners.forEach((cb) => cb(a));
}

/** Uruchamia nasłuch sesji (także po kliknięciu linku z e-maila). */
export function initAccounts() {
  if (!accountsEnabled) return;
  getClient().auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') recoveryListeners.forEach((cb) => cb());
    const user = session?.user;
    if (!user) {
      if (current) emit(null);
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
