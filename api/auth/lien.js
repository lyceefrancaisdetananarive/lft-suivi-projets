import { envoyerLienSiPossible } from '../_lib/lien.js';
import { configuree, origineLegitime, refus, corps } from '../_lib/supabase.js';

// « Première connexion » et « Mot de passe oublié » : un seul parcours.
// La personne saisit son adresse ; si elle a un compte actif, elle reçoit un
// lien pour choisir son mot de passe. Il n'y a plus d'inscription libre ni de
// mot de passe provisoire envoyé en clair : un compte est créé par
// l'administrateur, et son titulaire l'active par ce lien.
//
// RÉPONSE TOUJOURS IDENTIQUE, que l'adresse existe ou non : sinon cette
// page deviendrait un annuaire des comptes.
const REPONSE = "Si cette adresse a un compte, un message vient de lui être envoyé. "
  + "Ouvrez votre messagerie @egd.mg et regardez aussi le dossier « indésirables ». "
  + "Le lien est valable 24 heures. Si rien n'arrive, vérifiez l'orthographe de "
  + "l'adresse, ou adressez-vous à l'administrateur de la plateforme.";

export default async function handler(req, res) {
  if (req.method !== 'POST') return refus(res, 405, 'Méthode non autorisée.');
  if (!configuree()) return refus(res, 503, 'Service non configuré.');
  if (!origineLegitime(req)) return refus(res, 403, 'Origine non autorisée.');

  const email = String(corps(req).email ?? '').replace(/\s+/g, '').toLowerCase();
  if (email) {
    try {
      await envoyerLienSiPossible(req, email);
    } catch (e) {
      console.error('lien :', e.message);       // même réponse en cas de panne
    }
  }
  res.status(200).json({ ok: true, message: REPONSE });
}
