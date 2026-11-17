// =====================================================================
// Essai des fonctions /api/ contre la base Supabase du suivi.
//
//   node outils/essai-api.mjs
//
// Appelle chaque fonction comme Vercel le ferait (requête et réponse
// simulées), avec des comptes d'essai créés pour l'occasion dans chaque
// rôle (essai-api-...@egd.mg), puis EFFACE tout ce qu'il a créé : comptes,
// fiches, commentaires, lignes de journal. Les fiches et comptes réels ne
// sont ni modifiés ni supprimés ; une reconduction d'essai part d'une fiche
// réelle et sa copie est supprimée à la fin.
//
// AUCUN COURRIEL : les appels à /auth/v1/recover sont interceptés.
// La clé est lue dans ~/.config/lft/suivi-supabase.env, jamais affichée.
// =====================================================================

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';

const conf = Object.fromEntries(readFileSync(`${homedir()}/.config/lft/suivi-supabase.env`, 'utf8')
  .split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
  .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));

const PREFIXE = 'essai-api-';
const ADMIN = `${PREFIXE}admin@egd.mg`;
process.env.SUPABASE_URL = conf.SUPABASE_URL;
process.env.SUPABASE_SECRET_KEY = conf.SUPABASE_SECRET_KEY;
process.env.SUIVI_COOKIE_SECRET = randomBytes(32).toString('base64');
process.env.ADMINS_SUIVI = ADMIN;

// ---------------------------------------------------------------- courriels
const envoisInterceptes = [];
const fetchReel = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (String(url).includes('/auth/v1/recover')) {
    envoisInterceptes.push(JSON.parse(opts.body).email);
    return new Response('{}', { status: 200 });
  }
  return fetchReel(url, opts);
};

// ---------------------------------------------------------------- base brute
const URL = conf.SUPABASE_URL;
const H = { apikey: conf.SUPABASE_SECRET_KEY, 'content-type': 'application/json' };
const HS = { ...H, 'accept-profile': 'suivi', 'content-profile': 'suivi' };
async function rest(methode, chemin, corps, prefer = 'return=representation') {
  const r = await fetchReel(`${URL}/rest/v1/${chemin}`, {
    method: methode, headers: { ...HS, prefer }, body: corps ? JSON.stringify(corps) : undefined,
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${methode} ${chemin.split('?')[0]} ${r.status} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
}
async function auth(methode, chemin, corps) {
  const r = await fetchReel(`${URL}/auth/v1/${chemin}`, {
    method: methode, headers: H, body: corps ? JSON.stringify(corps) : undefined,
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`auth ${methode} ${chemin} ${r.status} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
}
const motDePasse = () => `Essai-${randomBytes(12).toString('base64url')}-Tsingy`;

// ---------------------------------------------------------------- appels
const charger = async (n) => (await import(`../api/${n}.js`)).default;
const H_API = {};
for (const n of ['auth/connexion', 'auth/deconnexion', 'auth/moi', 'auth/lien', 'auth/mot-de-passe',
  'auth/demande-suppression', 'projets/liste', 'projets/annees', 'projets/fiche',
  'projets/corbeille', 'projets/verrou', 'projets/reconduire', 'projets/export',
  'projets/commentaires', 'admin/comptes', 'admin/journal']) H_API[n] = await charger(n);

async function appel(nom, { methode = 'GET', query = {}, body, cookie, origine = true } = {}) {
  const req = {
    method: methode, query, body,
    headers: {
      host: 'suivi.essai', 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/130.0 Safari/537.36',
      ...(origine ? { origin: 'https://suivi.essai' } : {}), ...(cookie ? { cookie } : {}),
    },
  };
  const res = {
    statut: 200, entetes: {}, corps: null,
    status(c) { this.statut = c; return this; },
    json(o) { this.corps = o; return this; },
    send(s) { this.corps = s; return this; },
    setHeader(k, v) { this.entetes[k.toLowerCase()] = v; },
  };
  await H_API[nom](req, res);
  const sc = res.entetes['set-cookie'];
  const c = sc ? sc.map((x) => x.split(';')[0]).join('; ') : null;
  return { s: res.statut, b: res.corps, cookie: c, setCookie: sc ?? [] };
}

let reussis = 0;
const echecs = [];
function verifie(cond, libelle, detail) {
  if (cond) { reussis += 1; return; }
  echecs.push(libelle);
  console.log(`  ÉCHEC : ${libelle}${detail !== undefined ? ` -> ${JSON.stringify(detail).slice(0, 300)}` : ''}`);
}

// ---------------------------------------------------------------- comptes d'essai
const COMPTES = {
  admin: { email: ADMIN, role: 'admin', nom: 'ESSAIAPI', prenom: 'Admin' },
  direction: { email: `${PREFIXE}direction@egd.mg`, role: 'direction', nom: 'ESSAIAPI', prenom: 'Direction' },
  vs: { email: `${PREFIXE}vs@egd.mg`, role: 'vie_scolaire', nom: 'ESSAIAPI', prenom: 'Viesco' },
  e1: { email: `${PREFIXE}un@egd.mg`, role: 'enseignant', nom: 'ESSAIUN', prenom: 'Alpha' },
  e2: { email: `${PREFIXE}deux@egd.mg`, role: 'enseignant', nom: 'ESSAIDEUX', prenom: 'Bravo' },
};
const creesProjets = new Set();

async function nettoyer() {
  const ids = (await rest('GET', 'membres?email=like.essai-api-*&select=id')).map((x) => x.id);
  if (ids.length) {
    const p = await rest('GET', `projets?or=(cree_par.in.(${ids.join(',')}),modifie_par.in.(${ids.join(',')}))&select=id`);
    for (const x of p) creesProjets.add(x.id);
  }
  if (creesProjets.size) await rest('DELETE', `projets?id=in.(${[...creesProjets].join(',')})`, null, 'return=minimal');
  for (const id of ids) await auth('DELETE', `admin/users/${id}`);
  const restants = await auth('GET', 'admin/users?per_page=1000');
  for (const u of restants.users ?? []) {
    if (String(u.email).startsWith(PREFIXE)) await auth('DELETE', `admin/users/${u.id}`);
  }
  await rest('DELETE', 'journal?email=like.essai-api-*', null, 'return=minimal');
}

async function main() {
  const avant = {
    membres: (await rest('GET', 'membres?select=id')).length,
    projets: (await rest('GET', 'projets?select=id')).length,
    referents: (await rest('GET', 'projet_referents?select=projet_id')).length,
    journal: (await rest('GET', 'journal?select=id&limit=100000')).length,
  };
  await nettoyer();   // restes d'un essai interrompu

  for (const c of Object.values(COMPTES)) {
    c.mdp = motDePasse();
    const u = await auth('POST', 'admin/users', { email: c.email, password: c.mdp, email_confirm: true });
    c.id = u.id;
    await rest('POST', 'membres', { id: c.id, email: c.email, role: c.role, nom: c.nom, prenom: c.prenom, mdp_provisoire: false });
  }
  const connecter = async (c) => {
    const r = await appel('auth/connexion', { methode: 'POST', body: { email: c.email, motDePasse: c.mdp } });
    verifie(r.s === 200 && r.cookie, `connexion ${c.role} ${c.prenom}`, r.b);
    c.cookie = r.cookie;
  };
  for (const c of Object.values(COMPTES)) await connecter(c);
  const { admin, direction, vs, e1, e2 } = COMPTES;

  console.log('1. Lecture publique');
  let r = await appel('projets/annees');
  verifie(r.s === 200 && r.b.annees.includes('2025-2026') && r.b.annees.includes('2026-2027'), 'années', r.b);
  const courante = r.b.courante;
  r = await appel('projets/liste', { query: { annee: '2026-2027' } });
  verifie(r.s === 200 && r.b.projets.length === 16, 'liste 2026-2027 anonyme : 16 fiches', r.b.projets?.length);
  verifie(!/@egd\.mg/.test(JSON.stringify(r.b)), 'liste anonyme sans aucune adresse');
  verifie(!JSON.stringify(r.b).includes('cree_par"'), 'liste anonyme sans identifiant de compte');
  verifie(r.b.projets.every((p) => !('peut_modifier' in p)) && r.b.categories_autorisees.length === 0, 'aucun droit pour un visiteur');
  // 7 reconductions importées, dont une à la corbeille : 6 visibles.
  verifie(r.b.projets.filter((p) => p.reconduit_de?.annee === '2025-2026' && /^\w+-\d{3}$/.test(p.reconduit_de.code)).length === 6,
    'reconductions décrites (6 visibles sur 7)');
  r = await appel('projets/liste', { query: { annee: '2025-2026' } });
  verifie(r.s === 200 && r.b.projets.length === 73 && r.b.archivee === true, '2025-2026 : 73 fiches, archivée', r.b.projets?.length);
  r = await appel('projets/liste', { query: { annee: '2025' } });
  verifie(r.s === 400, 'année malformée refusée');

  console.log('2. Connexion, session, verrou');
  r = await appel('auth/connexion', { methode: 'POST', body: { email: e1.email, motDePasse: 'faux-mot-de-passe' } });
  verifie(r.s === 401 && !r.cookie, 'mauvais mot de passe refusé');
  r = await appel('auth/connexion', { methode: 'POST', body: { email: `${PREFIXE}inconnu@egd.mg`, motDePasse: 'x' } });
  verifie(r.s === 401, 'adresse inconnue : même refus');
  r = await appel('auth/connexion', { methode: 'POST', body: { email: e1.email, motDePasse: e1.mdp }, origine: false });
  verifie(r.s === 403, 'connexion sans origine refusée');
  r = await appel('auth/moi', { cookie: e1.cookie });
  verifie(r.b.connecte === true && r.b.role === 'enseignant' && r.b.prenom === 'Alpha', 'moi : enseignant connecté', r.b);
  r = await appel('auth/moi', { cookie: e1.cookie.replace(/suivi_session=([^.;]+)\.[^;]+/, 'suivi_session=$1.AAAA') });
  verifie(r.b.connecte === false, 'cookie falsifié : anonyme');
  r = await appel('auth/moi', { cookie: admin.cookie });
  verifie(r.b.admin === true, 'admin reconnu');

  console.log('3. Création et droits des enseignants');
  r = await appel('projets/fiche', { methode: 'POST', cookie: e1.cookie, body: { nom: 'Essai API un', categorie: 'LFT', axe: 2, priorite: 'haute', date_debut: '2026-12-01', date_fin: '2027-03-01' } });
  verifie(r.s === 201 && /^LFT-\d{3}$/.test(r.b.projet?.code) && r.b.projet.peut_modifier === true, 'enseignant crée une fiche', r.b);
  const p1 = r.b.projet; creesProjets.add(p1.id);
  verifie(p1.annee === courante && p1.statut === 'planifie' && p1.cree_par_nom === 'Alpha ESSAIUN', 'fiche créée : année, statut, auteur', p1);
  r = await appel('projets/fiche', { methode: 'POST', cookie: e1.cookie, body: { nom: 'x', categorie: 'LFT', date_debut: '2027-02-01', date_fin: '2027-01-01' } });
  verifie(r.s === 400, 'dates inversées refusées');
  r = await appel('projets/fiche', { methode: 'POST', cookie: e1.cookie, body: { nom: 'x', categorie: 'XYZ' } });
  verifie(r.s === 400, 'catégorie inconnue refusée');
  r = await appel('projets/fiche', { methode: 'POST', body: { nom: 'x', categorie: 'LFT' } });
  verifie(r.s === 401, 'création anonyme refusée');
  r = await appel('projets/fiche', { methode: 'PATCH', cookie: e2.cookie, body: { id: p1.id, nom: 'piraté' } });
  verifie(r.s === 403, "un autre enseignant ne modifie pas la fiche");
  r = await appel('projets/corbeille', { methode: 'POST', cookie: e2.cookie, body: { id: p1.id, geste: 'jeter' } });
  verifie(r.s === 403, "un autre enseignant ne la jette pas");
  r = await appel('projets/fiche', { methode: 'PATCH', cookie: e1.cookie, body: { id: p1.id, referents: 'ESSAIDEUX Bravo, Mme INTERVENANTE' } });
  verifie(r.s === 200, 'auteur ajoute un référent', r.b);
  r = await appel('projets/fiche', { methode: 'PATCH', cookie: e2.cookie, body: { id: p1.id, description: 'ajout du référent' } });
  verifie(r.s === 200 && r.b.projet.peut_modifier, 'le référent modifie la fiche', r.b);
  r = await appel('projets/fiche', { methode: 'PATCH', cookie: e1.cookie, body: { id: p1.id, referents: 'ESSAIDEUX' } });
  r = await appel('projets/fiche', { methode: 'PATCH', cookie: e2.cookie, body: { id: p1.id, description: 'nom seul : rattachement gardé' } });
  verifie(r.s === 200, 'nom seul : le rattachement existant est gardé', r.b);
  r = await appel('projets/fiche', { methode: 'PATCH', cookie: e1.cookie, body: { id: p1.id, referents: 'Mme INTERVENANTE' } });
  r = await appel('projets/fiche', { methode: 'PATCH', cookie: e2.cookie, body: { id: p1.id, description: 'retiré' } });
  verifie(r.s === 403, 'référent retiré : plus de droit');
  r = await appel('projets/liste', { cookie: e2.cookie });
  verifie(r.b.projets.find((p) => p.id === p1.id)?.peut_modifier === false && r.b.categories_autorisees.length === 6, 'liste connectée : droits calculés', r.b.categories_autorisees);

  console.log('4. Modifications concurrentes');
  r = await appel('projets/fiche', { query: { id: p1.id } });
  const version = r.b.projet.modifie_le;
  r = await appel('projets/fiche', { methode: 'PATCH', cookie: e1.cookie, body: { id: p1.id, modifie_le: version, objectifs: 'premier' } });
  verifie(r.s === 200, 'enregistrement avec la bonne version', r.b);
  r = await appel('projets/fiche', { methode: 'PATCH', cookie: e1.cookie, body: { id: p1.id, modifie_le: version, objectifs: 'second' } });
  verifie(r.s === 409, 'version périmée : conflit signalé', r.b);
  r = await appel('projets/fiche', { methode: 'PATCH', cookie: e1.cookie, body: { id: p1.id, objectifs: 'premier' } });
  verifie(r.s === 200 && r.b.inchange === true, 'rien de changé : rien écrit');

  console.log('5. Vie scolaire');
  r = await appel('projets/fiche', { methode: 'POST', cookie: vs.cookie, body: { nom: 'x', categorie: 'LFT' } });
  verifie(r.s === 403, 'vie scolaire : LFT refusé');
  r = await appel('projets/fiche', { methode: 'POST', cookie: vs.cookie, body: { nom: 'Club essai API', categorie: 'CLUB' } });
  verifie(r.s === 201 && r.b.projet.code.startsWith('CLUB-'), 'vie scolaire : club créé', r.b);
  const pClub = r.b.projet; creesProjets.add(pClub.id);
  r = await appel('projets/fiche', { methode: 'PATCH', cookie: vs.cookie, body: { id: pClub.id, categorie: 'LFT' } });
  verifie(r.s === 403, 'vie scolaire : le club ne sort pas de ses catégories');
  r = await appel('projets/fiche', { methode: 'PATCH', cookie: vs.cookie, body: { id: p1.id, nom: 'x' } });
  verifie(r.s === 403, 'vie scolaire : fiche LFT non modifiable');

  console.log('6. Verrou');
  r = await appel('projets/verrou', { methode: 'POST', cookie: e1.cookie, body: { id: p1.id, verrouiller: true } });
  verifie(r.s === 403, "l'enseignant ne verrouille pas");
  r = await appel('projets/verrou', { methode: 'POST', cookie: direction.cookie, body: { id: p1.id, verrouiller: true } });
  verifie(r.s === 200, 'la direction verrouille');
  r = await appel('projets/fiche', { methode: 'PATCH', cookie: e1.cookie, body: { id: p1.id, nom: 'après verrou' } });
  verifie(r.s === 403, "fiche verrouillée : l'auteur ne modifie plus");
  r = await appel('projets/corbeille', { methode: 'POST', cookie: e1.cookie, body: { id: p1.id, geste: 'jeter' } });
  verifie(r.s === 403, "fiche verrouillée : l'auteur ne la jette plus");
  r = await appel('projets/fiche', { methode: 'PATCH', cookie: direction.cookie, body: { id: p1.id, nom: 'Essai API un (validé)' } });
  verifie(r.s === 200, 'la direction modifie une fiche verrouillée');
  r = await appel('projets/liste', { query: { annee: courante } });
  verifie(r.b.projets.find((p) => p.id === p1.id)?.verrouille === true, 'verrou visible dans la liste');
  r = await appel('projets/verrou', { methode: 'POST', cookie: direction.cookie, body: { id: p1.id, verrouiller: false } });
  verifie(r.s === 200, 'la direction déverrouille');

  console.log('7. Années archivée et suivante');
  const suivante = `${Number(courante.slice(0, 4)) + 1}-${Number(courante.slice(5)) + 1}`;
  r = await appel('projets/fiche', { methode: 'POST', cookie: direction.cookie, body: { annee: '2025-2026', nom: 'x', categorie: 'LFT' } });
  verifie(r.s === 403, 'année archivée : direction refusée');
  r = await appel('projets/fiche', { methode: 'POST', cookie: e1.cookie, body: { annee: suivante, nom: 'x', categorie: 'LFT' } });
  verifie(r.s === 403, 'année suivante : enseignant refusé');
  r = await appel('projets/fiche', { methode: 'POST', cookie: e1.cookie, body: { annee: '2031-2032', nom: 'x', categorie: 'LFT' } });
  verifie(r.s === 403, 'année lointaine refusée');
  r = await appel('projets/fiche', { methode: 'POST', cookie: admin.cookie, body: { annee: '2025-2026', nom: 'Essai API archive', categorie: 'INST' } });
  verifie(r.s === 201 && r.b.projet.annee === '2025-2026', "année archivée : l'admin peut écrire", r.b);
  creesProjets.add(r.b.projet?.id);
  const pArchive = r.b.projet;
  r = await appel('projets/fiche', { methode: 'PATCH', cookie: direction.cookie, body: { id: pArchive.id, nom: 'x' } });
  verifie(r.s === 403, 'année archivée : la direction ne modifie pas');

  console.log('8. Commentaires');
  r = await appel('projets/commentaires', { methode: 'POST', body: { projet: p1.id, texte: 'anonyme' } });
  verifie(r.s === 401, 'commentaire anonyme refusé');
  r = await appel('projets/commentaires', { methode: 'POST', cookie: e2.cookie, body: { projet: p1.id, texte: 'Bravo pour ce projet' } });
  verifie(r.s === 201 && r.b.commentaire.auteur_nom === 'Bravo ESSAIDEUX', 'commentaire ajouté', r.b);
  r = await appel('projets/commentaires', { methode: 'POST', cookie: e2.cookie, body: { projet: p1.id, texte: 'x'.repeat(1001) } });
  verifie(r.s === 400, 'commentaire trop long refusé');
  r = await appel('projets/commentaires', { methode: 'POST', cookie: e2.cookie, body: { projet: pArchive.id, texte: 'archive' } });
  verifie(r.s === 403, 'commentaire sur une année archivée refusé');
  r = await appel('projets/commentaires', { query: { projet: p1.id } });
  verifie(r.s === 200 && r.b.commentaires.length === 1 && !/@/.test(JSON.stringify(r.b)), 'commentaires lus sans adresse', r.b);

  console.log('9. Reconduction');
  const sources = (await rest('GET', 'projets?annee=eq.2025-2026&supprime_le=is.null&select=id,code&order=code'));
  const dejaReconduits = new Set((await rest('GET', `projets?annee=eq.${courante}&reconduit_de=not.is.null&select=reconduit_de`)).map((x) => x.reconduit_de));
  const refsParProjet = new Map();
  for (const x of await rest('GET', 'projet_referents?select=projet_id')) refsParProjet.set(x.projet_id, (refsParProjet.get(x.projet_id) ?? 0) + 1);
  const src = sources.find((x) => !dejaReconduits.has(x.id) && refsParProjet.get(x.id));
  const srcDeja = sources.find((x) => dejaReconduits.has(x.id));
  r = await appel('projets/reconduire', { methode: 'POST', cookie: e1.cookie, body: { ids: [src.id, srcDeja.id, p1.id] } });
  verifie(r.s === 200 && r.b.crees.length === 1 && r.b.ignores.length === 1 && r.b.erreurs.length === 1, 'reconduction : 1 créée, 1 ignorée, 1 en erreur', r.b);
  const copie = r.b.crees?.[0];
  if (copie) creesProjets.add(copie.id);
  const refsCopie = await rest('GET', `projet_referents?projet_id=eq.${copie?.id}&select=membre_id`);
  verifie(refsCopie.length === refsParProjet.get(src.id), 'les référents suivent la fiche reconduite', refsCopie.length);
  r = await appel('projets/fiche', { query: { id: copie?.id } });
  verifie(r.b.projet?.date_debut === null && r.b.projet?.reconduit_de?.code === src.code && r.b.projet?.cree_par_nom === 'Alpha ESSAIUN', 'copie : sans dates, liée à son origine', r.b.projet);
  r = await appel('projets/reconduire', { methode: 'POST', cookie: e1.cookie, body: { ids: [src.id] } });
  verifie(r.b.crees.length === 0 && r.b.ignores.length === 1, 'seconde reconduction ignorée', r.b);
  r = await appel('projets/reconduire', { methode: 'POST', cookie: e1.cookie, body: { ids: [src.id], annee_cible: suivante } });
  verifie(r.s === 403, 'enseignant : année suivante refusée');
  r = await appel('projets/reconduire', { methode: 'POST', cookie: vs.cookie, body: { ids: [src.id] } });
  verifie(r.s === 200 && r.b.erreurs.length === 1 && r.b.crees.length === 0, 'vie scolaire : hors catégories', r.b);

  console.log('10. Corbeille');
  r = await appel('projets/corbeille', { methode: 'POST', cookie: e1.cookie, body: { id: p1.id, geste: 'jeter' } });
  verifie(r.s === 200, "l'auteur jette sa fiche", r.b);
  r = await appel('projets/liste', { query: { annee: courante } });
  verifie(!r.b.projets.some((p) => p.id === p1.id), 'fiche jetée absente de la liste publique');
  r = await appel('projets/commentaires', { query: { projet: p1.id } });
  verifie(r.s === 404, 'commentaires d’une fiche jetée non publics');
  r = await appel('projets/corbeille', { cookie: e1.cookie, query: { annee: courante } });
  verifie(r.s === 403, "l'enseignant ne voit pas la corbeille");
  r = await appel('projets/corbeille', { methode: 'POST', cookie: e1.cookie, body: { id: p1.id, geste: 'restaurer' } });
  verifie(r.s === 403, "l'enseignant ne restaure pas");
  r = await appel('projets/corbeille', { cookie: direction.cookie, query: { annee: courante } });
  const jete = r.b.projets?.find((p) => p.id === p1.id);
  verifie(r.s === 200 && jete?.supprime_par_nom === 'Alpha ESSAIUN', 'la direction voit la corbeille et qui a jeté', r.b);
  r = await appel('projets/corbeille', { methode: 'POST', cookie: direction.cookie, body: { id: p1.id, geste: 'restaurer' } });
  verifie(r.s === 200, 'la direction restaure');
  r = await appel('projets/corbeille', { methode: 'POST', cookie: direction.cookie, body: { id: p1.id, geste: 'supprimer' } });
  verifie(r.s === 409, 'suppression définitive hors corbeille refusée');

  console.log('11. Export');
  await appel('projets/fiche', { methode: 'PATCH', cookie: e1.cookie, body: { id: p1.id, sous_axe: '=HYPERLINK("http://exemple")' } });
  r = await appel('projets/export', { cookie: e1.cookie });
  verifie(r.s === 403, "l'enseignant n'exporte pas");
  r = await appel('projets/export', { cookie: direction.cookie, query: { annee: courante } });
  verifie(r.s === 200 && r.b.startsWith('﻿Code;Nom;Catégorie'), 'export CSV de la direction');
  verifie(r.b.includes(`"'=HYPERLINK(""http://exemple"")"`) && !/;=HYPERLINK/.test(r.b), 'formule neutralisée dans le CSV');
  verifie(!/@egd\.mg/.test(r.b), 'export sans adresse');

  console.log('12. Mot de passe');
  r = await appel('auth/mot-de-passe', { methode: 'POST', cookie: e1.cookie, body: { ancien: 'faux', nouveau: 'trois mots collés ensemble' } });
  verifie(r.s === 401, 'ancien mot de passe faux refusé');
  r = await appel('auth/mot-de-passe', { methode: 'POST', cookie: e1.cookie, body: { ancien: e1.mdp, nouveau: 'azertyuiop123' } });
  verifie(r.s === 400, 'mot de passe trop faible refusé', r.b);
  r = await appel('auth/mot-de-passe', { methode: 'POST', cookie: e1.cookie, body: { ancien: e1.mdp, nouveau: 'Alpha essaiun manguier' } });
  verifie(r.s === 400, 'mot de passe contenant le nom refusé', r.b);
  const nouveau = 'Baobab lagon vanille 42';
  r = await appel('auth/mot-de-passe', { methode: 'POST', cookie: e1.cookie, body: { ancien: e1.mdp, nouveau } });
  verifie(r.s === 200 && r.cookie, 'mot de passe changé', r.b);
  r = await appel('auth/connexion', { methode: 'POST', body: { email: e1.email, motDePasse: nouveau } });
  verifie(r.s === 200, 'connexion avec le nouveau mot de passe');

  console.log('13. Lien et première connexion');
  r = await appel('auth/lien', { methode: 'POST', body: { email: `${PREFIXE}inconnu@egd.mg` } });
  const reponseInconnu = r.b.message;
  verifie(r.s === 200 && envoisInterceptes.length === 0, 'adresse inconnue : aucun envoi');
  r = await appel('auth/lien', { methode: 'POST', body: { email: e2.email } });
  verifie(r.s === 200 && r.b.message === reponseInconnu && envoisInterceptes.length === 1, 'adresse connue : même réponse, un envoi');
  r = await appel('auth/lien', { methode: 'POST', body: { email: e2.email } });
  verifie(envoisInterceptes.length === 1, 'second lien dans les cinq minutes : pas de nouvel envoi');
  const lien = await auth('POST', 'admin/generate_link', { type: 'recovery', email: vs.email });
  const jeton = lien.hashed_token ?? lien.properties?.hashed_token;
  r = await appel('auth/mot-de-passe', { methode: 'POST', body: { jeton, nouveau: 'court' } });
  verifie(r.s === 400, 'lien : mot de passe faible refusé sans griller le lien');
  r = await appel('auth/mot-de-passe', { methode: 'POST', body: { jeton, nouveau: 'Tsiry fanorona pirogue 7' } });
  verifie(r.s === 200 && r.cookie, 'lien : mot de passe choisi, session ouverte', r.b);
  r = await appel('auth/mot-de-passe', { methode: 'POST', body: { jeton, nouveau: 'Tsiry fanorona pirogue 8' } });
  verifie(r.s === 401, 'lien déjà servi : refusé');

  console.log('14. Administration des comptes');
  r = await appel('admin/comptes', { cookie: direction.cookie });
  verifie(r.s === 403, 'la direction ne gère pas les comptes');
  r = await appel('admin/comptes', { cookie: admin.cookie });
  verifie(r.s === 200 && r.b.comptes.length === avant.membres + 5, 'liste des comptes', r.b.comptes?.length);
  r = await appel('admin/comptes', { methode: 'POST', cookie: admin.cookie, body: { email: `${PREFIXE}nouveau@egd.mg`, role: 'enseignant', nom: 'ESSAINOUVEAU', prenom: 'Charlie' } });
  verifie(r.s === 201, 'compte créé sans mot de passe connu', r.b);
  const idNouveau = r.b.id;
  r = await appel('admin/comptes', { methode: 'POST', cookie: admin.cookie, body: { email: 'quelqu.un@gmail.com', role: 'enseignant', nom: 'X', prenom: 'Y' } });
  verifie(r.s === 400, 'adresse hors @egd.mg refusée');
  r = await appel('admin/comptes', { methode: 'PATCH', cookie: admin.cookie, body: { id: idNouveau, role: 'direction' } });
  verifie(r.s === 401, 'changement de rôle sans ressaisie refusé');
  r = await appel('admin/comptes', { methode: 'PATCH', cookie: admin.cookie, body: { id: idNouveau, role: 'direction', motDePasse: admin.mdp } });
  verifie(r.s === 200, 'changement de rôle avec ressaisie', r.b);
  r = await appel('admin/comptes', { methode: 'PATCH', cookie: admin.cookie, body: { id: idNouveau, role: 'admin', motDePasse: admin.mdp } });
  verifie(r.s === 403, 'rôle admin refusé hors ADMINS_SUIVI');
  r = await appel('admin/comptes', { methode: 'PATCH', cookie: admin.cookie, body: { id: admin.id, actif: false } });
  verifie(r.s === 400, "l'admin ne se désactive pas lui-même");
  r = await appel('admin/comptes', { methode: 'PATCH', cookie: admin.cookie, body: { id: e2.id, actif: false } });
  verifie(r.s === 200, 'désactivation');
  r = await appel('auth/moi', { cookie: e2.cookie });
  verifie(r.b.connecte === false, 'compte désactivé : session coupée aussitôt');
  r = await appel('projets/commentaires', { methode: 'POST', cookie: e2.cookie, body: { projet: pClub.id, texte: 'après désactivation' } });
  verifie(r.s === 401, 'compte désactivé : plus aucune écriture');
  r = await appel('auth/connexion', { methode: 'POST', body: { email: e2.email, motDePasse: e2.mdp } });
  verifie(r.s === 403 && /désactivé/.test(r.b.message), 'compte désactivé : message clair avec le bon mot de passe');
  r = await appel('admin/comptes', { methode: 'DELETE', cookie: admin.cookie, body: { id: idNouveau, motDePasse: 'faux' } });
  verifie(r.s === 401, 'suppression sans bon mot de passe refusée');
  r = await appel('admin/comptes', { methode: 'DELETE', cookie: admin.cookie, body: { id: idNouveau, motDePasse: admin.mdp } });
  verifie(r.s === 200, 'suppression du compte', r.b);
  verifie((await rest('GET', `membres?id=eq.${idNouveau}&select=id`)).length === 0, 'la ligne membres part avec le compte');

  console.log('15. Journal et rôle admin révoqué');
  r = await appel('admin/journal', { cookie: e1.cookie });
  verifie(r.s === 403, "l'enseignant ne lit pas le journal");
  r = await appel('admin/journal', { cookie: admin.cookie, query: { limite: '100' } });
  const actions = new Set(r.b.journal?.map((l) => l.action));
  verifie(['login', 'login_fail', 'add_project', 'update_project', 'lock_project', 'add_comment',
    'reconduct_batch', 'delete_project', 'restore_project', 'change_password', 'password_reset',
    'add_user', 'change_role', 'deactivate_user', 'delete_user', 'export'].every((a) => actions.has(a)),
  'le journal trace les gestes', [...actions]);
  verifie(r.b.journal?.[0]?.os === 'macOS' && r.b.journal?.[0]?.navigateur === 'Chrome', 'système et navigateur notés');
  process.env.ADMINS_SUIVI = 'quelqu.un.d.autre@egd.mg';
  r = await appel('admin/comptes', { cookie: admin.cookie });
  verifie(r.s === 401, 'admin retiré de ADMINS_SUIVI : plus aucun droit');
  process.env.ADMINS_SUIVI = ADMIN;
  r = await appel('auth/deconnexion', { methode: 'POST', cookie: e1.cookie });
  verifie(r.s === 200 && r.setCookie.length === 2 && r.setCookie.every((x) => /Max-Age=0/.test(x)),
    'déconnexion : les deux cookies effacés', r.setCookie);
  r = await appel('auth/deconnexion', { methode: 'GET' });
  verifie(r.s === 405, 'déconnexion par GET refusée');

  return avant;
}

let avant = null;
try {
  avant = await main();
} catch (e) {
  echecs.push(`exception : ${e.message}`);
  console.log('EXCEPTION', e.stack);
} finally {
  await nettoyer();
  const apres = {
    membres: (await rest('GET', 'membres?select=id')).length,
    projets: (await rest('GET', 'projets?select=id')).length,
    referents: (await rest('GET', 'projet_referents?select=projet_id')).length,
    journal: (await rest('GET', 'journal?select=id&limit=100000')).length,
  };
  if (avant) verifie(JSON.stringify(avant) === JSON.stringify(apres), 'base rendue dans son état initial', { avant, apres });
  console.log(`\n${reussis} vérifications réussies, ${echecs.length} échec(s).`);
  console.log('État de la base après nettoyage :', apres);
  process.exitCode = echecs.length ? 1 : 0;
}
