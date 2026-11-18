/** Kto jest w pokoju (Presence). */
export interface PlayerMeta {
  id: string;
  nick: string;
  /** losowy token gotowości (null = niegotowy) – host zużywa go przy starcie, więc nie da się wystartować 2x */
  ready: string | null;
  joinedAt: number;
  /** gracz zalogowany (wynik może trafić do rankingu) */
  acct?: boolean;
  /** custom outfit (validated with sanitizeOutfit by the receiver) */
  outfit?: unknown;
  /** victory celebration (checked against CELEBRATIONS by the receiver) */
  celebration?: string;
}

export type Handler = (payload: any) => void;

/**
 * Kanał pokoju. Dwie implementacje:
 *  - SupabaseTransport: WebSocket przez Supabase Realtime (różne przeglądarki / komputery),
 *  - LocalTransport: BroadcastChannel (dwie karty tej samej przeglądarki, do testów bez backendu).
 * Handlery (on/onPlayers) rejestruj PRZED connect().
 */
export interface RoomTransport {
  readonly kind: 'local' | 'supabase';
  connect(me: PlayerMeta): Promise<void>;
  setMeta(me: PlayerMeta): void;
  /** wysyła do pozostałych graczy (nie do siebie) */
  send(event: string, payload: unknown): void;
  on(event: string, h: Handler): void;
  onPlayers(cb: (players: PlayerMeta[]) => void): void;
  close(): void;
}
