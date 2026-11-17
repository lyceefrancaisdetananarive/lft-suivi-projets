import { appelant } from '../_lib/autorisation.js';
import { journaliser } from '../_lib/journal.js';
import { configuree, origineLegitime, refus } from '../_lib/supabase.js';

// Droit à l'effacement (RGPD, article 17) : la personne demande la
// suppression de son compte. La demande est inscrite au journal, que
// l'administrateur consulte ; c'est lui qui supprime, depuis la gestion des
// comptes. (L'ancienne plateforme envoyait un courriel par Gmail ; le
// nouveau serveur n'a pas de relais de courriel propre.)
export default async function handler(req, res) {
  if (req.method !== 'POST') return refus(res, 405, 'Méthode non autorisée.');
  if (!configuree()) return refus(res, 503, 'Service non configuré.');
  if (!origineLegitime(req)) return refus(res, 403, 'Origine non autorisée.');
  try {
    const m = await appelant(req);
    if (!m) return refus(res, 401, 'Connectez-vous pour faire cette demande.');
    await journaliser(req, m, 'request_deletion', 'Demande de suppression du compte');
    res.status(200).json({ ok: true, message: "Demande transmise à l'administrateur." });
  } catch (e) {
    console.error('demande-suppression :', e.message);
    refus(res, 500, "La demande n'a pas abouti. Réessayez plus tard.");
  }
}
