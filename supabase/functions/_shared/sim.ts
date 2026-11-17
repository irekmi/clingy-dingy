// Deterministyczna symulacja wspinaczki.
//
// Ten sam plik działa w przeglądarce (Vite, alias "@sim") i na serwerze (Supabase Edge Function / Deno).
// Dzięki temu serwer może odtworzyć bieg z logu wciśnięć i sprawdzić, czy zgłoszony czas jest prawdziwy.
//
// Zasady determinizmu:
//  - wszystkie czasy to CAŁKOWITE milisekundy liczone od sygnału START (lokalny timer gracza),
//  - logika używa tylko liczb całkowitych (bez Math.random / Math.pow w trakcie biegu),
//  - stan zmienia wyłącznie press(); tick() jest czystą funkcją (do wyświetlania) i jest składalny:
//    tick(tick(s, a), b) === tick(s, b) dla a <= b.
//
// Mechanika (rytm): po złapaniu chwytu na NASTĘPNYM chwycie zaciska się pierścień (czas = period).
// Wciśnij klawisz strony tego chwytu (← lewa / → prawa), gdy pierścień się zamknie.
//  - PERFEKT (±perfectWin ms): wchodzisz wyżej, tempo przyspiesza (combo),
//  - OK (±goodWin ms): wchodzisz wyżej, tempo bez zmian,
//  - ZA WCZEŚNIE: krótkie zatrzymanie, tempo resetuje się,
//  - ZŁA RĘKA: ześlizg o jeden chwyt w dół + dłuższe zatrzymanie,
//  - SPÓŹNIONE (brak reakcji): pierścień zaczyna od nowa, tempo resetuje się.

export type Side = 0 | 1; // 0 = lewa ręka / lewy chwyt, 1 = prawa
export type Feedback = 'none' | 'perfect' | 'good' | 'early' | 'wrong' | 'miss';
export type InputEvent = [t: number, side: Side];

export const CFG = {
  holds: 24, // ile chwytów do szczytu
  basePeriod: 720, // ms – czas zaciskania pierścienia na starcie i po błędzie
  minPeriod: 360, // ms – najszybsze możliwe tempo
  comboPct: 92, // każde PERFEKT skraca okres do 92%
  perfectWin: 50, // ± ms
  goodWin: 120, // ± ms
  earlyStun: 250, // ms
  slipStun: 650, // ms
  maxInputs: 1000,
} as const;

export interface Route {
  seed: number;
  /** strona chwytu i (index 0 = chwyt startowy) */
  sides: Side[];
  /** przesunięcie poziome chwytu w procentach połowy ściany (-100..100), tylko do rysowania */
  xs: number[];
}

export interface SimState {
  hold: number; // na którym chwycie jesteśmy (0..CFG.holds)
  cycleStart: number; // kiedy zaczął się zaciskać pierścień na następnym chwycie
  period: number; // ile trwa zaciskanie
  combo: number;
  finishedAt: number | null;
  last: Feedback;
  lastAt: number;
  perfects: number;
  goods: number;
  errors: number;
}

/** FNV-1a 32-bit */
export function hashSeed(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeRoute(seed: number): Route {
  const rnd = mulberry32(seed);
  const sides: Side[] = [0];
  const xs: number[] = [0];
  let streak = 0;
  for (let i = 1; i <= CFG.holds; i++) {
    const prev = sides[i - 1];
    let side: Side;
    if (i === 1) side = rnd() < 0.5 ? 0 : 1;
    else if (streak >= 2) side = prev === 0 ? 1 : 0; // max 2 razy ta sama ręka z rzędu
    else side = rnd() < 0.7 ? (prev === 0 ? 1 : 0) : prev; // zwykle na zmianę
    streak = side === prev ? streak + 1 : 1;
    sides.push(side);
    const off = 35 + Math.floor(rnd() * 50); // 35..84
    xs.push(side === 0 ? -off : off);
  }
  return { seed, sides, xs };
}

/** Trasa jest wyznaczana z identyfikatora meczu – obaj gracze mają identyczną ścianę. */
export function routeFor(matchId: string): Route {
  return makeRoute(hashSeed(matchId));
}

export function initState(): SimState {
  return {
    hold: 0,
    cycleStart: 0,
    period: CFG.basePeriod,
    combo: 0,
    finishedAt: null,
    last: 'none',
    lastAt: 0,
    perfects: 0,
    goods: 0,
    errors: 0,
  };
}

/** Stan w chwili t (obsługuje przegapione chwyty). Nie mutuje wejścia. */
export function tick(s: SimState, t: number): SimState {
  if (s.finishedAt !== null) return s;
  const limit = s.cycleStart + s.period + CFG.goodWin;
  if (t <= limit) return s;
  const period = CFG.basePeriod;
  let cycleStart = limit;
  let misses = 1;
  while (t > cycleStart + period + CFG.goodWin) {
    cycleStart += period + CFG.goodWin;
    misses++;
  }
  return { ...s, cycleStart, period, combo: 0, last: 'miss', lastAt: cycleStart, errors: s.errors + misses };
}

/** Wciśnięcie klawisza w chwili t. */
export function press(s0: SimState, route: Route, t: number, side: Side): SimState {
  const s = tick(s0, t);
  if (s.finishedAt !== null) return s;
  if (t < s.cycleStart) return s; // zatrzymanie po błędzie – wciśnięcia ignorowane

  const next = s.hold + 1;
  const dt = t - (s.cycleStart + s.period);

  if (side !== route.sides[next]) {
    return {
      ...s,
      hold: Math.max(0, s.hold - 1),
      combo: 0,
      period: CFG.basePeriod,
      cycleStart: t + CFG.slipStun,
      last: 'wrong',
      lastAt: t,
      errors: s.errors + 1,
    };
  }
  if (dt < -CFG.goodWin) {
    return {
      ...s,
      combo: 0,
      period: CFG.basePeriod,
      cycleStart: t + CFG.earlyStun,
      last: 'early',
      lastAt: t,
      errors: s.errors + 1,
    };
  }
  // dt > goodWin jest niemożliwe – tick() zresetowałby już cykl
  const perfect = Math.abs(dt) <= CFG.perfectWin;
  const period = perfect
    ? Math.max(CFG.minPeriod, Math.floor((s.period * CFG.comboPct) / 100))
    : s.period;
  return {
    ...s,
    hold: next,
    combo: perfect ? s.combo + 1 : s.combo,
    period,
    cycleStart: t,
    finishedAt: next >= CFG.holds ? t : null,
    last: perfect ? 'perfect' : 'good',
    lastAt: t,
    perfects: s.perfects + (perfect ? 1 : 0),
    goods: s.goods + (perfect ? 0 : 1),
  };
}

/** Odtwarza cały bieg z logu wciśnięć. Rzuca błąd przy nieprawidłowym logu. */
export function replay(route: Route, inputs: unknown): SimState {
  if (!Array.isArray(inputs) || inputs.length > CFG.maxInputs) throw new Error('bad inputs');
  let s = initState();
  let prev = 0;
  for (const ev of inputs) {
    if (!Array.isArray(ev) || ev.length !== 2) throw new Error('bad event');
    const [t, side] = ev as [unknown, unknown];
    if (typeof t !== 'number' || !Number.isInteger(t) || t < prev || t > 3_600_000) throw new Error('bad time');
    if (side !== 0 && side !== 1) throw new Error('bad side');
    prev = t;
    s = press(s, route, t, side);
    if (s.finishedAt !== null) break;
  }
  return s;
}
