// =====================================================================
// Import de la liste des élèves d'une année dans suivi.eleves.
//
//   node outils/importer-eleves.mjs <fichier.json> [--annee 2026-2027]           simulation
//   node outils/importer-eleves.mjs <fichier.json> [--annee 2026-2027] --ecrire  écriture
//
// Le fichier vient d'un relevé Pronote (Liste des élèves, une liste par
// classe) et reste HORS DU DÉPÔT, qui est public :
//   { "source": "...", "classes": { "3M2": ["NOM Prénom", ...], ... } }
//
// Règles :
//  - le nom de famille est la suite des premiers mots en capitales, le
//    prénom le reste (« DUPONT DE LA TOUR Marie-Anne ») ;
//  - un élève déjà en base garde ses mandats et son repère PAP ;
//  - un élève qui a changé de classe est déplacé, pas recréé (ses projets
//    et ses mandats le suivent) ;
//  - un élève absent du fichier est retiré, avec ses rattachements aux
//    projets (ON DELETE CASCADE).
// Le script n'affiche que des nombres, jamais un nom.
// =====================================================================

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

const args = process.argv.slice(2);
const fichier = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--annee');
const annee = args.includes('--annee') ? args[args.indexOf('--annee') + 1] : '2026-2027';
const ecrire = args.includes('--ecrire');
if (!fichier || !/^\d{4}-\d{4}$/.test(annee)) {
  console.error('Usage : node outils/importer-eleves.mjs <fichier.json> [--annee AAAA-AAAA] [--ecrire]');
  process.exit(1);
}

const conf = Object.fromEntries(readFileSync(`${homedir()}/.config/lft/suivi-supabase.env`, 'utf8')
  .split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
  .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const H = {
  apikey: conf.SUPABASE_SECRET_KEY, 'content-type': 'application/json',
  'accept-profile': 'suivi', 'content-profile': 'suivi',
};
if (!String(conf.SUPABASE_SECRET_KEY).startsWith('sb_')) H.authorization = `Bearer ${conf.SUPABASE_SECRET_KEY}`;

async function rest(methode, chemin, corps) {
  const r = await fetch(`${conf.SUPABASE_URL}/rest/v1/${chemin}`, {
    method: methode, headers: { ...H, prefer: 'return=minimal' },
    body: corps ? JSON.stringify(corps) : undefined,
  });
  const t = await r.text();
  // Le message d'erreur de PostgREST peut citer une valeur : on n'en garde que le code.
  if (!r.ok) throw new Error(`${methode} ${chemin.split('?')[0]} : ${r.status} ${(() => { try { return JSON.parse(t).code; } catch { return ''; } })()}`);
  return t ? JSON.parse(t) : null;
}
async function lireTout(chemin) {
  const l = [];
  for (let n = 0; ; n += 1) {
    const r = await fetch(`${conf.SUPABASE_URL}/rest/v1/${chemin}&limit=1000&offset=${n * 1000}`, { headers: H });
    if (!r.ok) throw new Error(`lecture : ${r.status}`);
    const page = await r.json();
    l.push(...page);
    if (page.length < 1000) return l;
  }
}

// ------------------------------------------------------------ lecture du fichier
const MAJ = /^[A-ZÀ-ÖØ-Þ'’-]+$/u;
function decouper(complet) {
  const mots = String(complet).trim().split(/\s+/);
  let i = 0;
  while (i < mots.length - 1 && MAJ.test(mots[i]) && /[A-ZÀ-ÖØ-Þ]/u.test(mots[i])) i += 1;
  return i === 0 ? null : { nom: mots.slice(0, i).join(' '), prenom: mots.slice(i).join(' ') };
}

const source = JSON.parse(readFileSync(fichier, 'utf8'));
const voulus = new Map();
let illisibles = 0;
let doublons = 0;
for (const [classe, noms] of Object.entries(source.classes ?? {})) {
  if (!/^[0-9A-Z]{2,12}$/.test(classe)) { console.error('Nom de classe refusé (format).'); process.exit(1); }
  for (const n of noms) {
    const d = decouper(n);
    if (!d) { illisibles += 1; continue; }
    const cle = `${classe}|${d.nom}|${d.prenom}`;
    if (voulus.has(cle)) { doublons += 1; continue; }
    voulus.set(cle, { annee, classe, ...d });
  }
}
if (illisibles) { console.error(`${illisibles} nom(s) sans nom de famille en capitales : rien n'est écrit.`); process.exit(1); }

// ------------------------------------------------------------ comparaison avec la base
const actuels = await lireTout(`eleves?annee=eq.${annee}&select=id,classe,nom,prenom&order=id`);
const parCle = new Map(actuels.map((e) => [`${e.classe}|${e.nom}|${e.prenom}`, e]));

const nouveaux = [...voulus.entries()].filter(([k]) => !parCle.has(k)).map(([, v]) => v);
const absents = actuels.filter((e) => !voulus.has(`${e.classe}|${e.nom}|${e.prenom}`));

// Changements de classe : même nom et prénom, un seul candidat de chaque côté.
const personne = (e) => `${e.nom}|${e.prenom}`;
const compter = (l) => l.reduce((m, e) => m.set(personne(e), (m.get(personne(e)) ?? 0) + 1), new Map());
const nN = compter(nouveaux);
const nA = compter(absents);
const deplaces = [];
for (const a of absents) {
  const k = personne(a);
  if (nA.get(k) === 1 && nN.get(k) === 1) deplaces.push({ id: a.id, classe: nouveaux.find((n) => personne(n) === k).classe });
}
const deplacesK = new Set(deplaces.map((d) => personne(actuels.find((a) => a.id === d.id))));
const aCreer = nouveaux.filter((n) => !deplacesK.has(personne(n)));
const aRetirer = absents.filter((a) => !deplacesK.has(personne(a)));

console.log(`Année ${annee} : ${Object.keys(source.classes).length} classes, ${voulus.size} élèves dans le fichier`
  + (doublons ? ` (${doublons} doublon(s) ignoré(s))` : '') + '.');
console.log(`En base : ${actuels.length}. À créer : ${aCreer.length}. Changement de classe : ${deplaces.length}. À retirer : ${aRetirer.length}.`);

if (!ecrire) {
  console.log('Simulation : rien n\'est écrit. Relancer avec --ecrire pour appliquer.');
  process.exit(0);
}

for (let i = 0; i < aCreer.length; i += 500) await rest('POST', 'eleves', aCreer.slice(i, i + 500));
for (const d of deplaces) await rest('PATCH', `eleves?id=eq.${d.id}`, { classe: d.classe, maj_le: new Date().toISOString() });
for (let i = 0; i < aRetirer.length; i += 100) {
  await rest('DELETE', `eleves?id=in.(${aRetirer.slice(i, i + 100).map((a) => a.id).join(',')})`);
}
const apres = await lireTout(`eleves?annee=eq.${annee}&select=id&order=id`);
console.log(`Écrit. En base pour ${annee} : ${apres.length} élèves.`);
