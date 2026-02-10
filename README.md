# Hawk & Pigeon

A web-based 3D multiplayer chase game built with Three.js and WebRTC. Two players compete in 1v1 matches: one as a pigeon trying to eat and survive, one as a hawk trying to hunt them down.

## Current Status

Phase 1 MVP is complete and networking hardening for sharing with friends is implemented.
For the latest implementation details and handoff notes, see `PROJECT_STATUS.md`.

## Prerequisites

You need Node.js (version 18+ recommended) to run this project.

## Setup Instructions

1. Install dependencies:
   ```bash
   npm install
   ```
2. Run the development server:
   ```bash
   npm run dev
   ```
3. Open your browser:
   - Navigate to `http://localhost:3000`
   - Click anywhere on the canvas to start

4. Optional leaderboard setup (no player accounts required):
   - Copy `.env.example` to `.env.local`
   - Fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
   - Run the SQL in the **Leaderboard (Supabase)** section below once

## Controls

- `W` Move forward
- `A/D` Bank left/right
- `Space` Ascend
- `Shift` Descend
- `Mouse Y` Pitch up/down (click canvas to lock pointer)
- `Arrow Up/Down` Pitch up/down (keyboard alternative)

## Development

### Build for Production
```bash
npm run build
```

### Preview Production Build
```bash
npm run preview
```

## Deployment

GitHub Pages deployment is configured.

```bash
npm run deploy
```

Full publish steps (including first-time repo setup) are in `DEPLOYMENT.md`.

## Leaderboard (Supabase)

Players do **not** need accounts. They can enter any name.

### 1. Table
Run this SQL in Supabase SQL Editor:

```sql
create table if not exists public.leaderboard_entries (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  metric text not null check (metric in ('fattest_pigeon', 'fastest_hawk_kill')),
  value double precision not null,
  match_id text,
  round_number integer,
  created_at timestamptz not null default now()
);
```

### 2. Row Level Security (anon insert/select only)

```sql
alter table public.leaderboard_entries enable row level security;

create policy "lb_select_all"
on public.leaderboard_entries
for select
to anon
using (true);

create policy "lb_insert_anon"
on public.leaderboard_entries
for insert
to anon
with check (
  char_length(username) between 1 and 20
  and value >= 0
);
```

### 3. Keep it safe
- Use only `VITE_SUPABASE_ANON_KEY` in frontend.
- Never expose Supabase service-role key in this repo/app.

## Game Specification

For full game design and mechanics, see `Birdgame Spec.md`.

## License

Private project
