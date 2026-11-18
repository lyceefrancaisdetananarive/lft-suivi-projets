// =====================================================================
// Les fiches projet : champs saisissables, contrôles, forme renvoyée au
// navigateur, rattachement des référents.
// =====================================================================

import { lire, lireTout, ecrire } from './supabase.js';
import { statut } from './annee.js';

// Cinq catégories depuis la phase 2 (18/11/2026) : les projets de
// l'internat entrent dans « Club et activité » (aucune fiche INT en base).
export const CATEGORIES = {
  LFT: "Projet d'établissement",
  ZOI: 'Zone océan Indien',
  AEFE: 'Réseau AEFE',
  INST: 'Institutionnel',
  CLUB: 'Club et activité',
};

// Les parcours éducatifs et leurs trois axes (indices 0 à 2). Textes de
// référence : santé, circulaire 2016-008 ; citoyen, circulaire 2016-092 ;
// Avenir et PEAC, arrêtés du 1er juillet 2015.
export const PARCOURS = ['S', 'C', 'A', 'E'];

/** { S: [0, 1] } nettoyé, ou null si la forme est fausse. */
export function parcoursValide(x) {
  if (x == null) return {};
  if (typeof x !== 'object' || Array.isArray(x)) return null;
  const v = {};
  for (const [k, axes] of Object.entries(x)) {
    if (!PARCOURS.includes(k) || !Array.isArray(axes)) return null;
    const a = [...new Set(axes.map(Number))].sort();
    if (a.some((i) => ![0, 1, 2].includes(i))) return null;
    if (a.length) v[k] = a;
  }
  return v;
}
export const PRIORITES = ['haute', 'moyenne', 'basse'];

// Les seuls champs qu'une page peut écrire. Tout le reste (code, auteur,
// dates de suivi, corbeille, verrou, reconduction) est posé par le serveur.
const TEXTES = {
  nom: 300, echelle: 200, sous_axe: 300, disciplines: 1000, niveaux: 500,
  description: 8000, objectifs: 8000, partenariats: 3000, ressources: 3000,
  valorisation: 3000, referents: 1000, classes: 500,
};
export const CHAMPS_EDITABLES = [...Object.keys(TEXTES), 'categorie', 'axe', 'priorite',
  'date_debut', 'date_fin', 'parcours', 'phare_propose'];

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const dateValide = (v) => DATE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))
  && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

/**
 * Contrôle et nettoie la saisie. `partiel` : une modification ne porte que
 * les champs envoyés. Renvoie { valeurs } ou { message }.
 */
export function valider(entree, partiel = false) {
  const e = entree && typeof entree === 'object' ? entree : {};
  const v = {};
  for (const [champ, max] of Object.entries(TEXTES)) {
    if (!(champ in e)) continue;
    const t = e[champ] == null ? '' : String(e[champ]).trim();
    if (t.length > max) return { message: `Le champ « ${champ} » dépasse ${max} caractères.` };
    v[champ] = t || null;
  }
  if ('categorie' in e) {
    if (!(e.categorie in CATEGORIES)) return { message: 'Catégorie inconnue.' };
    v.categorie = e.categorie;
  }
  if ('axe' in e) {
    const a = e.axe === '' || e.axe == null ? null : Number(e.axe);
    if (a !== null && ![1, 2, 3].includes(a)) return { message: "L'axe doit valoir 1, 2 ou 3." };
    v.axe = a;
  }
  if ('priorite' in e) {
    const p = e.priorite ? String(e.priorite).toLowerCase() : null;
    if (p && !PRIORITES.includes(p)) return { message: 'Priorité inconnue.' };
    v.priorite = p;
  }
  if ('parcours' in e) {
    const pa = parcoursValide(e.parcours);
    if (!pa) return { message: 'Parcours éducatifs : valeur inconnue.' };
    v.parcours = pa;
  }
  if ('phare_propose' in e) v.phare_propose = e.phare_propose === true;
  for (const d of ['date_debut', 'date_fin']) {
    if (!(d in e)) continue;
    const t = e[d] ? String(e[d]).slice(0, 10) : null;
    if (t && !dateValide(t)) return { message: 'Date invalide (format attendu : AAAA-MM-JJ).' };
    v[d] = t;
  }
  if (!partiel) {
    if (!v.nom) return { message: 'Le nom du projet est obligatoire.' };
    if (!v.categorie) return { message: 'La catégorie est obligatoire.' };
  } else if ('nom' in v && !v.nom) {
    return { message: 'Le nom du projet ne peut pas être vide.' };
  }
  return { valeurs: v };
}

/** Les deux dates, en tenant compte de celle qui ne change pas. */
export function datesOrdonnees(valeurs, existant = {}) {
  const debut = 'date_debut' in valeurs ? valeurs.date_debut : existant.date_debut;
  const fin = 'date_fin' in valeurs ? valeurs.date_fin : existant.date_fin;
  return !debut || !fin || fin >= debut;
}

// Colonnes lues pour composer une fiche. Jamais d'adresse : les visiteurs
// anonymes lisent la liste publique.
export const CHAMPS_LUS = 'id,annee,code,categorie,nom,echelle,axe,sous_axe,disciplines,'
  + 'niveaux,description,objectifs,priorite,date_debut,date_fin,partenariats,ressources,'
  + 'valorisation,referents,cree_par,cree_par_nom,cree_le,modifie_le,supprime_le,'
  + 'verrouille_le,reconduit_de,parcours,phare,phare_propose,classes';

/**
 * La forme renvoyée au navigateur. `origines` : id -> { annee, code } des
 * projets d'origine. Les identifiants de comptes (cree_par...) ne sortent
 * pas : la page reçoit des droits calculés, pas de quoi les recalculer.
 */
export function versPage(p, { origines = new Map(), droits = null } = {}) {
  const o = p.reconduit_de ? origines.get(p.reconduit_de) : null;
  return {
    id: p.id,
    annee: p.annee,
    code: p.code,
    categorie: p.categorie,
    categorie_libelle: CATEGORIES[p.categorie] ?? p.categorie,
    nom: p.nom,
    echelle: p.echelle,
    axe: p.axe,
    sous_axe: p.sous_axe,
    disciplines: p.disciplines,
    niveaux: p.niveaux,
    classes: p.classes,
    description: p.description,
    objectifs: p.objectifs,
    priorite: p.priorite,
    date_debut: p.date_debut,
    date_fin: p.date_fin,
    partenariats: p.partenariats,
    ressources: p.ressources,
    valorisation: p.valorisation,
    referents: p.referents,
    parcours: p.parcours ?? {},
    phare: Boolean(p.phare),
    phare_propose: Boolean(p.phare_propose),
    statut: statut(p.date_debut, p.date_fin),
    verrouille: Boolean(p.verrouille_le),
    cree_par_nom: p.cree_par_nom,
    cree_le: p.cree_le,
    modifie_le: p.modifie_le,
    reconduit_de: o ? { id: p.reconduit_de, annee: o.annee, code: o.code } : null,
    ...(droits ?? {}),
  };
}

// ---------------------------------------------------------------------
// LA VITRINE PUBLIQUE (visiteurs non connectés : parents, réseau AEFE,
// collègues d'autres établissements). Décision du 18/11/2026 :
//  - l'année courante et l'année précédente seulement ;
//  - ni moyens ni budget (ressources), ni priorité, ni auteur, ni date de
//    saisie : ce sont des éléments de travail internes ;
//  - les noms des enseignants référents quand VITRINE_NOMS vaut « oui » dans
//    le projet Vercel. Activé le 18/11/2026 : les collègues ont donné leur
//    accord à la diffusion, l'outil sert aussi la communication du lycée.
//    Sans la variable, les noms ne sortent pas (repli prudent) ;
//  - jamais de nom d'élève : aucune colonne n'en porte. Les textes libres
//    (description, objectifs) restent sous la responsabilité de leur auteur.
// ---------------------------------------------------------------------

export const nomsPublics = () => String(process.env.VITRINE_NOMS ?? '').trim().toLowerCase() === 'oui';

/** Les années ouvertes au public : l'année courante et la précédente. */
export function anneesPubliques(courante) {
  const [a, b] = courante.split('-').map(Number);
  return [`${a - 1}-${b - 1}`, courante];
}

/** La forme publique d'une fiche, à partir de la forme versPage. */
export function versPublic(f) {
  const {
    ressources, priorite, cree_par_nom, cree_le, modifie_le, referents, phare_propose, ...reste
  } = f;
  return { ...reste, referents: nomsPublics() ? referents : null };
}

/** Les projets d'origine des reconductions présentes dans `projets`. */
export async function originesDe(projets) {
  const ids = [...new Set(projets.map((p) => p.reconduit_de).filter(Boolean))];
  if (!ids.length) return new Map();
  const l = await lire('projets', `id=in.(${ids.join(',')})&select=id,annee,code`);
  return new Map(l.map((x) => [x.id, x]));
}

// ---------------------------------------------------------------------
// LES RÉFÉRENTS
//
// Le champ « referents » est un texte libre (« DUPONT Marie, MARTIN »). Le
// droit de modifier une fiche, lui, passe par la table projet_referents.
// À chaque enregistrement, le serveur la recalcule à partir du texte, avec
// une règle plus stricte que l'ancienne (qui cherchait des sous-chaînes) :
//  - un rattachement EXISTANT est gardé tant que le nom de famille du
//    collègue figure encore dans le texte, en mots entiers ; c'est ce qui
//    conserve les rattachements confirmés à la main (« GEORGE » sans
//    prénom) ;
//  - un NOUVEAU rattachement exige le nom ET le premier prénom, en mots
//    entiers.
// ---------------------------------------------------------------------

const mots = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);

export async function synchroniserReferents(projetId, texte) {
  const presents = new Set(mots(texte));
  const actuels = new Set((await lire('projet_referents',
    `projet_id=eq.${projetId}&select=membre_id`)).map((x) => x.membre_id));
  const membres = await lireTout('membres', 'role=neq.eleve&select=id,nom,prenom&order=id');

  const voulus = new Set();
  for (const m of membres) {
    const nom = mots(m.nom);
    if (!nom.length || !nom.every((w) => presents.has(w))) continue;
    const prenom = mots(m.prenom);
    if (actuels.has(m.id) || !prenom.length || presents.has(prenom[0])) voulus.add(m.id);
  }

  const ajouts = [...voulus].filter((id) => !actuels.has(id));
  const retraits = [...actuels].filter((id) => !voulus.has(id));
  if (ajouts.length) {
    await ecrire('projet_referents', 'on_conflict=projet_id,membre_id',
      ajouts.map((membre_id) => ({ projet_id: projetId, membre_id })), 'POST',
      'resolution=ignore-duplicates');
  }
  if (retraits.length) {
    await ecrire('projet_referents',
      `projet_id=eq.${projetId}&membre_id=in.(${retraits.join(',')})`, undefined, 'DELETE');
  }
  return { ajouts: ajouts.length, retraits: retraits.length };
}
