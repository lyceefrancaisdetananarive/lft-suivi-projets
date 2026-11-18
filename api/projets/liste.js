import { appelant, peutModifier, peutReconduire, peutCreer, referentDe } from '../_lib/autorisation.js';
import {
  CATEGORIES, CHAMPS_LUS, versPage, versPublic, anneesPubliques, originesDe,
} from '../_lib/projets.js';
import { anneeCourante, anneeValide, archivee } from '../_lib/annee.js';
import { lireTout, configuree, refus } from '../_lib/supabase.js';

// La liste des projets d'une année, hors corbeille. PUBLIQUE pour l'année
// courante et la précédente : un visiteur non connecté consulte la vitrine,
// sous la forme réduite de versPublic (voir _lib/projets.js). Elle ne porte
// aucune adresse ni aucun identifiant de compte. À une
// personne connectée, chaque fiche dit en plus si elle peut la modifier :
// la page n'a pas à recalculer les droits, et ne le pourrait pas.
export default async function handler(req, res) {
  if (req.method !== 'GET') return refus(res, 405, 'Méthode non autorisée.');
  if (!configuree()) return refus(res, 503, 'Service non configuré.');

  const annee = String(req.query?.annee ?? '') || anneeCourante();
  if (!anneeValide(annee)) return refus(res, 400, 'Année invalide.');

  try {
    const m = await appelant(req);
    if (!m && !anneesPubliques(anneeCourante()).includes(annee)) {
      return refus(res, 401, 'Connectez-vous pour consulter les années plus anciennes.');
    }
    const projets = await lireTout('projets',
      `annee=eq.${annee}&supprime_le=is.null&select=${CHAMPS_LUS}&order=code`);
    const refs = m ? await referentDe(m.id, projets.map((p) => p.id)) : new Set();
    const origines = await originesDe(projets);

    res.status(200).json({
      ok: true,
      annee,
      courante: anneeCourante(),
      archivee: archivee(annee),
      // Les catégories dans lesquelles cette personne peut créer une fiche
      // cette année : vide pour un visiteur, ou pour une année archivée.
      categories_autorisees: m
        ? Object.keys(CATEGORIES).filter((c) => peutCreer(m, annee, c)) : [],
      projets: projets.map((p) => {
        const f = versPage(p, {
          origines,
          droits: m ? { peut_modifier: peutModifier(m, p, refs.has(p.id)), peut_reconduire: peutReconduire(m, p, refs.has(p.id)) } : null,
        });
        return m ? f : versPublic(f);
      }),
    });
  } catch (e) {
    console.error('projets/liste :', e.message);
    refus(res, 500, 'La liste des projets est momentanément indisponible.');
  }
}
