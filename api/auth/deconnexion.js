import { effacerCookie } from '../_lib/session.js';
import { origineLegitime, refus } from '../_lib/supabase.js';

// POST et même origine seulement : un GET suffisait, dans le classeur, à
// déconnecter n'importe quel visiteur depuis une balise <img> d'un autre site.
export default async function handler(req, res) {
  if (req.method !== 'POST') return refus(res, 405, 'Méthode non autorisée.');
  if (!origineLegitime(req)) return refus(res, 403, 'Origine non autorisée.');
  res.setHeader('Set-Cookie', effacerCookie());
  res.status(200).json({ ok: true });
}
