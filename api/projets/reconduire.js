import { appelant, reArmer, estDirection, nomAffiche, CATS_VIE_SCOLAIRE } from '../_lib/autorisation.js';
import { CHAMPS_LUS } from '../_lib/projets.js';
import { anneeCourante, anneeSuivante, anneeValide } from '../_lib/annee.js';
import { journaliser } from '../_lib/journal.js';
import {
  lire, ecrire, configuree, origineLegitime, refus, corps, UUID,
} from '../_lib/supabase.js';

// Reconduire un ou plusieurs projets vers une autre année.
// POST { ids: [uuid, ...], annee_cible? }
//
// La copie reprend le contenu de la fiche et ses référents, repart sans
// dates, sans verrou, avec un code neuf (posé par la base) et la personne
// qui reconduit pour auteur. Elle garde le lien vers son origine, et la base
// interdit de reconduire deux fois le même projet dans la même année.
//
// Année cible : l'année courante pour tous ; l'année suivante pour la
// direction et l'administration seulement (ouvrir une année la rend visible
// de tous les visiteurs).

const CONTENU = ['categorie', 'nom', 'echelle', 'axe', 'sous_axe', 'disciplines', 'niveaux',
  'description', 'objectifs', 'priorite', 'partenariats', 'ressources', 'valorisation', 'referents',
  'parcours'];

export default async function handler(req, res) {
  if (req.method !== 'POST') return refus(res, 405, 'Méthode non autorisée.');
  if (!configuree()) return refus(res, 503, 'Service non configuré.');
  if (!origineLegitime(req)) return refus(res, 403, 'Origine non autorisée.');

  try {
    const m = await appelant(req);
    if (!m) return refus(res, 401, 'Session expirée : reconnectez-vous.');
    if (m.role === 'eleve') return refus(res, 403, 'Action non autorisée.');

    const b = corps(req);
    const courante = anneeCourante();
    const cible = String(b.annee_cible ?? '') || courante;
    if (!anneeValide(cible)) return refus(res, 400, 'Année cible invalide.');
    if (cible !== courante) {
      if (cible !== anneeSuivante(courante)) {
        return refus(res, 403, `Année cible non autorisée (${cible}) : la reconduction vise ${courante}.`);
      }
      if (!estDirection(m)) {
        return refus(res, 403, `Seules la direction et l'administration peuvent ouvrir l'année ${cible}.`);
      }
    }

    const ids = [...new Set((Array.isArray(b.ids) ? b.ids : []).map(String))];
    if (!ids.length) return refus(res, 400, 'Aucun projet sélectionné.');
    if (ids.length > 200) return refus(res, 400, 'Trop de projets en une fois (200 au plus).');
    if (!ids.every((x) => UUID.test(x))) return refus(res, 400, 'Identifiant invalide.');

    const sources = new Map((await lire('projets',
      `id=in.(${ids.join(',')})&select=${CHAMPS_LUS}`)).map((p) => [p.id, p]));
    const deja = new Set((await lire('projets',
      `annee=eq.${cible}&reconduit_de=in.(${ids.join(',')})&select=reconduit_de`))
      .map((x) => x.reconduit_de));

    const erreurs = [];
    const ignores = [];
    const retenus = [];
    for (const id of ids) {
      const p = sources.get(id);
      if (!p || p.supprime_le) { erreurs.push({ id, motif: 'introuvable' }); continue; }
      const etiquette = { id, code: p.code, annee: p.annee, nom: p.nom };
      if (p.annee === cible) { erreurs.push({ ...etiquette, motif: `déjà en ${cible}` }); continue; }
      if (m.role === 'vie_scolaire' && !CATS_VIE_SCOLAIRE.includes(p.categorie)) {
        erreurs.push({ ...etiquette, motif: 'hors de vos catégories' }); continue;
      }
      if (deja.has(id)) { ignores.push({ ...etiquette, motif: 'déjà reconduit' }); continue; }
      retenus.push(p);
    }

    let crees = [];
    if (retenus.length) {
      const maintenant = new Date().toISOString();
      const lignes = retenus.map((p) => ({
        ...Object.fromEntries(CONTENU.map((k) => [k, p[k]])),
        annee: cible,
        reconduit_de: p.id,
        cree_par: m.id,
        cree_par_nom: nomAffiche(m),
        modifie_par: m.id,
        modifie_le: maintenant,
      }));
      try {
        crees = await ecrire('projets', 'select=id,code,nom,reconduit_de', lignes, 'POST');
      } catch (e) {
        // Deux reconductions simultanées du même projet : la base refuse la
        // seconde (index unique), rien n'est écrit, on le dit.
        if (e.code === '23505') {
          return refus(res, 409, "Un de ces projets vient d'être reconduit par quelqu'un d'autre. "
            + 'Rechargez la liste et recommencez.');
        }
        throw e;
      }

      // Les référents suivent leur fiche.
      const nouveau = new Map(crees.map((c) => [c.reconduit_de, c.id]));
      const refs = await lire('projet_referents',
        `projet_id=in.(${retenus.map((p) => p.id).join(',')})&select=projet_id,membre_id`);
      if (refs.length) {
        await ecrire('projet_referents', 'on_conflict=projet_id,membre_id',
          refs.map((r) => ({ projet_id: nouveau.get(r.projet_id), membre_id: r.membre_id })),
          'POST', 'resolution=ignore-duplicates');
      }
    }

    const parSource = new Map(crees.map((c) => [c.reconduit_de, c]));
    const resultat = retenus.map((p) => ({
      id: parSource.get(p.id).id,
      code: parSource.get(p.id).code,
      nom: p.nom,
      source: { id: p.id, annee: p.annee, code: p.code },
    }));

    if (ids.length === 1 && resultat.length === 1) {
      const r = resultat[0];
      await journaliser(req, m, 'reconduct_project',
        `Reconduit ${r.source.code} (${r.source.annee}) -> ${r.code} (${cible}) : ${r.nom}`);
    } else {
      await journaliser(req, m, 'reconduct_batch',
        `${resultat.length} projet(s) reconduit(s) vers ${cible} `
        + `(${ignores.length} ignoré(s), ${erreurs.length} en erreur)`);
    }
    if (resultat.length) await reArmer(req, res, m);

    res.status(200).json({
      ok: true,
      annee: cible,
      crees: resultat,
      ignores,
      erreurs,
      message: `${resultat.length} projet(s) reconduit(s) vers ${cible}.`,
    });
  } catch (e) {
    console.error('projets/reconduire :', e.message);
    refus(res, 500, "La reconduction n'a pas abouti. Réessayez dans un instant.");
  }
}
