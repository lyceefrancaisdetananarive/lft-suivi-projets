// =====================================================================
// Les élèves concernés par un projet (décision du 18/11/2026 : direction,
// AIPD réalisée, avis du DPD obtenu ; voir db/06-eleves.sql).
//
//  - Les noms ne sortent QUE vers les personnels connectés (enseignant, vie
//    scolaire, direction, administrateur). Jamais vers la vitrine, jamais
//    vers un compte élève : rien ici n'est appelé par versPublic.
//  - Le repère PAP (plan d'accompagnement personnalisé) suit la même règle.
//    Aucune autre information de santé ou de handicap n'est tenue (ni PPS,
//    ni PAI) : le minimum utile à l'équipe qui monte le projet.
//  - Les mandats et le repère PAP sont posés par la vie scolaire, la
//    direction ou l'administrateur.
//  - Sans élève retenu, toute la classe est concernée.
// =====================================================================

import { lire, lireTout, ecrire, UUID } from './supabase.js';

export const MANDATS = ['delegue_titulaire', 'delegue_suppleant', 'eco_delegue', 'cvc', 'cvl'];
export const CHAMPS_ELEVE = 'id,classe,nom,prenom,mandats,pap';
const LECTEURS = ['enseignant', 'vie_scolaire', 'direction', 'admin'];
const REPEREURS = ['vie_scolaire', 'direction', 'admin'];
export const MAX_ELEVES = 1500;

export const peutLireEleves = (m) => LECTEURS.includes(m?.role);
export const peutReperer = (m) => REPEREURS.includes(m?.role);

const versPage = (e) => ({
  id: e.id, classe: e.classe, nom: e.nom, prenom: e.prenom, mandats: e.mandats ?? [], pap: Boolean(e.pap),
});
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
export async function elevesDesClasses(annee, classes) {
  if (!classes.length) return [];
  const l = await lireTout('eleves',
    `annee=eq.${annee}&classe=in.(${classes.join(',')})&select=${CHAMPS_ELEVE}&order=id`);
  return l.map(versPage).sort(ordre);
}

/** Les élèves retenus pour un projet (vide : toute la classe). */
export async function elevesDuProjet(projetId) {
  const l = await lireTout('projet_eleves', `projet_id=eq.${projetId}&select=eleves(${CHAMPS_ELEVE})&order=eleve_id`);
  return l.map((x) => x.eleves).filter(Boolean).map(versPage).sort(ordre);
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
