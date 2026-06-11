import express from 'express';
import fetch from 'node-fetch';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

const CLIENT_ID      = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET  = process.env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI   = process.env.REDIRECT_URI;
const LASTFM_API_KEY = process.env.LASTFM_API_KEY;
const LASTFM_USER    = process.env.LASTFM_USERNAME;
const PORT           = process.env.PORT || 3000;

if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI || !LASTFM_API_KEY || !LASTFM_USER) {
  console.error('Variables manquantes : SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, REDIRECT_URI, LASTFM_API_KEY, LASTFM_USERNAME');
  process.exit(1);
}

const SCOPES = 'user-top-read user-read-private';

app.use(express.static(path.join(__dirname, 'public')));

/* ── 1. Login Spotify ── */
app.get('/auth/login', (req, res) => {
  const state = Math.random().toString(36).slice(2);
  const params = new URLSearchParams({
    client_id:     CLIENT_ID,
    response_type: 'code',
    redirect_uri:  REDIRECT_URI,
    scope:         SCOPES,
    state,
    show_dialog:   'true',
  });
  res.redirect('https://accounts.spotify.com/authorize?' + params);
});

/* ── 2. Callback OAuth ── */
app.get('/auth/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.redirect('/?error=' + encodeURIComponent(error));
  try {
    const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + Buffer.from(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64'),
      },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI }),
    });
    const tokenData = await tokenRes.json();
    if (tokenData.error) throw new Error(tokenData.error_description || tokenData.error);
    res.redirect(`/#access_token=${tokenData.access_token}`);
  } catch (err) {
    res.redirect('/?error=' + encodeURIComponent(err.message));
  }
});

/* ── 3. Proxy top Spotify ── */
app.get('/api/top/:type', async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: 'Token manquant' });
  const { type } = req.params;
  const { limit = 5 } = req.query;
  if (!['tracks', 'artists'].includes(type)) return res.status(400).json({ error: 'Type invalide' });
  try {
    const r = await fetch(
      `https://api.spotify.com/v1/me/top/${type}?limit=${limit}&time_range=short_term`,
      { headers: { Authorization: auth } }
    );
    res.json(await r.json());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ── 4. Proxy profil Spotify ── */
app.get('/api/me', async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: 'Token manquant' });
  try {
    const r = await fetch('https://api.spotify.com/v1/me', { headers: { Authorization: auth } });
    res.json(await r.json());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ── 5. Proxy image artiste (fix CORS canvas) ── */
app.get('/api/image-proxy', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).send('URL manquante');
  if (!url.startsWith('https://i.scdn.co/') && !url.startsWith('https://mosaic.scdn.co/')) {
    return res.status(403).send('Domaine non autorisé');
  }
  try {
    const r = await fetch(url);
    if (!r.ok) return res.status(r.status).send('Image introuvable');
    res.set('Content-Type', r.headers.get('content-type') || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=3600');
    r.body.pipe(res);
  } catch (err) { res.status(500).send('Erreur proxy'); }
});

/* ── 6. Temps d'écoute via Last.fm ── */
app.get('/api/lastfm-minutes', async (req, res) => {
  try {
    const now   = new Date();
    const from  = Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000);
    const to    = Math.floor(now.getTime() / 1000);

    // ── Étape A : récupère tous les scrobbles du mois (paginé) ──
    const scrobbles = [];
    let page = 1;
    let totalPages = 1;

    while (page <= totalPages && page <= 50) { // max 50 pages = ~10 000 scrobbles
      const url = `https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks`
        + `&user=${encodeURIComponent(LASTFM_USER)}`
        + `&api_key=${LASTFM_API_KEY}`
        + `&format=json&limit=200&from=${from}&to=${to}&page=${page}`;

      const r    = await fetch(url);
      const data = await r.json();

      if (data.error) throw new Error('Last.fm : ' + data.message);

      const tracks = data.recenttracks?.track || [];
      totalPages   = parseInt(data.recenttracks?.['@attr']?.totalPages || '1', 10);

      for (const t of tracks) {
        // Ignore le morceau "en cours de lecture" (pas de timestamp)
        if (t['@attr']?.nowplaying) continue;
        scrobbles.push({ artist: t.artist?.['#text'] || '', track: t.name || '', mbid: t.mbid || '' });
      }

      page++;
    }

    if (scrobbles.length === 0) {
      return res.json({ minutes: 0, scrobbles: 0 });
    }

    // ── Étape B : regroupe par morceau unique pour limiter les appels API ──
    const uniqueMap = new Map(); // clé "artist|||track"
    for (const s of scrobbles) {
      const key = `${s.artist}|||${s.track}`;
      if (!uniqueMap.has(key)) uniqueMap.set(key, { artist: s.artist, track: s.track, count: 0, duration: null });
      uniqueMap.get(key).count++;
    }

    const uniqueTracks = [...uniqueMap.values()];

    // ── Étape C : récupère la durée de chaque morceau unique (par lots de 5 en parallèle) ──
    const BATCH = 5;
    for (let i = 0; i < uniqueTracks.length; i += BATCH) {
      const batch = uniqueTracks.slice(i, i + BATCH);
      await Promise.all(batch.map(async (t) => {
        try {
          const url = `https://ws.audioscrobbler.com/2.0/?method=track.getInfo`
            + `&api_key=${LASTFM_API_KEY}&format=json`
            + `&artist=${encodeURIComponent(t.artist)}&track=${encodeURIComponent(t.track)}`;
          const r    = await fetch(url);
          const data = await r.json();
          const dur  = parseInt(data.track?.duration || '0', 10); // durée en ms
          t.duration = dur > 0 ? dur : 210000; // fallback 3min30 si inconnu
        } catch {
          t.duration = 210000;
        }
      }));
    }

    // ── Étape D : calcule le total ──
    let totalMs = 0;
    for (const t of uniqueTracks) {
      totalMs += t.duration * t.count;
    }

    res.json({
      minutes:   Math.round(totalMs / 60000),
      scrobbles: scrobbles.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`Serveur sur le port ${PORT}`));
