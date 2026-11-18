import { appelant } from '../_lib/autorisation.js';
import { lireTout, configuree, refus } from '../_lib/supabase.js';

// Les personnels que l'on peut associer à un projet (co-animateurs) :
// prénom, nom, fonction et rôle des comptes actifs. Jamais d'adresse, jamais
// d'élève. Réservé aux personnes connectées : la vitrine n'en a pas besoin.
const ROLES = ['enseignant', 'vie_scolaire', 'direction', 'admin'];

export default async function handler(req, res) {
  if (req.method !== 'GET') return refus(res, 405, 'Méthode non autorisée.');
  if (!configuree()) return refus(res, 503, 'Service non configuré.');
  try {
    if (!(await appelant(req))) return refus(res, 401, 'Connectez-vous pour consulter la liste des personnels.');
    const l = await lireTout('membres',
      `actif=is.true&role=in.(${ROLES.join(',')})&email=not.like.essai-page-*&select=prenom,nom,fonction,role&order=nom,prenom`);
    const personnels = l.filter((m) => m.nom)
      .map((m) => ({ prenom: m.prenom ?? '', nom: m.nom, fonction: m.fonction ?? '', role: m.role }));
    res.status(200).json({ ok: true, personnels });
  } catch (e) {
    console.error('projets/personnels :', e.message);
    refus(res, 500, 'La liste des personnels est momentanément indisponible.');
  }
}
