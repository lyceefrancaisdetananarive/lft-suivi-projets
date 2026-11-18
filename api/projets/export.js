import { appelant, estDirection } from '../_lib/autorisation.js';
import { CATEGORIES, CHAMPS_LUS, originesDe } from '../_lib/projets.js';
import { anneeCourante, anneeValide, statut } from '../_lib/annee.js';
import { journaliser } from '../_lib/journal.js';
import { lireTout, configuree, refus } from '../_lib/supabase.js';

// Export CSV des projets d'une année (hors corbeille), pour la direction et
// l'administration. Séparateur point-virgule et marque d'ordre des octets :
// le fichier s'ouvre tel quel dans Excel en français.
//
// INJECTION DE FORMULE : une cellule qui commence par = + - @ serait
// exécutée comme une formule à l'ouverture dans un tableur. On la préfixe
// d'une apostrophe, comme le faisait l'ancienne plateforme pour la feuille.

const STATUTS = { planifie: 'Planifié', en_cours: 'En cours', termine: 'Terminé' };
const PRIORITES = { haute: 'Haute', moyenne: 'Moyenne', basse: 'Basse' };

function cellule(v) {
  let t = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return /[;"\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

const PARCOURS_L = { S: 'Santé', C: 'Citoyen', A: 'Avenir', E: 'Arts et culture' };
const AXES_L = {
  S: ['Éducation à la santé', 'Prévention', 'Protection de la santé'],
  C: ['Valeurs et EMC', 'Engagement', 'Éducation aux médias'],
  A: ['Monde économique et professionnel', "Esprit d'initiative", 'Orientation'],
  E: ['Rencontres', 'Pratiques', 'Connaissances'],
};

export default async function handler(req, res) {
  if (req.method !== 'GET') return refus(res, 405, 'Méthode non autorisée.');
  if (!configuree()) return refus(res, 503, 'Service non configuré.');
  try {
    const m = await appelant(req);
    if (!m) return refus(res, 401, 'Session expirée : reconnectez-vous.');
    if (!estDirection(m)) return refus(res, 403, 'Réservé à la direction et à l’administration.');
    const annee = String(req.query?.annee ?? '') || anneeCourante();
    if (!anneeValide(annee)) return refus(res, 400, 'Année invalide.');

    const projets = await lireTout('projets',
      `annee=eq.${annee}&supprime_le=is.null&select=${CHAMPS_LUS}&order=code`);
    const origines = await originesDe(projets);
    const colonnes = [
      ['Code', (p) => p.code],
      ['Nom', (p) => p.nom],
      ['Catégorie', (p) => CATEGORIES[p.categorie]],
      ['Échelle', (p) => p.echelle],
      ['Axe', (p) => (p.axe ? `Axe ${p.axe}` : '')],
      ['Sous-axe', (p) => p.sous_axe],
      ['Disciplines', (p) => p.disciplines],
      ['Niveaux', (p) => p.niveaux],
      ['Classes', (p) => p.classes],
      ['Description', (p) => p.description],
      ['Objectifs pédagogiques', (p) => p.objectifs],
      ['Statut', (p) => STATUTS[statut(p.date_debut, p.date_fin)]],
      ['Projet phare', (p) => (p.phare ? 'Oui' : '')],
      ['Parcours', (p) => Object.entries(p.parcours ?? {}).map(([k, a]) => `${PARCOURS_L[k] ?? k} (${a.map((i) => AXES_L[k]?.[i] ?? i).join(', ')})`).join(' ; ')],
      ['Début', (p) => p.date_debut],
      ['Fin', (p) => p.date_fin],
      ['Partenariats', (p) => p.partenariats],
      ['Ressources', (p) => p.ressources],
      ['Valorisation', (p) => p.valorisation],
      ['Référents', (p) => p.referents],
      ['Créé par', (p) => p.cree_par_nom],
      ['Verrouillé', (p) => (p.verrouille_le ? 'Oui' : 'Non')],
      ['Reconduit de', (p) => {
        const o = p.reconduit_de && origines.get(p.reconduit_de);
        return o ? `${o.annee}/${o.code}` : '';
      }],
    ];
    const lignes = [colonnes.map(([t]) => t).join(';'),
      ...projets.map((p) => colonnes.map(([, f]) => cellule(f(p))).join(';'))];

    await journaliser(req, m, 'export', `Export CSV ${annee} (${projets.length} projets)`);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="projets-${annee}.csv"`);
    res.status(200).send(`﻿${lignes.join('\r\n')}\r\n`);
  } catch (e) {
    console.error('projets/export :', e.message);
    refus(res, 500, "L'export n'a pas abouti. Réessayez dans un instant.");
  }
}
