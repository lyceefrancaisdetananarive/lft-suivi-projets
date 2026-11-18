// =====================================================================
// Import des repères des élèves (mandats et accompagnements) depuis un ou
// plusieurs exports Pronote : délégués, éco-délégués, élus CVC ou CVL,
// PAP, PPRE, PAI.
//
//   node outils/importer-reperes.mjs <fichier> [<fichier>...] [--annee 2026-2027]            simulation
//   node outils/importer-reperes.mjs <fichier> [<fichier>...] [--annee 2026-2027] --ecrire   écriture
//
// Les fichiers restent HORS DU DÉPÔT (il est public) : PAI et PAP sont des
// données sensibles. Formats acceptés : CSV (« ; » ou « , ») ou texte
// tabulé, tel que le donne « Copier la liste » ou l'export de Pronote, avec
// une ligne d'en-tête. Le script reconnaît :
//  - la classe : colonne dont l'en-tête contient « classe » ;
//  - l'élève : colonne « élève » (« NOM Prénom ») ou colonnes « nom » et
//    « prénom » ;
//  - les repères, de deux façons : une colonne par repère (en-tête « PAP »,
//    « Suppléant »... et une case remplie), ou une colonne dont les cases
//    portent le libellé (« Délégué titulaire », « PPRE »...).
//
// Les repères trouvés s'AJOUTENT à ceux déjà posés : rien n'est retiré.
// Le script n'affiche que des nombres (et, pour une ligne non reconnue,
// son numéro et sa classe), jamais un nom.
// =====================================================================

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

const args = process.argv.slice(2);
const fichiers = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--annee');
const annee = args.includes('--annee') ? args[args.indexOf('--annee') + 1] : '2026-2027';
const ecrire = args.includes('--ecrire');
if (!fichiers.length || !/^\d{4}-\d{4}$/.test(annee)) {
  console.error('Usage : node outils/importer-reperes.mjs <fichier> [...] [--annee AAAA-AAAA] [--ecrire]');
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

// ------------------------------------------------------------ repères
const MANDATS = ['delegue_titulaire', 'delegue_suppleant', 'eco_delegue', 'cvc', 'cvl'];
const ACCOMPAGNEMENTS = ['PAP', 'PPRE', 'PAI'];
const norme = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[’']/g, ' ').replace(/\s+/g, ' ').trim();

/** Les repères qu'un libellé désigne (« Délégué suppléant », « PPRE », « élu CVL »...). */
function reperesDe(texte, entete = false) {
  const t = ` ${norme(texte).replace(/[^a-z0-9]+/g, ' ')} `;
  const r = new Set();
  if (/ pap /.test(t)) r.add('PAP');
  if (/ ppre /.test(t)) r.add('PPRE');
  if (/ pai /.test(t)) r.add('PAI');
  if (/ cvc |vie collegienne/.test(t)) r.add('cvc');
  if (/ cvl |vie lyceenne/.test(t)) r.add('cvl');
  // « Éco » seul ne vaut que dans un en-tête : une case « Éco-gestion » n'est pas un mandat.
  if (/ eco ?delegue/.test(t) || (entete && / eco /.test(t))) r.add('eco_delegue');
  else if (/ suppleant/.test(t)) r.add('delegue_suppleant');
  else if (/ delegue|titulaire/.test(t)) r.add('delegue_titulaire');
  return r;
}
const VIDE = /^(|0|non|faux|false|-|x?\s*non)$/i;

// ------------------------------------------------------------ lecture
function lignes(texte) {
  const brut = texte.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const sep = ['\t', ';', ','].find((s) => brut[0].includes(s)) ?? ';';
  const decoupe = (l) => {
    const out = []; let cur = ''; let q = false;
    for (const ch of l) {
      if (ch === '"') q = !q;
      else if (ch === sep && !q) { out.push(cur.trim()); cur = ''; } else cur += ch;
    }
    out.push(cur.trim());
    return out;
  };
  return brut.map(decoupe);
}

const MAJ = /^[A-ZÀ-ÖØ-Þ'’-]+$/u;
function decouper(complet) {
  const mots = String(complet).trim().split(/\s+/);
  let i = 0;
  while (i < mots.length - 1 && MAJ.test(mots[i]) && /[A-ZÀ-ÖØ-Þ]/u.test(mots[i])) i += 1;
  return i === 0 ? null : { nom: mots.slice(0, i).join(' '), prenom: mots.slice(i).join(' ') };
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

const eleves = await lireTout(`eleves?annee=eq.${annee}&select=id,classe,nom,prenom,mandats,accompagnements&order=id`);
const index = new Map(eleves.map((e) => [`${e.classe}|${norme(e.nom)}|${norme(e.prenom)}`, e]));
// Repli sans classe (export qui ne la porte pas) : seulement si le nom est unique dans l'année.
const parNom = new Map();
for (const e of eleves) {
  const k = `${norme(e.nom)}|${norme(e.prenom)}`;
  parNom.set(k, parNom.has(k) ? null : e);
}

const voulus = new Map();   // id -> Set de repères
let reconnues = 0;
let sansRepere = 0;
const inconnues = [];
for (const f of fichiers) {
  const t = lignes(readFileSync(f, 'utf8'));
  const tete = t[0].map(norme);
  const cClasse = tete.findIndex((h) => h.includes('classe'));
  const cEleve = tete.findIndex((h) => /eleve|nom complet|nom et prenom/.test(h));
  const cNom = tete.findIndex((h) => h === 'nom');
  const cPrenom = tete.findIndex((h) => h.startsWith('prenom'));
  if (cEleve < 0 && (cNom < 0 || cPrenom < 0)) {
    console.error(`${f.split('/').pop()} : colonne de l'élève introuvable (en-tête « Élève », ou « Nom » et « Prénom »).`);
    process.exit(1);
  }
  const autres = tete.map((_, i) => i).filter((i) => ![cClasse, cEleve, cNom, cPrenom].includes(i));
  for (let n = 1; n < t.length; n += 1) {
    const l = t[n];
    const classe = cClasse >= 0 ? String(l[cClasse] ?? '').toUpperCase().replace(/\s+/g, '') : '';
    const np = cEleve >= 0 ? decouper(l[cEleve]) : { nom: l[cNom], prenom: l[cPrenom] };
    const r = new Set();
    for (const i of autres) {
      const cel = String(l[i] ?? '').trim();
      if (VIDE.test(cel)) continue;
      // Le libellé de la case prime (« Suppléant » sous « Délégués ») ; à défaut,
      // une case remplie sous un en-tête de repère (« X » sous « PAP »).
      const parCase = reperesDe(cel);
      for (const x of (parCase.size ? parCase : reperesDe(t[0][i], true))) r.add(x);
    }
    if (!np || !np.nom) { inconnues.push(`${f.split('/').pop()} ligne ${n + 1} (${classe || 'sans classe'})`); continue; }
    const e = classe ? index.get(`${classe}|${norme(np.nom)}|${norme(np.prenom)}`)
      : parNom.get(`${norme(np.nom)}|${norme(np.prenom)}`);
    if (!e) { inconnues.push(`${f.split('/').pop()} ligne ${n + 1} (${classe || 'sans classe'})`); continue; }
    reconnues += 1;
    if (!r.size) { sansRepere += 1; continue; }
    const s = voulus.get(e.id) ?? new Set();
    for (const x of r) s.add(x);
    voulus.set(e.id, s);
  }
}

// ------------------------------------------------------------ comparaison
const parId = new Map(eleves.map((e) => [e.id, e]));
const compte = Object.fromEntries([...MANDATS, ...ACCOMPAGNEMENTS].map((k) => [k, 0]));
const aEcrire = [];
for (const [id, s] of voulus) {
  const e = parId.get(id);
  const m = MANDATS.filter((k) => s.has(k) || e.mandats.includes(k));
  const a = ACCOMPAGNEMENTS.filter((k) => s.has(k) || e.accompagnements.includes(k));
  for (const k of s) if (!(e.mandats.includes(k) || e.accompagnements.includes(k))) compte[k] += 1;
  if (m.length !== e.mandats.length || a.length !== e.accompagnements.length) aEcrire.push({ id, mandats: m, accompagnements: a });
}

console.log(`Année ${annee} : ${reconnues} ligne(s) reconnue(s), ${sansRepere} sans repère, ${inconnues.length} non reconnue(s).`);
if (inconnues.length) console.log(`Lignes non reconnues : ${inconnues.slice(0, 40).join(', ')}${inconnues.length > 40 ? '...' : ''}`);
console.log('Repères nouveaux :', Object.entries(compte).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(', ') || 'aucun');
console.log(`Élèves à mettre à jour : ${aEcrire.length}.`);

if (!ecrire) {
  console.log('Simulation : rien n\'est écrit. Relancer avec --ecrire pour appliquer.');
  process.exit(0);
}
const maintenant = new Date().toISOString();
for (const x of aEcrire) {
  const r = await fetch(`${conf.SUPABASE_URL}/rest/v1/eleves?id=eq.${x.id}`, {
    method: 'PATCH', headers: { ...H, prefer: 'return=minimal' },
    body: JSON.stringify({ mandats: x.mandats, accompagnements: x.accompagnements, maj_le: maintenant }),
  });
  if (!r.ok) throw new Error(`écriture : ${r.status}`);
}
console.log(`Écrit : ${aEcrire.length} élève(s) mis à jour.`);
