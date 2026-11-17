// =====================================================================
// Le journal : qui a fait quoi, quand. Mêmes noms d'action que l'ancienne
// plateforme (login, add_project, delete_project...), pour que l'historique
// importé et le nouveau se lisent d'un seul tenant.
//
// Jamais d'adresse IP. Le pays et la ville viennent des en-têtes de Vercel
// (une approximation par réseau, pas une localisation), le système et le
// navigateur de l'en-tête User-Agent. Lu par le seul administrateur.
// Une écriture qui échoue ne bloque jamais le geste journalisé.
// =====================================================================

import { ecrire } from './supabase.js';

function appareilDe(req) {
  const ua = String(req.headers['user-agent'] ?? '');
  const os = /Windows/i.test(ua) ? 'Windows'
    : /iPhone|iPad|iPod/i.test(ua) ? 'iOS'
      : /Android/i.test(ua) ? 'Android'
        : /CrOS/i.test(ua) ? 'ChromeOS'
          : /Mac OS X|Macintosh/i.test(ua) ? 'macOS'
            : /Linux/i.test(ua) ? 'Linux' : '';
  const navigateur = /Edg\//.test(ua) ? 'Edge'
    : /OPR\/|Opera/.test(ua) ? 'Opera'
      : /Firefox\//.test(ua) ? 'Firefox'
        : /Chrome\//.test(ua) ? 'Chrome'
          : /Safari\//.test(ua) ? 'Safari' : '';
  const appareil = /iPad|Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua)) ? 'Tablette'
    : /Mobile|iPhone/i.test(ua) ? 'Mobile' : (ua ? 'Ordinateur' : '');
  const dechiffrer = (v) => { try { return decodeURIComponent(String(v ?? '')); } catch { return ''; } };
  return {
    pays: dechiffrer(req.headers['x-vercel-ip-country']) || null,
    ville: dechiffrer(req.headers['x-vercel-ip-city']) || null,
    os: os || null,
    navigateur: navigateur || null,
    appareil: appareil || null,
  };
}

/**
 * `qui` : le membre (id, email, role) ou, à défaut, une adresse seule
 * (connexion ratée). `detail` est tronqué : le journal n'est pas une copie
 * des fiches.
 */
export async function journaliser(req, qui, action, detail = null) {
  const ligne = {
    membre_id: qui?.id ?? null,
    email: qui?.email ?? null,
    role: qui?.role ?? null,
    action,
    detail: detail ? String(detail).slice(0, 300) : null,
    ...appareilDe(req),
  };
  await ecrire('journal', '', ligne, 'POST')
    .catch((e) => console.error('journal :', action, e.message));
}
