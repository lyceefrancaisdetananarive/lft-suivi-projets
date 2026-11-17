import {
  appelant, peutModifier, peutEcrireAnnee, referentDe, reArmer, estDirection,
} from '../_lib/autorisation.js';
import { CHAMPS_LUS, versPage, originesDe } from '../_lib/projets.js';
import { anneeCourante, anneeValide, archivee } from '../_lib/annee.js';
import { journaliser } from '../_lib/journal.js';
import {
  lire, lireTout, ecrire, configuree, origineLegitime, refus, corps, UUID,
} from '../_lib/supabase.js';

// La corbeille.
//   GET  ?annee=...                      contenu (direction et admin)
//   POST { id, geste: 'jeter' }          mettre à la corbeille (qui peut modifier)
//   POST { id, geste: 'restaurer' }      direction et admin
//   POST { id, geste: 'supprimer' }      suppression définitive, depuis la
//                                        corbeille seulement (direction, admin)

const ARCHIVE = "Cette année est archivée (lecture seule). Seul l'administrateur peut la modifier.";

export default async function handler(req, res) {
  if (!configuree()) return refus(res, 503, 'Service non configuré.');
  try {
    const m = await appelant(req);

    if (req.method === 'GET') {
      if (!m) return refus(res, 401, 'Session expirée : reconnectez-vous.');
      if (!estDirection(m)) return refus(res, 403, 'Réservé à la direction et à l’administration.');
      const annee = String(req.query?.annee ?? '') || anneeCourante();
      if (!anneeValide(annee)) return refus(res, 400, 'Année invalide.');
      const jetes = await lireTout('projets',
        `annee=eq.${annee}&supprime_le=not.is.null&select=${CHAMPS_LUS},`
        + 'jete_par:membres!projets_supprime_par_fkey(prenom,nom)&order=supprime_le.desc,id');
      const origines = await originesDe(jetes);
      return res.status(200).json({
        ok: true,
        annee,
        projets: jetes.map((p) => ({
          ...versPage(p, { origines }),
          supprime_le: p.supprime_le,
          supprime_par_nom: [p.jete_par?.prenom, p.jete_par?.nom].filter(Boolean).join(' ') || null,
        })),
      });
    }

    if (req.method !== 'POST') return refus(res, 405, 'Méthode non autorisée.');
    if (!origineLegitime(req)) return refus(res, 403, 'Origine non autorisée.');
    if (!m) return refus(res, 401, 'Session expirée : reconnectez-vous.');

    const b = corps(req);
    const id = String(b.id ?? '');
    if (!UUID.test(id)) return refus(res, 400, 'Identifiant invalide.');
    const p = (await lire('projets', `id=eq.${id}&select=${CHAMPS_LUS}`))[0];
    if (!p) return refus(res, 404, 'Projet introuvable.');
    const libelle = `${p.code} - ${p.nom}`;

    if (b.geste === 'jeter') {
      if (p.supprime_le) return refus(res, 409, 'Ce projet est déjà dans la corbeille.');
      const refs = await referentDe(m.id, [p.id]);
      if (!peutModifier(m, p, refs.has(p.id))) {
        if (!peutEcrireAnnee(m, p.annee)) return refus(res, 403, ARCHIVE);
        if (p.verrouille_le) return refus(res, 403, 'Ce projet est verrouillé : seule la direction peut le mettre à la corbeille.');
        return refus(res, 403, 'Vous ne pouvez mettre à la corbeille que vos projets, ou ceux dont vous êtes référent.');
      }
      await ecrire('projets', `id=eq.${id}`, { supprime_le: new Date().toISOString(), supprime_par: m.id });
      await journaliser(req, m, 'delete_project', `Corbeille: ${libelle}`);
      await reArmer(req, res, m);
      return res.status(200).json({ ok: true, message: 'Projet placé dans la corbeille.' });
    }

    if (b.geste !== 'restaurer' && b.geste !== 'supprimer') return refus(res, 400, 'Geste inconnu.');
    if (!estDirection(m)) return refus(res, 403, 'Réservé à la direction et à l’administration.');
    if (archivee(p.annee) && m.role !== 'admin') return refus(res, 403, ARCHIVE);
    if (!p.supprime_le) return refus(res, 409, "Ce projet n'est pas dans la corbeille.");

    if (b.geste === 'restaurer') {
      await ecrire('projets', `id=eq.${id}`, { supprime_le: null, supprime_par: null });
      await journaliser(req, m, 'restore_project', `Restauré: ${libelle}`);
      await reArmer(req, res, m);
      return res.status(200).json({ ok: true, message: 'Projet restauré.' });
    }

    // Suppression définitive : les commentaires et les référents partent en
    // cascade ; une fiche reconduite depuis celle-ci perd seulement son lien.
    await ecrire('projets', `id=eq.${id}`, undefined, 'DELETE');
    await journaliser(req, m, 'permanent_delete', `Supprimé définitivement: ${libelle} (${p.annee})`);
    await reArmer(req, res, m);
    return res.status(200).json({ ok: true, message: 'Projet supprimé définitivement.' });
  } catch (e) {
    console.error('projets/corbeille :', e.message);
    refus(res, 500, "L'opération n'a pas abouti. Réessayez dans un instant.");
  }
}
