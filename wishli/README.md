# wishli

## Supabase setup

Make a file named `.env` in this folder, next to `package.json`:

```
wishli/
  package.json
  .env          <- here
  src/
```

Put this in it:

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

Get both values from your Supabase project under **Project Settings**:

- **URL** — Data API → Project URL
- **Key** — API Keys → the `anon` / public key

Then restart the dev server. 
