# ShiftTrack

Personal shift tracking app for multiple jobs.

## Run Locally With SQLite

This mode needs no environment file. The app runs a local Node server and stores accounts/data in SQLite.

```bash
npm install
npm.cmd run dev
```

Open:

```text
http://localhost:5173
```

Local data is stored in:

```text
data/shifttrack.sqlite
```

In local mode, the app shows local Sign Up / Log In and stores each user's jobs, shifts, templates, and settings in SQLite on this computer.

## Run With Google Auth And Cloud Sync

Create `.env.local`:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-supabase-publishable-key
VITE_APP_URL=http://localhost:5173
```

Then:

1. Create a Supabase project.
2. Run `supabase-schema.sql` in Supabase SQL Editor.
3. Enable Google provider in Supabase Auth.
4. Add redirect URLs in Supabase Auth settings:
   - `http://localhost:5173`
   - your deployed site URL, for example `https://shifttrack.example.com`
5. Restart the dev server.

## Deploy To Cloud

For Vercel, Netlify, Render static hosting, or similar:

```bash
npm.cmd run build
```

Build output is in:

```text
dist
```

Set production environment variables in your hosting provider:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-supabase-publishable-key
VITE_APP_URL=https://your-deployed-site.com
```

If `VITE_APP_URL` is omitted, the app uses the current browser origin. Setting it explicitly is safer for Google OAuth redirects.

## Modes

- No Supabase env vars: local SQLite account mode.
- Supabase env vars present: Google account authentication and per-user cloud sync.
