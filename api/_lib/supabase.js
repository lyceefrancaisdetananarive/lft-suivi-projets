// =====================================================================
// Accès à Supabase depuis les fonctions Vercel, sans dépendance npm.
//
// Même architecture que le classeur de technologie : le navigateur ne parle
// JAMAIS à Supabase. Il appelle /api/, qui vérifie qui appelle, puis lit ou
// écrit avec la clé secrète. Côté base, le schéma « suivi » n'accorde rien
// aux rôles anon et authenticated (db/01-schema-suivi.sql, vérifié par
// db/02) : une clé publique égarée n'ouvrirait rien.
//
// Le suivi a son PROPRE projet Supabase, séparé de celui du classeur : la
// clé détenue ici n'ouvre aucune donnée d'élève du classeur.
//
// Variables d'environnement (réglages du projet Vercel, jamais dans le
// dépôt, qui est public) :
//   SUPABASE_URL          https://<ref>.supabase.co
//   SUPABASE_SECRET_KEY   clé secrète (sb_secret_...) ou ancienne service_role
//   SUIVI_COOKIE_SECRET   secret du sceau de session, distinct de Supabase
//   ADMINS_SUIVI          adresses autorisées à porter le rôle admin
// =====================================================================

import { isIP } from 'node:net';

const URL_BASE = () =>String(process.env.SUPABASE_URL ?? '').replace(/\/+$/, '');
const CLE = () => process.env.SUPABASE_SECRET_KEY;

export function configuree() {
  // ADMINS_SUIVI est exigée comme les clés : sans elle, adminsAutorises()
  // serait vide et le contrôle continu du rôle retirerait d'un coup ses
  // droits à l'administrateur. Une panne franche en 503 se voit et se répare.
  return Boolean(URL_BASE() && CLE() && process.env.SUIVI_COOKIE_SECRET
    && adminsAutorises().length);
}

/**
 * En-têtes d'appel. Les nouvelles clés (sb_secret_...) vont dans apikey
 * seulement ; une ancienne clé service_role (un JWT) va aussi dans
 * Authorization. `profil` désigne le schéma suivi pour PostgREST.
 */
function entetes(extra = {}, profil = true) {
  const h = { apikey: CLE(), 'content-type': 'application/json', ...extra };
  if (!String(CLE()).startsWith('sb_')) h.authorization = `Bearer ${CLE()}`;
  if (profil) {
    h['accept-profile'] = 'suivi';
    h['content-profile'] = 'suivi';
  }
  return h;
}

async function erreur(r, quoi) {
  let corps = {};
  try { corps = JSON.parse(await r.text()); } catch { /* corps non JSON */ }
  const e = new Error(`${quoi} : ${r.status} ${corps.message ?? ''}`.trim());
  e.statut = r.status;
  e.code = corps.code ?? null;          // 23505 doublon, 23503 clé absente, 23514 contrainte
  e.detail = corps.message ?? null;
  return e;
}

/** Lecture en base (RLS sans effet : clé secrète). */
export async function lire(table, requete = '') {
  const r = await fetch(`${URL_BASE()}/rest/v1/${table}?${requete}`, { headers: entetes() });
  if (!r.ok) throw await erreur(r, `lecture ${table}`);
  return r.json();
}

// Le plafond de PostgREST (mille lignes) tronque SANS LE DIRE. Les listes du
// suivi restent loin en dessous, mais la lecture pagine quand même : le jour
// où elle en aurait besoin, personne n'y pensera.
const PAS = 1000;
export async function lireTout(table, requete) {
  const lignes = [];
  for (let n = 0; n < 50; n += 1) {
    const page = await lire(table, `${requete}&limit=${PAS}&offset=${n * PAS}`);
    lignes.push(...page);
    if (page.length < PAS) return lignes;
  }
  throw new Error(`lecture ${table} : plus de 50 pages`);
}

/**
 * Écriture. `methode` : POST (insertion), PATCH (mise à jour), DELETE.
 * Renvoie les lignes touchées (return=representation).
 */
export async function ecrire(table, requete, corps, methode = 'PATCH', prefer = '') {
  const r = await fetch(`${URL_BASE()}/rest/v1/${table}?${requete}`, {
    method: methode,
    headers: entetes({
      prefer: prefer ? `return=representation,${prefer}` : 'return=representation',
    }),
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  if (!r.ok) throw await erreur(r, `écriture ${table}`);
  const t = await r.text();
  return t ? JSON.parse(t) : [];
}

// ------------------------------------------------------------- comptes

// LIMITES DE SUPABASE AUTH PAR ADRESSE IP. Toutes les demandes partent des
// serveurs de Vercel : sans précaution, Supabase compterait l'école entière
// sur une seule adresse (30 connexions par 5 minutes) et refuserait des
// collègues lors d'une réunion. On lui transmet donc l'adresse réelle de la
// personne dans l'en-tête Sb-Forwarded-For, qu'il n'accepte qu'avec une clé
// secrète sb_secret_ et l'option « IP address forwarding » activée
// (Authentication > Rate Limits). Vercel écrit lui-même x-real-ip et écrase
// ce que le navigateur prétendrait y mettre : l'adresse n'est pas falsifiable.
// Le lycée sortant sur une seule adresse publique, les plafonds par IP sont en
// outre relevés dans Supabase ; la protection contre les essais répétés reste
// celle de connexion.js, compte par compte.
function adresseClient(req) {
  const brute = String(req?.headers?.['x-real-ip']
    ?? String(req?.headers?.['x-forwarded-for'] ?? '').split(',')[0]).trim();
  return isIP(brute) ? brute : null;
}

function entetesAuth(req) {
  const ip = adresseClient(req);
  return entetes(ip ? { 'sb-forwarded-for': ip } : {}, false);
}

// Un 429 de Supabase veut dire « trop de demandes », pas « mot de passe faux »
// ni « lien périmé » : le confondre noterait un échec à tort, jusqu'à mettre un
// compte en pause. On le remonte en erreur, que les fonctions traduisent.
function saturation() {
  const e = new Error('Supabase Auth : trop de demandes (429)');
  e.statut = 429;
  return e;
}

/** Message à afficher quand Supabase Auth répond 429. */
export const MESSAGE_SATURATION = 'Beaucoup de connexions en même temps sur le site. '
  + 'Patientez une minute, puis réessayez.';

/** Vérifie une paire adresse / mot de passe. Renvoie l'id, ou null. */
export async function verifierMotDePasse(email, motDePasse, req) {
  const r = await fetch(`${URL_BASE()}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: entetesAuth(req),
    body: JSON.stringify({ email, password: motDePasse }),
  });
  if (r.status === 429) throw saturation();
  if (!r.ok) return null;
  const d = await r.json();
  // La vérification ouvre une session Supabase que personne n'utilise : la
  // session du site est notre cookie. On la referme aussitôt.
  if (d?.access_token) {
    await fetch(`${URL_BASE()}/auth/v1/logout?scope=local`, {
      method: 'POST',
      headers: { apikey: CLE(), authorization: `Bearer ${d.access_token}` },
    }).catch(() => {});
  }
  return d?.user?.id ?? null;
}

/** Pose un mot de passe (API d'administration). */
export async function definirMotDePasse(id, motDePasse) {
  const r = await fetch(`${URL_BASE()}/auth/v1/admin/users/${id}`, {
    method: 'PUT',
    headers: entetes({}, false),
    body: JSON.stringify({ password: motDePasse }),
  });
  if (!r.ok) throw await erreur(r, 'mot de passe');
  return true;
}

/**
 * À qui appartient ce jeton de récupération (lien « Première connexion » ou
 * « Mot de passe oublié ») ? Le courriel porte le HACHAGE du jeton, pas un
 * jeton de session : rien n'est consommé au clic, seulement ici, au moment
 * où la personne enregistre son mot de passe. Un lien ouvert par un
 * antivirus ou par un aperçu de messagerie reste donc valable (leçon du
 * classeur, 12 septembre 2026). C'est Supabase qui vérifie et périme le jeton.
 */
export async function utilisateurDuJetonHache(jetonHache, req) {
  const r = await fetch(`${URL_BASE()}/auth/v1/verify`, {
    method: 'POST',
    headers: entetesAuth(req),
    body: JSON.stringify({ type: 'recovery', token_hash: jetonHache }),
  });
  if (r.status === 429) throw saturation();
  if (!r.ok) return null;
  const d = await r.json();
  if (!d?.user?.id) return null;
  if (d.access_token) {
    await fetch(`${URL_BASE()}/auth/v1/logout?scope=local`, {
      method: 'POST',
      headers: { apikey: CLE(), authorization: `Bearer ${d.access_token}` },
    }).catch(() => {});
  }
  return { id: d.user.id, email: String(d.user.email ?? '').toLowerCase() };
}

/**
 * Demande à Supabase le courriel « choisir mon mot de passe ». Le gabarit
 * du courriel (tableau de bord Supabase, copie dans db/03) mène à
 * {{ .SiteURL }}/#jeton={{ .TokenHash }}. redirect_to va dans l'URL, jamais
 * dans le corps, où Supabase l'ignorerait sans un mot. Renvoie le statut HTTP
 * de Supabase.
 */
export async function envoyerLien(email, origine, req) {
  const cible = encodeURIComponent(`${origine}/`);
  const r = await fetch(`${URL_BASE()}/auth/v1/recover?redirect_to=${cible}`, {
    method: 'POST',
    headers: entetesAuth(req),
    body: JSON.stringify({ email }),
  });
  return r.status;
}

/**
 * Crée un compte avec un mot de passe ALÉATOIRE que personne ne lit. Son
 * titulaire passera par « Première connexion ». Aucun courriel n'est envoyé.
 * Renvoie l'id, ou null si l'adresse existe déjà côté authentification.
 */
export async function creerUtilisateur(email) {
  const alea = crypto.getRandomValues(new Uint8Array(32));
  const motDePasse = btoa(String.fromCharCode(...alea)).slice(0, 40);
  const r = await fetch(`${URL_BASE()}/auth/v1/admin/users`, {
    method: 'POST',
    headers: entetes({}, false),
    body: JSON.stringify({ email, password: motDePasse, email_confirm: true }),
  });
  if (r.status === 422) return null;
  if (!r.ok) throw await erreur(r, 'création du compte');
  return (await r.json())?.id ?? null;
}

/** Cherche un compte d'authentification par son adresse. */
export async function utilisateurParEmail(email) {
  const r = await fetch(
    `${URL_BASE()}/auth/v1/admin/users?filter=${encodeURIComponent(email)}`,
    { headers: entetes({}, false) });
  if (!r.ok) return null;
  const d = await r.json();
  const u = (d?.users ?? []).find((x) => String(x.email ?? '').toLowerCase() === email);
  return u?.id ?? null;
}

/** Supprime un compte : la ligne membres suit en cascade. */
export async function supprimerUtilisateur(id) {
  const r = await fetch(`${URL_BASE()}/auth/v1/admin/users/${id}`, {
    method: 'DELETE',
    headers: entetes({}, false),
  });
  return r.ok || r.status === 404;
}

/**
 * Les adresses autorisées à porter le rôle admin, dans la variable
 * ADMINS_SUIVI du projet Vercel, jamais dans le dépôt public. C'est la
 * barrière contre l'escalade : le rôle « admin » écrit en base ne suffit
 * pas, il faut aussi figurer sur cette liste, que seul le titulaire du
 * projet Vercel modifie. Extraction par motif : le format de la variable
 * (virgules, retours à la ligne, guillemets) n'a pas d'importance.
 */
export function adminsAutorises() {
  return String(process.env.ADMINS_SUIVI ?? '').toLowerCase()
    .match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g) ?? [];
}

// ------------------------------------------------------------- requêtes

/**
 * Défense contre la falsification de requête, en plus du cookie
 * SameSite=Strict : toute écriture doit venir d'une page du site lui-même.
 */
export function origineLegitime(req) {
  const origine = req.headers.origin || req.headers.referer;
  if (!origine) return false;
  try {
    return new URL(origine).host === req.headers.host;
  } catch {
    return false;
  }
}

/** Réponse d'erreur uniforme, sans détail exploitable. */
export function refus(res, code, message, extra = {}) {
  res.status(code).json({ ok: false, message, ...extra });
}

/** Le corps JSON de la requête, quel que soit l'en-tête envoyé. */
export function corps(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return {};
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
