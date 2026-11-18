import { anneeCourante } from '../_lib/annee.js';
import { appelant } from '../_lib/autorisation.js';
import { anneesPubliques } from '../_lib/projets.js';
import { lireTout, configuree, refus } from '../_lib/supabase.js';

// Les années qui ont des projets, plus l'année courante même vide. Un
// visiteur non connecté ne voit que l'année courante et la précédente.
export default async function handler(req, res) {
  if (req.method !== 'GET') return refus(res, 405, 'Méthode non autorisée.');
  if (!configuree()) return refus(res, 503, 'Service non configuré.');
  try {
    const lignes = await lireTout('projets', 'select=annee&order=id');
    const courante = anneeCourante();
    let annees = [...new Set([...lignes.map((l) => l.annee), courante])].sort();
    if (!(await appelant(req))) {
      const pub = anneesPubliques(courante);
      annees = annees.filter((a) => pub.includes(a));
    }
    res.status(200).json({ ok: true, annees, courante });
  } catch (e) {
    console.error('projets/annees :', e.message);
    refus(res, 500, 'La liste des années est momentanément indisponible.');
  }
}
