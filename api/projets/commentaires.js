import { appelant, peutEcrireAnnee, reArmer, estDirection, nomAffiche } from '../_lib/autorisation.js';
import { journaliser } from '../_lib/journal.js';
import {
  lire, ecrire, configuree, origineLegitime, refus, corps, UUID,
} from '../_lib/supabase.js';

// Les commentaires d'une fiche.
//   GET  ?projet=...                lecture, publique comme sur l'ancienne
//                                   plateforme (nom de l'auteur, jamais son adresse)
//   POST { projet, texte }          ajout, par une personne connectée

export default async function handler(req, res) {
  if (!configuree()) return refus(res, 503, 'Service non configuré.');
  try {
    if (req.method === 'GET') {
      const id = String(req.query?.projet ?? '');
      if (!UUID.test(id)) return refus(res, 400, 'Identifiant invalide.');
      const p = (await lire('projets', `id=eq.${id}&select=id,supprime_le`))[0];
      if (!p) return refus(res, 404, 'Projet introuvable.');
      // Une fiche à la corbeille n'est plus publique, ses commentaires non plus.
      if (p.supprime_le && !estDirection(await appelant(req))) return refus(res, 404, 'Projet introuvable.');
      const l = await lire('commentaires',
        `projet_id=eq.${id}&select=id,auteur_nom,texte,cree_le&order=cree_le.desc,id.desc&limit=500`);
      return res.status(200).json({ ok: true, commentaires: l });
    }

    if (req.method !== 'POST') return refus(res, 405, 'Méthode non autorisée.');
    if (!origineLegitime(req)) return refus(res, 403, 'Origine non autorisée.');
    const m = await appelant(req);
    if (!m) return refus(res, 401, 'Session expirée : reconnectez-vous.');

    const b = corps(req);
    const id = String(b.projet ?? '');
    const texte = String(b.texte ?? '').trim();
    if (!UUID.test(id)) return refus(res, 400, 'Identifiant invalide.');
    if (!texte) return refus(res, 400, 'Le commentaire est vide.');
    if (texte.length > 1000) return refus(res, 400, 'Commentaire trop long (1 000 caractères au plus).');

    const p = (await lire('projets', `id=eq.${id}&select=id,annee,code,supprime_le`))[0];
    if (!p || p.supprime_le) return refus(res, 404, 'Projet introuvable.');
    if (!peutEcrireAnnee(m, p.annee)) {
      return refus(res, 403, "Cette année est archivée (lecture seule). Seul l'administrateur peut commenter.");
    }
    const [c] = await ecrire('commentaires', 'select=id,auteur_nom,texte,cree_le',
      { projet_id: id, auteur_id: m.id, auteur_nom: nomAffiche(m), texte }, 'POST');
    await journaliser(req, m, 'add_comment', `Commentaire sur ${p.code} (${p.annee})`);
    await reArmer(req, res, m);
    res.status(201).json({ ok: true, commentaire: c });
  } catch (e) {
    console.error('projets/commentaires :', e.message);
    refus(res, 500, "Le commentaire n'a pas pu être traité. Réessayez dans un instant.");
  }
}
