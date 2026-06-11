# Ma Capsule Audio — Spotify Story Generator

Génère une story Instagram/TikTok avec tes vraies stats Spotify.

## Structure du projet

```
spotify-story/
├── server.js          ← serveur Express (OAuth + proxy API)
├── package.json
├── .env.example       ← modèle pour tes variables d'env
├── .gitignore
└── public/
    └── index.html     ← frontend (zéro credentials dedans)
```

## Déploiement sur Render

### 1. Créer l'app Spotify

1. Va sur https://developer.spotify.com/dashboard
2. Clique **Create app**
3. Dans **Redirect URIs**, ajoute : `https://TON-APP.onrender.com/auth/callback`
4. Coche **Web API** → Save
5. Note ton **Client ID** et ton **Client Secret**

### 2. Mettre le code sur GitHub

```bash
git init
git add .
git commit -m "init"
git remote add origin https://github.com/TONPSEUDO/spotify-story.git
git push -u origin main
```

### 3. Déployer sur Render

1. Va sur https://render.com → **New → Web Service**
2. Connecte ton repo GitHub
3. Configure :
   - **Environment** : `Node`
   - **Build Command** : `npm install`
   - **Start Command** : `npm start`
4. Dans **Environment Variables**, ajoute :

| Variable | Valeur |
|---|---|
| `SPOTIFY_CLIENT_ID` | ton Client ID Spotify |
| `SPOTIFY_CLIENT_SECRET` | ton Client Secret Spotify |
| `REDIRECT_URI` | `https://TON-APP.onrender.com/auth/callback` |

5. Clique **Deploy** → attends 2 min → c'est en ligne !

## En local (développement)

```bash
cp .env.example .env
# Remplis .env avec tes vraies valeurs

npm install
npm run dev
# → http://localhost:3000
```
