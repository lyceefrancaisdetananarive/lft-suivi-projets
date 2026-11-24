// =====================================================================
// Les élèves concernés par un projet (décision de la direction du
// 18/11/2026 ; voir db/06-eleves.sql). Règle d'accès corrigée le 24/11/2026
// (audit du 20/11/2026 : tout enseignant lisait les PAP, PPRE et PAI de
// toutes les classes, sans trace).
//
//  - Les noms et les mandats ne sortent QUE vers les personnels connectés
//    (enseignant, vie scolaire, direction, administrateur). Jamais vers la
//    vitrine, jamais vers un compte élève : rien ici n'est appelé par
//    versPublic.
//  - Les accompagnements (PAP, PPRE, PAI, comme dans Pronote ; db/07) sont
//    plus restreints : la direction et l'administrateur les voient pour toute
//    classe ; un enseignant ne les voit QUE pour les élèves d'un projet dont
//    il est l'auteur ou le référent (appel « ?projet= »), jamais par une
//    liste de classes. La vie scolaire ne les reçoit pas. Quand l'espace
//    élève ouvrira, un élève ne verra que les siens.
//  - Chaque lecture qui renvoie des accompagnements est inscrite au journal
//    (action read_support : projet ou classes, nombre d'élèves, jamais de
//    nom).
//  - Les mandats sont posés par la vie scolaire, la direction ou
//    l'administrateur ; les accompagnements par la direction ou
//    l'administrateur.
//  - Sans élève retenu, toute la classe est concernée.
// =====================================================================

import { lire, lireTout, ecrire, UUID } from './supabase.js';

export const MANDATS = ['delegue_titulaire', 'delegue_suppleant', 'eco_delegue', 'cvc', 'cvl'];
export const ACCOMPAGNEMENTS = ['PAP', 'PPRE', 'PAI'];
const CHAMPS_BASE = 'id,classe,nom,prenom,mandats';
/** Les colonnes lues : les accompagnements ne quittent la base que pour qui peut les voir. */
export const champsEleve = (avec) => (avec ? `${CHAMPS_BASE},accompagnements` : CHAMPS_BASE);
const LECTEURS = ['enseignant', 'vie_scolaire', 'direction', 'admin'];
const REPEREURS = ['vie_scolaire', 'direction', 'admin'];
const ACCOMPAGNATEURS = ['direction', 'admin'];
export const MAX_ELEVES = 1500;
/** Classes au plus par demande de liste (la page découpe ses demandes). */
export const MAX_CLASSES = 10;

export const peutLireEleves = (m) => LECTEURS.includes(m?.role);
export const peutReperer = (m) => REPEREURS.includes(m?.role);
export const peutAccompagner = (m) => ACCOMPAGNATEURS.includes(m?.role);

/** Direction et administrateur : les accompagnements de toute classe. */
export const voitTousAccompagnements = (m) => ACCOMPAGNATEURS.includes(m?.role);

/**
 * Les accompagnements des élèves d'UN projet : ceux qui les voient tous, et
 * l'enseignant auteur du projet ou inscrit parmi ses référents.
 * `projet` : { cree_par } ; `estReferent` : l'appelant figure dans projet_referents.
 */
export const voitAccompagnementsDuProjet = (m, projet, estReferent) =>
  voitTousAccompagnements(m)
  || (m?.role === 'enseignant' && Boolean(projet)
    && (projet.cree_par === m.id || Boolean(estReferent)));

/** La forme envoyée à la page : les accompagnements n'y sont que si `avec`. */
const versPage = (e, avec) => ({
  id: e.id, classe: e.classe, nom: e.nom, prenom: e.prenom, mandats: e.mandats ?? [],
  ...(avec ? { accompagnements: e.accompagnements ?? [] } : {}),
});

/** Combien d'élèves de cette liste portent au moins un accompagnement. */
export const nbAvecAccompagnement = (l) => l.filter((e) => (e.accompagnements ?? []).length).length;
const ordre = (a, b) => a.classe.localeCompare(b.classe) || a.nom.localeCompare(b.nom, 'fr')
  || a.prenom.localeCompare(b.prenom, 'fr');

/** Liste d'identifiants nettoyée, ou null si la forme est fausse. */
export function idsEleves(x) {
  if (x == null) return [];
  if (!Array.isArray(x) || x.length > MAX_ELEVES) return null;
  const ids = [...new Set(x.map(String))];
  return ids.every((i) => UUID.test(i)) ? ids : null;
}

/** Les noms de classes d'un champ « classes » (« 3M2, 3M4, club radio »). */
export const classesDuTexte = (t) => String(t ?? '').split(/\s*[,;]\s*/)
  .map((s) => s.trim().toUpperCase()).filter((s) => /^[0-9A-Z]{2,12}$/.test(s));

/** Les élèves d'une liste de classes, pour une année. */
export async function elevesDesClasses(annee, classes, avec) {
  if (!classes.length) return [];
  const l = await lireTout('eleves',
    `annee=eq.${annee}&classe=in.(${classes.join(',')})&select=${champsEleve(avec)}&order=id`);
  return l.map((e) => versPage(e, avec)).sort(ordre);
}

/** Les élèves retenus pour un projet (vide : toute la classe). */
export async function elevesDuProjet(projetId, avec) {
  const l = await lireTout('projet_eleves', `projet_id=eq.${projetId}&select=eleves(${champsEleve(avec)})&order=eleve_id`);
  return l.map((x) => x.eleves).filter(Boolean).map((e) => versPage(e, avec)).sort(ordre);
}

/**
 * Remplace les élèves retenus d'un projet. Seuls comptent les élèves de la
 * même année et d'une classe portée par la fiche : retirer une classe retire
 * ses élèves. Renvoie le nombre d'ajouts et de retraits.
 */
export async function enregistrerEleves(projet, ids) {
  const classes = classesDuTexte(projet.classes);
  let valides = [];
  if (ids.length && classes.length) {
    for (let i = 0; i < ids.length; i += 150) {
      const lot = await lire('eleves',
        `id=in.(${ids.slice(i, i + 150).join(',')})&annee=eq.${projet.annee}&classe=in.(${classes.join(',')})&select=id`);
      valides.push(...lot.map((e) => e.id));
    }
  }
  valides = new Set(valides);
  const actuels = new Set((await lireTout('projet_eleves',
    `projet_id=eq.${projet.id}&select=eleve_id&order=eleve_id`)).map((x) => x.eleve_id));
  const ajouts = [...valides].filter((id) => !actuels.has(id));
  const retraits = [...actuels].filter((id) => !valides.has(id));
  if (ajouts.length) {
    await ecrire('projet_eleves', 'on_conflict=projet_id,eleve_id',
      ajouts.map((eleve_id) => ({ projet_id: projet.id, eleve_id })), 'POST', 'resolution=ignore-duplicates');
  }
  for (let i = 0; i < retraits.length; i += 150) {
    await ecrire('projet_eleves',
      `projet_id=eq.${projet.id}&eleve_id=in.(${retraits.slice(i, i + 150).join(',')})`, undefined, 'DELETE');
  }
  return { ajouts: ajouts.length, retraits: retraits.length };
}

/** Les identifiants retenus aujourd'hui (pour recalculer après un changement de classes). */
export async function idsDuProjet(projetId) {
  return (await lireTout('projet_eleves', `projet_id=eq.${projetId}&select=eleve_id&order=eleve_id`))
    .map((x) => x.eleve_id);
}
