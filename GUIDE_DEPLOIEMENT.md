# Guide de Deploiement - LFT Suivi des Projets

## Etape 1 : Configurer le Google Sheet

1. Ouvrez votre Google Sheet : https://docs.google.com/spreadsheets/d/1mtvQNb9_HpYNAocHCd14FCHZt6VJX7mMM7NNZJ-AE6o/edit
2. Allez dans **Extensions > Apps Script**
3. Supprimez le contenu par defaut dans l'editeur

## Etape 2 : Deployer le Google Apps Script

1. Dans l'editeur Apps Script, creez **2 fichiers** :
   - `Code.gs` : copiez le contenu du fichier `Code.gs` de ce projet
   - `InitData.gs` : copiez le contenu du fichier `InitData.gs`

2. **Initialiser la structure** :
   - Dans l'editeur, selectionnez la fonction `initializeSheets` dans le menu deroulant
   - Cliquez sur **Executer** (bouton play)
   - Autorisez l'acces quand demande (c'est votre propre compte Google)
   - Verifiez que les onglets "Projets" et "Utilisateurs" ont ete crees

3. **Peupler les donnees** :
   - Selectionnez la fonction `populateAllData`
   - Cliquez sur **Executer**
   - Verifiez que les ~45 projets apparaissent dans l'onglet "Projets"

4. **Deployer en tant qu'application web** :
   - Allez dans **Deployer > Nouveau deploiement**
   - Type : **Application Web**
   - Description : "LFT Suivi Projets API"
   - Executer en tant que : **Moi**
   - Acces : **Tout le monde**
   - Cliquez sur **Deployer**
   - **COPIEZ L'URL** du deploiement (elle ressemble a : `https://script.google.com/macros/s/xxx/exec`)

## Etape 3 : Configurer le site web

1. Ouvrez le fichier `index.html`
2. Trouvez la ligne :
   ```
   const API_URL = 'VOTRE_URL_GOOGLE_APPS_SCRIPT_ICI';
   ```
3. Remplacez par l'URL copiee a l'etape precedente :
   ```
   const API_URL = 'https://script.google.com/macros/s/VOTRE_ID/exec';
   ```

## Etape 4 : Deployer sur GitHub Pages

1. Creez un nouveau repository sur GitHub (ex: `lft-suivi-projets`)
2. Uploadez les fichiers :
   - `index.html` (obligatoire)
   - `Code.gs` (pour reference)
   - `InitData.gs` (pour reference)
   - `GUIDE_DEPLOIEMENT.md` (pour reference)
3. Allez dans **Settings > Pages**
4. Source : **Deploy from a branch**
5. Branch : **main** / dossier : **/ (root)**
6. Cliquez sur **Save**
7. Votre site sera accessible a : `https://votre-username.github.io/lft-suivi-projets/`

## Identifiants par defaut

| Compte | Email | Mot de passe | Role |
|--------|-------|-------------|------|
| Admin | admin@egd.mg | admin2025 | admin |

**Important** : Changez le mot de passe admin apres le premier deploiement !

Pour ajouter des enseignants :
1. Connectez-vous en admin
2. Allez dans Administration
3. Cliquez sur "+ Ajouter un utilisateur"
4. Remplissez email @egd.mg, mot de passe, nom, prenom, role

## Notes importantes

- Le Google Sheet est **independant** : vous pouvez l'editer directement sans passer par le site
- Si vous modifiez le Google Sheet directement, les changements apparaitront sur le site au prochain chargement
- Le suivi chronologique se **met a jour automatiquement** selon les dates de debut/fin des projets
- Les enseignants ne peuvent modifier/supprimer que **leurs propres projets** (ceux qu'ils ont crees)
- L'admin peut tout modifier et gerer les comptes utilisateurs
- En cas de probleme avec l'API, verifiez que le deploiement Google Apps Script est bien en mode "Tout le monde"

## Mise a jour du deploiement Apps Script

Si vous modifiez le code `Code.gs` :
1. Allez dans **Deployer > Gerer les deploiements**
2. Cliquez sur l'icone crayon (modifier)
3. Version : **Nouveau version**
4. Cliquez sur **Deployer**
5. L'URL reste la meme, pas besoin de modifier index.html
