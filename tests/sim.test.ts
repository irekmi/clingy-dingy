import { describe, expect, it } from 'vitest';
import {
  CFG,
  analyzeRun,
  botFlags,
  initState,
  makeRoute,
  press,
  replay,
  routeFor,
  tick,
  type InputEvent,
  type Route,
  type Side,
  type SimState,
} from '../supabase/functions/_shared/sim';

function perfectRun(route: Route) {
  let s = initState();
  const inputs: InputEvent[] = [];
  while (s.finishedAt === null) {
    const t = s.cycleStart + s.period;
    const side = route.sides[s.hold + 1];
    inputs.push([t, side]);
    s = press(s, route, t, side);
  }
  return { s, inputs };
}

function rng(seed: number) {
  let x = seed;
  return () => ((x = (Math.imul(x, 1103515245) + 12345) >>> 0) / 4294967296);
}

describe('trasa', () => {
  it('jest deterministyczna dla tego samego meczu', () => {
    expect(routeFor('match-1')).toEqual(routeFor('match-1'));
    expect(routeFor('match-1').sides).not.toEqual(routeFor('match-2').sides);
  });

  it('nie ma więcej niż 2 tych samych stron z rzędu', () => {
    for (let seed = 0; seed < 200; seed++) {
      const { sides } = makeRoute(seed);
      expect(sides).toHaveLength(CFG.holds + 1);
      for (let i = 3; i < sides.length; i++) {
        expect(sides[i] === sides[i - 1] && sides[i] === sides[i - 2] && sides[i] === sides[i - 3]).toBe(false);
      }
    }
  });
});

describe('symulacja', () => {
  it('idealny bieg kończy się w rozsądnym czasie i odtwarza się identycznie', () => {
    const route = routeFor('perfect');
    const { s, inputs } = perfectRun(route);
    expect(s.perfects).toBe(CFG.holds);
    expect(s.finishedAt!).toBeGreaterThan(8000);
    expect(s.finishedAt!).toBeLessThan(12000);
    expect(replay(route, inputs).finishedAt).toBe(s.finishedAt);
  });

  it('zła ręka powoduje ześlizg', () => {
    const route = routeFor('slip');
    let s = initState();
    const ok = route.sides[1];
    s = press(s, route, 720, ok);
    expect(s.hold).toBe(1);
    const wrong = (route.sides[2] === 0 ? 1 : 0) as Side;
    s = press(s, route, 720 + s.period, wrong);
    expect(s.hold).toBe(0);
    expect(s.last).toBe('wrong');
  });

  it('tick jest składalny (wyświetlanie nie wpływa na wynik)', () => {
    const r = rng(7);
    for (let n = 0; n < 500; n++) {
      const s: SimState = { ...initState(), cycleStart: Math.floor(r() * 3000), period: 360 + Math.floor(r() * 400) };
      const a = Math.floor(r() * 10000);
      const b = a + Math.floor(r() * 10000);
      expect(tick(tick(s, a), b)).toEqual(tick(s, b));
    }
  });

  it('losowa gra: stan klienta == stan z replay na serwerze', () => {
    const r = rng(42);
    for (let game = 0; game < 50; game++) {
      const route = routeFor(`g${game}`);
      let s = initState();
      const inputs: InputEvent[] = [];
      let t = 0;
      while (s.finishedAt === null && inputs.length < 600) {
        t += Math.floor(r() * 900);
        tick(s, t - 5); // klatki rysowania nie mutują stanu
        const side = (r() < 0.85 ? route.sides[s.hold + 1] : r() < 0.5 ? 0 : 1) as Side;
        inputs.push([t, side]);
        s = press(s, route, t, side);
      }
      expect(replay(route, inputs)).toEqual(s);
    }
  });

  it('odrzuca nieposortowany lub zły log', () => {
    const route = routeFor('x');
    expect(() => replay(route, [[100, 0], [50, 1]])).toThrow();
    expect(() => replay(route, [[100.5, 0]])).toThrow();
    expect(() => replay(route, [[100, 2]])).toThrow();
    expect(() => replay(route, 'nope')).toThrow();
  });
});

describe('analiza biegu i wykrywanie botów', () => {
  it('analyzeRun daje ten sam stan co replay i odchyłki udanych trafień', () => {
    const route = routeFor('analiza');
    const { s, inputs } = perfectRun(route);
    const a = analyzeRun(route, inputs);
    expect(a.state).toEqual(s);
    expect(a.offsets).toHaveLength(CFG.holds);
    expect(a.offsets.every((d) => d === 0)).toBe(true);
  });

  it('idealny, maszynowy bieg jest podejrzany', () => {
    const { inputs } = perfectRun(routeFor('bot'));
    const flags = botFlags(analyzeRun(routeFor('bot'), inputs).offsets);
    expect(flags).toContain('robotic_precision');
    expect(flags).toContain('frame_perfect');
  });

  it('bieg z ludzkim rozrzutem (ok. 25 ms) nie jest podejrzany', () => {
    const r = rng(11);
    const gauss = () => (r() + r() + r() + r() - 2) * 38; // ok. 25 ms odchylenia
    let flagged = 0;
    for (let g = 0; g < 30; g++) {
      const route = routeFor('human' + g);
      let s = initState();
      const inputs: InputEvent[] = [];
      while (s.finishedAt === null && inputs.length < 200) {
        const t = Math.max(s.cycleStart, Math.round(s.cycleStart + s.period + gauss()));
        const side = route.sides[s.hold + 1];
        inputs.push([t, side]);
        s = press(s, route, t, side);
      }
      if (botFlags(analyzeRun(route, inputs).offsets).length) flagged++;
    }
    expect(flagged).toBe(0);
  });

  it('krótki bieg nie jest oceniany', () => {
    expect(botFlags([0, 0, 0])).toEqual([]);
  });
});
