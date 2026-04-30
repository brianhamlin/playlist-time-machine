# Playlist Time Machine

A React/Vite frontend-only site styled as a 5th generation iPod classic. It uses static JSON playlist data and can be deployed to GitHub Pages.

## Local development

```bash
npm install
npm run dev
```

## Edit the playlists

Update `src/data/playlists.json`. Each playlist supports:

```json
{
  "id": "summer-2008",
  "title": "Summer Car Window",
  "date": "Jul 2008",
  "description": "A short note.",
  "songs": [
    { "title": "Song", "artist": "Artist", "duration": "3:45" }
  ]
}
```

## Deploy to GitHub Pages

This repo includes `.github/workflows/deploy.yml`. In GitHub:

1. Go to **Settings → Pages**.
2. Set **Source** to **GitHub Actions**.
3. Push to `main`.

The workflow builds with `VITE_BASE_PATH=/<repo-name>/`, so Vite assets resolve correctly for project pages.
