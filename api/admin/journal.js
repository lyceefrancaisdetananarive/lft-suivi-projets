import { appelant, estAdmin } from '../_lib/autorisation.js';
import { lire, configuree, refus } from '../_lib/supabase.js';

// Le journal, du plus récent au plus ancien, par l'administrateur seul.
// GET ?limite=500 (2 000 au plus)
export default async function handler(req, res) {
  if (req.method !== 'GET') return refus(res, 405, 'Méthode non autorisée.');
  if (!configuree()) return refus(res, 503, 'Service non configuré.');
  try {
    const m = await appelant(req);
    if (!m) return refus(res, 401, 'Session expirée : reconnectez-vous.');
    if (!estAdmin(m)) return refus(res, 403, "Réservé à l'administrateur.");
    const limite = Math.min(2000, Math.max(1, Number.parseInt(req.query?.limite, 10) || 500));
    const lignes = await lire('journal',
      'select=quand,email,role,action,detail,pays,ville,os,navigateur,appareil'
      + `&order=quand.desc,id.desc&limit=${limite}`);
    res.status(200).json({ ok: true, journal: lignes });
  } catch (e) {
    console.error('admin/journal :', e.message);
    refus(res, 500, 'Le journal est momentanément indisponible.');
  }
}
