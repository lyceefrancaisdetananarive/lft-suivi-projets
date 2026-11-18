// =====================================================================
// Qui appelle, et qu'a-t-il le droit de faire. En un seul endroit : c'est
// exactement le genre de contrôle qu'on oublie de recopier dans le
// troisième fichier.
//
// LES DROITS (décision du 18/11/2026 : la direction a les mêmes accès que
// l'administrateur de l'application) :
//  - admin        : l'administrateur de l'application. Tout : projets,
//                   années archivées, comptes, journal complet ;
//  - direction    : les mêmes accès, à une réserve près : elle ne touche
//                   pas au compte de l'administrateur (sinon une erreur de
//                   manipulation suffirait à fermer l'application) ;
//  - vie_scolaire : projets des catégories CLUB et INT ;
//  - enseignant   : ses projets, et ceux dont il est référent ;
//  - eleve        : rien pour l'instant (suivi de parcours, plus tard).
// Une année antérieure à l'année courante est en lecture seule, sauf pour
// l'administrateur et la direction.
//
// DEUX RÈGLES DURCIES par rapport à l'ancienne plateforme :
//  - un projet verrouillé ne peut plus être mis à la corbeille que par
//    l'admin ou la direction (avant : par son auteur, verrou ou pas) ;
//  - la vie scolaire ne peut pas faire sortir un projet de ses catégories
//    en changeant sa catégorie.
// =====================================================================

import { ouvrir, lireCookie, sceller, poserCookie, DUREE } from './session.js';
import { lire, ecrire, adminsAutorises } from './supabase.js';
import { archivee } from './annee.js';

const CHAMPS_MEMBRE = 'id,email,role,actif,mdp_provisoire,mdp_pose_le,prenom,nom';
// Marge entre l'heure du mot de passe (millisecondes) et celle de la session
// (secondes arrondies) : la session posée juste après le changement reste valable.
const MARGE_MS = 1500;

/**
 * Qui appelle ? Le compte est RELU EN BASE à chaque appel, jamais pris au
 * mot du cookie : un compte désactivé perd la main à sa requête suivante.
 * null si la session est absente ou expirée, le compte inactif, le mot de
 * passe jamais choisi, ou le rôle plus tenable.
 */
export async function appelant(req) {
  const session = await ouvrir(lireCookie(req.headers.cookie), process.env.SUIVI_COOKIE_SECRET);
  if (!session) return null;
  const m = (await lire('membres', `id=eq.${session.sub}&select=${CHAMPS_MEMBRE}`))[0];
  if (!m || !m.actif || m.mdp_provisoire) return null;
  if (!roleTenable(m)) return null;
  // Un mot de passe changé ferme les sessions ouvertes avant le changement,
  // sur tous les appareils (audit du 18/11/2026) : sans cela, un cookie volé
  // restait valable jusqu'à huit heures malgré le nouveau mot de passe.
  if (m.mdp_pose_le && session.dep * 1000 < Date.parse(m.mdp_pose_le) - MARGE_MS) return null;
  return m;
}

/** Le rôle admin n'est tenable que si l'adresse figure dans ADMINS_SUIVI. */
export function roleTenable(m) {
  if (m.role !== 'admin') return true;
  return adminsAutorises().includes(String(m.email ?? '').toLowerCase());
}

/** L'administrateur de l'application, seul : la garde de son propre compte. */
export const estAdmin = (m) => m?.role === 'admin';
/** Administrateur OU direction : tous les gestes de pilotage, comptes et journal compris. */
export const estDirection = (m) => m?.role === 'admin' || m?.role === 'direction';
export const CATS_VIE_SCOLAIRE = ['CLUB', 'INT'];

export function nomAffiche(m) {
  return [m?.prenom, m?.nom].filter(Boolean).join(' ') || String(m?.email ?? '').split('@')[0];
}

/** Peut-il écrire dans cette année ? */
export function peutEcrireAnnee(m, annee) {
  if (!m || m.role === 'eleve') return false;
  return !archivee(annee) || estDirection(m);
}

/** Peut-il créer un projet de cette catégorie dans cette année ? */
export function peutCreer(m, annee, categorie) {
  if (!peutEcrireAnnee(m, annee)) return false;
  if (m.role === 'vie_scolaire') return CATS_VIE_SCOLAIRE.includes(categorie);
  return true;
}

/**
 * Peut-il modifier (ou mettre à la corbeille) ce projet ? `estReferent` :
 * l'appelant figure dans projet_referents pour ce projet.
 */
export function peutModifier(m, p, estReferent) {
  if (!m || !p || p.supprime_le) return false;
  if (!peutEcrireAnnee(m, p.annee)) return false;
  if (estDirection(m)) return true;
  if (p.verrouille_le) return false;
  if (m.role === 'vie_scolaire') return CATS_VIE_SCOLAIRE.includes(p.categorie);
  if (m.role === 'enseignant') return p.cree_par === m.id || Boolean(estReferent);
  return false;
}

/**
 * Peut-il reconduire ce projet vers une autre année ? Direction et
 * administrateur : tout ; vie scolaire : ses catégories ; enseignant : ses
 * projets et ceux dont il est référent (audit du 18/11/2026 : avant, toute
 * personne connectée pouvait copier n'importe quelle fiche à son nom, la
 * publier sur la vitrine et empêcher son auteur de la reconduire).
 */
export function peutReconduire(m, p, estReferent) {
  if (!m || !p || p.supprime_le || m.role === 'eleve') return false;
  if (estDirection(m)) return true;
  if (m.role === 'vie_scolaire') return CATS_VIE_SCOLAIRE.includes(p.categorie);
  if (m.role === 'enseignant') return p.cree_par === m.id || Boolean(estReferent);
  return false;
}

/** Les projets (parmi `ids`) dont ce membre est référent. */
export async function referentDe(membreId, ids) {
  if (!membreId || !ids.length) return new Set();
  const l = await lire('projet_referents',
    `membre_id=eq.${membreId}&projet_id=in.(${ids.join(',')})&select=projet_id`);
  return new Set(l.map((x) => x.projet_id));
}

/**
 * Réarme la session après une écriture enregistrée. `dep` est RECOPIÉ : le
 * plafond absolu se compte depuis la connexion initiale, sinon une session
 * entretenue ne mourrait jamais.
 */
export async function reArmer(req, res, m) {
  const s = await ouvrir(lireCookie(req.headers.cookie), process.env.SUIVI_COOKIE_SECRET);
  if (!s) return;
  const jeton = await sceller({ sub: m.id, role: m.role, prov: false, dep: s.dep },
    process.env.SUIVI_COOKIE_SECRET, DUREE);
  res.setHeader('Set-Cookie', poserCookie(jeton, m.role, DUREE));
}

// ---------------------------------------------------------------------
// Ressaisie du mot de passe avant un geste lourd (changer son mot de passe,
// supprimer un compte, changer un rôle). Compteur à part de celui des
// connexions : un inconnu ne doit pas pouvoir bloquer ces gestes en se
// trompant dix fois sur l'adresse de l'administrateur.
// ---------------------------------------------------------------------
export const MAX_RESSAISIES = 8;
export const FENETRE_MINUTES = 15;

export async function ressaisieAutorisee(membreId) {
  const depuis = new Date(Date.now() - FENETRE_MINUTES * 60000).toISOString();
  const echecs = await lire('tentatives',
    `membre_id=eq.${membreId}&origine=eq.ressaisie&quand=gte.${depuis}&select=id&limit=${MAX_RESSAISIES}`)
    .catch(() => null);      // compteur illisible : on refuse, position fermée
  return echecs !== null && echecs.length < MAX_RESSAISIES;
}

export async function noterEchecRessaisie(membreId) {
  await ecrire('tentatives', '', { membre_id: membreId, origine: 'ressaisie' }, 'POST').catch(() => {});
}
