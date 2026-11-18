import { appelant, reArmer } from '../_lib/autorisation.js';
import {
  peutLireEleves, peutReperer, elevesDesClasses, elevesDuProjet, classesDuTexte, MANDATS,
} from '../_lib/eleves.js';
import { anneeCourante, anneeValide } from '../_lib/annee.js';
import { journaliser } from '../_lib/journal.js';
import {
  lire, ecrire, configuree, origineLegitime, refus, corps, UUID,
} from '../_lib/supabase.js';

// Les élèves, pour les personnels connectés SEULEMENT (voir _lib/eleves.js).
//   GET   ?classes=3M2,3M4[&annee=]   les élèves de ces classes
//   GET   ?projet=<id>                les élèves retenus pour un projet
//   PATCH { id, mandats?, pap? }      repères d'un élève (vie scolaire,
//                                     direction, administrateur)
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
        return res.status(200).json({ ok: true, eleves: await elevesDuProjet(projet), reperer: peutReperer(m) });
      }
      const annee = String(req.query?.annee ?? '') || anneeCourante();
      if (!anneeValide(annee)) return refus(res, 400, 'Année invalide.');
      const classes = [...new Set(classesDuTexte(req.query?.classes))].slice(0, 80);
      return res.status(200).json({
        ok: true, annee, eleves: await elevesDesClasses(annee, classes), reperer: peutReperer(m),
      });
    }

    if (req.method !== 'PATCH') return refus(res, 405, 'Méthode non autorisée.');
    if (!origineLegitime(req)) return refus(res, 403, 'Origine non autorisée.');
    const m = await appelant(req);
    if (!m) return refus(res, 401, 'Session expirée : reconnectez-vous.');
    if (!peutReperer(m)) return refus(res, 403, 'Repères réservés à la vie scolaire et à la direction.');
    const b = corps(req);
    const id = String(b.id ?? '');
    if (!UUID.test(id)) return refus(res, 400, 'Identifiant invalide.');
    const v = {};
    if ('mandats' in b) {
      if (!Array.isArray(b.mandats) || b.mandats.some((x) => !MANDATS.includes(x))) {
        return refus(res, 400, 'Mandat inconnu.');
      }
      v.mandats = MANDATS.filter((x) => b.mandats.includes(x));
    }
    if ('pap' in b) v.pap = b.pap === true;
    if (!Object.keys(v).length) return refus(res, 400, 'Rien à modifier.');
    const [e] = await ecrire('eleves', `id=eq.${id}&select=id,classe,mandats,pap`,
      { ...v, maj_le: new Date().toISOString() });
    if (!e) return refus(res, 404, 'Élève introuvable.');
    // Le journal ne porte pas le nom : la classe suffit à retrouver le geste.
    await journaliser(req, m, 'update_student', `Repères d'un élève de ${e.classe}`);
    await reArmer(req, res, m);
    return res.status(200).json({ ok: true, eleve: { id: e.id, mandats: e.mandats, pap: e.pap } });
  } catch (e) {
    console.error('projets/eleves :', e.message);
    refus(res, 500, 'La liste des élèves est momentanément indisponible.');
  }
}
