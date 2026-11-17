import { anneeCourante } from '../_lib/annee.js';
import { lireTout, configuree, refus } from '../_lib/supabase.js';

// Les années qui ont des projets, plus l'année courante même vide. Publique.
export default async function handler(req, res) {
  if (req.method !== 'GET') return refus(res, 405, 'Méthode non autorisée.');
  if (!configuree()) return refus(res, 503, 'Service non configuré.');
  try {
    const lignes = await lireTout('projets', 'select=annee&order=id');
    const courante = anneeCourante();
    const annees = [...new Set([...lignes.map((l) => l.annee), courante])].sort();
    res.status(200).json({ ok: true, annees, courante });
  } catch (e) {
    console.error('projets/annees :', e.message);
    refus(res, 500, 'La liste des années est momentanément indisponible.');
  }
}
