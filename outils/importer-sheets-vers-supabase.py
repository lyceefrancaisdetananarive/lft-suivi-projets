#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Import du suivi des projets : Google Sheets -> Supabase (schéma « suivi »).

Deux modes :

  python3 importer-sheets-vers-supabase.py
      SIMULATION (par défaut). Lit le classeur, prépare tout, écrit un
      rapport, n'envoie RIEN à Supabase. Ne demande aucune clé.

  python3 importer-sheets-vers-supabase.py --ecrire
      Écrit dans le projet Supabase Suivi_Projets_LFT. Refuse de tourner si
      les tables du suivi contiennent déjà des données, sauf avec
      --remplacer, qui les vide d'abord (les comptes auth.users, eux, sont
      réutilisés et jamais supprimés).

CE QUE LE SCRIPT NE FAIT JAMAIS
  - Il n'écrit rien dans le Google Sheet : la plateforme actuelle continue
    de tourner pendant toute la préparation.
  - Il ne lit pas les colonnes de mots de passe, de jetons ou de mots de
    passe provisoires. Les empreintes SHA-256 de l'ancienne base ne sont pas
    reprenables par Supabase : chaque compte reçoit un mot de passe aléatoire
    que personne ne connaît, jamais affiché ni enregistré, et son titulaire
    passera par « Première connexion ».
  - Il n'envoie aucun courriel : les comptes sont créés déjà confirmés, par
    l'API d'administration, sans invitation.
  - Il n'affiche jamais la clé secrète.

LA CLÉ SECRÈTE
  Elle n'est pas dans ce dépôt (public). Le script la lit dans
  ~/.config/lft/suivi-supabase.env, fichier à créer par l'administrateur :
      SUPABASE_URL=https://<ref du projet>.supabase.co
      SUPABASE_SECRET_KEY=...
  (Project Settings > API Keys > Secret keys du projet Suivi_Projets_LFT),
  puis : chmod 600 ~/.config/lft/suivi-supabase.env

LE RAPPORT
  Il nomme des collègues (référents non rattachés) : il est écrit hors du
  dépôt, dans le dossier OneDrive du projet, jamais dans git.
"""

import argparse
import collections
import datetime
import json
import os
import re
import secrets
import sys
import time
import unicodedata
import urllib.error
import urllib.request
import warnings

warnings.filterwarnings("ignore")

SHEET_ID = "1WIroVN7v0fEXMXh0Ldg97Y1nLlGLizC10TJKTlM59gg"
CREDS = os.path.expanduser("~/.config/lft/service-account.json")
ENV = os.path.expanduser("~/.config/lft/suivi-supabase.env")
RAPPORT_DIR = os.path.expanduser(
    "~/Library/CloudStorage/OneDrive-Personnel/Documents/"
    "Projets d'établissement -- Lycée Français de Tananarive/Refonte-suivi-2026")

TZ = datetime.timezone(datetime.timedelta(hours=3))  # Antananarivo, sans heure d'été
MAINTENANT = datetime.datetime.now(TZ)

# Libellés du Sheet -> codes du schéma (comparaison sans accent ni casse).
CATEGORIES = {
    "PROJET LFT": "LFT",
    "PROJET ZONE OI": "ZOI",
    "PROJET AEFE": "AEFE",
    "PROJET INSTITUTIONNEL": "INST",
    "CLUBS ET ACTIVITES": "CLUB",
    "PROJETS DE L'INTERNAT": "INT",
    "PROJETS DE L INTERNAT": "INT",
}
ROLES = {"admin", "direction", "vie_scolaire", "enseignant"}
PRIORITES = {"haute", "moyenne", "basse"}
VRAI = {"1", "true", "vrai", "oui", "x", "yes"}


# ------------------------------------------------------------------ outils

def norm(s):
    """Majuscules, sans accent : la même normalisation que isReferentOf()."""
    s = unicodedata.normalize("NFD", s or "")
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return s.upper().strip()


def mots(s):
    return [m for m in re.split(r"[^A-Z0-9]+", norm(s)) if m]


def vide(v):
    return v is None or str(v).strip() == ""


def texte(v):
    v = (v or "").strip()
    return v or None


def annee_scolaire(d):
    """Même règle que suivi.annee_scolaire() : bascule le 4 juillet."""
    if (d.month, d.day) >= (7, 4):
        return "%d-%d" % (d.year, d.year + 1)
    return "%d-%d" % (d.year - 1, d.year)


def date_seule(v, alertes, ou):
    v = (v or "").strip()
    if not v:
        return None
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.datetime.strptime(v, fmt).date().isoformat()
        except ValueError:
            pass
    alertes.append("%s : date illisible « %s », laissée vide" % (ou, v))
    return None


def horodatage(v, alertes=None, ou=""):
    """Les dates du Sheet sont écrites à l'heure d'Antananarivo (nowStr())."""
    v = (v or "").strip()
    if not v:
        return None
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d", "%d/%m/%Y %H:%M:%S", "%d/%m/%Y"):
        try:
            return datetime.datetime.strptime(v, fmt).replace(tzinfo=TZ).isoformat()
        except ValueError:
            pass
    if alertes is not None:
        alertes.append("%s : horodatage illisible « %s », laissé vide" % (ou, v))
    return None


def lignes(ws_values):
    """Transforme get_all_values() en dictionnaires, en ignorant les lignes vides."""
    if not ws_values:
        return []
    tete = ws_values[0]
    out = []
    for r in ws_values[1:]:
        if not any(str(x).strip() for x in r):
            continue
        r = list(r) + [""] * (len(tete) - len(r))
        out.append(dict(zip(tete, r)))
    return out


# -------------------------------------------------------------- lecture

def lire_sheet():
    import gspread
    gc = gspread.service_account(filename=CREDS)
    sh = gc.open_by_key(SHEET_ID)
    titres = [ws.title for ws in sh.worksheets()]
    data = {"projets": {}, "commentaires": {}}
    for t in titres:
        m = re.fullmatch(r"Projets_(\d{4}-\d{4})", t)
        if m:
            data["projets"][m.group(1)] = lignes(sh.worksheet(t).get_all_values())
        m = re.fullmatch(r"Commentaires_(\d{4}-\d{4})", t)
        if m:
            data["commentaires"][m.group(1)] = lignes(sh.worksheet(t).get_all_values())
    # Utilisateurs : on ne garde QUE les colonnes utiles. Les colonnes de mots
    # de passe et de jetons sont écartées dès la lecture.
    garder = ("Email", "Role", "Nom", "Prenom", "Actif")
    data["utilisateurs"] = [{k: u.get(k, "") for k in garder}
                            for u in lignes(sh.worksheet("Utilisateurs").get_all_values())]
    data["logs"] = lignes(sh.worksheet("Logs").get_all_values()) if "Logs" in titres else []
    return data


# ------------------------------------------------------------ préparation

def preparer(data):
    alertes = []
    rapport = collections.OrderedDict()

    # --- membres
    membres = []
    vus = set()
    for u in data["utilisateurs"]:
        email = (u["Email"] or "").strip().lower()
        if not email:
            continue
        role = (u["Role"] or "").strip()
        if email in vus:
            alertes.append("Compte en double ignoré : %s" % email)
            continue
        if role not in ROLES:
            alertes.append("Rôle inconnu « %s » pour %s : compte ignoré" % (role, email))
            continue
        if not email.endswith("@egd.mg") or email.endswith("@eleve.egd.mg"):
            alertes.append("Adresse hors @egd.mg ou d'élève : %s ignoré" % email)
            continue
        vus.add(email)
        membres.append({
            "email": email,
            "role": role,
            "nom": texte(u["Nom"]),
            "prenom": texte(u["Prenom"]),
            "actif": (u["Actif"] or "").strip() != "0",
            # Personne ne connaît le mot de passe aléatoire : pas de mot de
            # passe provisoire remis, donc pas de péremption (contrat de
            # mdp_pose_le) ; le passage par « Première connexion » abaissera
            # mdp_provisoire.
            "mdp_provisoire": True,
            "mdp_pose_le": None,
        })
    par_email = {m["email"]: m for m in membres}

    def nom_affiche(email):
        m = par_email.get((email or "").strip().lower())
        if m:
            return " ".join(x for x in (m["prenom"], m["nom"]) if x)
        return (email or "").split("@")[0] or None

    # --- date de création reconstituée depuis le journal
    #     « Nouveau projet: <nom> (<CODE>) » ou « Reconduit X (a) -> CODE (b) »
    crees = {}
    for l in data["logs"]:
        quand = horodatage(l.get("Date_Heure"))
        if not quand:
            continue
        jour = datetime.datetime.fromisoformat(quand).date()
        det = l.get("Detail", "")
        code, annee = None, None
        if l.get("Action") == "add_project":
            m = re.search(r"\(([A-Z]+-\d{3,})\)?\s*$", det)
            if m:
                code, annee = m.group(1), annee_scolaire(jour)
        elif l.get("Action") == "reconduct_project":
            m = re.search(r"->\s*([A-Z]+-\d{3,})\s*\((\d{4}-\d{4})\)", det)
            if m:
                code, annee = m.group(1), m.group(2)
        if code and (annee, code) not in crees:
            crees[(annee, code)] = quand

    # --- projets
    projets = []
    cree_le_source = collections.Counter()
    for annee in sorted(data["projets"]):
        for r in data["projets"][annee]:
            code = (r.get("ID_Projet") or "").strip()
            ou = "%s %s" % (annee, code or "(sans code)")
            if not re.fullmatch(r"(LFT|ZOI|AEFE|INST|CLUB|INT)-\d{3,}", code):
                alertes.append("%s : code invalide, fiche ignorée" % ou)
                continue
            cat = CATEGORIES.get(norm(r.get("Categorie")))
            if not cat:
                alertes.append("%s : catégorie inconnue « %s », fiche ignorée" % (ou, r.get("Categorie")))
                continue
            nom = (r.get("Nom_Projet") or "").strip()
            if not nom:
                alertes.append("%s : fiche sans nom, ignorée" % ou)
                continue
            axe = None
            m = re.search(r"([123])", r.get("Axe_Projet_Etablissement") or "")
            if m:
                axe = int(m.group(1))
            prio = (r.get("Priorite") or "").strip().lower() or None
            if prio and prio not in PRIORITES:
                alertes.append("%s : priorité « %s » inconnue, laissée vide" % (ou, prio))
                prio = None
            debut = date_seule(r.get("Date_Debut"), alertes, ou)
            fin = date_seule(r.get("Date_Fin"), alertes, ou)
            if debut and fin and fin < debut:
                alertes.append("%s : fin (%s) avant début (%s), fin laissée vide" % (ou, fin, debut))
                fin = None
            p = collections.OrderedDict()
            p["annee"] = annee
            p["code"] = code
            p["categorie"] = cat
            p["nom"] = nom
            p["echelle"] = texte(r.get("Echelle"))
            p["axe"] = axe
            p["sous_axe"] = texte(r.get("Sous_Axe"))
            p["disciplines"] = texte(r.get("Disciplines_Mobilisees"))
            p["niveaux"] = texte(r.get("Niveaux_Concernes"))
            p["description"] = texte(r.get("Description"))
            p["objectifs"] = texte(r.get("Objectifs_Pedagogiques"))
            p["priorite"] = prio
            p["date_debut"] = debut
            p["date_fin"] = fin
            p["partenariats"] = texte(r.get("Partenariats"))
            p["ressources"] = texte(r.get("Ressources_Necessaires"))
            p["valorisation"] = texte(r.get("Modalite_Valorisation"))
            p["referents"] = texte(r.get("Enseignant_Referent"))
            p["_cree_par"] = (r.get("Created_By") or "").strip().lower() or None
            p["cree_par_nom"] = nom_affiche(r.get("Created_By"))
            if (annee, code) in crees:
                p["cree_le"] = crees[(annee, code)]
                cree_le_source["date du journal"] += 1
            elif not vide(r.get("Last_Modified_Date")):
                p["cree_le"] = horodatage(r.get("Last_Modified_Date"), alertes, ou)
                cree_le_source["date de dernière modification"] += 1
            else:
                cree_le_source["inconnue (date de l'import)"] += 1
            p["_modifie_par"] = (r.get("Last_Modified_By") or "").strip().lower() or None
            p["modifie_le"] = horodatage(r.get("Last_Modified_Date"), alertes, ou)
            if (r.get("Deleted") or "").strip().lower() in VRAI:
                p["supprime_le"] = horodatage(r.get("Deleted_Date"), alertes, ou) or MAINTENANT.isoformat()
                p["_supprime_par"] = (r.get("Deleted_By") or "").strip().lower() or None
            if (r.get("Locked") or "").strip().lower() in VRAI:
                p["verrouille_le"] = horodatage(r.get("Locked_Date"), alertes, ou) or MAINTENANT.isoformat()
                p["_verrouille_par"] = (r.get("Locked_By") or "").strip().lower() or None
            p["_reconduit_de"] = texte(r.get("Reconduit_De"))
            for champ in ("_cree_par", "_modifie_par", "_supprime_par", "_verrouille_par"):
                e = p.get(champ)
                if e and e not in par_email:
                    alertes.append("%s : %s « %s » sans compte, lien laissé vide" % (ou, champ[1:], e))
            projets.append(p)

    cles = {(p["annee"], p["code"]) for p in projets}
    if len(cles) != len(projets):
        doublons = [k for k, v in collections.Counter((p["annee"], p["code"]) for p in projets).items() if v > 1]
        raise SystemExit("ARRÊT : codes en double dans une même année : %s" % doublons)

    reconductions = []
    for p in projets:
        src = p["_reconduit_de"]
        if not src:
            continue
        m = re.fullmatch(r"(\d{4}-\d{4})/([A-Z]+-\d{3,})", src)
        if m and (m.group(1), m.group(2)) in cles:
            reconductions.append(((p["annee"], p["code"]), (m.group(1), m.group(2))))
        else:
            alertes.append("%s %s : origine « %s » introuvable, lien laissé vide" % (p["annee"], p["code"], src))

    # --- référents : seulement les correspondances SÛRES
    #     (nom complet ET premier prénom présents comme mots entiers).
    #     L'ancienne règle (isReferentOf, par sous-chaîne) sert à repérer ce
    #     qu'elle accordait en plus : listé « à vérifier », non importé.
    referents, a_verifier, non_rattaches = [], [], []
    for p in projets:
        t = p["referents"]
        if not t:
            continue
        mt = set(mots(t))
        ref_n = norm(t)
        trouves = []
        for m in membres:
            nom_m, pre_m = mots(m["nom"]), mots(m["prenom"])
            if not nom_m:
                continue
            sur = all(w in mt for w in nom_m) and (not pre_m or pre_m[0] in mt)
            # ancienne règle, à l'identique de Code.gs
            nn = norm(m["nom"])
            ancien = len(nn) >= 2 and (nn in ref_n or any(
                len(x) >= 3 and x in ref_n for x in re.split(r"[-\s]", nn)))
            if ancien:
                pn = norm(m["prenom"])
                ancien = (pn in ref_n) if len(pn) >= 2 else True
            if sur:
                trouves.append(m)
                referents.append(((p["annee"], p["code"]), m["email"]))
            elif ancien:
                a_verifier.append("%s %s : « %s » ressemble à %s %s (%s), non rattaché"
                                  % (p["annee"], p["code"], t, m["prenom"], m["nom"], m["email"]))
        # fragments du texte que personne ne couvre (intervenant, collègue
        # sans compte, faute de frappe)
        for frag in re.split(r"\s+(?:et|ET|Et)\s+|[/,;&+]|\s-\s", t):
            fm = set(mots(frag))
            if not fm:
                continue
            if not any(all(w in fm for w in mots(m["nom"])) for m in trouves):
                # Un seul compte porte ce nom : on le propose, sans l'accorder.
                cands = [m for m in membres if mots(m["nom"]) and all(w in fm for w in mots(m["nom"]))]
                piste = ""
                if len(cands) == 1:
                    c = cands[0]
                    piste = " : peut-être %s %s (%s%s), seul compte à ce nom" % (
                        c["prenom"] or "", c["nom"], c["email"], "" if c["actif"] else ", compte désactivé")
                non_rattaches.append("%s %s : « %s »%s" % (p["annee"], p["code"], frag.strip(), piste))

    # --- commentaires
    commentaires = []
    for annee, rows in sorted(data["commentaires"].items()):
        for r in rows:
            code = (r.get("ID_Projet") or "").strip()
            if (annee, code) not in cles:
                alertes.append("Commentaire %s %s : projet introuvable, ignoré" % (annee, code))
                continue
            t = (r.get("Commentaire") or "").strip()
            if not t:
                continue
            commentaires.append({
                "_projet": (annee, code),
                "_auteur": (r.get("Email") or "").strip().lower() or None,
                "auteur_nom": texte(r.get("Nom_Prenom")) or nom_affiche(r.get("Email")) or "Inconnu",
                "texte": t[:1000],
                "cree_le": horodatage(r.get("Date_Heure"), alertes, "Commentaire %s %s" % (annee, code)),
            })

    # --- journal
    journal = []
    for l in data["logs"]:
        quand = horodatage(l.get("Date_Heure"), alertes, "Journal")
        if not quand or vide(l.get("Action")):
            continue
        email = (l.get("Email") or "").strip().lower() or None
        journal.append({
            "quand": quand,
            "_membre": email,
            "email": email,
            "role": texte(l.get("Role")),
            "action": l.get("Action").strip(),
            "detail": texte(l.get("Detail")),
            "pays": texte(l.get("Pays")),
            "ville": texte(l.get("Ville")),
            "os": texte(l.get("OS")),
            "navigateur": texte(l.get("Navigateur")),
            "appareil": texte(l.get("Appareil")),
        })

    rapport["membres"] = membres
    rapport["projets"] = projets
    rapport["reconductions"] = reconductions
    rapport["referents"] = referents
    rapport["a_verifier"] = a_verifier
    rapport["non_rattaches"] = non_rattaches
    rapport["commentaires"] = commentaires
    rapport["journal"] = journal
    rapport["alertes"] = alertes
    rapport["cree_le_source"] = cree_le_source
    return rapport


# ------------------------------------------------------------ Supabase

class Supabase:
    def __init__(self, url, cle):
        self.url = url.rstrip("/")
        self.cle = cle

    def _entetes(self, profil=True, extra=None):
        h = {"apikey": self.cle, "Content-Type": "application/json"}
        # Les anciennes clés (JWT) vont aussi dans Authorization ; les
        # nouvelles (sb_secret_...) seulement dans apikey.
        if not self.cle.startswith("sb_"):
            h["Authorization"] = "Bearer " + self.cle
        if profil:
            h["Accept-Profile"] = "suivi"
            h["Content-Profile"] = "suivi"
        if extra:
            h.update(extra)
        return h

    def requete(self, methode, chemin, corps=None, profil=True, extra=None, essais=4):
        url = self.url + chemin
        donnees = None if corps is None else json.dumps(corps).encode("utf-8")
        for n in range(essais):
            req = urllib.request.Request(url, data=donnees, method=methode,
                                         headers=self._entetes(profil, extra))
            try:
                with urllib.request.urlopen(req, timeout=90) as rep:
                    brut = rep.read().decode("utf-8")
                    return rep.status, (json.loads(brut) if brut else None), rep.headers
            except urllib.error.HTTPError as e:
                msg = e.read().decode("utf-8", "replace")
                if e.code >= 500 and n < essais - 1:
                    time.sleep(2 * (n + 1))
                    continue
                raise SystemExit("ARRÊT : %s %s -> HTTP %s : %s" % (methode, chemin.split("?")[0], e.code, msg[:400]))
            except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
                if n < essais - 1:
                    time.sleep(3 * (n + 1))
                    continue
                raise SystemExit("ARRÊT : réseau injoignable (%s) sur %s" % (e, chemin.split("?")[0]))

    def compter(self, table):
        _, _, h = self.requete("HEAD", "/rest/v1/%s?select=*" % table, extra={"Prefer": "count=exact"})
        plage = h.get("Content-Range")
        if not plage or "/" not in plage:
            raise SystemExit("ARRÊT : comptage impossible sur %s (pas de Content-Range)." % table)
        return int(plage.split("/")[-1])

    def comptes_existants(self):
        out, page = {}, 1
        while True:
            _, rep, _ = self.requete("GET", "/auth/v1/admin/users?page=%d&per_page=1000" % page, profil=False)
            users = rep.get("users", []) if isinstance(rep, dict) else (rep or [])
            for u in users:
                if u.get("email"):
                    out[u["email"].lower()] = u["id"]
            if len(users) < 1000:
                return out
            page += 1

    def creer_compte(self, email):
        corps = {
            "email": email,
            # Aléatoire, jamais affiché ni conservé : personne ne le connaît.
            "password": secrets.token_urlsafe(32),
            "email_confirm": True,
        }
        _, rep, _ = self.requete("POST", "/auth/v1/admin/users", corps, profil=False)
        return rep["id"]

    def inserer(self, table, lignes_, retour=False, conflit=None):
        if not lignes_:
            return []
        colonnes = sorted({k for l in lignes_ for k in l})
        q = "/rest/v1/%s?columns=%s" % (table, ",".join(colonnes))
        prefer = ["missing=default", "return=representation" if retour else "return=minimal"]
        if conflit:
            q += "&on_conflict=" + conflit
            prefer.append("resolution=merge-duplicates")
        out = []
        for i in range(0, len(lignes_), 200):
            _, rep, _ = self.requete("POST", q, lignes_[i:i + 200], extra={"Prefer": ",".join(prefer)})
            if retour:
                out.extend(rep or [])
        return out


def lire_cle():
    if not os.path.exists(ENV):
        raise SystemExit(
            "ARRÊT : configuration absente. Créer %s avec les lignes\n"
            "  SUPABASE_URL=https://<ref du projet Suivi_Projets_LFT>.supabase.co\n"
            "  SUPABASE_SECRET_KEY=<clé secrète du projet Suivi_Projets_LFT>\n"
            "puis : chmod 600 %s" % (ENV, ENV))
    if os.stat(ENV).st_mode & 0o077:
        raise SystemExit("ARRÊT : %s est lisible par d'autres comptes. Faire : chmod 600 %s" % (ENV, ENV))
    conf = {}
    for ligne in open(ENV, encoding="utf-8"):
        if "=" in ligne and not ligne.lstrip().startswith("#"):
            k, v = ligne.split("=", 1)
            conf[k.strip()] = v.strip().strip('"').strip("'")
    for k in ("SUPABASE_URL", "SUPABASE_SECRET_KEY"):
        if not conf.get(k):
            raise SystemExit("ARRÊT : %s introuvable dans %s" % (k, ENV))
    if not re.fullmatch(r"https://[a-z0-9]+\.supabase\.co/?", conf["SUPABASE_URL"]):
        raise SystemExit("ARRÊT : SUPABASE_URL inattendue dans %s" % ENV)
    return conf["SUPABASE_URL"], conf["SUPABASE_SECRET_KEY"]


def ecrire(r, remplacer):
    sb = Supabase(*lire_cle())

    tables = ["commentaires", "projet_referents", "tentatives", "journal", "projets", "membres"]
    deja = {t: sb.compter(t) for t in tables}
    if any(deja.values()):
        if not remplacer:
            raise SystemExit("ARRÊT : le suivi contient déjà des données %s. Relancer avec "
                             "--remplacer pour les vider d'abord." % deja)
        print("Vidage des tables du suivi (les comptes sont conservés)...")
        for t in tables:
            sb.requete("DELETE", "/rest/v1/%s?%s" % (t, "projet_id=not.is.null" if t == "projet_referents" else "id=not.is.null"))

    print("Comptes : lecture des comptes existants...")
    ids = sb.comptes_existants()
    a_creer = [m["email"] for m in r["membres"] if m["email"] not in ids]
    print("Comptes : %d existants, %d à créer (sans courriel)." % (len(ids), len(a_creer)))
    for n, email in enumerate(a_creer, 1):
        ids[email] = sb.creer_compte(email)
        if n % 20 == 0 or n == len(a_creer):
            print("   %d / %d" % (n, len(a_creer)))

    def id_de(email):
        return ids.get(email) if email else None

    membres = [dict(m, id=ids[m["email"]]) for m in r["membres"]]
    sb.inserer("membres", membres, conflit="id")
    print("Membres : %d écrits." % len(membres))

    def propre(p):
        q = {k: v for k, v in p.items() if not k.startswith("_")}
        q["cree_par"] = id_de(p["_cree_par"]) if p["_cree_par"] in ids else None
        q["modifie_par"] = id_de(p["_modifie_par"]) if p["_modifie_par"] in ids else None
        if "supprime_le" in p:
            q["supprime_par"] = id_de(p.get("_supprime_par")) if p.get("_supprime_par") in ids else None
        if "verrouille_le" in p:
            q["verrouille_par"] = id_de(p.get("_verrouille_par")) if p.get("_verrouille_par") in ids else None
        return q

    # Années dans l'ordre : l'origine d'une reconduction est déjà écrite quand
    # on écrit la fiche reconduite, et le lien part avec l'insertion. Le poser
    # ensuite par une mise à jour réveillerait le trigger, qui remplacerait
    # modifie_le par la date de l'import.
    origine = dict(r["reconductions"])
    uuid_projet = {}
    poses = 0
    for annee in sorted({p["annee"] for p in r["projets"]}):
        lot = []
        for p in r["projets"]:
            if p["annee"] != annee:
                continue
            q = propre(p)
            src = origine.get((p["annee"], p["code"]))
            if src:
                if src not in uuid_projet:
                    raise SystemExit("ARRÊT : origine %s non encore écrite pour %s %s." % (src, annee, p["code"]))
                q["reconduit_de"] = uuid_projet[src]
                poses += 1
            lot.append(q)
        for row in sb.inserer("projets", lot, retour=True):
            uuid_projet[(row["annee"], row["code"])] = row["id"]
        print("Projets %s : %d écrits." % (annee, len(lot)))
    print("Reconductions : %d liens posés." % poses)

    refs = [{"projet_id": uuid_projet[k], "membre_id": ids[e]} for k, e in r["referents"] if e in ids]
    sb.inserer("projet_referents", refs, conflit="projet_id,membre_id")
    print("Référents : %d rattachements." % len(refs))

    com = [{"projet_id": uuid_projet[c["_projet"]], "auteur_id": id_de(c["_auteur"]) if c["_auteur"] in ids else None,
            "auteur_nom": c["auteur_nom"], "texte": c["texte"], "cree_le": c["cree_le"]}
           for c in r["commentaires"]]
    sb.inserer("commentaires", com)
    print("Commentaires : %d écrits." % len(com))

    jl = [dict({k: v for k, v in j.items() if not k.startswith("_")},
               membre_id=id_de(j["_membre"]) if j["_membre"] in ids else None)
          for j in r["journal"]]
    sb.inserer("journal", jl)
    print("Journal : %d lignes écrites." % len(jl))

    # Contrôle final : la base compte ce qu'on croit y avoir mis.
    attendu = {"membres": len(membres), "projets": len(r["projets"]),
               "projet_referents": len(refs), "commentaires": len(com), "journal": len(jl)}
    obtenu = {t: sb.compter(t) for t in attendu}
    print("Contrôle : attendu %s" % attendu)
    print("           obtenu  %s" % obtenu)
    if obtenu != attendu:
        raise SystemExit("ARRÊT : les comptes ne correspondent pas, examiner la base.")
    return obtenu


# -------------------------------------------------------------- rapport

def ecrire_rapport(r, mode, obtenu=None):
    os.makedirs(RAPPORT_DIR, exist_ok=True)
    chemin = os.path.join(RAPPORT_DIR, "rapport-import-%s-%s.md" % (
        mode, MAINTENANT.strftime("%Y-%m-%d_%Hh%M")))
    P = r["projets"]
    L = []
    L.append("# Import du suivi des projets vers Supabase : %s" % mode)
    L.append("")
    L.append("Le %s (heure d'Antananarivo). Source : Google Sheet de la plateforme, "
             "lu sans modification." % MAINTENANT.strftime("%d/%m/%Y à %H h %M"))
    L.append("")
    L.append("## Chiffres")
    L.append("")
    roles = collections.Counter(m["role"] for m in r["membres"])
    inactifs = sum(1 for m in r["membres"] if not m["actif"])
    L.append("- Comptes : %d (%s), dont %d désactivés."
             % (len(r["membres"]), ", ".join("%s %d" % kv for kv in sorted(roles.items())), inactifs))
    for annee in sorted({p["annee"] for p in P}):
        pa = [p for p in P if p["annee"] == annee]
        cats = collections.Counter(p["categorie"] for p in pa)
        corb = sum(1 for p in pa if "supprime_le" in p)
        verr = sum(1 for p in pa if "verrouille_le" in p)
        L.append("- Projets %s : %d (%s), dont %d en corbeille et %d verrouillés."
                 % (annee, len(pa), ", ".join("%s %d" % kv for kv in sorted(cats.items())), corb, verr))
    L.append("- Reconductions reliées à leur projet d'origine : %d." % len(r["reconductions"]))
    L.append("- Référents rattachés à un compte : %d." % len(r["referents"]))
    L.append("- Commentaires : %d. Lignes de journal : %d." % (len(r["commentaires"]), len(r["journal"])))
    L.append("- Date de création des fiches : %s."
             % ", ".join("%s %d" % kv for kv in r["cree_le_source"].most_common()))
    if obtenu:
        L.append("- Contrôle en base après écriture : %s." % ", ".join("%s %d" % kv for kv in obtenu.items()))
    L.append("")
    L.append("## Référents à vérifier (non rattachés par prudence)")
    L.append("")
    L.append("L'ancienne règle accordait le droit de modifier la fiche à ces personnes, "
             "sur une simple ressemblance de nom. L'import ne l'a pas repris. "
             "Pour le leur rendre, il suffit de le confirmer.")
    L.append("")
    L.extend("- " + x for x in r["a_verifier"]) if r["a_verifier"] else L.append("Aucun.")
    L.append("")
    L.append("## Noms cités comme référents sans compte correspondant")
    L.append("")
    L.append("Intervenants extérieurs, collègues partis, ou nom écrit autrement que sur le compte. "
             "Le texte reste affiché sur la fiche ; seul le droit de modifier n'est pas accordé.")
    L.append("")
    L.extend("- " + x for x in r["non_rattaches"]) if r["non_rattaches"] else L.append("Aucun.")
    L.append("")
    L.append("## Alertes de données")
    L.append("")
    L.extend("- " + x for x in r["alertes"]) if r["alertes"] else L.append("Aucune.")
    L.append("")
    with open(chemin, "w", encoding="utf-8") as f:
        f.write("\n".join(L))
    return chemin


def main():
    ap = argparse.ArgumentParser(description="Import Google Sheets -> Supabase (suivi)")
    ap.add_argument("--ecrire", action="store_true", help="écrire dans Supabase (sinon simulation)")
    ap.add_argument("--remplacer", action="store_true", help="vider les tables du suivi avant d'écrire")
    a = ap.parse_args()

    print("Lecture du Google Sheet...")
    r = preparer(lire_sheet())
    print("Prêt : %d comptes, %d projets, %d référents sûrs, %d à vérifier, %d noms sans compte, "
          "%d commentaires, %d lignes de journal, %d alertes."
          % (len(r["membres"]), len(r["projets"]), len(r["referents"]), len(r["a_verifier"]),
             len(r["non_rattaches"]), len(r["commentaires"]), len(r["journal"]), len(r["alertes"])))
    obtenu = None
    if a.ecrire:
        obtenu = ecrire(r, a.remplacer)
    chemin = ecrire_rapport(r, "ecriture" if a.ecrire else "simulation", obtenu)
    print("Rapport : %s" % chemin)


if __name__ == "__main__":
    main()
