// Supabase Edge Function: przyjmuje wynik gracza, odtwarza bieg z logu wciśnięć
// (ta sama symulacja co w przeglądarce) i zapisuje ZWERYFIKOWANY czas w tabeli race_results.
//
// Deploy:  npx supabase functions deploy submit-result
import { createClient } from 'npm:@supabase/supabase-js@2';
import { replay, routeFor } from '../_shared/sim.ts';

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

  let state;
  try {
    state = replay(routeFor(matchId), inputs);
  } catch {
    return json({ error: 'bad inputs' }, 400);
  }

  const verifiedMs = state.finishedAt;
  const valid = verifiedMs !== null && verifiedMs === claimedMs;

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });

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
  return json({ valid, verifiedMs, ranked: userId !== null && valid });
});
