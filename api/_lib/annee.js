// =====================================================================
// L'année scolaire et le statut d'un projet, mêmes règles que la base
// (suivi.annee_scolaire, suivi.statut_calcule) et que l'ancienne
// plateforme (currentSchoolYear, computeStatus).
// =====================================================================

/** La date du jour à Antananarivo (UTC+3, sans heure d'été), « AAAA-MM-JJ ». */
export function aujourdhui(maintenant = new Date()) {
  return new Date(maintenant.getTime() + 3 * 3600_000).toISOString().slice(0, 10);
}

/** Bascule le 4 juillet : « 2026-07-03 » -> 2025-2026, « 2026-07-04 » -> 2026-2027. */
export function anneeScolaire(jour = aujourdhui()) {
  const [a, m, j] = jour.split('-').map(Number);
  return (m > 7 || (m === 7 && j >= 4)) ? `${a}-${a + 1}` : `${a - 1}-${a}`;
}

export const anneeCourante = () => anneeScolaire();

export function anneeSuivante(annee) {
  const [a, b] = annee.split('-').map(Number);
  return `${a + 1}-${b + 1}`;
}

export const ANNEE = /^(\d{4})-(\d{4})$/;
export function anneeValide(annee) {
  const m = ANNEE.exec(String(annee ?? ''));
  return Boolean(m && Number(m[2]) === Number(m[1]) + 1);
}

/** Une année antérieure à l'année courante est archivée : lecture seule, sauf admin. */
export const archivee = (annee) => annee < anneeCourante();

/** planifie, en_cours ou termine : exactement suivi.statut_calcule. */
export function statut(debut, fin, jour = aujourdhui()) {
  if (!debut && !fin) return 'planifie';
  if (debut && jour < debut) return 'planifie';
  if (fin && jour > fin) return 'termine';
  if (debut && jour >= debut) return 'en_cours';
  return 'planifie';
}
