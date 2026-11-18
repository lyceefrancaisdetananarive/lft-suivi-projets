import {
  appelant, estAdmin, estDirection, reArmer, ressaisieAutorisee, noterEchecRessaisie, FENETRE_MINUTES,
} from '../_lib/autorisation.js';
import { envoyerLienSiPossible } from '../_lib/lien.js';
import { journaliser } from '../_lib/journal.js';
import {
  lire, lireTout, ecrire, creerUtilisateur, utilisateurParEmail, supprimerUtilisateur,
  verifierMotDePasse, adminsAutorises, configuree, origineLegitime, refus, corps, UUID,
  MESSAGE_SATURATION,
} from '../_lib/supabase.js';

// La gestion des comptes, par l'administrateur et la direction (qui ne
// touche pas au compte de l'administrateur).
//   GET                                   liste des comptes
//   POST   { email, role, nom, prenom, envoyer_lien? }       créer un compte
//   PATCH  { id, actif?, nom?, prenom?, envoyer_lien? }      modifier
//   PATCH  { id, role, motDePasse }                          changer le rôle
//   DELETE { id, motDePasse }                                supprimer
//
// Créer un compte ne crée AUCUN mot de passe connu : son titulaire choisit
// le sien par le lien « Première connexion », que l'administrateur peut lui
// envoyer d'ici. Plus de liste d'adresses autorisées ni d'inscription
// libre : autoriser quelqu'un, c'est lui créer son compte.
//
// Changer un rôle et supprimer un compte redemandent le mot de passe de
// l'administrateur : sur un poste resté ouvert, ces deux gestes donneraient
// la plateforme à qui s'assoit devant.

const ROLES_PERSONNEL = ['admin', 'direction', 'vie_scolaire', 'enseignant'];
const EMAIL = /^[a-z0-9._%+-]+@egd\.mg$/;

async function ressaisie(req, m, motDePasse) {
  if (!(await ressaisieAutorisee(m.id))) {
    return `Trop d'essais. Réessayez dans ${FENETRE_MINUTES} minutes.`;
  }
  if (!motDePasse || !(await verifierMotDePasse(m.email, String(motDePasse), req))) {
    await noterEchecRessaisie(m.id);
    return 'Mot de passe incorrect : confirmez avec votre propre mot de passe.';
  }
  return null;
}

const texte = (v, max = 120) => {
  const t = String(v ?? '').trim();
  return t ? t.slice(0, max) : null;
};

export default async function handler(req, res) {
  if (!configuree()) return refus(res, 503, 'Service non configuré.');
  try {
    if (req.method !== 'GET' && !origineLegitime(req)) return refus(res, 403, 'Origine non autorisée.');
    const m = await appelant(req);
    if (!m) return refus(res, 401, 'Session expirée : reconnectez-vous.');
    if (!estDirection(m)) return refus(res, 403, "Réservé à la direction et à l'administrateur.");

    if (req.method === 'GET') {
      const l = await lireTout('membres',
        'select=id,email,role,nom,prenom,actif,mdp_provisoire,cree_le,derniere_connexion&order=nom,prenom,id');
      return res.status(200).json({
        ok: true,
        comptes: l.map(({ mdp_provisoire: prov, ...c }) => ({ ...c, active: !prov })),
      });
    }

    const b = corps(req);

    // ------------------------------------------------------------- création
    if (req.method === 'POST') {
      const email = String(b.email ?? '').replace(/\s+/g, '').toLowerCase();
      const role = String(b.role ?? 'enseignant');
      if (!EMAIL.test(email)) return refus(res, 400, 'Adresse invalide : seules les adresses @egd.mg sont acceptées.');
      if (!ROLES_PERSONNEL.includes(role)) return refus(res, 400, 'Rôle inconnu.');
      if (role === 'admin' && !adminsAutorises().includes(email)) {
        return refus(res, 403, "Cette adresse ne figure pas dans la liste ADMINS_SUIVI du projet "
          + "Vercel : elle ne peut pas recevoir le rôle admin.");
      }
      const nom = texte(b.nom);
      const prenom = texte(b.prenom);
      if (!nom || !prenom) return refus(res, 400, 'Nom et prénom requis.');
      if ((await lire('membres', `email=eq.${encodeURIComponent(email)}&select=id`)).length) {
        return refus(res, 409, 'Un compte existe déjà avec cette adresse.');
      }
      const id = (await creerUtilisateur(email)) ?? (await utilisateurParEmail(email));
      if (!id) return refus(res, 500, "Le compte n'a pas pu être créé.");
      await ecrire('membres', '', { id, email, role, nom, prenom, mdp_provisoire: true }, 'POST');
      await journaliser(req, m, 'add_user', `Création du compte ${email} (${role})`);
      const lien = b.envoyer_lien === true ? await envoyerLienSiPossible(req, email, m) : null;
      await reArmer(req, res, m);
      return res.status(201).json({
        ok: true, id, lien_envoye: Boolean(lien?.envoye),
        message: `Compte créé pour ${email}.${lien?.envoye ? ' Lien de première connexion envoyé.' : ''}`,
      });
    }

    const id = String(b.id ?? '');
    if (!UUID.test(id)) return refus(res, 400, 'Identifiant invalide.');
    const cible = (await lire('membres', `id=eq.${id}&select=id,email,role,nom,prenom,actif`))[0];
    if (!cible) return refus(res, 404, 'Compte introuvable.');
    // La direction gère tous les comptes, sauf celui de l'administrateur.
    if (cible.role === 'admin' && !estAdmin(m)) {
      return refus(res, 403, "Seul l'administrateur de l'application modifie son propre compte.");
    }

    // ---------------------------------------------------------- suppression
    if (req.method === 'DELETE') {
      if (cible.id === m.id) return refus(res, 400, 'Vous ne pouvez pas supprimer votre propre compte.');
      const motif = await ressaisie(req, m, b.motDePasse);
      if (motif) return refus(res, 401, motif);
      // Les projets restent : leur auteur devient vide, son nom reste affiché.
      if (!(await supprimerUtilisateur(cible.id))) return refus(res, 500, "La suppression n'a pas abouti.");
      await journaliser(req, m, 'delete_user', `Suppression du compte ${cible.email}`);
      await reArmer(req, res, m);
      return res.status(200).json({ ok: true, message: `Compte ${cible.email} supprimé.` });
    }

    if (req.method !== 'PATCH') return refus(res, 405, 'Méthode non autorisée.');

    // -------------------------------------------------------- modification
    const maj = {};
    const traces = [];
    if ('role' in b && b.role !== cible.role) {
      const role = String(b.role);
      if (cible.id === m.id) return refus(res, 400, 'Vous ne pouvez pas changer votre propre rôle.');
      if (!ROLES_PERSONNEL.includes(role)) return refus(res, 400, 'Rôle inconnu.');
      if (role === 'admin' && !adminsAutorises().includes(cible.email)) {
        return refus(res, 403, "Cette adresse ne figure pas dans la liste ADMINS_SUIVI du projet "
          + "Vercel : elle ne peut pas recevoir le rôle admin.");
      }
      const motif = await ressaisie(req, m, b.motDePasse);
      if (motif) return refus(res, 401, motif);
      maj.role = role;
      traces.push(['change_role', `${cible.email}: ${cible.role} -> ${role}`]);
    }
    if ('actif' in b && Boolean(b.actif) !== cible.actif) {
      if (cible.id === m.id) return refus(res, 400, 'Vous ne pouvez pas désactiver votre propre compte.');
      maj.actif = Boolean(b.actif);
      // Pas de session à révoquer : chaque appel relit le compte en base,
      // la personne perd la main à sa requête suivante.
      traces.push([maj.actif ? 'reactivate_user' : 'deactivate_user',
        `${maj.actif ? 'Réactivation' : 'Désactivation'} : ${cible.email}`]);
    }
    for (const champ of ['nom', 'prenom']) {
      if (champ in b) {
        const t = texte(b[champ]);
        if (!t) return refus(res, 400, 'Nom et prénom ne peuvent pas être vides.');
        if (t !== cible[champ]) maj[champ] = t;
      }
    }
    if ((maj.nom || maj.prenom) && !traces.some(([a]) => a === 'update_user')) {
      traces.push(['update_user', `Nom modifié : ${cible.email}`]);
    }

    if (Object.keys(maj).length) await ecrire('membres', `id=eq.${cible.id}`, maj);
    for (const [action, detail] of traces) await journaliser(req, m, action, detail);

    let lien = null;
    if (b.envoyer_lien === true) {
      if (maj.actif === false || (!('actif' in maj) && !cible.actif)) {
        return refus(res, 400, "Ce compte est désactivé : réactivez-le avant d'envoyer un lien.");
      }
      lien = await envoyerLienSiPossible(req, cible.email, m);
    }
    await reArmer(req, res, m);
    res.status(200).json({
      ok: true,
      lien_envoye: lien ? lien.envoye : undefined,
      message: lien && !lien.envoye && lien.raison === 'recent'
        ? 'Un lien a déjà été envoyé il y a moins de cinq minutes.' : 'Compte mis à jour.',
    });
  } catch (e) {
    console.error('admin/comptes :', e.message);
    if (e.statut === 429) return refus(res, 429, MESSAGE_SATURATION);
    refus(res, 500, "L'opération n'a pas abouti. Réessayez dans un instant.");
  }
}
