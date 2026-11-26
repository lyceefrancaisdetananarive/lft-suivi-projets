// =====================================================================
// Essai HORS LIGNE de la règle d'accès aux élèves (24/11/2026).
//
//   node outils/essai-acces-eleves.mjs
//
// Aucun réseau, aucune base : fetch est remplacé par une fausse base en
// mémoire (élèves inventés, comptes inventés). Rien de réel n'est lu ni écrit,
// contrairement à outils/essai-api.mjs qui parle à la vraie base.
//
// Vérifie que :
//  - un enseignant ne reçoit jamais les accompagnements (PAP, PPRE, PAI) par
//    une liste de classes ;
//  - il les reçoit pour les élèves d'un projet dont il est l'auteur ou le
//    référent, et seulement ceux-là ;
//  - la colonne « accompagnements » n'est même pas demandée à la base quand
//    elle ne doit pas sortir ;
//  - la direction et l'administrateur les reçoivent ; la vie scolaire jamais ;
//  - chaque lecture qui renvoie des accompagnements est journalisée, sans nom ;
//  - plus de dix classes par demande : refus ; compte élève : refus.
// =====================================================================

import { randomBytes } from 'node:crypto';

process.env.SUPABASE_URL = 'https://faux.invalid';
process.env.SUPABASE_SECRET_KEY = 'sb_secret_essai';
process.env.SUIVI_COOKIE_SECRET = randomBytes(32).toString('base64');
process.env.ADMINS_SUIVI = 'admin@essai.invalid';

const { sceller } = await import('../api/_lib/session.js');
const { default: eleves } = await import('../api/projets/eleves.js');

// ------------------------------------------------------------ fausse base
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const MEMBRES = {
  ref:   { id: id(1), email: 'ref@essai.invalid', role: 'enseignant' },
  autre: { id: id(2), email: 'autre@essai.invalid', role: 'enseignant' },
  auteur: { id: id(3), email: 'auteur@essai.invalid', role: 'enseignant' },
  dir:   { id: id(4), email: 'dir@essai.invalid', role: 'direction' },
  admin: { id: id(5), email: 'admin@essai.invalid', role: 'admin' },
  vs:    { id: id(6), email: 'vs@essai.invalid', role: 'vie_scolaire' },
  eleve: { id: id(7), email: 'eleve@essai.invalid', role: 'eleve' },
};
for (const m of Object.values(MEMBRES)) Object.assign(m, { actif: true, mdp_provisoire: false, mdp_pose_le: null });
const PROJET = { id: id(100), code: 'LFT-900', cree_par: MEMBRES.auteur.id, supprime_le: null };
const ELEVES = [
  { id: id(201), annee: '2026-2027', classe: '3M2', nom: 'ESSAI', prenom: 'Un', mandats: ['cvc'], accompagnements: ['PAP'] },
  { id: id(202), annee: '2026-2027', classe: '3M2', nom: 'ESSAI', prenom: 'Deux', mandats: [], accompagnements: [] },
  { id: id(203), annee: '2026-2027', classe: '3M4', nom: 'ESSAI', prenom: 'Trois', mandats: [], accompagnements: ['PAI', 'PPRE'] },
];
const RETENUS = [id(201), id(203)];
const REFERENTS = [{ membre_id: MEMBRES.ref.id, projet_id: PROJET.id }];

let journal = [];
let requetes = [];

function colonnes(select) { return select.replace(/^.*?\(/, '').replace(/\)$/, '').split(','); }
function proj(l, cols) { return l.map((e) => Object.fromEntries(cols.map((c) => [c, e[c]]))); }

globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(url);
  const table = u.pathname.replace('/rest/v1/', '');
  const q = u.searchParams;
  requetes.push(`${opts.method ?? 'GET'} ${table}?${u.searchParams.toString()}`);
  const ok = (corps) => new Response(JSON.stringify(corps), { status: 200, headers: { 'content-type': 'application/json' } });
  if (opts.method === 'POST' && table === 'journal') { journal.push(JSON.parse(opts.body)); return ok([]); }
  if (table === 'membres') {
    const idm = q.get('id').replace('eq.', '');
    return ok(Object.values(MEMBRES).filter((m) => m.id === idm));
  }
  if (table === 'projets') return ok(q.get('id') === `eq.${PROJET.id}` ? [PROJET] : []);
  if (table === 'projet_referents') {
    const mid = q.get('membre_id').replace('eq.', '');
    return ok(REFERENTS.filter((r) => r.membre_id === mid));
  }
  if (table === 'projet_eleves') {
    const cols = colonnes(q.get('select'));
    return ok(proj(ELEVES.filter((e) => RETENUS.includes(e.id)), cols).map((e) => ({ eleves: e })));
  }
  if (table === 'eleves') {
    const classes = q.get('classe').replace(/^in\.\(|\)$/g, '').split(',');
    const cols = q.get('select').split(',');
    return ok(proj(ELEVES.filter((e) => e.annee === q.get('annee').replace('eq.', '') && classes.includes(e.classe)), cols));
  }
  return ok([]);
};

// ---------------------------------------------------------------- essai
async function appel(qui, query) {
  const jeton = qui ? await sceller({ sub: MEMBRES[qui].id, role: MEMBRES[qui].role }, process.env.SUIVI_COOKIE_SECRET) : null;
  const req = { method: 'GET', query, headers: jeton ? { cookie: `suivi_session=${jeton}` } : {} };
  let sortie = {};
  const res = { status(c) { sortie.code = c; return this; }, json(b) { sortie.corps = b; return this; }, setHeader() {} };
  journal = []; requetes = [];
  await eleves(req, res);
  return { ...sortie, journal: [...journal], requetes: [...requetes] };
}

let echecs = 0;
function verifie(nom, condition, detail = '') {
  if (!condition) echecs += 1;
  console.log(`${condition ? 'OK ' : 'ECHEC'}  ${nom}${condition ? '' : '  <- ' + detail}`);
}
const aAcc = (r) => (r.corps?.eleves ?? []).some((e) => 'accompagnements' in e);
const demandeAcc = (r) => r.requetes.some((x) => /accompagnements/.test(x));
const projetQ = { projet: PROJET.id };
const classesQ = { annee: '2026-2027', classes: '3M2,3M4' };

let r = await appel('autre', classesQ);
verifie('enseignant quelconque, par classes : élèves reçus', r.code === 200 && r.corps.eleves.length === 3);
verifie('  sans accompagnements', !aAcc(r));
verifie('  colonne accompagnements non demandée à la base', !demandeAcc(r), r.requetes.join(' | '));
verifie('  rien au journal', r.journal.length === 0);

r = await appel('ref', classesQ);
verifie('enseignant référent, par classes : sans accompagnements', r.code === 200 && !aAcc(r) && !demandeAcc(r));

r = await appel('autre', projetQ);
verifie('enseignant ni auteur ni référent, par projet : sans accompagnements', r.code === 200 && r.corps.eleves.length === 2 && !aAcc(r) && !demandeAcc(r));

r = await appel('ref', projetQ);
verifie('enseignant référent, par projet : accompagnements reçus', r.code === 200 && aAcc(r));
verifie('  limité aux élèves du projet (2 sur 3)', r.corps.eleves.length === 2);
verifie('  journalisé (read_support)', r.journal.length === 1 && r.journal[0].action === 'read_support' && r.journal[0].email === MEMBRES.ref.email);
verifie('  journal sans nom d\'élève', !/ESSAI|Un|Deux|Trois/.test(r.journal[0]?.detail ?? ''), r.journal[0]?.detail);

r = await appel('auteur', projetQ);
verifie('enseignant auteur, par projet : accompagnements reçus', r.code === 200 && aAcc(r));

r = await appel('dir', classesQ);
verifie('direction, par classes : accompagnements reçus', r.code === 200 && aAcc(r) && r.corps.eleves.length === 3);
verifie('  journalisé', r.journal.length === 1 && r.journal[0].action === 'read_support' && r.journal[0].role === 'direction');

r = await appel('admin', classesQ);
verifie('administrateur, par classes : accompagnements reçus', r.code === 200 && aAcc(r));

r = await appel('dir', projetQ);
verifie('direction, par projet : accompagnements reçus', r.code === 200 && aAcc(r));

r = await appel('vs', classesQ);
verifie('vie scolaire, par classes : sans accompagnements', r.code === 200 && !aAcc(r) && !demandeAcc(r));
r = await appel('vs', projetQ);
verifie('vie scolaire, par projet : sans accompagnements', r.code === 200 && !aAcc(r) && !demandeAcc(r));

r = await appel('eleve', classesQ);
verifie('compte élève : refus 403', r.code === 403);
r = await appel(null, classesQ);
verifie('sans session : refus 401', r.code === 401);

const onze = '3M1,3M2,3M3,3M4,3M5,4M1,4M2,4M3,4M4,4M5,5M1';
r = await appel('autre', { annee: '2026-2027', classes: onze });
verifie('onze classes : refus 400', r.code === 400);
const dix = onze.split(',').slice(0, 10).join(',');
r = await appel('autre', { annee: '2026-2027', classes: dix });
verifie('dix classes : accepté', r.code === 200);

r = await appel('autre', { projet: id(999) });
verifie('projet inconnu : 404', r.code === 404);

console.log(echecs ? `\n${echecs} échec(s)` : '\nTout est vert.');
process.exit(echecs ? 1 : 0);
