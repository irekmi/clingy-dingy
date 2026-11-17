// Supabase Edge Function: zakłada mecz na serwerze i zwraca jego identyfikator.
// Identyfikator meczu jest potem podstawą trasy (wszyscy gracze mają tę samą ścianę),
// a serwer zna czas startu, więc może odrzucić wyniki szybsze niż realnie upłynęło.
//
// Deploy:  npx supabase functions deploy create-match
import { createClient } from 'npm:@supabase/supabase-js@2';

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
  const { room, players } = body ?? {};
  if (
    typeof room !== 'string' || !ROOM_RE.test(room) ||
    !Array.isArray(players) || players.length < 2 || players.length > 6 ||
    !players.every((p) => typeof p === 'string' && UUID_RE.test(p)) ||
    new Set(players).size !== players.length
  ) {
    return json({ error: 'bad payload' }, 400);
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });

  // proste ograniczenie: w jednym pokoju nie częściej niż co 4 s (odliczanie trwa 3 s)
  const since = new Date(Date.now() - 4000).toISOString();
  const { count } = await supabase
    .from('matches')
    .select('id', { count: 'exact', head: true })
    .eq('room_code', room)
    .gt('created_at', since);
  if ((count ?? 0) > 0) return json({ error: 'too many' }, 429);

  const id = crypto.randomUUID();
  const { error } = await supabase.from('matches').insert({ id, room_code: room, players });
  if (error) {
    console.error(error);
    return json({ error: 'db error' }, 500);
  }
  return json({ matchId: id });
});
