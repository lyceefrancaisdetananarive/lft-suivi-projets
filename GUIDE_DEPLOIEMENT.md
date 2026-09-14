# Guide de déploiement — LFT Suivi des projets

> **Avertissement — cette installation est en production.**
>
> Le Google Sheet contient les projets réels de l'établissement, les comptes des
> utilisateurs et les journaux d'activité. Ce guide décrit comment **faire évoluer
> l'installation existante**, jamais comment en créer une nouvelle. Il n'y a
> aucune étape d'initialisation à rejouer : tout est déjà en place.
>
> **Ne jamais exécuter `InitData.gs`.** Ce script d'amorçage date de la première
> version. Sa fonction `populateProjets()` commence par vider l'onglet cible
> (`InitData.gs:72` — `clearContent()` sur toutes les lignes sous l'en-tête) puis
> y réécrit un jeu de démonstration. Il vise en plus un onglet `Projets` non daté,
> qui n'existe plus depuis l'archivage par année scolaire.
>
> Deux protections existent. Le fichier n'est pas déployé : le projet Apps Script
> ne contient que `Code.gs`, `InitData.gs` ne subsiste que dans le dépôt git. Et
> **chacun** de ses points d'entrée — `populateAllData()`, `populateProjets()`,
> `populateUsers()`, `populateEmailsAutorises()` — appelle `refuserSiNonAutorise()`
> et lève une exception tant que la constante `AUTORISER_AMORCAGE_DESTRUCTIF`
> (`InitData.gs:29`) vaut `false`. Le garde couvre chaque fonction, et non le seul
> point d'entrée principal, parce que l'éditeur Apps Script permet de lancer
> n'importe quelle fonction depuis son sélecteur. Le fichier est conservé pour
> mémoire, et pour cette seule raison.

## Ce qui compose l'installation

| Élément | Où | Rôle |
|---|---|---|
| `index.html` | dépôt GitHub, publié par GitHub Pages | l'application entière : CSS, HTML et JS dans un seul fichier, sans build ni framework |
| `Code.gs` | projet Apps Script lié au Google Sheet | l'API (routage `doGet` / `doPost`, `Code.gs:434` et suivantes) |
| Google Sheet | Drive du compte propriétaire | la base de données |
| `Signature.gs` | projet Apps Script **uniquement** (non versionné dans git) | la bannière de signature de l'administrateur, en base64, jointe aux courriels d'identifiants |

Site en ligne : <https://lyceefrancaisdetananarive.github.io/lft-suivi-projets/>

Google Sheet de production : identifiant `1WIroVN7v0fEXMXh0Ldg97Y1nLlGLizC10TJKTlM59gg`.
C'est **le seul** classeur en service. Si un document ou un signet vous conduit
vers un autre identifiant, c'est un vestige d'une version antérieure : ne rien y
écrire.

Le projet Apps Script est **lié au Sheet**, pas autonome. On n'y accède donc pas
par la liste des projets Apps Script mais par le Sheet lui-même :
**Extensions → Apps Script**. Le projet s'appelle « Projet sans titre » ; c'est
bien le bon.

---

## 1. Déployer une modification du site (front)

C'est le cas courant : toute modification de `index.html` (interface, textes,
logique côté client) part par git.

```bash
cd ~/Documents/lft-suivi-projets
git add index.html
git commit -m "Décrire la modification"
git push origin main
```

GitHub Pages republie automatiquement. Le dépôt ne contient aucun workflow GitHub
Actions : la publication se fait par le mode « déploiement depuis une branche »,
sur `main`, à la racine (`/`) — c'est le réglage enregistré côté GitHub, lisible
dans **Settings → Pages** du dépôt. Comptez quelques minutes entre le `push` et
la mise en ligne.

**Si `git push` renvoie une erreur 403**, le compte GitHub actif n'est pas le bon.
`lyceefrancaisdetananarive` est un **compte utilisateur**, pas une organisation ;
l'authentification passe par `gh`, avec le jeton dans le trousseau macOS :

```bash
gh auth status     # quel compte est actif ?
gh auth switch     # basculer sur lyceefrancaisdetananarive
```

**Piège du cache navigateur.** L'application est un fichier unique servi par
GitHub Pages avec un en-tête `cache-control: max-age=600`, soit dix minutes de
cache navigateur. Après un déploiement, un simple rechargement affiche souvent
encore l'ancienne version, et l'on croit à tort que le déploiement a échoué.
Vérifiez toujours par un rechargement forcé :
**⌘⇧R** (macOS) ou **Ctrl+F5** (Windows). En cas de doute, ouvrez le site dans une
fenêtre de navigation privée.

---

## 2. Déployer une modification du backend

Le déploiement du backend est **manuel** : il n'y a pas de `clasp`, pas de
synchronisation automatique entre le dépôt et l'éditeur Apps Script. Le fichier
`Code.gs` du dépôt est la référence ; l'éditeur en reçoit une copie.

### 2.1 Préparer le presse-papiers

**Ne jamais faire `pbcopy < Code.gs` sans forcer l'encodage.** Le shell tourne
avec `LC_CTYPE=C` : `pbcopy` traite alors le fichier comme du Mac OS Roman et non
comme de l'UTF-8. Les deux octets `c3 a9` du `é` deviennent deux caractères, `√`
et `©`, et tout `é` arrive dans l'éditeur sous la forme `√©`. Le code
reste syntaxiquement valide et se déploie sans la moindre erreur — seuls les
littéraux accentués sont faux. Concrètement, `VS_CATS` (`Code.gs:59`,
`'Clubs et activités'`) ne reconnaît plus les catégories de la vie scolaire, et le
statut par défaut `'Planifié'` (`Code.gs:1348`) est écrit corrompu dans la feuille.
Ce piège a réellement corrompu un déploiement.

```bash
cd ~/Documents/lft-suivi-projets
LC_CTYPE=UTF-8 pbcopy < Code.gs
```

Contrôle obligatoire avant de coller :

```bash
LC_CTYPE=UTF-8 pbpaste | grep -o "Planifié" | head -1 | xxd
```

Attendu — les deux octets `c3a9`, le `é` en UTF-8, juste avant le saut de ligne
final `0a` :

```
00000000: 506c 616e 6966 69c3 a90a                 Planifi...
```

**Une sortie vide signifie corrompu**, et non « rien à signaler » : `grep` ne
trouve pas `Planifié` parce que le presse-papiers contient `Planif√©`. Pour vous
en assurer, élargissez le motif — vous lirez alors les octets du `√©` :

```bash
LC_CTYPE=UTF-8 pbpaste | grep -o "Planif.*" | head -1 | xxd
# 00000000: 506c 616e 6966 69e2 889a c2a9 0a   -> Planifi√© : corrompu
```

Dans ce cas, recommencez la commande `LC_CTYPE=UTF-8 pbcopy`.

**`LC_CTYPE=UTF-8` sur `pbpaste` n'est pas décoratif : sans lui le contrôle ment,
et il ment dans les deux sens.** `pbpaste` hérite lui aussi de `LC_CTYPE=C` et
refait la conversion en sens inverse. Un presse-papiers corrompu en `√©` est donc
relu en `c3a9` : le contrôle affiche la ligne attendue et l'on colle du code
corrompu en toute confiance. Inversement, un presse-papiers correct est relu sans
son `é` : la sortie est vide et l'on refait une copie pourtant déjà bonne. C'est
vérifié : `LC_CTYPE=C pbcopy` puis `LC_CTYPE=UTF-8 pbpaste` donne bien
`e288 9ac2 a9`, alors que le même presse-papiers relu par un `pbpaste` nu redonne
`c3a9`.

### 2.2 Coller et enregistrer

1. Ouvrir le Google Sheet de production, puis **Extensions → Apps Script**.
2. Ouvrir le fichier `Code.gs` dans l'éditeur.
3. Tout sélectionner (⌘A) et coller (⌘V) — on **remplace** le contenu, on n'ajoute pas.
4. Enregistrer (⌘S). Attendre la confirmation.

À ce stade, **rien n'est en ligne**. L'application web publiée continue de servir
l'ancienne version : Apps Script sert la version *déployée*, pas le code de
l'éditeur. C'est une sécurité, pas un dysfonctionnement.

### 2.3 Publier — le chemin qui conserve l'URL

1. **Déployer → Gérer les déploiements** *(surtout pas « Nouveau déploiement »)*.
2. Sélectionner le déploiement existant, puis cliquer sur l'**icône crayon**.
3. Champ **Version** : choisir **Nouvelle version**.
4. Ajouter une description courte (ce que change cette version).
5. Cliquer sur **Déployer**.

**Pourquoi ce chemin et pas l'autre.** « Nouveau déploiement » crée une seconde
application web avec une **URL différente**. L'ancienne URL continue de répondre
avec l'ancien code : le site ne tombe pas en panne, il reste simplement figé, et
l'on cherche longtemps une erreur qui n'existe pas. Il faudrait alors modifier la
constante `API_URL` (`index.html:1508`), commettre et repousser le front. « Gérer
les déploiements → crayon → Nouvelle version » met à jour le déploiement en place
et **conserve l'URL**.

URL de l'API en service, à titre de référence :

```
https://script.google.com/macros/s/AKfycbz23u7EaJP6ZczIqiwITDGb0FgpOp6cMGGEK293k7NS0xqyU7o5r_UUwnNMcBS0ruDkJQ/exec
```

---

## 3. Vérifier qu'un déploiement a pris

Ne vous fiez pas à l'apparence du site : le cache navigateur et le décalage entre
le code de l'éditeur et la version déployée rendent l'inspection visuelle peu
fiable. Utilisez un test **en lecture seule**, qui n'écrit rien et ne demande
aucune authentification.

L'action `list-years` est publique et servie en GET (`Code.gs:439`, handler
`Code.gs:1550`). Ouvrez dans le navigateur :

```
<API_URL>?action=list-years
```

soit, en toutes lettres :

```
https://script.google.com/macros/s/AKfycbz23u7EaJP6ZczIqiwITDGb0FgpOp6cMGGEK293k7NS0xqyU7o5r_UUwnNMcBS0ruDkJQ/exec?action=list-years
```

La réponse est du JSON de cette forme :

```json
{"success":true,"years":["2025-2026","2026-2027"],"current":"2026-2027"}
```

Trois lectures utiles :

- `"success":true` — le déploiement répond, le code n'a pas d'erreur au chargement.
- `current` — l'année scolaire calculée par le **serveur**. Elle doit correspondre
  à l'année attendue à la date du jour (voir la règle du 4 juillet, section 4). Si
  elle est fausse, c'est le serveur qui se trompe, pas le navigateur.
- `years` — la liste des onglets `Projets_*` existants. L'année courante y figure
  toujours, même si son onglet n'a pas encore été créé (`Code.gs:1563`).

Si la page affiche une erreur d'autorisation Google au lieu du JSON, le
déploiement n'est plus accessible à tout le monde : vérifiez dans **Gérer les
déploiements** que l'accès est réglé sur « Tout le monde » et l'exécution « en
tant que moi ».

Le numéro de version courant est visible dans **Déployer → Gérer les
déploiements** : notez-le après chaque publication, il sert au retour arrière
(section 5).

---

## 4. Ouvrir une nouvelle année scolaire

**Il n'y a rien à faire.** Aucune manipulation du Sheet, aucune fonction à
exécuter, aucun déploiement. C'est délibéré : la rentrée est le moment où
personne n'a le temps d'administrer un outil.

**La bascule est automatique le 4 juillet.** `currentSchoolYear()`
(`Code.gs:75`) lit la date à Antananarivo et compare au 4 juillet : avant, l'année
active est `(y-1)-y` ; à partir du 4 juillet, `y-(y+1)`. La même fonction existe
côté client, avec la même règle, pour que l'interface et le serveur ne divergent
jamais.

**L'onglet est créé à la première écriture.** La lecture d'une année sans onglet
renvoie une liste vide, pas une erreur (`Code.gs:768`). L'onglet
`Projets_<année>` n'est créé, avec ses 28 en-têtes, qu'au premier ajout ou à la
première reconduction (`ensureYearSheet()`, `Code.gs:109`). Autrement dit : le
4 juillet, l'application affiche une année vide ; le premier projet déclaré crée
l'onglet.

**Conséquence sur les liens.** Les identifiants de projet repartent à `001`
chaque année. Un lien ne désigne un projet qu'accompagné de son année, via le
paramètre `?annee=` que l'application ajoute automatiquement lorsqu'on consulte
une année autre que l'année courante (`index.html:1955`). Un lien vers un projet
d'archive copié sans ce paramètre ouvrira un projet différent.

### Transmettre les identifiants aux collègues

Les identifiants de rentrée ne s'envoient pas depuis l'application : `Code.gs`
contient une section **« BROUILLONS GMAIL »** qui dépose, dans la boîte Gmail de
l'administrateur, **un brouillon par enseignant et par CPE actif** de l'onglet
`Utilisateurs`. Rien n'est envoyé : chaque brouillon se relit et s'envoie à la
main depuis Gmail. Trois formulations sont choisies automatiquement — mot de passe
provisoire jamais changé (redonné tel quel), mot de passe personnalisé
(« identifiants inchangés »), compte créé à la rentrée (liste
`BROUILLONS_NOUVEAUX`).

1. Dans `Code.gs`, mettre à jour `BROUILLONS_ANNEE`, `BROUILLONS_ANNEE_PREC` et
   `BROUILLONS_NOUVEAUX` ; coller le fichier dans l'éditeur (§ 2.1–2.2). Aucun
   redéploiement n'est nécessaire : ces fonctions se lancent depuis l'éditeur.
2. Vérifier que le fichier **`Signature.gs`** est présent dans le projet Apps
   Script (menu Fichiers, à gauche). Il porte la bannière de signature encodée en
   base64 et n'est **pas** dans le dépôt git : s'il manque, le régénérer depuis
   `documents/signature_max_rafaliarison.png` (la commande figure en tête du
   fichier local) et l'ajouter au projet par **Fichiers → + → Script**, nom
   `Signature`.
3. Sélectionner `creerBrouillonsIdentifiants` dans la liste des fonctions,
   **Exécuter**. À la première exécution, Google demande l'autorisation Gmail
   (« Gérer les brouillons ») : la cocher. La fonction refuse de tourner sous un
   autre compte que `max.rafaliarison@egd.mg` et ne crée jamais de doublon.
4. Lire le **Journal d'exécution** : `Brouillons crees : N (A=…, B=…, C=…)`, puis
   ouvrir Gmail → Brouillons.

Pour retoucher le texte ou la mise en forme après coup : modifier
`composerCourrielIdentifiants()`, **incrémenter `BROUILLONS_MODELE`** (le nom de
la bannière jointe porte cette version et sert de marqueur « brouillon à
jour »), recoller `Code.gs`, puis exécuter `mettreAJourBrouillonsIdentifiants()`
— elle régénère les brouillons à l'ancienne version sans les renvoyer, saute
ceux déjà à jour et s'arrête d'elle-même avant la limite de six minutes d'Apps
Script : la relancer jusqu'à ce que le journal n'indique plus de restants. Sans
incrément de `BROUILLONS_MODELE`, elle ne refait rien.

### Reprendre les projets de l'année précédente

Depuis l'application, sans toucher au Sheet :

1. Se connecter, puis ouvrir l'année précédente avec le **sélecteur d'année**
   (bouton en haut à droite).
2. Un bandeau d'archive s'affiche, avec le bouton **« ♻️ Reprendre des projets »**.
   Tant que l'année courante compte moins de cinq projets, le tableau de bord
   propose un raccourci vers le même écran : **« ♻️ Reprendre des projets de
   `<année précédente>` »**, qui bascule d'année et ouvre la sélection d'un coup.
3. Cocher les projets à reconduire, puis valider : **« Reconduire la sélection
   vers `<année>` »**. L'écriture est groupée (une seule opération pour toute la
   sélection), ce qui compte sur une connexion lente.
4. Un projet peut aussi être reconduit seul, depuis sa fiche : **« ♻️ Reconduire
   pour `<année>` »**.

Deux garde-fous à connaître, pour ne pas les prendre pour des pannes :

- **On ne reconduit pas deux fois le même projet.** La colonne `Reconduit_De`
  porte `"<année source>/<ID source>"` ; les projets déjà repris sont signalés
  dans la liste et ne sont plus sélectionnables.
- **L'année cible est contrôlée par le serveur** (`targetYearError()`,
  `Code.gs:1586`). Tous les rôles autorisés peuvent reconduire vers l'**année
  courante** ; seules la direction et l'administration peuvent viser l'**année
  suivante**. Un enseignant qui pourrait ouvrir une année future créerait un
  onglet aussitôt publié à tous les visiteurs par `list-years` — d'où la
  restriction.

Enfin, une année antérieure passe en **lecture seule** : tous les gestionnaires
d'écriture refusent la modification d'une archive, sauf pour l'administrateur.
Ce n'est pas un bogue de permissions, c'est la protection de l'archive.

---

## 5. Revenir en arrière

Règle : **on revient en arrière d'abord, on comprend ensuite.** Chaque minute
passée à diagnostiquer est une minute pendant laquelle personne ne peut
travailler.

### Front

```bash
cd ~/Documents/lft-suivi-projets
git log --oneline -5          # repérer le commit fautif
git revert <sha>              # crée un commit qui annule le précédent
git push origin main
```

`git revert` est préférable à `git reset` : il n'efface pas l'historique et se
pousse sans forcer. Comptez à nouveau quelques minutes, puis vérifiez avec ⌘⇧R.

### Backend

Le retour arrière ne passe pas par git : les versions antérieures sont conservées
par Apps Script lui-même.

1. Sheet → **Extensions → Apps Script**.
2. **Déployer → Gérer les déploiements**, icône **crayon**.
3. Champ **Version** : sélectionner dans la liste déroulante la **version
   antérieure** connue pour fonctionner (elles sont numérotées et datées).
4. **Déployer**.

L'URL est conservée, le site repasse immédiatement sur l'ancien code. On corrige
ensuite `Code.gs` dans le dépôt à tête reposée, avant de redéployer.

**Ce que le retour arrière ne défait pas** : les données déjà écrites dans le
Sheet. Redéployer une version antérieure du code ne restaure aucune ligne. Pour
les données, la ressource est l'historique des versions du Google Sheet
(**Fichier → Historique des versions**), et la corbeille de l'application pour
les projets supprimés.

---

## 6. Accès nécessaires

Deux accès, et deux seulement. Sans eux, aucune des procédures ci-dessus n'est
possible.

**Le compte Google propriétaire du Google Sheet.** Le projet Apps Script étant
lié au classeur, ses droits sont ceux du classeur. Depuis un autre compte, même
avec un accès en lecture au Sheet, l'éditeur Apps Script refuse l'ouverture par un
message d'autorisation : ce n'est pas une panne, c'est le compte actif qui n'est
pas le bon. Vérifiez le
compte dans le coin supérieur droit du navigateur, et méfiez-vous des sessions
Google multiples — le mauvais compte est la cause la plus fréquente de ce message.

**Le compte GitHub `lyceefrancaisdetananarive`**, avec droit de poussée sur
`lyceefrancaisdetananarive/lft-suivi-projets`. C'est un **compte utilisateur**, pas
une organisation. L'authentification passe par `gh` ; le jeton est dans le
trousseau macOS. Un `git push` en 403 signifie presque toujours qu'un autre compte
GitHub est actif : `gh auth status`, puis `gh auth switch`.

Aucun mot de passe ni jeton ne figure dans ce document, ni ne doit y être ajouté.
Les identifiants applicatifs (comptes administrateur, direction, vie scolaire,
enseignants) se gèrent depuis la page **Administration** de l'application —
réservée au seul rôle `admin` — jamais en écrivant directement dans l'onglet
`Utilisateurs`.

---

## Rappels de contexte

- **Connexion lente et coupures de courant.** Un déploiement backend interrompu
  entre l'enregistrement (⌘S) et la publication laisse le site sur l'ancienne
  version : c'est sans danger, il suffit de reprendre à l'étape 2.3. Un `git push`
  interrompu peut en revanche laisser un commit local non poussé — vérifiez avec
  `git status` avant de conclure quoi que ce soit.
- **Ne pas éditer le Sheet à la main** pour ce que l'application sait faire. Les
  écritures passant par l'API sont journalisées, contrôlées par rôle et nettoyées
  contre l'injection de formules ; une saisie directe échappe à tout cela.
- Les onglets non datés — `Utilisateurs`, `Emails_Autorises`, `Logs` — sont
  communs à toutes les années. Seuls `Projets_<année>` et `Commentaires_<année>`
  sont dupliqués par année scolaire.
