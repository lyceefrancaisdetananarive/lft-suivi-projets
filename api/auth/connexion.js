import { sceller, poserCookie, DUREE } from '../_lib/session.js';
import { roleTenable } from '../_lib/autorisation.js';
import { journaliser } from '../_lib/journal.js';
import {
  verifierMotDePasse, lire, ecrire, configuree, origineLegitime, refus, corps,
} from '../_lib/supabase.js';

// Un seul message pour une adresse inconnue et un mot de passe faux : la
// différence dirait à qui essaie si un collègue a un compte.
const ECHEC = 'Adresse ou mot de passe incorrect. Après plusieurs essais, le compte se '
  + 'met en pause un quart d’heure : passez alors par « Mot de passe oublié ».';

// LE VERROU (CNIL, délibération n° 2022-100 ; ANSSI), repris du classeur.
// À partir de SEUIL_PAUSE échecs sur la fenêtre, chaque essai attend un délai
// qui double AVANT la vérification ; à MAX_TENTATIVES, le compte est en pause
// jusqu'à la fin de la fenêtre et Supabase n'est plus sollicité. Compteur par
// compte, jamais par adresse IP : le lycée sort sur une seule adresse.
const SEUIL_PAUSE = 5;
const MAX_TENTATIVES = 10;
const FENETRE_MINUTES = 15;
const DELAI_MAX_MS = 4000;
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

export default async function handler(req, res) {
  if (req.method !== 'POST') return refus(res, 405, 'Méthode non autorisée.');
  if (!configuree()) return refus(res, 503, "Le service n'est pas encore configuré.");
  if (!origineLegitime(req)) return refus(res, 403, 'Origine non autorisée.');

  const b = corps(req);
  const email = String(b.email ?? '').replace(/\s+/g, '').toLowerCase();
  const motDePasse = String(b.motDePasse ?? '');
  if (!email || !motDePasse) return refus(res, 400, ECHEC);

  try {
    const m = (await lire('membres',
      `email=eq.${encodeURIComponent(email)}&select=id,email,role,actif,mdp_provisoire,prenom,nom`))[0];

    let echecs = 0;
    if (m) {
      const depuis = new Date(Date.now() - FENETRE_MINUTES * 60000).toISOString();
      const lignes = await lire('tentatives',
        `membre_id=eq.${m.id}&origine=eq.connexion&quand=gte.${depuis}&select=id&limit=${MAX_TENTATIVES}`)
        .catch(() => new Array(SEUIL_PAUSE).fill(null));   // illisible : on ralentit
      echecs = lignes.length;
    }
    if (echecs >= MAX_TENTATIVES) {
      await attendre(DELAI_MAX_MS);
      await journaliser(req, m, 'login_blocked', `Compte en pause (${echecs} échecs)`);
      return refus(res, 401, ECHEC);
    }
    // Une adresse inconnue attend autant qu'un compte au seuil : le temps de
    // réponse ne doit pas dire si le compte existe.
    if (echecs >= SEUIL_PAUSE || !m) {
      await attendre(Math.min(DELAI_MAX_MS, 500 * 2 ** (m ? echecs - SEUIL_PAUSE : 0)));
    }

    const id = await verifierMotDePasse(email, motDePasse);
    const bon = Boolean(id && m && m.id === id);

    if (!bon) {
      if (m) {
        await ecrire('tentatives', '', { membre_id: m.id, origine: 'connexion' }, 'POST').catch(() => {});
      }
      await journaliser(req, m ?? { email }, 'login_fail',
        m ? `Identifiants incorrects (${echecs + 1}/${MAX_TENTATIVES})` : 'Adresse inconnue');
      return refus(res, 401, ECHEC);
    }

    // Le mot de passe est JUSTE : on peut alors dire pourquoi la porte reste
    // fermée, sans rien apprendre à qui ne connaît pas le mot de passe.
    if (!m.actif) {
      await journaliser(req, m, 'login_disabled', 'Tentative sur un compte désactivé');
      return refus(res, 403, "Ce compte a été désactivé. Adressez-vous à l'administrateur "
        + "si vous pensez qu'il s'agit d'une erreur.");
    }
    if (!roleTenable(m)) {
      return refus(res, 403, "Votre compte n'est plus autorisé. Adressez-vous à l'administrateur.");
    }
    if (m.mdp_provisoire) {
      return refus(res, 403, 'Choisissez d’abord votre mot de passe en passant par '
        + '« Première connexion ».');
    }

    const jeton = await sceller({ sub: m.id, role: m.role, prov: false },
      process.env.SUIVI_COOKIE_SECRET, DUREE);
    await ecrire('tentatives', `membre_id=eq.${m.id}&origine=eq.connexion`, undefined, 'DELETE')
      .catch(() => {});
    await ecrire('membres', `id=eq.${m.id}`, { derniere_connexion: new Date().toISOString() })
      .catch(() => {});
    await journaliser(req, m, 'login', 'Connexion réussie');

    res.setHeader('Set-Cookie', poserCookie(jeton, m.role, DUREE));
    res.status(200).json({ ok: true, role: m.role, prenom: m.prenom, nom: m.nom, email: m.email });
  } catch (e) {
    console.error('connexion :', e.message);
    refus(res, 500, "Le service d'authentification est momentanément indisponible.");
  }
}
