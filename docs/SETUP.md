# Setup and deployment

Everything you need to run Clingy Dingy locally, connect it to your own Supabase project and publish it on GitHub Pages.

## Run locally

```bash
npm install
```

```bash
npm run dev
```

Without an `.env.local` file the game runs in **local mode**: *Solo run* works as usual, and for a duel you create a room and open the same link in a **second window** of the same browser. Keep both windows visible side by side, because a background tab does not render animations.

Tests (deterministic simulation, anti-bot analysis):

```bash
npm test
```

## Connect your own Supabase project

1. Create a project on [supabase.com](https://supabase.com) (a nearby region, e.g. Frankfurt `eu-central-1`).
2. **Project Settings → API**: copy the *Project URL* and the **publishable** (or legacy *anon*) key. Create `.env.local` modelled on [.env.example](../.env.example).
3. Create the schema, either by pasting the files from [`supabase/migrations/`](../supabase/migrations) into the **SQL Editor** (in file-name order), or with the CLI:
   ```bash
   npx supabase login
   ```
   ```bash
   npx supabase link --project-ref YOUR_PROJECT_REF
   ```
   ```bash
   npx supabase db push
   ```
4. Deploy the Edge Functions (they verify and store results; they need the `link` step above):
   ```bash
   npx supabase functions deploy submit-result --no-verify-jwt
   ```
   ```bash
   npx supabase functions deploy create-match --no-verify-jwt
   ```
5. **Realtime → Settings**: make sure *Allow public access* is on (the game uses public channels).
6. Run `npm run dev`. The menu should say “Online: Supabase Realtime ✓”.
7. For accounts: **Authentication → URL Configuration**, add your site URL (local and production) to *Site URL* / *Redirect URLs*. Mail confirmation uses Supabase's built-in sender, which has a low hourly limit; connect your own SMTP for production.

> The publishable/anon key is public and ends up in the browser. That is by design: security comes from Row Level Security and the Edge Functions. **Never** put a `secret` / `service_role` key in the repo or the front end.

## Publish on GitHub Pages

1. Push the code to a GitHub repository.
2. **Settings → Pages → Source: GitHub Actions**.
3. **Settings → Secrets and variables → Actions → Variables**: add `VITE_SUPABASE_URL` and `VITE_SUPABASE_KEY` (and, once you have them, `VITE_ADSENSE_CLIENT` / `VITE_ADSENSE_SLOT`).
4. Every push to `main` builds and publishes the game (see [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)).

## Ads (optional)

Ads are off until `VITE_ADSENSE_CLIENT` and `VITE_ADSENSE_SLOT` are set. The step-by-step AdSense checklist (custom domain, consent banner, `ads.txt`) is in [ROADMAP.md](ROADMAP.md).
