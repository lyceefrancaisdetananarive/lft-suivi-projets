// =====================================================================
// Serveur d'essai LOCAL de la page et des fonctions /api/, sans Vercel.
//
//   node outils/serveur-local.mjs              sert http://localhost:3210
//   node outils/serveur-local.mjs --comptes    crée en plus des comptes d'essai
//   node outils/serveur-local.mjs --nettoyer   efface comptes et données d'essai, puis quitte
//
// Les fonctions s'exécutent comme sur Vercel, contre la base Supabase du suivi
// (clé lue dans ~/.config/lft/suivi-supabase.env, jamais affichée). Le secret des
// cookies est tiré au hasard à chaque lancement.
//
// AUCUN COURRIEL : les appels à /auth/v1/recover sont interceptés et le lien
// qu'aurait reçu la personne est écrit dans la console (comptes d'essai seulement).
//
// Comptes d'essai (essai-page-...@egd.mg) : mots de passe aléatoires écrits dans
// un fichier hors du dépôt (chmod 600), jamais affichés. Seul essai-page-admin
// peut tenir le rôle admin ici (ADMINS_SUIVI local).
//
// Ce fichier n'est pas déployé : outils/ est hors de la liste blanche .vercelignore.
// =====================================================================

import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, statSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = normalize(join(dirname(fileURLToPath(import.meta.url)), '..'));
const PORT = Number(process.env.PORT || 3210);
const PREFIXE = 'essai-page-';
const FICHIER_COMPTES = process.env.ESSAI_COMPTES || `${homedir()}/.config/lft/essai-page.env`;

const conf = Object.fromEntries(readFileSync(`${homedir()}/.config/lft/suivi-supabase.env`, 'utf8')
  .split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
  .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
process.env.SUPABASE_URL = conf.SUPABASE_URL;
process.env.SUPABASE_SECRET_KEY = conf.SUPABASE_SECRET_KEY;
process.env.SUIVI_COOKIE_SECRET = randomBytes(32).toString('base64');
process.env.ADMINS_SUIVI = `${PREFIXE}admin@egd.mg`;

// ------------------------------------------------------------ courriels
const fetchReel = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (String(url).includes('/auth/v1/recover')) {
    const email = JSON.parse(opts.body).email;
    if (!String(email).startsWith(PREFIXE)) {
      console.log(`[courriel] envoi vers ${email} BLOQUÉ (serveur local)`);
      return new Response('{}', { status: 200 });
    }
    // Le lien que Supabase aurait envoyé : on le fabrique pour l'essai.
    const r = await fetchReel(`${conf.SUPABASE_URL}/auth/v1/admin/generate_link`, {
      method: 'POST',
      headers: { apikey: conf.SUPABASE_SECRET_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'recovery', email }),
    });
    const d = await r.json();
    const jeton = d.hashed_token || d.properties?.hashed_token;
    console.log(`[courriel] lien pour ${email} : http://localhost:${PORT}/?jeton=${jeton}`);
    return new Response('{}', { status: 200 });
  }
  return fetchReel(url, opts);
};

// ------------------------------------------------------------ base brute
const H = { apikey: conf.SUPABASE_SECRET_KEY, 'content-type': 'application/json' };
const HS = { ...H, 'accept-profile': 'suivi', 'content-profile': 'suivi' };
async function rest(methode, chemin, corps, prefer = 'return=representation') {
  const r = await fetchReel(`${conf.SUPABASE_URL}/rest/v1/${chemin}`, {
    method: methode, headers: { ...HS, prefer }, body: corps ? JSON.stringify(corps) : undefined,
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${methode} ${chemin.split('?')[0]} ${r.status} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
}
async function auth(methode, chemin, corps) {
  const r = await fetchReel(`${conf.SUPABASE_URL}/auth/v1/${chemin}`, {
    method: methode, headers: H, body: corps ? JSON.stringify(corps) : undefined,
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`auth ${methode} ${chemin} ${r.status} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
}

async function nettoyer() {
  const ids = (await rest('GET', `membres?email=like.${PREFIXE}*&select=id`)).map((x) => x.id);
  if (ids.length) {
    const l = ids.join(',');
    // Seulement les fiches CRÉÉES par un compte d'essai : une fiche réelle qu'un essai
    // aurait touchée ne doit jamais être effacée.
    const p = await rest('GET', `projets?cree_par=in.(${l})&select=id`);
    if (p.length) await rest('DELETE', `projets?id=in.(${p.map((x) => x.id).join(',')})`, null, 'return=minimal');
    await rest('DELETE', `commentaires?auteur_id=in.(${l})`, null, 'return=minimal');
  }
  for (const id of ids) await auth('DELETE', `admin/users/${id}`);
  const restants = await auth('GET', 'admin/users?per_page=1000');
  for (const u of restants.users ?? []) {
    if (String(u.email).startsWith(PREFIXE)) await auth('DELETE', `admin/users/${u.id}`);
  }
  await rest('DELETE', `journal?email=like.${PREFIXE}*`, null, 'return=minimal');
  console.log(`Nettoyage : ${ids.length} compte(s) d'essai et leurs données effacés.`);
}

async function creerComptes() {
  await nettoyer();
  const comptes = [
    { cle: 'ADMIN', role: 'admin', nom: 'ESSAIPAGE', prenom: 'Admin' },
    { cle: 'DIRECTION', role: 'direction', nom: 'ESSAIPAGE', prenom: 'Direction' },
    { cle: 'ENSEIGNANT', role: 'enseignant', nom: 'ESSAIPAGE', prenom: 'Alpha' },
    { cle: 'NOUVEAU', role: 'enseignant', nom: 'ESSAIPAGE', prenom: 'Nouveau', provisoire: true },
  ];
  const lignes = ['# Comptes d\'essai du serveur local (effacés par --nettoyer)'];
  for (const c of comptes) {
    const email = `${PREFIXE}${c.cle.toLowerCase()}@egd.mg`;
    const mdp = `Essai-${randomBytes(12).toString('base64url')}-Tsingy`;
    const u = await auth('POST', 'admin/users', { email, password: mdp, email_confirm: true });
    await rest('POST', 'membres', {
      id: u.id, email, role: c.role, nom: c.nom, prenom: c.prenom, mdp_provisoire: Boolean(c.provisoire),
    });
    lignes.push(`${c.cle}_EMAIL=${email}`, `${c.cle}_MDP=${mdp}`);
  }
  writeFileSync(FICHIER_COMPTES, `${lignes.join('\n')}\n`, { mode: 0o600 });
  chmodSync(FICHIER_COMPTES, 0o600);
  console.log(`Comptes d'essai créés ; identifiants dans ${FICHIER_COMPTES} (non affichés).`);
}

// ------------------------------------------------------------ serveur
const PUBLICS = new Set(['/index.html', '/logo-lft.jpg', '/logo_aefe_egd.png']);
const TYPES = { '.html': 'text/html; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.woff2': 'font/woff2' };
const gestionnaires = new Map();
async function gestionnaire(nom) {
  if (!gestionnaires.has(nom)) {
    const f = join(RACINE, 'api', `${nom}.js`);
    if (!nom.match(/^[a-z-]+\/[a-z-]+$/) || !existsSync(f)) return null;
    gestionnaires.set(nom, (await import(f)).default);
  }
  return gestionnaires.get(nom);
}

function demarrer() {
  createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    try {
      if (url.pathname.startsWith('/api/')) {
        const h = await gestionnaire(url.pathname.slice(5).replace(/\/$/, ''));
        if (!h) { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"ok":false,"message":"Introuvable."}'); return; }
        const morceaux = [];
        for await (const m of req) morceaux.push(m);
        const brut = Buffer.concat(morceaux).toString('utf8');
        req.query = Object.fromEntries(url.searchParams);
        req.body = brut && String(req.headers['content-type'] || '').includes('json')
          ? (() => { try { return JSON.parse(brut); } catch { return brut; } })() : (brut || undefined);
        res.status = (c) => { res.statusCode = c; return res; };
        res.json = (o) => { if (!res.getHeader('content-type')) res.setHeader('content-type', 'application/json; charset=utf-8'); res.end(JSON.stringify(o)); return res; };
        res.send = (s) => { res.end(s); return res; };
        res.setHeader('cache-control', 'no-store');
        const t0 = Date.now();
        await h(req, res);
        console.log(`${req.method} ${url.pathname}${url.search ? '?…' : ''} ${res.statusCode} ${Date.now() - t0} ms`);
        return;
      }
      let chemin = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
      const ok = PUBLICS.has(chemin) || /^\/fonts\/[A-Za-z_-]+\.woff2$/.test(chemin);
      const f = join(RACINE, chemin);
      if (!ok || !f.startsWith(RACINE) || !existsSync(f) || !statSync(f).isFile()) { res.writeHead(404); res.end('Introuvable'); return; }
      res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(readFileSync(f));
    } catch (e) {
      console.error(e);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  }).listen(PORT, '127.0.0.1', () => console.log(`Serveur local : http://localhost:${PORT}`));
}

if (process.argv.includes('--nettoyer')) {
  await nettoyer();
  process.exit(0);
}
if (process.argv.includes('--comptes')) await creerComptes();
demarrer();
