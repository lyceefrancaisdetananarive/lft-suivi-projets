# Reprise en urgence — LFT Suivi des projets

Ce document s'adresse à la personne qui reprend l'application sans la connaître,
probablement parce que quelque chose est cassé et que la direction attend.

**Règle d'or : on revient en arrière d'abord, on comprend ensuite.**
Chaque minute passée à comprendre est une minute où les utilisateurs ne
travaillent pas. Rétablissez le service, puis diagnostiquez à froid.

---

## 1. En 30 secondes

« LFT — Suivi des projets d'établissement » recense les projets pédagogiques du
Lycée Français de Tananarive (réseau AEFE, Madagascar). Les enseignants y
déclarent leurs projets, la direction les suit, les valide et les reconduit
d'une année sur l'autre.

Il n'y a pas de serveur, pas de base de données classique, pas de build.
Trois pièces seulement :

| Pièce | Ce que c'est | Où |
|---|---|---|
| Le site | `index.html`, un seul fichier (CSS + HTML + JS) | GitHub Pages : <https://lyceefrancaisdetananarive.github.io/lft-suivi-projets/> |
| La base | Un Google Sheet | Feuille id `1WIroVN7v0fEXMXh0Ldg97Y1nLlGLizC10TJKTlM59gg` |
| L'API | `Code.gs`, un Google Apps Script **lié au Sheet** | Sheet → Extensions → Apps Script (projet nommé « Projet sans titre ») |

Dépôt Git : `lyceefrancaisdetananarive/lft-suivi-projets` (branche `main`).
Copie de travail locale : `/Users/maxwilliamrafaliarison/Documents/lft-suivi-projets/`.

L'URL de l'API est en dur dans `index.html`, constante `API_URL` (ligne ~1508) :

```
https://script.google.com/macros/s/AKfycbz23u7EaJP6ZczIqiwITDGb0FgpOp6cMGGEK293k7NS0xqyU7o5r_UUwnNMcBS0ruDkJQ/exec
```

Retenez ces deux adresses : le site et le Sheet. Tout le reste en découle.

---

## 2. Les trois choses à savoir avant de toucher à quoi que ce soit

**1. Le front se déploie tout seul, le backend non.**
Un `git push` sur `main` met le site à jour sans autre intervention (le dépôt ne
contient aucun workflow d'intégration continue : GitHub Pages publie directement
le contenu de la branche). Le backend, lui, ne bouge **jamais** tant qu'on n'a pas
recollé `Code.gs` dans l'éditeur Apps Script et redéployé à la main. Modifier
`Code.gs` dans le dépôt ne change strictement rien en production.

**2. Le Sheet est la base de données.**
Une ligne effacée à la main dans le Sheet est effacée pour de bon. L'application
a une corbeille (colonne `Deleted`), mais elle ne protège que les suppressions
faites depuis l'application. Une suppression manuelle dans le tableur ne passe
par aucune corbeille : elle se rattrape par l'historique des versions Google
ou par la copie de sauvegarde de la nuit précédente (voir § 3).

**3. Les onglets sont datés par année scolaire.**
Un onglet `Projets_<année>` et un onglet `Commentaires_<année>` par année, plus
trois onglets non datés : `Utilisateurs`, `Emails_Autorises`, `Logs`.
L'année bascule **le 4 juillet**. La fonction `currentSchoolYear()` est écrite
deux fois avec la même règle : côté serveur dans `Code.gs` (sur l'heure
d'Antananarivo) et côté client dans `index.html` (sur l'horloge du poste).
Avant le 4 juillet → `(y-1)-y` ; à partir du 4 juillet → `y-(y+1)`.
Une année antérieure à l'année courante est en lecture seule : seul un compte de
rôle `admin` peut y écrire, et le serveur le vérifie sur chaque action
d'écriture.

---

## 3. Revenir en arrière

La section la plus importante. Faites-la avant tout diagnostic.

### Le site est cassé (page blanche, affichage aberrant, bouton mort)

```bash
cd ~/Documents/lft-suivi-projets
git log --oneline | head -10          # repérer le dernier commit sain
git revert <commit_fautif>            # annule ce commit, en crée un nouveau
git push
```

`git revert` n'efface pas l'historique : il ajoute un commit qui défait le
précédent. C'est sans danger, même à plusieurs. Le site est republié dans la
minute ou les deux minutes qui suivent — comptez un peu plus si la connexion est
mauvaise. Rechargez en vidant le cache (Cmd+Maj+R) avant de conclure que ça n'a
pas marché.

Si plusieurs commits sont en cause, annulez-les du plus récent au plus ancien.

### Le backend est cassé (le site s'affiche mais rien ne se charge ou ne s'enregistre)

**C'est le réflexe n°1, et il prend une minute.** Les anciennes versions du
déploiement sont conservées ; on rebascule dessus sans rien réécrire.

1. Ouvrir le Sheet → **Extensions** → **Apps Script**.
2. **Déployer** → **Gérer les déploiements**.
3. Cliquer sur le **crayon** (Modifier) du déploiement existant.
4. Dans la liste **Version**, choisir **une version antérieure** (la dernière
   connue comme saine).
5. **Déployer**.

L'URL de l'API ne change pas. Aucune modification d'`index.html` n'est
nécessaire. Testez immédiatement avec l'URL du § 4.

Dernier déploiement connu : **version 11, du 10/09/2026**.

### Une donnée a disparu du Sheet

1. Ouvrir le Sheet.
2. **Fichier** → **Historique des versions** → **Afficher l'historique des versions**.
3. Choisir un horodatage antérieur à l'incident, vérifier le contenu dans
   l'aperçu, puis **Restaurer cette version**.

Restaurer ramène **tout le classeur** à cet instant : les écritures faites
entre-temps par d'autres utilisateurs sont perdues. Si l'incident ne porte que
sur quelques lignes, préférez copier-coller les cellules depuis l'aperçu de
l'ancienne version plutôt que de restaurer le classeur entier.

**Autre recours : la sauvegarde nocturne.** Le classeur entier est copié chaque
nuit vers 2 h dans le dossier Drive « LFT - Sauvegardes Suivi Projets » ; les
30 dernières copies sont conservées, les plus anciennes passent à la corbeille.
Ouvrir la copie du jour voulu et y recopier les lignes manquantes évite de
restaurer tout le classeur. Le panneau Admin de l'application affiche l'état de
ces sauvegardes (nombre de copies, date de la dernière, déclencheur actif ou
non) et permet d'en lancer une immédiatement. Si le déclencheur est inactif, il
s'installe en exécutant une seule fois `installBackupTrigger()` depuis l'éditeur
Apps Script (la première exécution demande l'autorisation d'accès à Drive).

---

## 4. Diagnostiquer en trois questions

Dans cet ordre. Arrêtez-vous à la première réponse « non ».

### Question 1 — Le site s'affiche-t-il ?

Ouvrir <https://lyceefrancaisdetananarive.github.io/lft-suivi-projets/>.

- **Erreur 404** → GitHub Pages est désactivé, ou `index.html` n'est plus à la
  racine de `main`. Vérifier dans les réglages du dépôt (Settings → Pages).
- **Page blanche ou mise en page cassée** → le dernier commit est en cause.
  Annulez le commit fautif (§ 3).

### Question 2 — Les projets se chargent-ils ?

Si le site s'affiche mais reste sur « Chargement des projets… », l'API ne répond
pas. Testez-la directement dans le navigateur :

```
https://script.google.com/macros/s/AKfycbz23u7EaJP6ZczIqiwITDGb0FgpOp6cMGGEK293k7NS0xqyU7o5r_UUwnNMcBS0ruDkJQ/exec?action=list-years
```

Une réponse saine est du JSON de cette forme :

```json
{"success":true,"years":["2025-2026","2026-2027"],"current":"2026-2027"}
```

- Vous voyez ce JSON → l'API vit, le problème est ailleurs.
- Vous voyez une **page de connexion Google** ou « Vous avez besoin d'une
  autorisation » → le déploiement n'est plus public. Dans Apps Script :
  Gérer les déploiements → crayon → « Qui a accès » = **Tout le monde**.
- Vous voyez `{"success":false,"error":"Action non reconnue (GET)"}` → l'URL est
  bonne mais le code déployé est une version qui ignore `list-years`. Rebasculer
  sur la bonne version (§ 3).
- **Rien du tout, ou une attente sans fin** → connexion locale, ou coupure côté
  Google. Testez une autre page web avant d'accuser l'application.

Pour tester le chargement d'une année précise :

```
…/exec?action=list&year=2026-2027
```

Réponse saine : `{"success":true,"data":[…],"year":"2026-2027"}`.
Un onglet d'année qui n'existe pas encore renvoie une liste vide, pas une
erreur — ce n'est donc pas un symptôme de panne.

### Question 3 — Les écritures passent-elles ?

Le site affiche les projets mais refuse d'enregistrer.

- Message **« Session expirée – veuillez vous reconnecter »** ou
  **« Authentification requise »** → la session dure 8 heures (`SESSION_HOURS`).
  Se déconnecter, se reconnecter. C'est la cause la plus fréquente et la moins
  grave.
- Message **« Token invalide ou expire »** → rien à voir avec la session : c'est
  un lien de réinitialisation de mot de passe périmé (il vaut 24 heures). Refaire
  une demande depuis « Mot de passe oublié ».
- Message **« Action non reconnue (POST) »** → le backend n'est pas à jour (§ 5).
- Message **« Cette annee est archivee (lecture seule). Seul l'administrateur
  peut la modifier. »** (ou « … peut commenter. » sur un commentaire) → ce n'est pas
  une panne. L'utilisateur consulte une année antérieure. Le sélecteur d'année,
  en haut de page, doit revenir sur l'année courante.

Les traces sont dans l'onglet `Logs` du Sheet : chaque connexion et chaque
écriture y laissent une ligne (les simples consultations, elles, ne sont pas
tracées). C'est le premier endroit à regarder pour reconstituer ce qui s'est
passé.

---

## 5. Les pièges qui font perdre une heure

**« Action non reconnue (POST) »**
*Cause* : `Code.gs` a été modifié dans le dépôt, mais pas redéployé. Le front
appelle une action que le backend en production ne connaît pas.
*Correctif* : coller `Code.gs` dans l'éditeur Apps Script → Enregistrer →
**Déployer** → **Gérer les déploiements** → crayon → Version : **Nouvelle
version** → Déployer. Ce chemin conserve l'URL.

**Des accents transformés en `√©` dans le code déployé**
*Cause* : le shell tourne avec `LC_CTYPE=C`. `pbcopy < Code.gs` corrompt alors
chaque `é`. Rien ne casse visiblement : le script reste valide, seuls les
littéraux accentués sont faux — dont `VS_CATS` (les catégories de la vie
scolaire) et le statut `'Planifié'`. Les filtres cessent silencieusement de
correspondre.
*Correctif* :

```bash
LC_CTYPE=UTF-8 pbcopy < Code.gs
pbpaste | grep -o 'Planifié' | head -1 | xxd | tail -1   # doit finir par c3a9
```

**`git push` refusé en 403**
*Cause* : mauvais compte GitHub actif. `lyceefrancaisdetananarive` est un
**compte utilisateur**, pas une organisation ; l'authentification passe par `gh`
(jeton dans le trousseau macOS).
*Correctif* :

```bash
gh auth status
gh auth switch
```

**« Accès refusé » en ouvrant le Sheet**
*Cause* : le navigateur est connecté avec un autre compte Google (compte
personnel au lieu du compte établissement). Google affiche un refus d'accès et
non une demande de connexion, ce qui égare.
*Correctif* : changer de compte dans le navigateur, ou ouvrir le Sheet dans une
fenêtre de navigation privée avec le bon compte.

**Un lien vers un projet ouvre le mauvais projet**
*Cause* : les identifiants de projet repartent à `001` à chaque année scolaire.
`ID_Projet` seul ne désigne rien. Un lien n'est complet qu'accompagné de son
année, via le paramètre `?annee=` :

```
…/lft-suivi-projets/?annee=2025-2026#/detail/AEFE-001
```

Sans `?annee=`, l'application ouvre l'année courante et affiche soit un autre
projet portant le même identifiant, soit le message « Projet introuvable dans
l'année … ». Le paramètre n'est ajouté automatiquement que lorsqu'on ne consulte
pas l'année courante : un lien copié depuis l'année en cours cessera d'être
valable après le 4 juillet.

---

## 6. Qui contacter

Administrateur de l'application : **max.rafaliarison@aefe.fr**
(constante `ADMIN_EMAIL` dans `Code.gs`). Cette adresse reçoit les demandes de
suppression de compte : c'est son unique usage dans le code. Les notifications
automatiques de verrouillage et de déverrouillage d'un projet partent, elles,
vers le créateur du projet et non vers l'administrateur.

Le droit d'écrire dans une année archivée n'est pas attaché à cette adresse mais
au **rôle** `admin`, vérifié côté serveur par `isAdmin(user)` : c'est le rôle du
compte connecté qui décide, quelle que soit son adresse.

Aucune autre adresse de contact ne figure dans le code. La seule autre adresse
qu'on y trouve, `admin@egd.mg`, est le compte d'amorçage créé au premier
lancement lorsque l'onglet `Utilisateurs` n'existe pas encore : ce n'est pas
un contact.

---

## 7. Ce qu'il ne faut surtout pas faire

- **Ne pas exécuter `InitData.gs`.** C'est le script d'amorçage d'origine, écrit
  pour un onglet `Projets` non daté qui n'existe plus depuis l'archivage par
  année. `populateAllData()` efface le contenu de l'onglet cible avant de le
  repeupler avec des données de démonstration. Il refuse aujourd'hui de partir :
  le drapeau `AUTORISER_AMORCAGE_DESTRUCTIF`, en tête du fichier, vaut `false` et
  la fonction lève une erreur. **Ne pas passer ce drapeau à `true`.** Ce fichier
  n'a plus aucun usage.
- **Ne pas créer un « Nouveau déploiement ».** Cela génère une **nouvelle URL**
  d'API. Le site continuerait d'appeler l'ancienne et tomberait en panne. On
  passe toujours par **Gérer les déploiements → crayon → Nouvelle version**, qui
  conserve l'URL.
- **Ne pas relancer `migrateToYearlySheets()`.** La migration vers les onglets
  annuels a été faite le 05/06/2026.
- **Ne pas renommer un onglet du Sheet.** Les noms sont calculés
  (`Projets_<année>`, `Commentaires_<année>`) et les trois onglets non datés sont
  référencés en dur. Un onglet renommé est un onglet invisible pour l'API.
- **Ne pas supprimer ni renommer une colonne.** Le code retrouve chaque champ par
  son **nom d'en-tête** (`headers.indexOf('ID_Projet')`, etc.). Une colonne
  renommée ou supprimée n'est plus reconnue : son contenu cesse simplement d'être
  écrit, sans aucun message d'erreur — la saisie paraît réussir et la donnée est
  perdue. Si c'est `ID_Projet` qui est touchée, plus aucune
  modification ne trouve sa ligne et l'application répond « Projet introuvable ».
- **Ne pas écrire de mot de passe ni de jeton dans un document, un commentaire de
  code ou un message.**

---

## Contexte local

Connexion lente et intermittente, coupures de courant fréquentes. Deux
conséquences pratiques :

- Avant une manipulation Apps Script, vérifiez que vous avez de quoi la terminer.
  Un déploiement interrompu au milieu laisse le service dans l'état précédent —
  ce n'est pas grave — mais un collage de `Code.gs` interrompu, lui, enregistre
  un fichier tronqué. N'enregistrez qu'après avoir vérifié que le collage est
  complet.
- Un « ça ne charge pas » est souvent un problème de réseau et non de code.
  Testez l'URL `?action=list-years` du § 4 avant d'engager quoi que ce soit.
