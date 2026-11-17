import { ouvrir, lireCookie, sceller, poserCookie, DUREE } from '../_lib/session.js';
import {
  ressaisieAutorisee, noterEchecRessaisie, roleTenable, FENETRE_MINUTES,
} from '../_lib/autorisation.js';
import { refuserMotDePasse } from '../_lib/motdepasse.js';
import { journaliser } from '../_lib/journal.js';
import {
  definirMotDePasse, verifierMotDePasse, utilisateurDuJetonHache, lire, ecrire,
  configuree, origineLegitime, refus, corps,
} from '../_lib/supabase.js';

// =====================================================================
// Choisir son mot de passe. DEUX ENTRÉES :
//
//  A. CHANGEMENT ORDINAIRE : la personne est connectée et redonne son mot
//     de passe actuel. Sans cette ressaisie, qui trouve un poste resté
//     ouvert volerait le compte.
//
//  B. LIEN REÇU PAR COURRIEL (« Première connexion », « Mot de passe
//     oublié ») : ni session ni ancien mot de passe. La page transmet le
//     hachage du jeton lu dans son adresse ; Supabase seul le valide et le
//     consomme, ici, au moment d'enregistrer.
// =====================================================================

export default async function handler(req, res) {
  if (req.method !== 'POST') return refus(res, 405, 'Méthode non autorisée.');
  if (!configuree()) return refus(res, 503, 'Service non configuré.');
  if (!origineLegitime(req)) return refus(res, 403, 'Origine non autorisée.');

  const b = corps(req);
  const ancien = String(b.ancien ?? '');
  const nouveau = String(b.nouveau ?? '');
  const jeton = String(b.jeton ?? '');

  try {
    let m = null;
    const champs = 'id,email,role,actif,prenom,nom';

    if (jeton) {
      // Le contrôle de la règle AVANT de consommer le jeton : un mot de
      // passe refusé ne doit pas griller le lien.
      const prealable = refuserMotDePasse(nouveau);
      if (prealable) return refus(res, 400, prealable);
      const porteur = await utilisateurDuJetonHache(jeton);
      if (!porteur) {
        return refus(res, 401, "Ce lien n'est plus valable : il expire au bout de 24 heures "
          + "et ne sert qu'une fois. Demandez-en un nouveau avec « Mot de passe oublié ».");
      }
      m = (await lire('membres', `id=eq.${porteur.id}&select=${champs}`))[0];
    } else {
      const s = await ouvrir(lireCookie(req.headers.cookie), process.env.SUIVI_COOKIE_SECRET);
      if (!s) {
        return refus(res, 401, 'Aucune session ouverte, ou session expirée. Connectez-vous, '
          + 'ou passez par « Mot de passe oublié ».');
      }
      if (nouveau === ancien) {
        return refus(res, 400, "Le nouveau mot de passe doit être différent de l'ancien.");
      }
      m = (await lire('membres', `id=eq.${s.sub}&select=${champs}`))[0];
      if (!m || !m.actif) return refus(res, 401, 'Compte introuvable ou désactivé.');
      if (!(await ressaisieAutorisee(m.id))) {
        return refus(res, 429, `Trop d'essais. Réessayez dans ${FENETRE_MINUTES} minutes.`);
      }
      if (!(await verifierMotDePasse(m.email, ancien))) {
        await noterEchecRessaisie(m.id);
        return refus(res, 401, 'Le mot de passe actuel est incorrect.');
      }
    }

    if (!m || !m.actif) return refus(res, 401, 'Compte introuvable ou désactivé.');
    if (!roleTenable(m)) {
      return refus(res, 403, "Ce compte n'est plus autorisé. Adressez-vous à l'administrateur.");
    }
    const motif = refuserMotDePasse(nouveau, m);
    if (motif) return refus(res, 400, motif);

    await definirMotDePasse(m.id, nouveau);
    const maintenant = new Date().toISOString();
    await ecrire('membres', `id=eq.${m.id}`,
      { mdp_provisoire: false, mdp_pose_le: maintenant, derniere_connexion: maintenant });
    // Un mot de passe neuf repart de zéro : le verrou ne doit pas refuser,
    // à la connexion suivante, le mot de passe qu'on vient de choisir.
    await ecrire('tentatives', `membre_id=eq.${m.id}&origine=eq.connexion`, undefined, 'DELETE')
      .catch(() => {});
    await journaliser(req, m, jeton ? 'password_reset' : 'change_password',
      jeton ? 'Mot de passe choisi par lien' : 'Mot de passe modifié');

    // Toute porte qui pose un cookie date la session (leçon du classeur).
    const session = await sceller({ sub: m.id, role: m.role, prov: false },
      process.env.SUIVI_COOKIE_SECRET, DUREE);
    res.setHeader('Set-Cookie', poserCookie(session, m.role, DUREE));
    res.status(200).json({ ok: true, role: m.role, prenom: m.prenom, nom: m.nom, email: m.email });
  } catch (e) {
    console.error('mot-de-passe :', e.message);
    refus(res, 500, "Le changement n'a pas abouti. Réessayez ; si cela persiste, "
      + "demandez un nouveau lien avec « Mot de passe oublié ».");
  }
}
