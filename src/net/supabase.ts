import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import type { InputEvent } from '@sim';
import type { Handler, PlayerMeta, RoomTransport } from './transport';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_KEY as string | undefined;

export const supabaseConfigured = Boolean(url && key && !url.includes('TWOJ-PROJEKT'));

let client: SupabaseClient | null = null;
export function getClient(): SupabaseClient {
  // sesja logowania zapamiętana w przeglądarce; link z e-maila potwierdzającego loguje automatycznie
  if (!client) client = createClient(url!, key!, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  return client;
}

/** Realtime: Broadcast (zdarzenia gry) + Presence (lista graczy w pokoju) po WebSockecie. */
export class SupabaseTransport implements RoomTransport {
  readonly kind = 'supabase' as const;
  private ch: RealtimeChannel | null = null;
  private handlers = new Map<string, Handler[]>();
  private playersCb: (p: PlayerMeta[]) => void = () => {};

  constructor(private code: string) {}

  connect(me: PlayerMeta): Promise<void> {
    const ch = getClient().channel(`room-${this.code}`, {
      config: { broadcast: { self: false }, presence: { key: me.id } },
    });
    this.ch = ch;
    for (const [event, hs] of this.handlers) {
      ch.on('broadcast', { event }, ({ payload }) => hs.forEach((h) => h(payload)));
    }
    ch.on('presence', { event: 'sync' }, () => {
      const state = ch.presenceState<PlayerMeta>();
      const list: PlayerMeta[] = [];
      for (const entries of Object.values(state)) {
        const m = entries[entries.length - 1];
        if (m && typeof m.id === 'string') list.push({ id: m.id, nick: m.nick, ready: m.ready, joinedAt: m.joinedAt, acct: !!m.acct });
      }
      this.playersCb(list);
    });
    return new Promise((resolve, reject) => {
      ch.subscribe(async (status, err) => {
        if (status === 'SUBSCRIBED') {
          await ch.track(me);
          resolve();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          reject(err ?? new Error(status));
        }
      });
    });
  }

  setMeta(me: PlayerMeta) {
    void this.ch?.track(me);
  }

  send(event: string, payload: unknown) {
    void this.ch?.send({ type: 'broadcast', event, payload });
  }

  on(event: string, h: Handler) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), h]);
  }

  onPlayers(cb: (p: PlayerMeta[]) => void) {
    this.playersCb = cb;
  }

  close() {
    if (this.ch) void getClient().removeChannel(this.ch);
    this.ch = null;
  }
}

export interface SubmitReply {
  valid: boolean;
  verifiedMs: number | null;
  /** wynik wszedł do rankingu ogólnego */
  ranked?: boolean;
  /** serwer uznał bieg za podejrzany (np. zbyt równe trafienia) */
  suspect?: boolean;
  flags?: string[];
}

/** Zakłada mecz na serwerze; null = nie udało się (wynik takiego meczu nie trafi do rankingu). */
export async function createMatch(room: string, players: string[]): Promise<string | null> {
  try {
    const { data, error } = await getClient().functions.invoke('create-match', { body: { room, players } });
    if (error) throw error;
    return typeof data?.matchId === 'string' ? data.matchId : null;
  } catch {
    return null;
  }
}

export interface SubmitBody {
  matchId: string;
  room: string;
  playerId: string;
  nick: string;
  claimedMs: number;
  inputs: InputEvent[];
}

/** Wysyła wynik do Edge Function, która odtwarza bieg i zapisuje zweryfikowany czas w bazie. */
export async function submitResult(body: SubmitBody): Promise<SubmitReply> {
  const { data, error } = await getClient().functions.invoke('submit-result', { body });
  if (error) throw error;
  return data;
}
