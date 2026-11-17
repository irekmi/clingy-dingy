// Supabase Edge Function: przyjmuje wynik gracza i zapisuje go w tabeli race_results.
//
// Co sprawdza serwer (sam wynik od klienta nic nie znaczy):
//  1. odtwarza bieg z logu wciśnięć (ta sama symulacja co w przeglądarce) – czas musi się zgadzać,
//  2. mecz musi istnieć na serwerze (create-match), a gracz być jego uczestnikiem,
//  3. czas ścienny: od założenia meczu musiało upłynąć co najmniej odliczanie + zgłoszony czas biegu,
//  4. statystyka trafień: nienaturalnie równe trafienia = bot -> wynik zapisany, ale poza rankingiem,
//  5. po zgłoszeniu wyników wszystkich uczestników serwer rozstrzyga zwycięzcę meczu.
//
// Deploy:  npx supabase functions deploy submit-result
import { createClient } from 'npm:@supabase/supabase-js@2';
import { analyzeRun, botFlags, routeFor } from '../_shared/sim.ts';

const COUNTDOWN_MS = 3000;
const SLACK_MS = 1000; // zapas na opóźnienia sieci i planowania zegarów
const MAX_AGE_MS = 15 * 60 * 1000; // wynik zgłoszony później niż 15 min po starcie nie liczy się

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROOM_RE = /^[A-Z0-9]{4,8}$/;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad json' }, 400);
  }
  const { matchId, room, playerId, nick, claimedMs, inputs } = body ?? {};
  if (
    typeof matchId !== 'string' || !UUID_RE.test(matchId) ||
    typeof playerId !== 'string' || !UUID_RE.test(playerId) ||
    typeof room !== 'string' || !ROOM_RE.test(room) ||
    typeof nick !== 'string' || nick.trim().length < 1 || nick.length > 16 ||
    typeof claimedMs !== 'number' || !Number.isInteger(claimedMs) || claimedMs < 0
  ) {
    return json({ error: 'bad payload' }, 400);
  }

  let analysis;
  try {
    analysis = analyzeRun(routeFor(matchId), inputs);
  } catch {
    return json({ error: 'bad inputs' }, 400);
  }
  const { state, offsets } = analysis;
  const verifiedMs = state.finishedAt;
  const valid = verifiedMs !== null && verifiedMs === claimedMs;

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });

  const flags: string[] = [];

  // mecz założony na serwerze, gracz jest jego uczestnikiem
  const { data: match } = await supabase
    .from('matches')
    .select('id, room_code, players, created_at, finished_at')
    .eq('id', matchId)
    .maybeSingle();
  if (!match) {
    // starsi klienci (sprzed create-match): wynik zapisujemy, ale nie liczy się do rankingu
    flags.push('no_match');
  } else {
    if (match.room_code !== room || !(match.players as string[]).includes(playerId)) {
      return json({ error: 'not a participant' }, 403);
    }
    const elapsed = Date.now() - new Date(match.created_at).getTime();
    if (elapsed > MAX_AGE_MS) return json({ error: 'match too old' }, 410);
    if (valid && elapsed < COUNTDOWN_MS + claimedMs - SLACK_MS) flags.push('too_fast');
  }
  if (valid) flags.push(...botFlags(offsets));
  const suspect = flags.length > 0;

  // Zalogowany gracz: token sesji (JWT) w nagłówku Authorization. Gość wysyła tylko klucz publiczny.
  let userId: string | null = null;
  let finalNick = nick.trim();
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (token.split('.').length === 3) {
    const { data } = await supabase.auth.getUser(token);
    if (data.user) {
      userId = data.user.id;
      const { data: prof } = await supabase.from('profiles').select('nick').eq('id', userId).maybeSingle();
      if (prof?.nick) finalNick = prof.nick;
    }
  }

  const { error } = await supabase.from('race_results').insert({
    match_id: matchId,
    room_code: room,
    player_id: playerId,
    user_id: userId,
    nick: finalNick,
    claimed_ms: claimedMs,
    verified_ms: verifiedMs,
    valid,
    suspect,
    flags,
    perfects: state.perfects,
    goods: state.goods,
    errors: state.errors,
    inputs,
  });
  if (error) {
    if (error.code === '23505') return json({ error: 'already submitted' }, 409);
    console.error(error);
    return json({ error: 'db error' }, 500);
  }

  // rozstrzygnięcie zwycięzcy po stronie serwera, gdy wszyscy uczestnicy mają już wynik
  let winnerIsYou = false;
  let decided = false;
  if (match) {
    const { data: all } = await supabase
      .from('race_results')
      .select('player_id, verified_ms, valid, suspect')
      .eq('match_id', matchId);
    const players = match.players as string[];
    if (all && all.length >= players.length && !match.finished_at) {
      const best = all
        .filter((r) => r.valid && !r.suspect && r.verified_ms !== null)
        .sort((a, b) => a.verified_ms - b.verified_ms)[0];
      await supabase
        .from('matches')
        .update({ finished_at: new Date().toISOString(), winner_player_id: best?.player_id ?? null })
        .eq('id', matchId)
        .is('finished_at', null);
      decided = true;
      winnerIsYou = best?.player_id === playerId;
    }
  }

  return json({ valid, verifiedMs, ranked: userId !== null && valid && !suspect, suspect, flags, decided, winnerIsYou });
});
