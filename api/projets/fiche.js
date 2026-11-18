import {
  appelant, peutModifier, peutReconduire, peutCreer, referentDe, reArmer, estDirection, nomAffiche,
  CATS_VIE_SCOLAIRE,
} from '../_lib/autorisation.js';
import {
  valider, datesOrdonnees, CHAMPS_LUS, versPage, versPublic, anneesPubliques, originesDe,
  synchroniserReferents,
} from '../_lib/projets.js';
import { anneeCourante, anneeSuivante, anneeValide, archivee } from '../_lib/annee.js';
import { journaliser } from '../_lib/journal.js';
import {
  lire, ecrire, configuree, origineLegitime, refus, corps, UUID,
} from '../_lib/supabase.js';

// Une fiche projet.
//   GET   ?id=...   lire une fiche (hors corbeille ; publique sous forme
//                   réduite pour l'année courante et la précédente)
//   POST            créer        { annee?, nom, categorie, ... }
//   PATCH           modifier     { id, modifie_le?, ...champs modifiés }
// La mise à la corbeille passe par /api/projets/corbeille.

async function fiche(id) {
  return (await lire('projets', `id=eq.${id}&select=${CHAMPS_LUS}`))[0] ?? null;
}

async function pourPage(p, m) {
  const refs = m ? await referentDe(m.id, [p.id]) : new Set();
  return versPage(p, {
    origines: await originesDe([p]),
    droits: m ? { peut_modifier: peutModifier(m, p, refs.has(p.id)), peut_reconduire: peutReconduire(m, p, refs.has(p.id)) } : null,
  });
}

/** L'année dans laquelle cette personne peut créer : courante, suivante et archivée (direction et admin). */
function anneeAutorisee(m, annee) {
  const courante = anneeCourante();
  if (annee === courante) return true;
  if (annee === anneeSuivante(courante)) return estDirection(m);
  return archivee(annee) && estDirection(m);
}

export default async function handler(req, res) {
  if (!configuree()) return refus(res, 503, 'Service non configuré.');

  try {
    if (req.method === 'GET') {
      const id = String(req.query?.id ?? '');
      if (!UUID.test(id)) return refus(res, 400, 'Identifiant invalide.');
      const p = await fiche(id);
      if (!p || p.supprime_le) return refus(res, 404, 'Projet introuvable.');
      const lecteur = await appelant(req);
      if (lecteur) return res.status(200).json({ ok: true, projet: await pourPage(p, lecteur) });
      // Visiteur : la vitrine, années courante et précédente, forme réduite.
      if (!anneesPubliques(anneeCourante()).includes(p.annee)) return refus(res, 404, 'Projet introuvable.');
      return res.status(200).json({ ok: true, projet: versPublic(await pourPage(p, null)) });
    }

    if (req.method !== 'POST' && req.method !== 'PATCH') return refus(res, 405, 'Méthode non autorisée.');
    if (!origineLegitime(req)) return refus(res, 403, 'Origine non autorisée.');
    const m = await appelant(req);
    if (!m) return refus(res, 401, 'Session expirée : reconnectez-vous.');
    const b = corps(req);

    // ---------------------------------------------------------- création
    if (req.method === 'POST') {
      const annee = String(b.annee ?? '') || anneeCourante();
      if (!anneeValide(annee) || !anneeAutorisee(m, annee)) {
        return refus(res, 403, archivee(annee)
          ? "Cette année est archivée (lecture seule). Seul l'administrateur peut la modifier."
          : `Vous ne pouvez pas créer de projet pour l'année ${annee}.`);
      }
      const { valeurs, message } = valider(b, false);
      if (message) return refus(res, 400, message);
      if (!datesOrdonnees(valeurs)) return refus(res, 400, 'La date de fin précède la date de début.');
      if (!peutCreer(m, annee, valeurs.categorie)) {
        return refus(res, 403, 'Vie scolaire : création limitée à la catégorie « Club et activité ».');
      }
      const maintenant = new Date().toISOString();
      const [p] = await ecrire('projets', `select=${CHAMPS_LUS}`, {
        ...valeurs, annee,
        cree_par: m.id, cree_par_nom: nomAffiche(m),
        modifie_par: m.id, modifie_le: maintenant,
      }, 'POST');
      if (valeurs.referents) await synchroniserReferents(p.id, valeurs.referents);
      await journaliser(req, m, 'add_project', `Nouveau projet: ${p.nom} (${p.code})`);
      await reArmer(req, res, m);
      return res.status(201).json({ ok: true, projet: await pourPage(p, m) });
    }

    // ---------------------------------------------------------- modification
    const id = String(b.id ?? '');
    if (!UUID.test(id)) return refus(res, 400, 'Identifiant invalide.');
    const p = await fiche(id);
    if (!p || p.supprime_le) return refus(res, 404, 'Projet introuvable.');
    const refs = await referentDe(m.id, [p.id]);
    if (!peutModifier(m, p, refs.has(p.id))) {
      if (archivee(p.annee) && !estDirection(m)) {
        return refus(res, 403, "Cette année est archivée (lecture seule).");
      }
      if (p.verrouille_le && !estDirection(m)) {
        return refus(res, 403, 'Ce projet est verrouillé. Adressez-vous à la direction pour le modifier.');
      }
      return refus(res, 403, 'Vous ne pouvez modifier que vos projets, ou ceux dont vous êtes référent.');
    }

    // Deux personnes sur la même fiche : la seconde ne doit pas effacer sans
    // le savoir ce que la première vient d'enregistrer.
    if (b.modifie_le !== undefined && b.modifie_le !== null
        && Date.parse(b.modifie_le) !== Date.parse(p.modifie_le ?? '')) {
      return refus(res, 409, "Cette fiche a été modifiée par quelqu'un d'autre depuis que vous "
        + "l'avez ouverte. Rechargez-la avant d'enregistrer.", { projet: await pourPage(p, m) });
    }

    const { valeurs, message } = valider(b, true);
    if (message) return refus(res, 400, message);
    if (!datesOrdonnees(valeurs, p)) return refus(res, 400, 'La date de fin précède la date de début.');
    if (m.role === 'vie_scolaire' && valeurs.categorie && !CATS_VIE_SCOLAIRE.includes(valeurs.categorie)) {
      return refus(res, 403, 'Vie scolaire : un projet ne peut pas quitter vos catégories.');
    }

    const pareil = (a, b) => (a && typeof a === 'object' ? JSON.stringify(a) === JSON.stringify(b ?? {}) : a === b);
    const changes = Object.fromEntries(Object.entries(valeurs).filter(([k, v]) => !pareil(v, p[k])));
    if (!Object.keys(changes).length) {
      return res.status(200).json({ ok: true, inchange: true, projet: await pourPage(p, m) });
    }
    // modifie_le est posé par le trigger de la base, seulement si le contenu change.
    const [apres] = await ecrire('projets', `id=eq.${id}&select=${CHAMPS_LUS}`,
      { ...changes, modifie_par: m.id });
    if ('referents' in changes) await synchroniserReferents(id, changes.referents);
    await journaliser(req, m, 'update_project', `Modification: ${apres.code} - ${apres.nom}`);
    await reArmer(req, res, m);
    return res.status(200).json({ ok: true, projet: await pourPage(apres, m) });
  } catch (e) {
    console.error('projets/fiche :', e.message);
    if (e.code === '23514') return refus(res, 400, 'Une valeur de la fiche est refusée par la base.');
    refus(res, 500, "L'enregistrement n'a pas abouti. Réessayez dans un instant.");
  }
}
