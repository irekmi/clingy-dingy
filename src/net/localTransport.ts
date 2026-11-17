import type { Handler, PlayerMeta, RoomTransport } from './transport';

type Msg =
  | { type: 'hello'; meta: PlayerMeta }
  | { type: 'meta'; meta: PlayerMeta }
  | { type: 'bye'; id: string }
  | { type: 'evt'; event: string; payload: unknown };

/** Tryb testowy bez serwera: komunikacja między kartami tej samej przeglądarki. */
export class LocalTransport implements RoomTransport {
  readonly kind = 'local' as const;
  private bc: BroadcastChannel;
  private me: PlayerMeta | null = null;
  private others = new Map<string, { meta: PlayerMeta; seen: number }>();
  private handlers = new Map<string, Handler[]>();
  private playersCb: (p: PlayerMeta[]) => void = () => {};
  private timer = 0;

  constructor(code: string) {
    this.bc = new BroadcastChannel(`patyczaki-room-${code}`);
    this.bc.onmessage = (e) => this.onMsg(e.data as Msg);
  }

  async connect(me: PlayerMeta) {
    this.me = me;
    this.post({ type: 'hello', meta: me });
    this.timer = window.setInterval(() => {
      if (this.me) this.post({ type: 'meta', meta: this.me });
      this.prune();
    }, 1000);
    window.addEventListener('pagehide', this.bye);
    this.emitPlayers();
  }

  setMeta(me: PlayerMeta) {
    this.me = me;
    this.post({ type: 'meta', meta: me });
    this.emitPlayers();
  }

  send(event: string, payload: unknown) {
    this.post({ type: 'evt', event, payload });
  }

  on(event: string, h: Handler) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), h]);
  }

  onPlayers(cb: (p: PlayerMeta[]) => void) {
    this.playersCb = cb;
  }

  close() {
    this.bye();
    clearInterval(this.timer);
    window.removeEventListener('pagehide', this.bye);
    this.bc.close();
  }

  private bye = () => {
    if (this.me) this.post({ type: 'bye', id: this.me.id });
  };

  private post(m: Msg) {
    try {
      this.bc.postMessage(m);
    } catch {
      /* kanał zamknięty */
    }
  }

  private onMsg(m: Msg) {
    switch (m?.type) {
      case 'hello':
        this.upsert(m.meta);
        if (this.me) this.post({ type: 'meta', meta: this.me });
        break;
      case 'meta':
        this.upsert(m.meta);
        break;
      case 'bye':
        if (this.others.delete(m.id)) this.emitPlayers();
        break;
      case 'evt':
        this.handlers.get(m.event)?.forEach((h) => h(m.payload));
        break;
    }
  }

  private upsert(meta: PlayerMeta) {
    if (!meta || typeof meta.id !== 'string' || meta.id === this.me?.id) return;
    this.others.set(meta.id, { meta, seen: Date.now() });
    this.emitPlayers();
  }

  private prune() {
    const now = Date.now();
    let changed = false;
    for (const [id, o] of this.others) {
      if (now - o.seen > 4000) {
        this.others.delete(id);
        changed = true;
      }
    }
    if (changed) this.emitPlayers();
  }

  private emitPlayers() {
    const list = [...this.others.values()].map((o) => o.meta);
    if (this.me) list.push(this.me);
    this.playersCb(list);
  }
}
