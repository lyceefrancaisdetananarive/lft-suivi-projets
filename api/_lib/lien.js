// =====================================================================
// Envoi du lien « choisir mon mot de passe » (Première connexion, Mot de
// passe oublié, ou geste de l'administrateur).
// =====================================================================

import { journaliser } from './journal.js';
import { lire, ecrire, envoyerLien } from './supabase.js';

// Au plus un courriel toutes les cinq minutes par compte : un lien en boucle
// serait un abus du relais de courriel.
const INTERVALLE_MINUTES = 5;

/** Envoie le lien si le compte existe et est actif. Partagé avec l'administration. */
export async function envoyerLienSiPossible(req, email, auteur = null) {
  const m = (await lire('membres',
    `email=eq.${encodeURIComponent(email)}&select=id,email,role,actif`))[0];
  if (!m || !m.actif) return { envoye: false, raison: m ? 'inactif' : 'inconnu' };
  const depuis = new Date(Date.now() - INTERVALLE_MINUTES * 60000).toISOString();
  const recentes = await lire('tentatives',
    `membre_id=eq.${m.id}&origine=eq.oubli&quand=gte.${depuis}&select=id&limit=1`).catch(() => []);
  if (recentes.length) return { envoye: false, raison: 'recent' };

  const statut = await envoyerLien(m.email, `https://${req.headers.host}`);
  if (statut < 200 || statut >= 300) {
    console.error('lien : /auth/v1/recover a répondu', statut);
    return { envoye: false, raison: `supabase ${statut}` };
  }
  // Noté APRÈS un envoi accepté : une demande refusée par Supabase ne doit
  // pas fermer le créneau de cinq minutes sur un courriel jamais parti.
  await ecrire('tentatives', '', { membre_id: m.id, origine: 'oubli' }, 'POST').catch(() => {});
  await journaliser(req, auteur ?? m, auteur ? 'send_link' : 'forgot_password',
    auteur ? `Lien envoyé à ${m.email}` : 'Lien de choix du mot de passe envoyé');
  return { envoye: true };
}
