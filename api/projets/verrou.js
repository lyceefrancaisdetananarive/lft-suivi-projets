import { appelant, reArmer, estDirection } from '../_lib/autorisation.js';
import { archivee } from '../_lib/annee.js';
import { journaliser } from '../_lib/journal.js';
import {
  lire, ecrire, configuree, origineLegitime, refus, corps, UUID,
} from '../_lib/supabase.js';

// Les gestes de la direction et de l'administrateur sur une fiche :
// POST { id, verrouiller: true | false }  verrouiller ou déverrouiller ; un
//                                         projet verrouillé ne se modifie plus
//                                         que par elles ;
// POST { id, phare: true | false }        projet phare, trois au plus par année.
const PHARES_MAX = 3;
export default async function handler(req, res) {
  if (req.method !== 'POST') return refus(res, 405, 'Méthode non autorisée.');
  if (!configuree()) return refus(res, 503, 'Service non configuré.');
  if (!origineLegitime(req)) return refus(res, 403, 'Origine non autorisée.');
  try {
    const m = await appelant(req);
    if (!m) return refus(res, 401, 'Session expirée : reconnectez-vous.');
    if (!estDirection(m)) return refus(res, 403, 'Réservé à la direction et à l’administration.');

    const b = corps(req);
    const id = String(b.id ?? '');
    if (!UUID.test(id)) return refus(res, 400, 'Identifiant invalide.');
    const verrouiller = b.verrouiller === true;
    const p = (await lire('projets', `id=eq.${id}&select=id,annee,code,nom,supprime_le,verrouille_le,phare`))[0];
    if (!p || p.supprime_le) return refus(res, 404, 'Projet introuvable.');
    if (archivee(p.annee) && !estDirection(m)) {
      return refus(res, 403, "Cette année est archivée (lecture seule).");
    }
    if ('phare' in b) {
      const phare = b.phare === true;
      if (Boolean(p.phare) === phare) return res.status(200).json({ ok: true, inchange: true });
      if (phare) {
        const deja = await lire('projets',
          `annee=eq.${p.annee}&phare=is.true&supprime_le=is.null&select=id`);
        if (deja.length >= PHARES_MAX) {
          return refus(res, 409, `Déjà ${PHARES_MAX} projets phares cette année : retirez-en un d'abord.`);
        }
      }
      await ecrire('projets', `id=eq.${id}`, { phare });
      await journaliser(req, m, phare ? 'feature_project' : 'unfeature_project',
        `${phare ? 'Projet phare' : 'Retiré des projets phares'}: ${p.code} - ${p.nom}`);
      await reArmer(req, res, m);
      return res.status(200).json({ ok: true, message: phare ? 'Projet mis en avant.' : 'Projet retiré des projets phares.' });
    }
    if (Boolean(p.verrouille_le) === verrouiller) {
      return res.status(200).json({ ok: true, inchange: true });
    }
    await ecrire('projets', `id=eq.${id}`, verrouiller
      ? { verrouille_le: new Date().toISOString(), verrouille_par: m.id }
      : { verrouille_le: null, verrouille_par: null });
    await journaliser(req, m, verrouiller ? 'lock_project' : 'unlock_project',
      `${verrouiller ? 'Verrouillé' : 'Déverrouillé'}: ${p.code} - ${p.nom}`);
    await reArmer(req, res, m);
    res.status(200).json({ ok: true, message: verrouiller ? 'Projet verrouillé.' : 'Projet déverrouillé.' });
  } catch (e) {
    console.error('projets/verrou :', e.message);
    refus(res, 500, "L'opération n'a pas abouti. Réessayez dans un instant.");
  }
}
