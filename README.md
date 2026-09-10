# LFT — Suivi des projets d'établissement

Application de recensement et de suivi des projets pédagogiques du **Lycée Français de
Tananarive** (établissement en gestion directe, réseau AEFE, Madagascar).

En ligne : <https://lyceefrancaisdetananarive.github.io/lft-suivi-projets/>

---

## 1. Ce que c'est

L'application tient le catalogue des projets d'établissement d'une année scolaire :
sorties, clubs, projets AEFE ou Zone Océan Indien, actions de l'internat, projets
institutionnels. Chaque fiche rattache le projet à un axe du **Projet d'Établissement
2025-2030**, précise les niveaux et disciplines mobilisés, les dates, les partenariats,
les ressources nécessaires et la modalité de valorisation.

**Pour qui.** Les enseignants saisissent et mettent à jour leurs propres projets. La vie
scolaire gère les clubs et l'internat. La direction dispose d'une vue d'ensemble, valide
les fiches en les verrouillant, exporte et prépare l'année suivante. Le catalogue est
consultable **sans compte** : un parent, un partenaire ou un inspecteur peut lire les
fiches, sans pouvoir rien y modifier.

**Ce que cela remplace.** Le recensement se faisait par fiches Word, une par projet,
transmises puis compilées à la main : pas d'identifiant stable, pas de trace de qui a
modifié quoi, pas de moyen de savoir si la version que l'on lit est la dernière. Ici,
chaque projet a un identifiant, un propriétaire, une date de dernière modification et un
fil de commentaires.

---

## 2. Architecture

```
   Navigateur                GitHub Pages              Google Apps Script          Google Sheets
  (enseignant,   ──GET/POST──▶  index.html   ──fetch──▶   Code.gs (doGet /   ──▶   1 onglet par
   direction,     HTTPS         fichier          JSON      doPost) — API web        année scolaire
   visiteur)                    statique unique            déployée « Tout le
                                                           monde », exécutée
                                                           sous le compte admin
```

Trois pièces, aucune quatrième :

| Fichier | Rôle |
| --- | --- |
| `index.html` (~3 800 lignes) | L'application entière : CSS, HTML et JavaScript dans un seul fichier. Aucun build, aucun framework, aucune dépendance installée. Servi tel quel par GitHub Pages. |
| `Code.gs` (~1 900 lignes) | L'API. Un projet Apps Script **lié au Google Sheet** (Sheet → Extensions → Apps Script), déployé en application web. `doGet` sert la lecture, `doPost` tout le reste. |
| `InitData.gs` | **Obsolète et destructeur.** Script d'amorçage d'origine : il vide l'onglet cible avant de le repeupler. Conservé pour mémoire, à ne plus jamais exécuter. |

### Pourquoi ce choix

- **Aucun serveur à administrer.** Pas de VPS, pas de conteneur, pas de certificat à
  renouveler, pas de mise à jour de sécurité à suivre. Le lycée n'a pas d'équipe
  d'exploitation ; un service qui demande de l'entretien mensuel finit par tomber.
- **Hébergement gratuit et durable.** GitHub Pages pour le site, Apps Script et Sheets
  dans l'espace Google de l'établissement, déjà payé.
- **La base reste éditable à la main.** La direction peut ouvrir le Google Sheet, trier,
  filtrer, corriger une faute de frappe dans quarante lignes d'un coup, ou récupérer un
  export. Aucune base « vraie » n'offre cela sans intermédiaire technique.
- **Un seul fichier à déployer côté site.** Pas de chaîne de build à réparer un an plus
  tard quand une dépendance a disparu.

### Ce que cela coûte

- **Déploiement backend manuel.** Toute modification de `Code.gs` doit être recopiée dans
  l'éditeur Apps Script et redéployée à la main (voir §9). Aucune intégration continue.
- **Quotas Apps Script.** Un compte Google Workspace est plafonné (temps d'exécution par
  requête, nombre de courriels envoyés par jour, appels par utilisateur). Les
  notifications par courriel et l'écriture cellule par cellule sont les postes qui
  consomment le plus.
- **Latence.** Chaque requête traverse l'infrastructure Apps Script, qui lit ensuite le
  Sheet. Comptez de l'ordre de la seconde en conditions normales — davantage sur une
  connexion malgache lente. C'est la raison pour laquelle l'application charge la liste
  des projets **une fois** au démarrage et travaille ensuite en mémoire.
- **Pas de transaction.** Deux écritures simultanées sur la même ligne s'écrasent
  mutuellement. À l'échelle d'un établissement, le risque est accepté.

---

## 3. Structure des données

Le classeur de production porte l'identifiant `1WIroVN7v0fEXMXh0Ldg97Y1nLlGLizC10TJKTlM59gg`.

### Onglets

| Onglet | Colonnes | Contenu |
| --- | --- | --- |
| `Projets_<année>` | 28 | Les projets d'une année scolaire. Un onglet par année (`Projets_2025-2026`, `Projets_2026-2027`…). Créé automatiquement, avec ses en-têtes, à la première écriture concernant l'année. |
| `Commentaires_<année>` | 5 | `ID_Projet`, `Date_Heure`, `Email`, `Nom_Prenom`, `Commentaire`. Un onglet par année. Commentaire plafonné à 1 000 caractères. |
| `Utilisateurs` | 11 | `Email`, `Mot_de_Passe` (empreinte SHA-256 en hexadécimal), `Role`, `Nom`, `Prenom`, `Reset_Token`, `Reset_Expiry`, `Mdp_Initial`, `First_Login`, `Session_Token`, `Session_Expiry`. **Non daté** : les comptes traversent les années. |
| `Emails_Autorises` | 1 | Liste blanche des adresses `@egd.mg` autorisées à créer un compte. **Non daté.** |
| `Logs` | 10 | `Date_Heure`, `Email`, `Role`, `Action`, `Detail`, `Pays`, `Ville`, `OS`, `Navigateur`, `Appareil`. **Non daté.** Les 500 dernières lignes sont consultables depuis l'administration. |

### Les 28 colonnes de `Projets_<année>`

L'ordre fait foi : il est défini une seule fois par la constante `PROJETS_HEADERS` dans
`Code.gs`, et le code lit toujours les colonnes par `headers.indexOf(...)`, jamais par
position codée en dur. Ajouter une colonne au milieu ne casse donc rien.

| # | Colonne | Rôle |
| --- | --- | --- |
| 1 | `ID_Projet` | Identifiant `PREFIXE-NNN` (`LFT-014`, `CLUB-003`…). **Unique dans l'année seulement.** |
| 2 | `Nom_Projet` | Intitulé affiché partout. |
| 3 | `Categorie` | Détermine la couleur, l'icône, le préfixe d'identifiant et les droits de la vie scolaire. |
| 4 | `Echelle` | `Réseau AEFE`, `Zone Océan Indien`, `Établissement` ou `National`. |
| 5 | `Axe_Projet_Etablissement` | Axe 1, 2 ou 3 du Projet d'Établissement 2025-2030. |
| 6 | `Sous_Axe` | Sous-axe, en texte libre. |
| 7 | `Disciplines_Mobilisees` | Texte libre. |
| 8 | `Niveaux_Concernes` | Niveaux, saisis par cases à cocher puis stockés en texte. |
| 9 | `Description` | Présentation du projet. |
| 10 | `Objectifs_Pedagogiques` | Objectifs visés. |
| 11 | `Statut` | `Planifié` à la création. **Valeur d'archive** : l'affichage recalcule toujours le statut à partir des dates (voir plus bas). |
| 12 | `Priorite` | `Haute`, `Moyenne` ou `Basse`. |
| 13 | `Date_Debut` | Format `AAAA-MM-JJ`. Alimente la chronologie et le statut calculé. |
| 14 | `Date_Fin` | Idem. |
| 15 | `Partenariats` | Partenaires associés. |
| 16 | `Ressources_Necessaires` | Moyens demandés. |
| 17 | `Modalite_Valorisation` | Restitution, exposition, publication… |
| 18 | `Enseignant_Referent` | Texte libre — **et porteur de droits** : y figurer donne le droit de modifier la fiche (voir §5). |
| 19 | `Created_By` | Courriel du créateur. Jamais réécrit par une modification. |
| 20 | `Deleted` | `1` = en corbeille. La suppression courante est logique, pas physique. |
| 21 | `Deleted_By` | Qui a mis en corbeille. |
| 22 | `Deleted_Date` | Quand. |
| 23 | `Locked` | `1` = fiche validée et verrouillée par la direction. |
| 24 | `Locked_By` | Qui a verrouillé. |
| 25 | `Locked_Date` | Quand. |
| 26 | `Last_Modified_By` | Dernier modificateur. Renseigné par le serveur, jamais par le client. |
| 27 | `Last_Modified_Date` | Horodatage `AAAA-MM-JJ hh:mm:ss`, fuseau `Indian/Antananarivo`. |
| 28 | `Reconduit_De` | `"<année source>/<ID source>"` pour un projet reconduit ; vide sinon. Trace la filiation et empêche la double reconduction. |

### Préfixe d'identifiant

Le préfixe se déduit de la catégorie (`prefixForCategory`) :

| Catégorie contient… | Préfixe |
| --- | --- |
| `AEFE` | `AEFE` |
| `Zone` | `ZOI` |
| `institution` | `INST` |
| `Clubs` | `CLUB` |
| `Internat` | `INT` |
| tout le reste | `LFT` |

### Statut : stocké, mais recalculé à l'affichage

Le formulaire ne demande pas le statut. Le client le déduit des dates
(`computeStatus`) : aucune date → `Planifié` ; aujourd'hui avant `Date_Debut` →
`Planifié` ; après `Date_Fin` → `Terminé` ; `Date_Debut` atteinte ou dépassée →
`En cours` ; dans tous les autres cas → `Planifié`. La colonne `Statut` est
malgré tout renseignée à `Planifié` à la création — sans quoi elle resterait vide dans la
feuille **et dans l'export CSV**, ce qui rend le tableur illisible pour qui ne passe pas
par l'application.

---

## 4. Archivage par année scolaire

### Un onglet par année

Les projets de 2025-2026 sont dans `Projets_2025-2026`, ceux de 2026-2027 dans
`Projets_2026-2027`. Idem pour les commentaires. Les onglets `Utilisateurs`,
`Emails_Autorises` et `Logs` ne sont pas datés.

### La bascule du 4 juillet

`currentSchoolYear()` — **présente des deux côtés, avec la même règle** — détermine
l'année active. Avant le 4 juillet, l'année est `(y-1)-y` ; à partir du 4 juillet 00h00,
elle devient `y-(y+1)`. Seule la date d'entrée diffère : le serveur la prend dans le
fuseau `Indian/Antananarivo`, et non dans celui de la machine qui exécute le script ; le
client, lui, s'en remet à l'horloge locale du navigateur. C'est le serveur qui fait foi.

Le 4 juillet, l'année en cours devient donc une archive et la nouvelle année s'ouvre. La
date est postérieure à la fin des cours et antérieure à la préparation de la rentrée.

### L'archive est en lecture seule

Une année antérieure à l'année courante est une archive. **Toute écriture y est réservée à
l'administrateur** : ajout, modification, corbeille, restauration, suppression définitive,
verrouillage, déverrouillage et commentaire. La garde est posée sur chaque handler
d'écriture du serveur (`isArchivedYear(year) && !isAdmin(user)`), pas seulement dans
l'interface : un appel direct à l'API est refusé de la même manière.

### Les identifiants repartent à 001 chaque année

`LFT-001` existe en 2025-2026 **et** en 2026-2027, et désigne deux projets différents.
Conséquence pratique, à retenir avant de partager un lien :

> **Un lien ne désigne un projet qu'accompagné de son année.** Dès que l'on consulte une
> année autre que l'année courante, l'application ajoute `?annee=` à l'URL et l'y conserve
> à travers la navigation (`yearQuery()`) ; sur l'année courante, l'URL n'en porte pas. Un lien
> `#/detail/LFT-001` sans `?annee=` ouvre donc la fiche de l'année courante — ou revient
> au tableau de bord avec le message « Projet introuvable dans l'année … » si elle n'y
> existe pas.

### Reconduction

Reconduire, c'est recopier une fiche vers une autre année : contenu repris,
**dates vidées**, statut remis à `Planifié`, `Created_By` mis au nom de celui qui
reconduit, corbeille et verrou remis à zéro, et `Reconduit_De` renseigné avec
`"<année source>/<ID source>"`.

Deux actions :

- `reconduct` — un projet, depuis sa fiche.
- `reconduct-batch` — une sélection entière (200 projets au maximum), depuis la vue
  d'année, avec un rapport final distinguant les fiches créées, ignorées (déjà reprises)
  et en erreur. Les projets en corbeille de l'année source sont écartés.

`Reconduit_De` sert d'index : avant d'écrire, le serveur relit la colonne dans l'onglet
cible. La reconduction unitaire **refuse** un projet déjà repris (sauf demande explicite
de forcer, paramètre `force`) ; la reconduction en lot l'**écarte** et le signale dans la
liste des fiches ignorées. Sans cette colonne, relancer une reconduction en lot créerait
silencieusement un doublon de chaque fiche.

**Année cible autorisée** (`targetYearError`) : l'année courante pour tous ; l'année
suivante pour la direction et l'administration seulement. Toute autre année est refusée.

---

## 5. Rôles et droits

| Rôle | Périmètre |
| --- | --- |
| `admin` | Tout, y compris l'écriture dans les archives et la gestion des comptes. |
| `direction` | CRUD sur tous les projets de l'année courante, corbeille, verrouillage, ouverture de l'année suivante, export. |
| `vie_scolaire` | CRUD limité aux catégories « Clubs et activités » et « Projets de l'Internat ». |
| `enseignant` | Ses propres projets (`Created_By`), ou ceux dont il est **enseignant référent**. |

### Tableau croisé

| Action | admin | direction | vie_scolaire | enseignant | visiteur |
| --- | :---: | :---: | :---: | :---: | :---: |
| Consulter les fiches et les commentaires | ✔ | ✔ | ✔ | ✔ | ✔ |
| Créer un projet | ✔ | ✔ | ses catégories | ✔ | — |
| Modifier un projet | ✔ | ✔ | ses catégories | le sien ou celui dont il est référent | — |
| Modifier un projet **verrouillé** | ✔ | ✔ | — | — | — |
| Mettre en corbeille | ✔ | ✔ | ses catégories | le sien ou celui dont il est référent | — |
| Restaurer depuis la corbeille | ✔ | ✔ | — | — | — |
| Supprimer définitivement | ✔ | ✔ | — | — | — |
| Verrouiller / déverrouiller | ✔ | ✔ | — | — | — |
| Commenter | ✔ | ✔ | ✔ | ✔ | — |
| Reconduire vers l'année courante | ✔ | ✔ | ses catégories | ✔ | — |
| Reconduire vers l'année **suivante** | ✔ | ✔ | — | — | — |
| Exporter en CSV | ✔ | ✔ | — | — | — |
| Écrire dans une **année archivée** | ✔ | — | — | — | — |
| Gérer les comptes, les rôles, la liste blanche, les journaux | ✔ | — | — | — | — |

### Deux précisions qui comptent

**« Enseignant référent » est un droit, pas une mention décorative.** `isReferentOf()`
compare le nom et le prénom de l'utilisateur au contenu texte de la colonne
`Enseignant_Referent`, après suppression des accents et passage en majuscules, avec
tolérance sur les noms composés (`MARIN-CUDRAZ`). Écrire quelqu'un comme référent lui
donne donc le droit de modifier et de mettre en corbeille la fiche. C'est voulu — un
projet a souvent plusieurs porteurs — mais il faut le savoir avant de remplir le champ.

**Le verrou protège de la modification, pas de la corbeille.** `handleUpdate` refuse la
modification d'une fiche verrouillée à quiconque n'est pas admin ou direction ;
`handleDelete` ne teste pas le verrou. Un enseignant peut donc envoyer à la corbeille une
fiche que la direction a validée. Le geste est réversible (la corbeille garde la ligne) et
tracé dans les journaux, mais il n'est pas bloqué.

---

## 6. API

Une seule URL, celle du déploiement Apps Script, avec `?action=` :

```
https://script.google.com/macros/s/AKfycbz23u7EaJP6ZczIqiwITDGb0FgpOp6cMGGEK293k7NS0xqyU7o5r_UUwnNMcBS0ruDkJQ/exec
```

Elle est reprise dans la constante `API_URL` d'`index.html`.

### GET — lecture seule, publique

| Action | Paramètres | Rôle minimum | Réponse |
| --- | --- | --- | --- |
| `list` | `year` | aucun | Les projets de l'année, corbeille exclue. Année inexistante → liste vide, pas une erreur. |
| `list-comments` | `id`, `year` | aucun | Les commentaires d'un projet, du plus récent au plus ancien. |
| `list-years` | — | aucun | Les années disponibles (les onglets `Projets_*`) et l'année courante. |

### POST — tout le reste

Le corps de la requête est du JSON ; le client y injecte systématiquement `token` et
`year`.

| Action | Rôle minimum | Effet |
| --- | --- | --- |
| `login` | aucun | Vérifie le couple courriel / mot de passe, ouvre une session de 8 h. |
| `register` | aucun | Crée un compte : adresse `@egd.mg` **et** présente dans `Emails_Autorises`. Mot de passe provisoire généré. |
| `forgot-password` | aucun | Envoie un lien de réinitialisation valable 24 h. |
| `confirm-reset` | jeton du courriel | Fixe le nouveau mot de passe. |
| `change-password` | connecté | Change le mot de passe (8 caractères minimum, une majuscule, une minuscule, un chiffre) et renouvelle le jeton de session. |
| `add` | connecté | Crée un projet. `table=Utilisateurs` → **admin**. |
| `update` | connecté | Modifie un projet, selon les règles du §5. |
| `delete` | connecté | Met en corbeille. `table=Utilisateurs` → **admin**, et suppression définitive de la ligne. |
| `restore` | admin / direction | Sort de la corbeille. |
| `permanent-delete` | admin / direction | Supprime la ligne. Irréversible. |
| `lock-project` / `unlock-project` | admin / direction | Verrouille ou déverrouille une fiche. |
| `reconduct` | connecté | Reconduit un projet (cible contrôlée par `targetYearError`). |
| `reconduct-batch` | connecté | Reconduit une sélection, 200 maximum, en une écriture. |
| `add-comment` | connecté | Ajoute un commentaire (1 000 caractères maximum). |
| `list-trash` | admin / direction | Les projets en corbeille de l'année. |
| `export` | admin / direction | CSV de l'année, séparateur `;`, corbeille exclue. Les colonnes `Deleted`, `Deleted_By`, `Deleted_Date`, `Locked_By`, `Locked_Date`, `Last_Modified_By` et `Last_Modified_Date` ne sont pas exportées ; `Locked` l'est. |
| `list-users` | admin | Les comptes, **sans** mot de passe ni jeton. |
| `get-logs` | admin | Les 500 derniers événements. |
| `backup-now` | admin | Duplique le classeur dans le dossier Drive de sauvegarde, puis purge les copies excédentaires. |
| `backup-status` | admin | Nombre de copies, date de la plus récente, présence du déclencheur nocturne. N'écrit rien. |
| `list-emails` / `add-email` / `delete-email` | admin | Liste blanche des adresses `@egd.mg`. |
| `change-role` | admin | Change le rôle d'un compte. Impossible sur soi-même. |
| `admin-reset-password` | admin | Réinitialise un mot de passe et l'envoie par courriel. |
| `request-deletion` | connecté | Envoie une demande de suppression de compte à l'administrateur. |

Toutes les gardes de rôle sont **côté serveur**. L'interface masque les boutons, mais ce
n'est jamais elle qui protège : un appel direct à l'API subit les mêmes contrôles.

---

## 7. Sécurité

- **Jeton de session de 8 heures.** `login` génère un UUID (`Utilities.getUuid()`) stocké
  dans `Session_Token`, avec son expiration dans `Session_Expiry`. Chaque requête est
  authentifiée par ce jeton. Un jeton expiré est effacé de la feuille au moment où il est
  présenté. Le client conserve la même échéance dans `localStorage` et affiche « Session
  expirée ».
- **Le jeton ne passe jamais par l'URL.** Il voyage dans le corps du POST. Les URL sont
  journalisées par les intermédiaires ; les corps de requête, non.
- **Toute écriture passe par POST.** `doGet` n'expose que trois actions de lecture. Aucune
  modification n'est accessible depuis une simple URL — donc ni depuis un lien piégé, ni
  depuis un préchargement de navigateur.
- **Mots de passe.** Stockés en empreinte SHA-256, jamais en clair. `list-users` retire
  explicitement `Mot_de_Passe`, `Reset_Token`, `Reset_Expiry`, `Session_Token` et
  `Session_Expiry` avant de répondre.
- **Limitation des tentatives de connexion.** Cinq échecs pour une même adresse en quinze
  minutes bloquent la connexion (compteur dans `CacheService`, TTL 900 s). L'échec comme le
  blocage sont journalisés.
- **Inscription sur liste blanche.** Adresse en `@egd.mg` **et** présente dans
  `Emails_Autorises` : le domaine seul ne suffit pas. Le même contrôle de domaine
  s'applique à `forgot-password` et à l'ajout d'une adresse à la liste.
- **`sanitizeCell()` contre l'injection de formules.** Toute valeur texte commençant par
  `=`, `+`, `-` ou `@` est préfixée d'une apostrophe avant d'être écrite. Sans cela, un
  champ contenant `=IMPORTXML(...)` s'exécuterait à l'ouverture du Sheet par la direction,
  avec les droits de celle-ci : le tableur est un moteur de calcul, pas un stockage inerte.
- **`esc()` et `jsq()` côté client.** Les données venant du serveur sont échappées par
  `esc()` avant d'être insérées dans le DOM, et par `jsq()` dès qu'elles entrent dans un
  attribut `onclick`. Voir §8 pour la raison d'être de `jsq()`.
- **Journalisation.** Connexions, échecs, créations, modifications, suppressions,
  verrouillages, reconductions, changements de rôle. Le contexte enregistré est volontairement
  pauvre : système, navigateur, type d'appareil et **pays/ville déduits du seul fuseau
  horaire du navigateur** — aucune géolocalisation par adresse IP.

---

## 8. Décisions techniques, avec leur motif

### Un seul fichier `index.html`, sans build

Il n'y a ni `npm install`, ni bundler, ni étape de compilation. Déployer, c'est copier un
fichier. Le motif est la durée de vie : ce projet doit rester modifiable par un
successeur qui n'a peut-être ni Node ni l'envie de réparer une chaîne d'outils
abandonnée. Un fichier unique s'ouvre dans n'importe quel éditeur et se relit
entièrement. Le coût — un fichier de près de 200 Ko et 3 800 lignes — est accepté : il est
servi une fois puis mis en cache, ce qui est justement l'économie recherchée sur une
connexion lente.

### Google Sheets plutôt qu'une vraie base

Une base relationnelle serait techniquement supérieure, et pratiquement pire ici. Le
Sheet donne gratuitement ce qu'il aurait fallu construire : une interface d'administration
(la direction ouvre le classeur et corrige), un historique de versions natif, un partage
géré par les comptes Google de l'établissement, un export. Le prix est réel — pas de
transaction, pas de contrainte d'intégrité, lecture de la feuille entière à chaque appel —
mais aucun de ces défauts ne se voit à l'échelle de quelques dizaines de projets par an.

### Des onglets datés plutôt qu'une colonne « année »

Une colonne `Annee` dans un onglet unique aurait été plus simple à écrire. Elle aurait été
plus difficile à vivre :

- **Le volume ne cesse jamais de croître.** Chaque lecture parcourt toute l'histoire de
  l'établissement pour n'afficher qu'une année. Avec des onglets datés, une année ne
  ralentit pas les suivantes, et un onglet ancien peut être exporté puis retiré du
  classeur sans toucher au reste.
- **L'archive devient tangible.** Une année révolue est un onglet qu'on ne touche plus, et
  non des lignes mêlées aux lignes vivantes où un filtre mal posé fait des dégâts.
- **La direction lit le classeur directement.** Un onglet par année correspond à sa façon
  de penser le travail ; un filtre à poser sur une colonne, non.

Le prix à payer est assumé : les identifiants repartent à `001` chaque année, donc un lien
doit porter son `?annee=`. C'est écrit en clair au §4 parce que c'est le seul piège que
cette décision introduit.

### `jsq()` en plus de `esc()`

`esc()` échappe pour le HTML : il transforme `'` en `&#39;`. C'est correct pour du texte
placé entre deux balises. C'est **faux** pour une valeur insérée dans un littéral
JavaScript lui-même placé dans un attribut HTML :

```html
<button onclick="goCategory('Projets de l'Internat')">
```

Le parseur HTML décode `&#39;` **avant** que le moteur JavaScript ne voie le code. Il rend
donc une vraie apostrophe, qui referme le littéral et casse l'appel. Le symptôme observé :
la catégorie « Projets de l'Internat » produisait un bouton inerte, sans la moindre erreur
visible pour l'utilisateur.

`jsq()` échappe donc dans le bon ordre — antislash, puis apostrophe (`\'`, comprise par
JavaScript et non retouchée par le parseur HTML), puis les entités HTML. **Règle : `esc()`
pour du contenu, `jsq()` dès qu'une donnée entre dans un `onclick`.**

### `reconduct-batch` écrit en une seule fois

Le lot construit toutes les lignes en mémoire, puis les écrit d'un seul
`getRange(...).setValues(rows)`. Ligne par ligne, chaque `appendRow` est un aller-retour
vers le service Sheets ; une centaine de projets suffit alors à dépasser le temps
d'exécution maximal d'Apps Script — et l'échec survient **au milieu**, laissant une année
cible à moitié peuplée que personne ne sait plus démêler. Pour la même raison, les
compteurs d'identifiants (`buildIdCounters`) et l'index des projets déjà repris
(`buildReconductIndex`) sont calculés **une seule fois** avant la boucle, et non relus à
chaque fiche.

### Une copie complète du classeur chaque nuit, en plus de l'historique Drive

L'historique de versions de Google rattrape une cellule effacée, tant qu'il n'a pas
expiré ; il ne rattrape ni une colonne renommée, ni une formule collée par erreur, ni une
ligne supprimée que personne ne remarque avant des mois. Le classeur étant la base de
données, `backupSpreadsheet()` en duplique donc l'intégralité chaque nuit vers 2 h
(fuseau `Indian/Antananarivo`) dans le dossier Drive « LFT - Sauvegardes Suivi Projets »,
sous le nom `LFT-Projets_<horodatage>`, et `pruneBackups()` ne conserve que les
**30 dernières** copies.

Deux points à connaître : le déclencheur doit être installé **une fois** en exécutant
`installBackupTrigger()` depuis l'éditeur Apps Script — c'est aussi ce qui fait accorder
l'autorisation Drive, sans laquelle `backup-now` échoue ; et l'administrateur peut
déclencher une sauvegarde à la demande depuis la page Administration, avant une opération
à risque comme une reconduction en lot.

### L'ouverture de l'année suivante est réservée à la direction

Reconduire vers l'année courante est ouvert à tous. Reconduire vers l'année **suivante**
crée l'onglet de cette année — et `list-years` étant une action GET publique, l'année
apparaît **immédiatement dans le sélecteur de tous les visiteurs**, connectés ou non.

Or l'application n'offre aucun moyen de supprimer un onglet d'année : il faut ouvrir le
Google Sheet. Une fausse manœuvre d'un enseignant en mars publierait donc une année
2027-2028 fantôme que lui-même ne pourrait pas retirer. D'où la garde `targetYearError()`,
appliquée côté serveur, et son reflet côté client dans `canReconduct()`.

### Le calcul de l'année scolaire est dupliqué client et serveur

`currentSchoolYear()` existe deux fois, avec la même règle de bascule (la version serveur
lisant en plus la date dans le fuseau `Indian/Antananarivo`). C'est une duplication
délibérée : le client doit savoir quelle année afficher **avant** d'avoir obtenu une réponse du
serveur, sous peine d'un écran vide pendant une seconde ou plus sur une connexion lente.
Le serveur, lui, ne fait jamais confiance à l'année envoyée par le client pour décider des
droits : il recalcule. En cas de désaccord — machine mal réglée, voyage —, c'est le serveur
qui tranche, et l'interface se réaligne après `list-years`.

### La liste des projets n'est jamais conservée en cas d'échec

Si `list` échoue, `S.projects` est vidé et `S.loadError` levé. Conserver l'ancienne liste
afficherait les projets d'une année sous le millésime d'une autre — une erreur silencieuse
et convaincante. Un encart distingue explicitement « année vide » de « chargement
impossible » : sans lui, une rentrée à deux projets ressemble trait pour trait à une
application en panne.

---

## 9. Développement local

```bash
cd ~/Documents/lft-suivi-projets
python3 -m http.server 8080
```

Puis <http://localhost:8080/>. La configuration `.claude/launch.json` fait exactement
cela, sous le nom `lft-site`.

**Le site local tape sur l'API de production.** Il n'existe pas d'environnement de
recette : `API_URL` pointe vers le déploiement réel, connecté au Google Sheet réel. Tout
ce que l'on crée, modifie ou supprime en développant est écrit dans les vraies données.
Pour expérimenter sans risque, travailler dans une année de préparation (future) plutôt que
dans l'année courante, et se souvenir que la corbeille rattrape une suppression, mais pas
une modification.

### Déployer le site

`git push` sur `main` : GitHub Pages publie la racine du dépôt. Le dépôt est
`lyceefrancaisdetananarive/lft-suivi-projets`, et **`lyceefrancaisdetananarive` est un
compte utilisateur, pas une organisation.** L'authentification passe par `gh` (jeton dans
le trousseau macOS). Un `git push` refusé en 403 signifie presque toujours que le mauvais
compte est actif : `gh auth status`, puis `gh auth switch`.

### Déployer le backend (manuel, et sensible)

1. Ouvrir le Google Sheet de production → **Extensions → Apps Script** (le projet, nommé
   « Projet sans titre », est lié au classeur).
2. Copier le contenu de `Code.gs` dans l'éditeur, puis **Enregistrer**.
3. **Déployer → Gérer les déploiements** → crayon → Version : **Nouvelle version** →
   **Déployer**.

**Passer par « Gérer les déploiements » conserve l'URL.** « Nouveau déploiement » en
créerait une autre, et il faudrait alors modifier `API_URL` dans `index.html` et
redéployer le site.

> **Piège vérifié, à ne pas redécouvrir.** Le shell a `LC_CTYPE=C`. Dans ce réglage,
> `pbcopy < Code.gs` corrompt chaque `é` en `√©` **sans rien casser en apparence** : le
> code reste syntaxiquement valide, seuls les littéraux accentués deviennent faux — dont
> `VS_CATS` et `'Planifié'`. Les droits de la vie scolaire et le statut par défaut
> cessent alors silencieusement de fonctionner. Toujours copier avec
> `LC_CTYPE=UTF-8 pbcopy < Code.gs`, puis vérifier :
> `pbpaste | grep -o Planifié | xxd` doit se terminer par `c3a9`.

Deux documents complètent ce README :

- `GUIDE_DEPLOIEMENT.md`, à la racine — la procédure de déploiement pas à pas : préparation
  du presse-papiers, contrôle de l'encodage, publication, vérification qu'un déploiement a
  pris (`?action=list-years`), retour arrière. C'est le document à ouvrir au moment de
  déployer.
- `docs/REPRISE.md` — le document de reprise, écrit pour un successeur ou un prestataire
  appelé en urgence, qui ne suppose aucune connaissance du projet.

---

## 10. Limites connues

- **Aucun test automatisé.** Ni côté client, ni côté Apps Script. Toute modification se
  vérifie à la main, et le backend n'a pas de filet : une erreur ne se voit qu'en
  production.
- **Les sauvegardes restent dans le même Drive.** Le duplicata nocturne (voir §8) protège
  d'une fausse manœuvre dans le classeur, pas de la perte du compte propriétaire : les
  copies vivent dans le Drive de ce même compte. Une copie périodique conservée hors de ce
  Drive reste à mettre en place. Par ailleurs, le déclencheur n'existe que si
  `installBackupTrigger()` a été exécuté une fois depuis l'éditeur Apps Script : la carte
  « Sauvegarde » de la page Administration indique s'il est actif.
- **Quotas Apps Script.** Les notifications par courriel (corbeille, restauration,
  suppression définitive, verrouillage, déverrouillage) consomment le quota d'envoi
  quotidien. Une reconduction en lot suivie d'un ménage massif peut le heurter ; les envois
  échouent alors en silence, la fonction étant volontairement enveloppée dans un `try`
  muet pour ne pas faire échouer l'action elle-même.
- **Latence en connexion lente.** Chaque écriture est un aller-retour d'une seconde ou
  plus. L'application se protège du double envoi (`setBusy`), mais l'attente reste
  perceptible. En cas de coupure en cours d'écriture, il faut rouvrir la fiche pour savoir
  si l'enregistrement a abouti.
- **Aucun mode hors ligne.** Sans réseau, l'application ne peut rien afficher : les projets
  sont chargés depuis l'API à chaque ouverture, rien n'est mis en cache localement.
- **Un projet verrouillé peut être mis en corbeille** par son propriétaire ou son référent
  (voir §5). Réversible et tracé, mais non bloqué.
- **La catégorie « Projets de l'Internat » n'est pas proposée dans le formulaire.** Elle
  ouvre pourtant des droits à la vie scolaire et dispose de son préfixe `INT-`. La page
  « Projets de l'Internat » ne filtre donc pas sur la catégorie : elle recherche le mot
  « internat » dans le nom, la description ou les niveaux concernés. Un projet dont le
  libellé ne contient pas ce mot n'y apparaîtra pas.
- **Un repli d'authentification par paramètres d'URL subsiste côté serveur.**
  `getAuthUser()` accepte encore un couple `email` + `password` passé dans l'URL, vestige
  du parcours de première connexion. Le client ne l'emprunte plus : toutes les requêtes
  passent le jeton dans le corps du POST. Ce chemin mérite d'être retiré du serveur.
- **Concurrence non gérée.** Deux personnes modifiant la même fiche en même temps :
  la dernière écriture gagne, sans avertissement.
