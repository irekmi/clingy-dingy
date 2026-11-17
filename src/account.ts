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

export const accountsEnabled = supabaseConfigured;
export const getAccount = () => current;

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
  getClient().auth.onAuthStateChange((_event, session) => {
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
  [/invalid login credentials/i, 'Nieprawidłowy e-mail lub hasło.'],
  [/email not confirmed/i, 'Potwierdź najpierw adres e-mail (link w wiadomości od nas).'],
  [/already registered|already been registered/i, 'Ten e-mail ma już konto – zaloguj się.'],
  [/password should be at least/i, 'Hasło musi mieć co najmniej 6 znaków.'],
  [/rate limit|too many/i, 'Za dużo prób – spróbuj za kilka minut.'],
  [/invalid email|unable to validate email/i, 'Nieprawidłowy adres e-mail.'],
];
export function plError(e: unknown): string {
  const msg = String((e as { message?: string })?.message ?? e);
  for (const [re, pl] of PL_ERRORS) if (re.test(msg)) return pl;
  return `Błąd: ${msg}`;
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
