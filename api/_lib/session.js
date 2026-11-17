// =====================================================================
// Le cookie de session du suivi des projets (repris du classeur).
//
// Notre propre cookie scellé (HMAC SHA-256), et non le jeton Supabase :
//  - le rôle n'est JAMAIS lu dans user_metadata, que tout utilisateur
//    authentifié peut réécrire lui-même ; il est relu en base à chaque appel
//    (autorisation.js, appelant) ;
//  - le secret SUIVI_COOKIE_SECRET est distinct de celui de Supabase : la
//    fuite de l'un ne compromet pas l'autre.
// =====================================================================

const NOM_COOKIE = 'suivi_session';

// Le témoin : lisible par la page, il ne contient ni jeton ni identité, juste
// le rôle et l'échéance, pour qu'une session ouverte se voie sans réseau.
// C'EST UN VOYANT, PAS UNE BARRIÈRE : aucun contrôle ne se fonde dessus.
const NOM_TEMOIN = 'suivi_ouvert';

export const ROLES = ['admin', 'direction', 'vie_scolaire', 'enseignant', 'eleve'];

// Durée d'une session : trois heures, réarmées à chaque écriture enregistrée
// (remplir une fiche longue ne déconnecte pas). Plafond absolu de huit
// heures depuis la connexion initiale, la durée de session de l'ancienne
// plateforme : une session laissée ouverte sur un poste de salle des
// professeurs finit toujours par mourir, même entretenue.
export const DUREE = 3 * 3600;
const PLAFOND_SECONDES = 8 * 3600;

const enc = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const dec = (s) => {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

async function cle(secret) {
  return crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

/** Scelle { sub, role, prov } ; `dep` (heure de connexion) est conservé tel quel. */
export async function sceller(charge, secret, duree = DUREE) {
  const maintenant = Math.floor(Date.now() / 1000);
  const c = { ...charge, dep: charge.dep ?? maintenant, exp: maintenant + duree };
  const texte = enc(new TextEncoder().encode(JSON.stringify(c)));
  const sig = await crypto.subtle.sign('HMAC', await cle(secret), new TextEncoder().encode(texte));
  return `${texte}.${enc(sig)}`;
}

/** Ouvre une session ; null à la moindre anomalie (échec en position fermée). */
export async function ouvrir(jeton, secret) {
  try {
    if (!jeton || !secret) return null;
    const [texte, sig] = jeton.split('.');
    if (!texte || !sig) return null;
    const valide = await crypto.subtle.verify(
      'HMAC', await cle(secret), dec(sig), new TextEncoder().encode(texte));
    if (!valide) return null;
    const c = JSON.parse(new TextDecoder().decode(dec(texte)));
    const maintenant = Math.floor(Date.now() / 1000);
    if (!c.exp || c.exp < maintenant) return null;
    if (!c.dep || maintenant - c.dep > PLAFOND_SECONDES) return null;
    if (!ROLES.includes(c.role)) return null;
    return c;
  } catch {
    return null;
  }
}

export function lireCookie(entete) {
  if (!entete) return null;
  for (const part of entete.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === NOM_COOKIE) return v.join('=');
  }
  return null;
}

/**
 * HttpOnly (illisible par le JavaScript de la page), Secure, SameSite=Strict
 * (n'accompagne aucune requête venue d'un autre site), sans Max-Age : le
 * cookie meurt avec le navigateur, seule garantie sur un poste partagé.
 */
export function poserCookie(jeton, role, duree = DUREE) {
  const jusqua = Math.floor(Date.now() / 1000) + duree;
  return [
    `${NOM_COOKIE}=${jeton}; Path=/; HttpOnly; Secure; SameSite=Strict`,
    `${NOM_TEMOIN}=${role}.${jusqua}; Path=/; Secure; SameSite=Strict`,
  ];
}

export function effacerCookie() {
  return [
    `${NOM_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`,
    `${NOM_TEMOIN}=; Path=/; Secure; SameSite=Strict; Max-Age=0`,
  ];
}
