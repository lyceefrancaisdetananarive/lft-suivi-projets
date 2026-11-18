import { appelant, reArmer } from '../_lib/autorisation.js';
import {
  peutLireEleves, peutReperer, peutAccompagner, voitAccompagnements, elevesDesClasses, elevesDuProjet, classesDuTexte,
  MANDATS, ACCOMPAGNEMENTS,
} from '../_lib/eleves.js';
import { anneeCourante, anneeValide } from '../_lib/annee.js';
import { journaliser } from '../_lib/journal.js';
import {
  lire, ecrire, configuree, origineLegitime, refus, corps, UUID,
} from '../_lib/supabase.js';

// Les élèves, pour les personnels connectés SEULEMENT (voir _lib/eleves.js).
//   GET   ?classes=3M2,3M4[&annee=]   les élèves de ces classes
//   GET   ?projet=<id>                les élèves retenus pour un projet
//   PATCH { id, mandats?, accompagnements? }
//         mandats : vie scolaire, direction, administrateur ;
//         accompagnements (PAP, PPRE, PAI) : direction, administrateur.
// Les accompagnements ne sont renvoyés qu'aux enseignants, à la direction et
// à l'administrateur.
// Jamais d'adresse : la table n'en porte pas.

export default async function handler(req, res) {
  if (!configuree()) return refus(res, 503, 'Service non configuré.');
  try {
    if (req.method === 'GET') {
      const m = await appelant(req);
      if (!m) return refus(res, 401, 'Connectez-vous pour consulter les élèves.');
      if (!peutLireEleves(m)) return refus(res, 403, 'Liste réservée aux personnels.');
      const projet = String(req.query?.projet ?? '');
      if (projet) {
        if (!UUID.test(projet)) return refus(res, 400, 'Identifiant invalide.');
        const p = (await lire('projets', `id=eq.${projet}&select=id,supprime_le`))[0];
        if (!p || p.supprime_le) return refus(res, 404, 'Projet introuvable.');
        return res.status(200).json({ ok: true, eleves: await elevesDuProjet(projet, m) });
      }
      const annee = String(req.query?.annee ?? '') || anneeCourante();
      if (!anneeValide(annee)) return refus(res, 400, 'Année invalide.');
      const classes = [...new Set(classesDuTexte(req.query?.classes))].slice(0, 80);
      return res.status(200).json({
        ok: true, annee, eleves: await elevesDesClasses(annee, classes, m),
      });
    }

    if (req.method !== 'PATCH') return refus(res, 405, 'Méthode non autorisée.');
    if (!origineLegitime(req)) return refus(res, 403, 'Origine non autorisée.');
    const m = await appelant(req);
    if (!m) return refus(res, 401, 'Session expirée : reconnectez-vous.');
    if (!peutReperer(m)) return refus(res, 403, 'Repères réservés à la vie scolaire et à la direction.');
    const b = corps(req);
    if ('accompagnements' in b && !peutAccompagner(m)) {
      return refus(res, 403, 'Les accompagnements (PAP, PPRE, PAI) sont saisis par la direction.');
    }
    const id = String(b.id ?? '');
    if (!UUID.test(id)) return refus(res, 400, 'Identifiant invalide.');
    const v = {};
    if ('mandats' in b) {
      if (!Array.isArray(b.mandats) || b.mandats.some((x) => !MANDATS.includes(x))) {
        return refus(res, 400, 'Mandat inconnu.');
      }
      v.mandats = MANDATS.filter((x) => b.mandats.includes(x));
    }
    if ('accompagnements' in b) {
      if (!Array.isArray(b.accompagnements) || b.accompagnements.some((x) => !ACCOMPAGNEMENTS.includes(x))) {
        return refus(res, 400, 'Accompagnement inconnu.');
      }
      v.accompagnements = ACCOMPAGNEMENTS.filter((x) => b.accompagnements.includes(x));
    }
    if (!Object.keys(v).length) return refus(res, 400, 'Rien à modifier.');
    const [e] = await ecrire('eleves', `id=eq.${id}&select=id,classe,mandats,accompagnements`,
      { ...v, maj_le: new Date().toISOString() });
    if (!e) return refus(res, 404, 'Élève introuvable.');
    // Le journal ne porte pas le nom : la classe suffit à retrouver le geste.
    await journaliser(req, m, 'update_student', `Repères d'un élève de ${e.classe}`);
    await reArmer(req, res, m);
    return res.status(200).json({ ok: true, eleve: {
      id: e.id, mandats: e.mandats, ...(voitAccompagnements(m) ? { accompagnements: e.accompagnements } : {}),
    } });
  } catch (e) {
    console.error('projets/eleves :', e.message);
    refus(res, 500, 'La liste des élèves est momentanément indisponible.');
  }
}
