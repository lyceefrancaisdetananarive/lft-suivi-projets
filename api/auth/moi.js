import { appelant, estAdmin, estDirection } from '../_lib/autorisation.js';
import { configuree } from '../_lib/supabase.js';
import { anneeCourante } from '../_lib/annee.js';

// Qui suis-je ? Relu EN BASE à chaque appel : un compte désactivé en cours
// de journée perd la main ici, sans attendre l'expiration du cookie.
export default async function handler(req, res) {
  if (!configuree()) return res.status(503).json({ connecte: false });
  try {
    const m = await appelant(req);
    if (!m) return res.status(200).json({ connecte: false, annee_courante: anneeCourante() });
    res.status(200).json({
      connecte: true,
      email: m.email,
      prenom: m.prenom,
      nom: m.nom,
      role: m.role,
      admin: estAdmin(m),
      direction: estDirection(m),
      annee_courante: anneeCourante(),
    });
  } catch {
    res.status(200).json({ connecte: false });
  }
}
