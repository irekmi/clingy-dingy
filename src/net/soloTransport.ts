import type { Handler, PlayerMeta, RoomTransport } from './transport';

/** Solo run: nobody else is in the room, so there is nothing to send or receive. */
export class SoloTransport implements RoomTransport {
  readonly kind = 'local' as const;
  async connect(_me: PlayerMeta) {}
  setMeta(_me: PlayerMeta) {}
  send(_event: string, _payload: unknown) {}
  on(_event: string, _h: Handler) {}
  onPlayers(_cb: (players: PlayerMeta[]) => void) {}
  close() {}
}
