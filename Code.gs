/**
 * ============================================================
 * LFT - Suivi des Projets d'Etablissement - v7.1
 * Google Apps Script - API Backend
 * Lycee Francais de Tananarive - AEFE
 * ============================================================
 *
 * SECURITE :
 * - Authentification par token de session (UUID, expire 8h)
 * - Toutes les actions sensibles passent par POST, jamais dans l'URL
 * - Verification des roles cote serveur sur chaque action
 * - sanitizeCell() contre l'injection de formules dans la feuille
 *
 * ARCHIVAGE PAR ANNEE SCOLAIRE (v7) :
 * - Un onglet par annee : Projets_<annee>, Commentaires_<annee>
 * - currentSchoolYear() bascule automatiquement le 4 juillet
 * - Une annee anterieure passe en lecture seule, sauf pour l'admin
 * - Les identifiants repartent a 001 chaque annee : un lien ne designe
 *   un projet qu'accompagne de son annee
 *
 * RECONDUCTION (v7.1) :
 * - reconduct        : un projet vers une autre annee
 * - reconduct-batch   : une selection entiere, en une seule ecriture groupee
 * - Colonne Reconduit_De = "<annee source>/<ID source>" : trace la filiation
 *   et empeche de reconduire deux fois le meme projet
 * - Annee cible limitee a l'annee courante (tous) ou a la suivante
 *   (direction uniquement) : cf. targetYearError()
 *
 * ONGLETS :
 * - "Projets_<annee>"      (28 colonnes, un par annee scolaire)
 * - "Commentaires_<annee>" (5 colonnes, un par annee scolaire)
 * - "Utilisateurs"         (11 colonnes)
 * - "Emails_Autorises"     (1 colonne)
 * - "Logs"                 (10 colonnes)
 *
 * ROLES :
 * - admin        : tout, y compris la modification des archives
 * - direction    : CRUD tous projets, corbeille, verrouillage, ouverture de l'annee suivante
 * - vie_scolaire : CRUD "Clubs et activites" + "Projets de l'Internat"
 * - enseignant   : cree, modifie et supprime SES projets (ou ceux dont il est referent)
 *
 * MIGRATION : migrateToYearlySheets() a ete executee le 05/06/2026.
 * Ne pas la relancer ; elle est de toute facon sans effet si deja faite.
 */

// Onglets non dates (inchanges par l'archivage annuel)
var USERS_SHEET    = 'Utilisateurs';
var EMAILS_SHEET   = 'Emails_Autorises';
var LOGS_SHEET     = 'Logs';

// Onglets dates par annee scolaire : Projets_2025-2026, Commentaires_2025-2026...
var PROJETS_PREFIX  = 'Projets';
var COMMENTS_PREFIX = 'Commentaires';

var ADMIN_EMAIL    = 'max.rafaliarison@aefe.fr';
var APP_URL        = 'https://lyceefrancaisdetananarive.github.io/lft-suivi-projets/';
var SESSION_HOURS  = 8;

var VS_CATS = ['Clubs et activités', "Projets de l'Internat"];

// En-tetes de l'onglet Projets (28 colonnes) — reference unique
// Reconduit_De : "<annee source>/<ID source>", trace la filiation d'un projet reconduit
// et permet de ne pas le reconduire deux fois.
var PROJETS_HEADERS = ['ID_Projet','Nom_Projet','Categorie','Echelle','Axe_Projet_Etablissement','Sous_Axe','Disciplines_Mobilisees','Niveaux_Concernes','Description','Objectifs_Pedagogiques','Statut','Priorite','Date_Debut','Date_Fin','Partenariats','Ressources_Necessaires','Modalite_Valorisation','Enseignant_Referent','Created_By','Deleted','Deleted_By','Deleted_Date','Locked','Locked_By','Locked_Date','Last_Modified_By','Last_Modified_Date','Reconduit_De'];

// ============================================================
// ANNEE SCOLAIRE — bascule automatique le 4 juillet
// ============================================================

/**
 * Annee scolaire active a la date donnee (defaut : maintenant, fuseau Antananarivo).
 * Convention : bascule le 4 juillet 00h00. Avant -> (y-1)-y, a partir du 4/7 -> y-(y+1).
 * Retourne une chaine "2025-2026".
 */
function currentSchoolYear(now) {
  if (!now) {
    // Date locale Antananarivo (UTC+3, sans DST)
    var parts = Utilities.formatDate(new Date(), 'Indian/Antananarivo', 'yyyy-MM-dd').split('-');
    now = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
  }
  var y = now.getFullYear();
  var cutoff = new Date(y, 6, 4); // 4 juillet (mois 6 = juillet)
  return (now < cutoff) ? (y - 1) + '-' + y : y + '-' + (y + 1);
}

function projetsSheetName(year)  { return PROJETS_PREFIX  + '_' + (year || currentSchoolYear()); }
function commentsSheetName(year) { return COMMENTS_PREFIX + '_' + (year || currentSchoolYear()); }

/** Une annee est archivee si elle est anterieure a l'annee courante (comparaison de chaine, ordre OK). */
function isArchivedYear(year) {
  return year && year < currentSchoolYear();
}

/** Lit le parametre year (body POST ou URL), fallback = annee courante. */
function getYearParam(e) {
  var year = '';
  try {
    var body = JSON.parse(e.postData.contents || '{}');
    year = body.year || '';
  } catch (x) {}
  if (!year) year = e.parameter.year || '';
  return year || currentSchoolYear();
}

/**
 * Retourne l'onglet Projets de l'annee demandee, en le creant avec ses en-tetes s'il n'existe pas.
 * Creation paresseuse : ouvrir une nouvelle annee ne demande aucune action admin.
 */
function ensureYearSheet(year) {
  var ss   = SpreadsheetApp.getActiveSpreadsheet();
  var name = projetsSheetName(year);
  var sh   = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, PROJETS_HEADERS.length).setValues([PROJETS_HEADERS]);
    sh.getRange(1, 1, 1, PROJETS_HEADERS.length).setFontWeight('bold').setBackground('#0053a3').setFontColor('white');
    sh.setFrozenRows(1);
  } else {
    ensureColumn(sh, 'Reconduit_De'); // onglets crees avant la v7.1
  }
  return sh;
}

/** Ajoute une colonne en fin d'onglet si elle n'existe pas deja. Retourne son index (0-base). */
function ensureColumn(sheet, colName) {
  var lastCol  = sheet.getLastColumn();
  var headers  = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var idx      = headers.indexOf(colName);
  if (idx >= 0) return idx;
  sheet.getRange(1, lastCol + 1).setValue(colName)
       .setFontWeight('bold').setBackground('#0053a3').setFontColor('white');
  return lastCol; // 0-base de la nouvelle colonne
}

/** Onglet Commentaires de l'annee, cree si absent. */
function ensureCommentsSheet(year) {
  var ss   = SpreadsheetApp.getActiveSpreadsheet();
  var name = commentsSheetName(year);
  var cs   = ss.getSheetByName(name);
  if (!cs) {
    cs = ss.insertSheet(name);
    cs.getRange(1, 1, 1, 5).setValues([['ID_Projet', 'Date_Heure', 'Email', 'Nom_Prenom', 'Commentaire']]);
    cs.getRange(1, 1, 1, 5).setFontWeight('bold').setBackground('#0053a3').setFontColor('white');
    cs.setFrozenRows(1);
  }
  return cs;
}

// ============================================================
// UTILITAIRES
// ============================================================

function hashPassword(password) {
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password);
  return raw.map(function(b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function generatePassword() {
  var upper  = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  var lower  = 'abcdefghjkmnpqrstuvwxyz';
  var digits = '23456789';
  var all    = upper + lower + digits;
  var pwd    = '';
  pwd += upper.charAt(Math.floor(Math.random() * upper.length));
  pwd += lower.charAt(Math.floor(Math.random() * lower.length));
  pwd += digits.charAt(Math.floor(Math.random() * digits.length));
  for (var i = 3; i < 8; i++) {
    pwd += all.charAt(Math.floor(Math.random() * all.length));
  }
  pwd = pwd.split('').sort(function() { return Math.random() - 0.5; }).join('');
  return pwd;
}

function nowStr() {
  return Utilities.formatDate(new Date(), 'Indian/Antananarivo', 'yyyy-MM-dd HH:mm:ss');
}

/**
 * Protege contre l'injection de formules dans Google Sheets.
 * Prefixe les valeurs commencant par = + - @ avec une apostrophe.
 */
function sanitizeCell(val) {
  if (typeof val !== 'string') return val;
  if (val.length > 0 && '=+-@'.indexOf(val.charAt(0)) >= 0) return "'" + val;
  return val;
}

// ============================================================
// AUTHENTIFICATION PAR MOT DE PASSE (login uniquement)
// ============================================================

/**
 * Un compte est actif sauf si sa colonne Actif vaut '0'.
 * Colonne absente ou cellule vide = actif : retrocompatible avec les lignes creees avant.
 * Desactiver un compte ne touche pas a ses projets (lignes independantes, liees par Created_By).
 */
function isRowActive(row, actifIdx) {
  if (actifIdx < 0) return true;
  var v = row[actifIdx];
  return !(v !== undefined && v !== null && v.toString().trim() === '0');
}

function authenticate(email, password) {
  if (!email || !password) return null;
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(USERS_SHEET);
  if (!sheet) return null;
  var data    = sheet.getDataRange().getValues();
  var headers = data[0];
  var emailIdx   = headers.indexOf('Email');
  var passIdx    = headers.indexOf('Mot_de_Passe');
  var roleIdx    = headers.indexOf('Role');
  var nomIdx     = headers.indexOf('Nom');
  var prenomIdx  = headers.indexOf('Prenom');
  var firstIdx   = headers.indexOf('First_Login');
  var actifIdx   = headers.indexOf('Actif');
  var hashed = hashPassword(password);
  for (var i = 1; i < data.length; i++) {
    if (data[i][emailIdx] && data[i][emailIdx].toString().toLowerCase().trim() === email.toLowerCase().trim()
        && data[i][passIdx] === hashed) {
      // Bon mot de passe mais compte desactive : on le signale distinctement pour un message clair
      if (!isRowActive(data[i], actifIdx)) return { _disabled: true, email: data[i][emailIdx].toString() };
      return {
        email:       data[i][emailIdx].toString(),
        role:        data[i][roleIdx] ? data[i][roleIdx].toString() : 'enseignant',
        nom:         data[i][nomIdx] ? data[i][nomIdx].toString() : '',
        prenom:      data[i][prenomIdx] ? data[i][prenomIdx].toString() : '',
        first_login: firstIdx >= 0 ? (data[i][firstIdx].toString() === '1') : false,
        _row:        i + 1
      };
    }
  }
  return null;
}

// ============================================================
// AUTHENTIFICATION PAR TOKEN DE SESSION (toutes les requetes)
// ============================================================

function authenticateByToken(token) {
  if (!token) return null;
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(USERS_SHEET);
  if (!sheet) return null;
  var data    = sheet.getDataRange().getValues();
  var headers = data[0];
  var emailIdx   = headers.indexOf('Email');
  var roleIdx    = headers.indexOf('Role');
  var nomIdx     = headers.indexOf('Nom');
  var prenomIdx  = headers.indexOf('Prenom');
  var firstIdx   = headers.indexOf('First_Login');
  var tokenIdx   = headers.indexOf('Session_Token');
  var expiryIdx  = headers.indexOf('Session_Expiry');
  var actifIdx   = headers.indexOf('Actif');

  if (tokenIdx < 0 || expiryIdx < 0) return null;

  for (var i = 1; i < data.length; i++) {
    if (data[i][tokenIdx] && data[i][tokenIdx].toString().trim() === token) {
      // Compte desactive : la session en cours est revoquee immediatement
      if (!isRowActive(data[i], actifIdx)) {
        sheet.getRange(i + 1, tokenIdx + 1).setValue('');
        sheet.getRange(i + 1, expiryIdx + 1).setValue('');
        return null;
      }
      var expiry = parseInt(data[i][expiryIdx].toString());
      if (isNaN(expiry) || new Date().getTime() > expiry) {
        // Token expire : on le nettoie
        sheet.getRange(i + 1, tokenIdx + 1).setValue('');
        sheet.getRange(i + 1, expiryIdx + 1).setValue('');
        return null;
      }
      return {
        email:       data[i][emailIdx] ? data[i][emailIdx].toString() : '',
        role:        data[i][roleIdx] ? data[i][roleIdx].toString() : 'enseignant',
        nom:         data[i][nomIdx] ? data[i][nomIdx].toString() : '',
        prenom:      data[i][prenomIdx] ? data[i][prenomIdx].toString() : '',
        first_login: firstIdx >= 0 ? (data[i][firstIdx].toString() === '1') : false,
        _row:        i + 1
      };
    }
  }
  return null;
}

/**
 * Cree un token de session pour un utilisateur
 * Retourne le token UUID
 */
function createSession(email) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(USERS_SHEET);
  if (!sheet) return null;
  var data    = sheet.getDataRange().getValues();
  var headers = data[0];
  var emailIdx   = headers.indexOf('Email');
  var tokenIdx   = headers.indexOf('Session_Token');
  var expiryIdx  = headers.indexOf('Session_Expiry');

  if (tokenIdx < 0 || expiryIdx < 0) return null;

  var token  = Utilities.getUuid();
  var expiry = new Date().getTime() + SESSION_HOURS * 60 * 60 * 1000;

  for (var i = 1; i < data.length; i++) {
    if (data[i][emailIdx] && data[i][emailIdx].toString().toLowerCase().trim() === email.toLowerCase().trim()) {
      sheet.getRange(i + 1, tokenIdx + 1).setValue(token);
      sheet.getRange(i + 1, expiryIdx + 1).setValue(expiry.toString());
      return token;
    }
  }
  return null;
}

/**
 * Helper : authentifie par token OU par email+password (fallback pour premiere connexion)
 */
function getAuthUser(e) {
  // Lire le token depuis le body POST (securise) OU fallback URL param
  var body = {};
  try { body = JSON.parse(e.postData.contents || '{}'); } catch(x) {}
  var token = body.token || e.parameter.token || '';
  if (token) {
    var user = authenticateByToken(token);
    if (user) return user;
  }
  // Repli email+mot de passe en parametre d'URL : SUPPRIME le 22/09/2026.
  // Il contournait la limitation a 5 tentatives de handleLogin (qui n'existe que la) et
  // offrait un oracle de mot de passe illimite et non journalise sur toutes les actions.
  // La premiere connexion n'en a pas besoin : elle utilise le jeton renvoye par login.
  return null;
}

function isAdmin(user)            { return user && user.role === 'admin'; }
function isDirection(user)        { return user && user.role === 'direction'; }
function isVieScolaire(user)      { return user && user.role === 'vie_scolaire'; }
function isAdminOrDirection(user) { return user && (user.role === 'admin' || user.role === 'direction'); }
function canManageTrash(user)     { return isAdminOrDirection(user); }

function isVsCat(cat) {
  for (var i = 0; i < VS_CATS.length; i++) {
    if (VS_CATS[i] === cat) return true;
  }
  return false;
}

/**
 * Verifie si l'utilisateur est liste dans Enseignant_Referent du projet
 * Compare Nom + Prenom (insensible accents/casse)
 */
function isReferentOf(user, referentStr) {
  if (!user || !referentStr) return false;
  var norm = function(s) {
    return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
  };
  var ref = norm(referentStr);
  var nom = norm(user.nom);
  if (!nom || nom.length < 2) return false;
  // Check nom (handle hyphenated names like MARIN-CUDRAZ)
  var nomMatch = ref.indexOf(nom) >= 0;
  if (!nomMatch) {
    var parts = nom.split(/[-\s]/);
    for (var p = 0; p < parts.length; p++) {
      if (parts[p].length >= 3 && ref.indexOf(parts[p]) >= 0) { nomMatch = true; break; }
    }
  }
  if (!nomMatch) return false;
  var prenom = norm(user.prenom);
  if (prenom && prenom.length >= 2) return ref.indexOf(prenom) >= 0;
  return true;
}

function isEmailAuthorized(email) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(EMAILS_SHEET);
  if (!sheet) return false;
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] && data[i][0].toString().toLowerCase().trim() === email.toLowerCase().trim()) return true;
  }
  return false;
}

function emailAlreadyRegistered(email) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(USERS_SHEET);
  if (!sheet) return false;
  var data     = sheet.getDataRange().getValues();
  var emailIdx = data[0].indexOf('Email');
  for (var i = 1; i < data.length; i++) {
    if (data[i][emailIdx] && data[i][emailIdx].toString().toLowerCase().trim() === email.toLowerCase().trim()) return true;
  }
  return false;
}

function generateProjectId(categorie, sheet) {
  // sheet = onglet de l'annee cible (la numerotation repart a 001 chaque annee)
  if (!sheet) sheet = ensureYearSheet(currentSchoolYear());
  var prefix   = prefixForCategory(categorie); // meme regle que la reconduction
  var counters = buildIdCounters(sheet.getDataRange().getValues());
  return prefix + '-' + ('000' + ((counters[prefix] || 0) + 1)).slice(-3);
}

function addLog(email, role, action, detail, deviceInfo) {
  try {
    var ss   = SpreadsheetApp.getActiveSpreadsheet();
    var logs = ss.getSheetByName(LOGS_SHEET);
    if (!logs) {
      logs = ss.insertSheet(LOGS_SHEET);
      logs.getRange(1, 1, 1, 10).setValues([['Date_Heure', 'Email', 'Role', 'Action', 'Detail', 'Pays', 'Ville', 'OS', 'Navigateur', 'Appareil']]);
      logs.getRange(1, 1, 1, 10).setFontWeight('bold').setBackground('#0053a3').setFontColor('white');
      logs.setFrozenRows(1);
    }
    var di  = deviceInfo || {};
    logs.appendRow([nowStr(), email || '', role || '', action || '', detail || '', di.pays || '', di.ville || '', di.os || '', di.navigateur || '', di.appareil || '']);
  } catch (e) { /* silencieux */ }
}

function extractDeviceInfo(e) {
  var p = e.parameter || {};
  return { pays: p.d_pays || '', ville: p.d_ville || '', os: p.d_os || '', navigateur: p.d_nav || '', appareil: p.d_app || '' };
}

function notifyProjectOwner(ownerEmail, projectName, projectId, actionType, actorEmail) {
  try {
    if (!ownerEmail || ownerEmail === actorEmail) return;
    var subject, body;
    if (actionType === 'delete') {
      subject = 'LFT Projets - Votre projet a ete place en corbeille';
      body = 'Bonjour,\n\nVotre projet "' + projectName + '" (' + projectId + ') a ete place en corbeille par ' + actorEmail + '.\n\nSi cette action n\'est pas volontaire, contactez l\'administrateur ou la direction pour le restaurer.\n\nPlateforme : ' + APP_URL + '\n\nCordialement,\nSysteme automatique - LFT Projets';
    } else if (actionType === 'restore') {
      subject = 'LFT Projets - Votre projet a ete restaure';
      body = 'Bonjour,\n\nVotre projet "' + projectName + '" (' + projectId + ') a ete restaure par ' + actorEmail + '.\nIl est de nouveau visible sur la plateforme.\n\nPlateforme : ' + APP_URL + '\n\nCordialement,\nSysteme automatique - LFT Projets';
    } else if (actionType === 'permanent-delete') {
      subject = 'LFT Projets - Votre projet a ete supprime definitivement';
      body = 'Bonjour,\n\nVotre projet "' + projectName + '" (' + projectId + ') a ete supprime definitivement par ' + actorEmail + '.\nCette action est irreversible.\n\nPlateforme : ' + APP_URL + '\n\nCordialement,\nSysteme automatique - LFT Projets';
    } else if (actionType === 'lock') {
      subject = 'LFT Projets - Votre projet a ete valide et verrouille';
      body = 'Bonjour,\n\nVotre projet "' + projectName + '" (' + projectId + ') a ete valide et verrouille par ' + actorEmail + '.\nIl ne peut plus etre modifie. Contactez la direction si des modifications sont necessaires.\n\nPlateforme : ' + APP_URL + '\n\nCordialement,\nSysteme automatique - LFT Projets';
    } else if (actionType === 'unlock') {
      subject = 'LFT Projets - Votre projet a ete deverrouille';
      body = 'Bonjour,\n\nVotre projet "' + projectName + '" (' + projectId + ') a ete deverrouille par ' + actorEmail + '.\nVous pouvez de nouveau le modifier.\n\nPlateforme : ' + APP_URL + '\n\nCordialement,\nSysteme automatique - LFT Projets';
    }
    if (subject && body) {
      MailApp.sendEmail({ to: ownerEmail, subject: subject, body: body });
    }
  } catch (e) { /* silencieux */ }
}

// ============================================================
// ROUTING v6 — GET = lecture seule, POST = tout le reste
// ============================================================

function doGet(e) {
  try {
    switch (e.parameter.action) {
      case 'list':           return handleList(e);
      case 'list-comments':  return handleListComments(e);
      case 'list-years':     return handleListYears(e);
      default: return jsonResponse({ success: false, error: 'Action non reconnue (GET)' });
    }
  } catch (err) { return jsonResponse({ success: false, error: err.toString() }); }
}

function doPost(e) {
  try {
    switch (e.parameter.action) {
      // Auth
      case 'login':                return handleLogin(e);
      case 'register':             return handleRegister(e);
      case 'forgot-password':      return handleForgotPassword(e);
      case 'confirm-reset':        return handleConfirmReset(e);
      case 'change-password':      return handleChangePassword(e);
      case 'admin-reset-password': return handleAdminResetPassword(e);
      // Projets
      case 'add':                  return handleAdd(e);
      case 'update':               return handleUpdate(e);
      case 'delete':               return handleDelete(e);
      case 'permanent-delete':     return handlePermanentDelete(e);
      case 'restore':              return handleRestore(e);
      case 'lock-project':         return handleLockProject(e);
      case 'unlock-project':       return handleUnlockProject(e);
      case 'reconduct':            return handleReconduct(e);
      case 'reconduct-batch':      return handleReconductBatch(e);
      // Sauvegarde
      case 'backup-now':           return handleBackupNow(e);
      case 'backup-status':        return handleBackupStatus(e);
      // Commentaires
      case 'add-comment':          return handleAddComment(e);
      // Admin
      case 'list-trash':           return handleListTrash(e);
      case 'get-logs':             return handleGetLogs(e);
      case 'list-emails':          return handleListEmails(e);
      case 'add-email':            return handleAddEmail(e);
      case 'delete-email':         return handleDeleteEmail(e);
      case 'change-role':          return handleChangeRole(e);
      case 'set-user-active':      return handleSetUserActive(e);
      case 'request-deletion':     return handleRequestDeletion(e);
      // Export + Liste utilisateurs (admin)
      case 'export':               return handleExport(e);
      case 'list-users':           return handleListUsers(e);
      default: return jsonResponse({ success: false, error: 'Action non reconnue (POST)' });
    }
  } catch (err) { return jsonResponse({ success: false, error: err.toString() }); }
}

// ============================================================
// AUTH : LOGIN (seule action qui utilise email+password)
// ============================================================

function handleLogin(e) {
  var body  = JSON.parse(e.postData.contents);
  var email = (body.email || '').trim().toLowerCase();
  var pwd   = body.password || '';
  var di    = extractDeviceInfo(e);

  // Rate limiting : max 5 echecs par email en 15 minutes
  var cache  = CacheService.getScriptCache();
  var cKey   = 'login_fail_' + email.replace(/[^a-z0-9]/g, '_');
  var fails  = parseInt(cache.get(cKey) || '0');
  if (fails >= 5) {
    addLog(email, '', 'login_blocked', 'Trop de tentatives (' + fails + ')', di);
    return jsonResponse({ success: false, error: 'Trop de tentatives. Reessayez dans quelques minutes.' });
  }

  var user = authenticate(email, pwd);
  if (user && user._disabled) {
    // Bon mot de passe, compte ferme : message clair, sans compter comme un echec
    addLog(email, '', 'login_disabled', 'Tentative sur un compte desactive', di);
    return jsonResponse({ success: false, error: "Ce compte a ete desactive. Contactez l'administrateur si vous pensez qu'il s'agit d'une erreur." });
  }
  if (!user) {
    cache.put(cKey, (fails + 1).toString(), 900); // 15 min TTL
    addLog(email, '', 'login_fail', 'Identifiants incorrects (' + (fails + 1) + '/5)', di);
    return jsonResponse({ success: false, error: 'Identifiants incorrects' });
  }
  // Succes : reset le compteur
  cache.remove(cKey);

  // Creer un token de session
  var token = createSession(email);
  if (!token) {
    return jsonResponse({ success: false, error: 'Erreur creation session' });
  }

  addLog(user.email, user.role, 'login', 'Connexion reussie', di);
  return jsonResponse({
    success: true,
    token: token,
    user: { email: user.email, role: user.role, nom: user.nom, prenom: user.prenom, first_login: user.first_login }
  });
}

// ============================================================
// AUTH : REGISTER
// ============================================================

function handleRegister(e) {
  var body   = JSON.parse(e.postData.contents);
  var email  = (body.Email || '').trim().toLowerCase();
  var nom    = (body.Nom    || '').trim();
  var prenom = (body.Prenom || '').trim();
  var di     = extractDeviceInfo(e);

  if (!email.endsWith('@egd.mg'))
    return jsonResponse({ success: false, error: 'Seules les adresses @egd.mg sont autorisees' });
  if (!nom || !prenom)
    return jsonResponse({ success: false, error: 'Nom et prenom requis' });
  if (!isEmailAuthorized(email)) {
    addLog(email, '', 'register_denied', 'Email non autorise', di);
    return jsonResponse({ success: false, error: "Vous n'etes pas inscrit(e) sur la liste des enseignants du lycee. Merci de contacter l'administrateur." });
  }
  if (emailAlreadyRegistered(email))
    return jsonResponse({ success: false, error: "Un compte existe deja avec cette adresse. Utilisez \"Mot de passe oublie\" si necessaire." });

  var password = generatePassword();
  var sheet    = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(USERS_SHEET);
  var hashed   = hashPassword(password);
  // sanitizeCell obligatoire : sans lui, un Nom commencant par '=' est ecrit comme FORMULE
  // par Sheets, relu par authenticate() et renvoye au client (fuite de cellules voisines).
  sheet.appendRow([email, hashed, 'enseignant', sanitizeCell(nom), sanitizeCell(prenom), '', '', password, '1', '', '']);
  addLog(email, 'enseignant', 'register', 'Nouveau compte: ' + prenom + ' ' + nom, di);

  // Creer le token de session immediatement
  var token = createSession(email);

  return jsonResponse({
    success: true, message: 'Compte cree avec succes !',
    generated_password: password,
    token: token,
    user: { email: email, role: 'enseignant', nom: nom, prenom: prenom, first_login: true }
  });
}

// ============================================================
// AUTH : CHANGE PASSWORD
// ============================================================

function handleChangePassword(e) {
  var body        = JSON.parse(e.postData.contents);
  var newPassword = body.new_password || '';
  var di          = extractDeviceInfo(e);

  // Auth par token OU par email+password (premiere connexion)
  var user = getAuthUser(e);
  if (!user) return jsonResponse({ success: false, error: 'Authentification requise' });

  if (!newPassword || newPassword.length < 8)
    return jsonResponse({ success: false, error: 'Le nouveau mot de passe doit contenir au moins 8 caracteres' });
  if (!/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/[0-9]/.test(newPassword))
    return jsonResponse({ success: false, error: 'Le mot de passe doit contenir au moins une majuscule, une minuscule et un chiffre' });

  var sheet   = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(USERS_SHEET);
  var data    = sheet.getDataRange().getValues();
  var headers = data[0];
  var emailIdx = headers.indexOf('Email');
  var passIdx  = headers.indexOf('Mot_de_Passe');
  var firstIdx = headers.indexOf('First_Login');
  var initIdx  = headers.indexOf('Mdp_Initial');

  for (var i = 1; i < data.length; i++) {
    if (data[i][emailIdx] && data[i][emailIdx].toString().toLowerCase() === user.email.toLowerCase()) {
      sheet.getRange(i + 1, passIdx + 1).setValue(hashPassword(newPassword));
      if (firstIdx >= 0) sheet.getRange(i + 1, firstIdx + 1).setValue('0');
      if (initIdx >= 0) sheet.getRange(i + 1, initIdx + 1).setValue('');
      addLog(user.email, user.role, 'change_password', 'Mot de passe modifie' + (user.first_login ? ' (premiere connexion)' : ''), di);

      // Generer un nouveau token de session
      var newToken = createSession(user.email);
      return jsonResponse({
        success: true, message: 'Mot de passe modifie avec succes !',
        token: newToken,
        user: { email: user.email, role: user.role, nom: user.nom, prenom: user.prenom, first_login: false }
      });
    }
  }
  return jsonResponse({ success: false, error: 'Utilisateur introuvable' });
}

// ============================================================
// AUTH : ADMIN RESET PASSWORD
// ============================================================

function handleAdminResetPassword(e) {
  var admin = getAuthUser(e);
  if (!isAdmin(admin)) return jsonResponse({ success: false, error: 'Admin requis' });

  var body        = JSON.parse(e.postData.contents);
  var targetEmail = (body.email || '').trim().toLowerCase();
  var di          = extractDeviceInfo(e);

  var sheet   = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(USERS_SHEET);
  var data    = sheet.getDataRange().getValues();
  var headers = data[0];
  var emailIdx = headers.indexOf('Email');
  var passIdx  = headers.indexOf('Mot_de_Passe');
  var nomIdx   = headers.indexOf('Nom');
  var prenomIdx= headers.indexOf('Prenom');
  var firstIdx = headers.indexOf('First_Login');
  var initIdx  = headers.indexOf('Mdp_Initial');

  for (var i = 1; i < data.length; i++) {
    if (data[i][emailIdx] && data[i][emailIdx].toString().toLowerCase() === targetEmail) {
      var newPwd = generatePassword();
      var nom    = data[i][nomIdx] || '';
      var prenom = data[i][prenomIdx] || '';
      sheet.getRange(i + 1, passIdx  + 1).setValue(hashPassword(newPwd));
      if (firstIdx >= 0) sheet.getRange(i + 1, firstIdx + 1).setValue('1');
      if (initIdx >= 0) sheet.getRange(i + 1, initIdx + 1).setValue(newPwd);

      var mailBody = 'Bonjour ' + prenom + ' ' + nom + ',\n\n'
        + 'Votre mot de passe pour la plateforme LFT - Suivi des projets a ete reinitialise.\n\n'
        + 'Nouveaux identifiants :\n'
        + '- Adresse : ' + APP_URL + '\n'
        + '- Email : ' + targetEmail + '\n'
        + '- Mot de passe temporaire : ' + newPwd + '\n\n'
        + 'Vous serez invite(e) a choisir un nouveau mot de passe personnel lors de votre prochaine connexion.\n\n'
        + 'Cordialement,\nL\'equipe LFT';
      MailApp.sendEmail({ to: targetEmail, subject: 'LFT Projets - Reinitialisation de votre mot de passe', body: mailBody });
      addLog(admin.email, admin.role, 'admin_reset_password', 'Reinitialisation mdp: ' + targetEmail, di);
      return jsonResponse({ success: true, message: 'Mot de passe reinitialise et envoye par email a ' + targetEmail });
    }
  }
  return jsonResponse({ success: false, error: 'Utilisateur introuvable' });
}

// ============================================================
// AUTH : FORGOT PASSWORD
// ============================================================

function handleForgotPassword(e) {
  var body  = JSON.parse(e.postData.contents);
  var email = (body.email || '').trim().toLowerCase();
  var di    = extractDeviceInfo(e);
  if (!email.endsWith('@egd.mg'))
    return jsonResponse({ success: false, error: 'Adresse email invalide' });

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(USERS_SHEET);
  if (!sheet) return jsonResponse({ success: false, error: 'Erreur systeme' });

  var data     = sheet.getDataRange().getValues();
  var headers  = data[0];
  var emailIdx = headers.indexOf('Email');
  var tokenIdx = headers.indexOf('Reset_Token');
  var expiryIdx= headers.indexOf('Reset_Expiry');
  var actifIdx = headers.indexOf('Actif');

  for (var i = 1; i < data.length; i++) {
    if (data[i][emailIdx] && data[i][emailIdx].toString().toLowerCase().trim() === email) {
      // Compte desactive : aucun lien envoye, reponse generique (ne pas reveler l'etat du compte)
      if (!isRowActive(data[i], actifIdx)) {
        addLog(email, '', 'forgot_password_disabled', 'Demande sur un compte desactive', di);
        break;
      }
      var token  = Utilities.getUuid();
      var expiry = new Date().getTime() + 24 * 60 * 60 * 1000;
      sheet.getRange(i + 1, tokenIdx  + 1).setValue(token);
      sheet.getRange(i + 1, expiryIdx + 1).setValue(expiry.toString());

      var resetLink = APP_URL + '?reset=' + token;
      MailApp.sendEmail({
        to: email,
        subject: 'LFT Projets - Reinitialisation de mot de passe',
        body: 'Bonjour,\n\nCliquez sur ce lien pour definir un nouveau mot de passe (valide 24h) :\n' + resetLink + '\n\nSi vous n\'etes pas a l\'origine de cette demande, ignorez cet email.\n\nCordialement,\nL\'equipe LFT'
      });
      addLog(email, '', 'forgot_password', 'Lien de reinitialisation envoye', di);
      return jsonResponse({ success: true, message: 'Un email de reinitialisation a ete envoye a ' + email });
    }
  }
  return jsonResponse({ success: true, message: 'Si cette adresse est associee a un compte, un email de reinitialisation a ete envoye.' });
}

// ============================================================
// AUTH : CONFIRM RESET
// ============================================================

function handleConfirmReset(e) {
  var body        = JSON.parse(e.postData.contents);
  var token       = (body.token    || '').trim();
  var newPassword = (body.password || '');

  if (!token) return jsonResponse({ success: false, error: 'Token manquant' });
  if (!newPassword || newPassword.length < 8)
    return jsonResponse({ success: false, error: 'Le mot de passe doit contenir au moins 8 caracteres' });
  if (!/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/[0-9]/.test(newPassword))
    return jsonResponse({ success: false, error: 'Le mot de passe doit contenir au moins une majuscule, une minuscule et un chiffre' });

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(USERS_SHEET);
  if (!sheet) return jsonResponse({ success: false, error: 'Erreur systeme' });

  var data      = sheet.getDataRange().getValues();
  var headers   = data[0];
  var emailIdx  = headers.indexOf('Email');
  var passIdx   = headers.indexOf('Mot_de_Passe');
  var tokenIdx  = headers.indexOf('Reset_Token');
  var expiryIdx = headers.indexOf('Reset_Expiry');
  var firstIdx  = headers.indexOf('First_Login');
  var initIdx   = headers.indexOf('Mdp_Initial');

  for (var i = 1; i < data.length; i++) {
    if (data[i][tokenIdx] && data[i][tokenIdx].toString().trim() === token) {
      var expiry = parseInt(data[i][expiryIdx].toString());
      if (isNaN(expiry) || new Date().getTime() > expiry)
        return jsonResponse({ success: false, error: 'Ce lien de reinitialisation a expire.' });
      sheet.getRange(i + 1, passIdx  + 1).setValue(hashPassword(newPassword));
      sheet.getRange(i + 1, tokenIdx + 1).setValue('');
      sheet.getRange(i + 1, expiryIdx + 1).setValue('');
      if (firstIdx >= 0) sheet.getRange(i + 1, firstIdx + 1).setValue('0');
      if (initIdx >= 0) sheet.getRange(i + 1, initIdx + 1).setValue('');
      addLog(data[i][emailIdx].toString(), '', 'password_reset', 'Mot de passe reinitialise via lien email');
      return jsonResponse({ success: true, message: 'Mot de passe modifie avec succes.' });
    }
  }
  return jsonResponse({ success: false, error: 'Token invalide ou expire' });
}

// ============================================================
// REQUEST DELETION
// ============================================================

function handleRequestDeletion(e) {
  var user = getAuthUser(e);
  if (!user) return jsonResponse({ success: false, error: 'Authentification requise' });

  MailApp.sendEmail({
    to: ADMIN_EMAIL,
    subject: 'LFT Projets - Demande de suppression de compte : ' + user.email,
    body: 'Un utilisateur a demande la suppression de son compte.\n\n- Email : ' + user.email + '\n- Nom : ' + (user.prenom || '') + ' ' + (user.nom || '') + '\n- Role : ' + (user.role || '') + '\n- Date : ' + nowStr()
  });
  addLog(user.email, user.role, 'request_deletion', 'Demande de suppression envoyee');
  return jsonResponse({ success: true, message: "Demande envoyee a l'administrateur." });
}

// ============================================================
// LIST PROJECTS (GET, public, exclut les supprimes)
// ============================================================

function handleList(e) {
  var year  = getYearParam(e);
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(projetsSheetName(year));
  // Onglet d'annee absent (annee non encore ouverte) : liste vide, pas une erreur
  if (!sheet) return jsonResponse({ success: true, data: [], year: year });

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return jsonResponse({ success: true, data: [], year: year });

  var headers = data[0];
  var deletedIdx = headers.indexOf('Deleted');
  var results = [];
  for (var i = 1; i < data.length; i++) {
    if (deletedIdx >= 0 && data[i][deletedIdx] && data[i][deletedIdx].toString() === '1') continue;
    var row = {};
    for (var j = 0; j < headers.length; j++) {
      var val = data[i][j];
      if (val instanceof Date) val = Utilities.formatDate(val, 'Indian/Antananarivo', 'yyyy-MM-dd');
      row[headers[j]] = val !== undefined && val !== null ? val.toString() : '';
    }
    results.push(row);
  }
  return jsonResponse({ success: true, data: results, year: year });
}

// ============================================================
// LIST USERS (POST, admin uniquement)
// ============================================================

function handleListUsers(e) {
  var user = getAuthUser(e);
  if (!isAdmin(user)) return jsonResponse({ success: false, error: 'Acces refuse - Admin uniquement' });

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(USERS_SHEET);
  if (!sheet) return jsonResponse({ success: false, error: 'Onglet introuvable' });

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return jsonResponse({ success: true, data: [] });

  var headers = data[0];
  var results = [];
  for (var i = 1; i < data.length; i++) {
    var row = {};
    for (var j = 0; j < headers.length; j++) {
      var val = data[i][j];
      if (val instanceof Date) val = Utilities.formatDate(val, 'Indian/Antananarivo', 'yyyy-MM-dd');
      row[headers[j]] = val !== undefined && val !== null ? val.toString() : '';
    }
    // Ne JAMAIS renvoyer le mot de passe, le token, les reset tokens
    delete row['Mot_de_Passe'];
    delete row['Reset_Token'];
    delete row['Reset_Expiry'];
    delete row['Session_Token'];
    delete row['Session_Expiry'];
    results.push(row);
  }
  return jsonResponse({ success: true, data: results });
}

// ============================================================
// LIST TRASH (POST, admin/direction)
// ============================================================

function handleListTrash(e) {
  var user = getAuthUser(e);
  if (!canManageTrash(user)) return jsonResponse({ success: false, error: 'Acces refuse - Admin/Direction uniquement' });

  var year  = getYearParam(e);
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(projetsSheetName(year));
  if (!sheet) return jsonResponse({ success: true, data: [] });

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return jsonResponse({ success: true, data: [] });

  var headers = data[0];
  var deletedIdx = headers.indexOf('Deleted');
  var results = [];
  for (var i = 1; i < data.length; i++) {
    if (deletedIdx >= 0 && data[i][deletedIdx] && data[i][deletedIdx].toString() === '1') {
      var row = {};
      for (var j = 0; j < headers.length; j++) {
        var val = data[i][j];
        if (val instanceof Date) val = Utilities.formatDate(val, 'Indian/Antananarivo', 'yyyy-MM-dd');
        row[headers[j]] = val !== undefined && val !== null ? val.toString() : '';
      }
      results.push(row);
    }
  }
  return jsonResponse({ success: true, data: results });
}

// ============================================================
// DELETE (soft delete, POST)
// ============================================================

function handleDelete(e) {
  var user = getAuthUser(e);
  if (!user) return jsonResponse({ success: false, error: 'Authentification requise' });
  var di = extractDeviceInfo(e);

  var body  = JSON.parse(e.postData.contents);
  // table logique : 'Projets' (defaut) ou 'Utilisateurs'
  var table = body.table || 'Projets';
  var year  = getYearParam(e);

  // Resolution de l'onglet : Projets -> onglet date de l'annee
  var sheetName = (table === USERS_SHEET) ? USERS_SHEET : projetsSheetName(year);
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) return jsonResponse({ success: false, error: 'Onglet introuvable' });

  var data    = sheet.getDataRange().getValues();
  var headers = data[0];

  if (table !== USERS_SHEET) {
    if (isArchivedYear(year) && !isAdmin(user))
      return jsonResponse({ success: false, error: "Cette annee est archivee (lecture seule). Seul l'administrateur peut la modifier." });
    var targetId     = body.id || '';
    var idIdx        = headers.indexOf('ID_Projet');
    var nomIdx       = headers.indexOf('Nom_Projet');
    var catIdx       = headers.indexOf('Categorie');
    var createdByIdx = headers.indexOf('Created_By');
    var deletedIdx   = headers.indexOf('Deleted');
    var delByIdx     = headers.indexOf('Deleted_By');
    var delDateIdx   = headers.indexOf('Deleted_Date');

    for (var i = 1; i < data.length; i++) {
      if (data[i][idIdx] === targetId) {
        var owner      = data[i][createdByIdx] ? data[i][createdByIdx].toString() : '';
        var projectCat = data[i][catIdx] ? data[i][catIdx].toString() : '';
        var nomProjet  = data[i][nomIdx] ? data[i][nomIdx].toString() : targetId;
        var refIdx     = headers.indexOf('Enseignant_Referent');
        var referent   = refIdx >= 0 ? (data[i][refIdx] || '').toString() : '';

        if (isVieScolaire(user)) {
          if (!isVsCat(projectCat))
            return jsonResponse({ success: false, error: 'Vie scolaire : suppression limitee a vos categories' });
        } else if (!isAdminOrDirection(user)) {
          if (owner !== user.email && !isReferentOf(user, referent))
            return jsonResponse({ success: false, error: 'Vous ne pouvez supprimer que vos propres projets' });
        }

        if (deletedIdx >= 0) sheet.getRange(i + 1, deletedIdx + 1).setValue('1');
        if (delByIdx >= 0)   sheet.getRange(i + 1, delByIdx + 1).setValue(user.email);
        if (delDateIdx >= 0) sheet.getRange(i + 1, delDateIdx + 1).setValue(nowStr());

        addLog(user.email, user.role, 'delete_project', 'Corbeille: ' + targetId + ' - ' + nomProjet, di);
        notifyProjectOwner(owner, nomProjet, targetId, 'delete', user.email);
        return jsonResponse({ success: true, message: 'Projet place en corbeille' });
      }
    }
    return jsonResponse({ success: false, error: 'Introuvable' });
  }

  // Suppression utilisateur (hard delete, admin uniquement)
  if (table === USERS_SHEET) {
    if (!isAdmin(user)) return jsonResponse({ success: false, error: 'Admin requis' });
    var targetEmail = body.email_target || '';
    if (targetEmail.toLowerCase() === user.email.toLowerCase()) return jsonResponse({ success: false, error: 'Impossible de supprimer votre propre compte' });
    var emailIdx = headers.indexOf('Email');
    for (var i = 1; i < data.length; i++) {
      if (data[i][emailIdx] && data[i][emailIdx].toString().toLowerCase() === targetEmail.toLowerCase()) {
        sheet.deleteRow(i + 1);
        addLog(user.email, user.role, 'delete_user', 'Suppression compte: ' + targetEmail, di);
        return jsonResponse({ success: true, message: 'Supprime' });
      }
    }
    return jsonResponse({ success: false, error: 'Introuvable' });
  }

  return jsonResponse({ success: false, error: 'Table non supportee' });
}

// ============================================================
// RESTORE (POST, admin/direction)
// ============================================================

function handleRestore(e) {
  var user = getAuthUser(e);
  if (!canManageTrash(user)) return jsonResponse({ success: false, error: 'Admin/Direction requis' });
  var di = extractDeviceInfo(e);

  var body     = JSON.parse(e.postData.contents);
  var targetId = (body.id || '').trim();
  var year     = getYearParam(e);

  if (isArchivedYear(year) && !isAdmin(user))
    return jsonResponse({ success: false, error: "Cette annee est archivee (lecture seule). Seul l'administrateur peut la modifier." });

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(projetsSheetName(year));
  if (!sheet) return jsonResponse({ success: false, error: 'Onglet introuvable' });

  var data    = sheet.getDataRange().getValues();
  var headers = data[0];
  var idIdx        = headers.indexOf('ID_Projet');
  var nomIdx       = headers.indexOf('Nom_Projet');
  var createdByIdx = headers.indexOf('Created_By');
  var deletedIdx   = headers.indexOf('Deleted');
  var delByIdx     = headers.indexOf('Deleted_By');
  var delDateIdx   = headers.indexOf('Deleted_Date');

  for (var i = 1; i < data.length; i++) {
    if (data[i][idIdx] === targetId) {
      var owner     = data[i][createdByIdx] ? data[i][createdByIdx].toString() : '';
      var nomProjet = data[i][nomIdx] ? data[i][nomIdx].toString() : targetId;

      if (deletedIdx >= 0) sheet.getRange(i + 1, deletedIdx + 1).setValue('');
      if (delByIdx >= 0)   sheet.getRange(i + 1, delByIdx + 1).setValue('');
      if (delDateIdx >= 0) sheet.getRange(i + 1, delDateIdx + 1).setValue('');

      addLog(user.email, user.role, 'restore_project', 'Restaure: ' + targetId + ' - ' + nomProjet, di);
      notifyProjectOwner(owner, nomProjet, targetId, 'restore', user.email);
      return jsonResponse({ success: true, message: 'Projet restaure avec succes' });
    }
  }
  return jsonResponse({ success: false, error: 'Projet introuvable' });
}

// ============================================================
// PERMANENT DELETE (POST, admin/direction)
// ============================================================

function handlePermanentDelete(e) {
  var user = getAuthUser(e);
  if (!canManageTrash(user)) return jsonResponse({ success: false, error: 'Admin/Direction requis' });
  var di = extractDeviceInfo(e);

  var body     = JSON.parse(e.postData.contents);
  var targetId = (body.id || '').trim();
  var year     = getYearParam(e);

  if (isArchivedYear(year) && !isAdmin(user))
    return jsonResponse({ success: false, error: "Cette annee est archivee (lecture seule). Seul l'administrateur peut la modifier." });

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(projetsSheetName(year));
  if (!sheet) return jsonResponse({ success: false, error: 'Onglet introuvable' });

  var data    = sheet.getDataRange().getValues();
  var headers = data[0];
  var idIdx        = headers.indexOf('ID_Projet');
  var nomIdx       = headers.indexOf('Nom_Projet');
  var createdByIdx = headers.indexOf('Created_By');

  for (var i = 1; i < data.length; i++) {
    if (data[i][idIdx] === targetId) {
      var owner     = data[i][createdByIdx] ? data[i][createdByIdx].toString() : '';
      var nomProjet = data[i][nomIdx] ? data[i][nomIdx].toString() : targetId;

      sheet.deleteRow(i + 1);
      addLog(user.email, user.role, 'permanent_delete', 'Supprime definitivement: ' + targetId + ' - ' + nomProjet, di);
      notifyProjectOwner(owner, nomProjet, targetId, 'permanent-delete', user.email);
      return jsonResponse({ success: true, message: 'Projet supprime definitivement' });
    }
  }
  return jsonResponse({ success: false, error: 'Projet introuvable' });
}

// ============================================================
// LOCK / UNLOCK PROJECT (POST, admin/direction)
// ============================================================

function handleLockProject(e) {
  var user = getAuthUser(e);
  if (!isAdminOrDirection(user)) return jsonResponse({ success: false, error: 'Admin/Direction requis' });
  var di = extractDeviceInfo(e);

  var body     = JSON.parse(e.postData.contents);
  var targetId = (body.id || '').trim();
  var year     = getYearParam(e);

  if (isArchivedYear(year) && !isAdmin(user))
    return jsonResponse({ success: false, error: "Cette annee est archivee (lecture seule). Seul l'administrateur peut la modifier." });

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(projetsSheetName(year));
  if (!sheet) return jsonResponse({ success: false, error: 'Onglet introuvable' });
  var data    = sheet.getDataRange().getValues();
  var headers = data[0];
  var idIdx        = headers.indexOf('ID_Projet');
  var nomIdx       = headers.indexOf('Nom_Projet');
  var createdByIdx = headers.indexOf('Created_By');
  var lockedIdx    = headers.indexOf('Locked');
  var lockByIdx    = headers.indexOf('Locked_By');
  var lockDateIdx  = headers.indexOf('Locked_Date');

  for (var i = 1; i < data.length; i++) {
    if (data[i][idIdx] === targetId) {
      var owner     = data[i][createdByIdx] ? data[i][createdByIdx].toString() : '';
      var nomProjet = data[i][nomIdx] ? data[i][nomIdx].toString() : targetId;
      if (lockedIdx >= 0)   sheet.getRange(i + 1, lockedIdx + 1).setValue('1');
      if (lockByIdx >= 0)   sheet.getRange(i + 1, lockByIdx + 1).setValue(user.email);
      if (lockDateIdx >= 0) sheet.getRange(i + 1, lockDateIdx + 1).setValue(nowStr());
      addLog(user.email, user.role, 'lock_project', 'Verrouille: ' + targetId + ' - ' + nomProjet, di);
      notifyProjectOwner(owner, nomProjet, targetId, 'lock', user.email);
      return jsonResponse({ success: true, message: 'Projet verrouille' });
    }
  }
  return jsonResponse({ success: false, error: 'Introuvable' });
}

function handleUnlockProject(e) {
  var user = getAuthUser(e);
  if (!isAdminOrDirection(user)) return jsonResponse({ success: false, error: 'Admin/Direction requis' });
  var di = extractDeviceInfo(e);

  var body     = JSON.parse(e.postData.contents);
  var targetId = (body.id || '').trim();
  var year     = getYearParam(e);

  if (isArchivedYear(year) && !isAdmin(user))
    return jsonResponse({ success: false, error: "Cette annee est archivee (lecture seule). Seul l'administrateur peut la modifier." });

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(projetsSheetName(year));
  if (!sheet) return jsonResponse({ success: false, error: 'Onglet introuvable' });
  var data    = sheet.getDataRange().getValues();
  var headers = data[0];
  var idIdx        = headers.indexOf('ID_Projet');
  var nomIdx       = headers.indexOf('Nom_Projet');
  var createdByIdx = headers.indexOf('Created_By');
  var lockedIdx    = headers.indexOf('Locked');
  var lockByIdx    = headers.indexOf('Locked_By');
  var lockDateIdx  = headers.indexOf('Locked_Date');

  for (var i = 1; i < data.length; i++) {
    if (data[i][idIdx] === targetId) {
      var owner     = data[i][createdByIdx] ? data[i][createdByIdx].toString() : '';
      var nomProjet = data[i][nomIdx] ? data[i][nomIdx].toString() : targetId;
      if (lockedIdx >= 0)   sheet.getRange(i + 1, lockedIdx + 1).setValue('');
      if (lockByIdx >= 0)   sheet.getRange(i + 1, lockByIdx + 1).setValue('');
      if (lockDateIdx >= 0) sheet.getRange(i + 1, lockDateIdx + 1).setValue('');
      addLog(user.email, user.role, 'unlock_project', 'Deverrouille: ' + targetId + ' - ' + nomProjet, di);
      notifyProjectOwner(owner, nomProjet, targetId, 'unlock', user.email);
      return jsonResponse({ success: true, message: 'Projet deverrouille' });
    }
  }
  return jsonResponse({ success: false, error: 'Introuvable' });
}

// ============================================================
// COMMENTS
// ============================================================

function handleAddComment(e) {
  var user = getAuthUser(e);
  if (!user) return jsonResponse({ success: false, error: 'Authentification requise' });
  var di = extractDeviceInfo(e);

  var body = JSON.parse(e.postData.contents);
  var projectId = (body.id || '').trim();
  var comment   = (body.comment || '').trim();
  var year      = getYearParam(e);

  if (isArchivedYear(year) && !isAdmin(user))
    return jsonResponse({ success: false, error: "Cette annee est archivee (lecture seule). Seul l'administrateur peut commenter." });

  if (!projectId || !comment) return jsonResponse({ success: false, error: 'Projet et commentaire requis' });
  if (comment.length > 1000) return jsonResponse({ success: false, error: 'Commentaire trop long (max 1000 car.)' });

  var cs = ensureCommentsSheet(year);

  var nomPrenom = (user.prenom || '') + ' ' + (user.nom || '');
  cs.appendRow([projectId, nowStr(), user.email, nomPrenom.trim(), comment]);
  addLog(user.email, user.role, 'add_comment', 'Commentaire sur ' + projectId, di);
  return jsonResponse({ success: true, message: 'Commentaire ajoute' });
}

function handleListComments(e) {
  var projectId = (e.parameter.id || '').trim();
  if (!projectId) return jsonResponse({ success: false, error: 'ID projet requis' });

  var year = getYearParam(e);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var cs = ss.getSheetByName(commentsSheetName(year));
  if (!cs) return jsonResponse({ success: true, data: [] });

  var data = cs.getDataRange().getValues();
  if (data.length < 2) return jsonResponse({ success: true, data: [] });

  var headers = data[0];
  var idIdx   = headers.indexOf('ID_Projet');
  var results = [];
  for (var i = 1; i < data.length; i++) {
    if (data[i][idIdx] && data[i][idIdx].toString() === projectId) {
      var row = {};
      for (var j = 0; j < headers.length; j++) {
        row[headers[j]] = data[i][j] !== undefined ? data[i][j].toString() : '';
      }
      results.push(row);
    }
  }
  results.reverse();
  return jsonResponse({ success: true, data: results });
}

// ============================================================
// EXPORT (GET, CSV)
// ============================================================

function handleExport(e) {
  var user = getAuthUser(e);
  if (!isAdminOrDirection(user)) return jsonResponse({ success: false, error: 'Acces refuse - Admin/Direction uniquement' });

  var year  = getYearParam(e);
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(projetsSheetName(year));
  if (!sheet) return jsonResponse({ success: false, error: 'Onglet introuvable' });

  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var deletedIdx = headers.indexOf('Deleted');

  var excludeCols = ['Deleted', 'Deleted_By', 'Deleted_Date', 'Locked_By', 'Locked_Date', 'Last_Modified_By', 'Last_Modified_Date'];
  var exportIdx = [];
  var exportHeaders = [];
  for (var j = 0; j < headers.length; j++) {
    if (excludeCols.indexOf(headers[j]) < 0) {
      exportIdx.push(j);
      exportHeaders.push(headers[j]);
    }
  }

  var csv = exportHeaders.join(';') + '\n';
  for (var i = 1; i < data.length; i++) {
    if (deletedIdx >= 0 && data[i][deletedIdx] && data[i][deletedIdx].toString() === '1') continue;
    var row = [];
    for (var k = 0; k < exportIdx.length; k++) {
      var val = data[i][exportIdx[k]];
      if (val instanceof Date) val = Utilities.formatDate(val, 'Indian/Antananarivo', 'yyyy-MM-dd');
      val = val !== undefined && val !== null ? val.toString() : '';
      if (val.indexOf(';') >= 0 || val.indexOf('"') >= 0 || val.indexOf('\n') >= 0) {
        val = '"' + val.replace(/"/g, '""') + '"';
      }
      row.push(val);
    }
    csv += row.join(';') + '\n';
  }

  return ContentService.createTextOutput(csv).setMimeType(ContentService.MimeType.CSV);
}

// ============================================================
// GET LOGS (POST, admin)
// ============================================================

function handleGetLogs(e) {
  var user = getAuthUser(e);
  if (!isAdmin(user)) return jsonResponse({ success: false, error: 'Acces refuse - Admin uniquement' });

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(LOGS_SHEET);
  if (!sheet) return jsonResponse({ success: true, data: [] });

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return jsonResponse({ success: true, data: [] });

  var headers = data[0];
  var results = [];
  var start = Math.max(1, data.length - 500);
  for (var i = data.length - 1; i >= start; i--) {
    var row = {};
    for (var j = 0; j < headers.length; j++) {
      row[headers[j]] = data[i][j] !== undefined ? data[i][j].toString() : '';
    }
    results.push(row);
  }
  return jsonResponse({ success: true, data: results });
}

// ============================================================
// CHANGE ROLE (POST, admin)
// ============================================================

/**
 * POST 'set-user-active' (admin) : desactive ou reactive un compte.
 * Body : { email, actif: '0' | '1' }
 * Desactiver conserve la ligne (nom, role, historique) et les projets de la personne ;
 * seul l'acces est coupe : connexion refusee, session revoquee, reinitialisation impossible.
 */
function handleSetUserActive(e) {
  var admin = getAuthUser(e);
  if (!isAdmin(admin)) return jsonResponse({ success: false, error: 'Admin requis' });

  var body        = JSON.parse(e.postData.contents);
  var targetEmail = (body.email || '').trim().toLowerCase();
  var actif       = (body.actif === '1' || body.actif === 1 || body.actif === true) ? '1' : '0';
  var di          = extractDeviceInfo(e);

  if (!targetEmail) return jsonResponse({ success: false, error: 'Email requis' });
  if (targetEmail === admin.email.toLowerCase())
    return jsonResponse({ success: false, error: 'Vous ne pouvez pas desactiver votre propre compte' });

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(USERS_SHEET);
  if (!sheet) return jsonResponse({ success: false, error: 'Onglet introuvable' });
  var actifIdx  = ensureColumn(sheet, 'Actif');
  var data      = sheet.getDataRange().getValues();
  var headers   = data[0];
  var emailIdx  = headers.indexOf('Email');
  var tokenIdx  = headers.indexOf('Session_Token');
  var expiryIdx = headers.indexOf('Session_Expiry');
  var nomIdx    = headers.indexOf('Nom');
  var prenomIdx = headers.indexOf('Prenom');

  for (var i = 1; i < data.length; i++) {
    if (data[i][emailIdx] && data[i][emailIdx].toString().toLowerCase().trim() === targetEmail) {
      sheet.getRange(i + 1, actifIdx + 1).setValue(actif);
      if (actif === '0') {
        // Revoquer la session en cours : la personne est deconnectee a sa prochaine requete
        if (tokenIdx  >= 0) sheet.getRange(i + 1, tokenIdx  + 1).setValue('');
        if (expiryIdx >= 0) sheet.getRange(i + 1, expiryIdx + 1).setValue('');
      }
      var qui = (data[i][prenomIdx] || '') + ' ' + (data[i][nomIdx] || '');
      addLog(admin.email, admin.role, actif === '0' ? 'deactivate_user' : 'reactivate_user',
             (actif === '0' ? 'Desactivation' : 'Reactivation') + ' : ' + targetEmail + ' (' + qui.trim() + ')', di);
      return jsonResponse({ success: true, message: (actif === '0' ? 'Compte desactive : ' : 'Compte reactive : ') + targetEmail });
    }
  }
  return jsonResponse({ success: false, error: 'Utilisateur introuvable' });
}

function handleChangeRole(e) {
  var admin = getAuthUser(e);
  if (!isAdmin(admin)) return jsonResponse({ success: false, error: 'Admin requis' });

  var body        = JSON.parse(e.postData.contents);
  var targetEmail = (body.email || '').trim().toLowerCase();
  var newRole     = (body.role  || '').trim().toLowerCase();

  if (['admin', 'direction', 'vie_scolaire', 'enseignant'].indexOf(newRole) < 0)
    return jsonResponse({ success: false, error: 'Role invalide' });
  if (targetEmail === admin.email.toLowerCase())
    return jsonResponse({ success: false, error: 'Vous ne pouvez pas changer votre propre role' });

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(USERS_SHEET);
  if (!sheet) return jsonResponse({ success: false, error: 'Onglet introuvable' });

  var data     = sheet.getDataRange().getValues();
  var headers  = data[0];
  var emailIdx = headers.indexOf('Email');
  var roleIdx  = headers.indexOf('Role');

  for (var i = 1; i < data.length; i++) {
    if (data[i][emailIdx] && data[i][emailIdx].toString().toLowerCase() === targetEmail) {
      var oldRole = data[i][roleIdx].toString();
      sheet.getRange(i + 1, roleIdx + 1).setValue(newRole);
      addLog(admin.email, admin.role, 'change_role', targetEmail + ': ' + oldRole + ' -> ' + newRole);
      return jsonResponse({ success: true, message: 'Role modifie : ' + oldRole + ' -> ' + newRole });
    }
  }
  return jsonResponse({ success: false, error: 'Utilisateur introuvable' });
}

// ============================================================
// EMAILS AUTORISES (POST, admin)
// ============================================================

function handleListEmails(e) {
  var user = getAuthUser(e);
  if (!isAdmin(user)) return jsonResponse({ success: false, error: 'Acces refuse' });
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(EMAILS_SHEET);
  if (!sheet) return jsonResponse({ success: true, data: [] });
  var data = sheet.getDataRange().getValues();
  var emails = [];
  for (var i = 1; i < data.length; i++) {
    if (data[i][0]) emails.push(data[i][0].toString());
  }
  return jsonResponse({ success: true, data: emails });
}

function handleAddEmail(e) {
  var user = getAuthUser(e);
  if (!isAdmin(user)) return jsonResponse({ success: false, error: 'Acces refuse' });
  var body     = JSON.parse(e.postData.contents);
  var newEmail = (body.email || body.Email || '').trim().toLowerCase();
  if (!newEmail.endsWith('@egd.mg'))
    return jsonResponse({ success: false, error: 'Seules les adresses @egd.mg sont autorisees' });
  if (isEmailAuthorized(newEmail))
    return jsonResponse({ success: false, error: 'Cette adresse est deja dans la liste' });
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(EMAILS_SHEET);
  sheet.appendRow([newEmail]);
  addLog(user.email, user.role, 'add_email', 'Ajout email autorise: ' + newEmail);
  return jsonResponse({ success: true, message: 'Email ajoute a la liste' });
}

function handleDeleteEmail(e) {
  var user = getAuthUser(e);
  if (!isAdmin(user)) return jsonResponse({ success: false, error: 'Acces refuse' });
  var body        = JSON.parse(e.postData.contents);
  var targetEmail = (body.target || '').trim().toLowerCase();
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(EMAILS_SHEET);
  if (!sheet) return jsonResponse({ success: false, error: 'Onglet introuvable' });
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] && data[i][0].toString().toLowerCase().trim() === targetEmail) {
      sheet.deleteRow(i + 1);
      addLog(user.email, user.role, 'delete_email', 'Suppression email autorise: ' + targetEmail);
      return jsonResponse({ success: true, message: 'Email supprime de la liste' });
    }
  }
  return jsonResponse({ success: false, error: 'Email introuvable' });
}

// ============================================================
// ADD (POST)
// ============================================================

function handleAdd(e) {
  var user = getAuthUser(e);
  if (!user) return jsonResponse({ success: false, error: 'Authentification requise' });

  var body  = JSON.parse(e.postData.contents);
  // table logique : 'Projets' (defaut) ou 'Utilisateurs'
  var table = e.parameter.table || body.table || body._table || 'Projets';
  var year  = getYearParam(e);
  var isProject = (table !== USERS_SHEET);

  if (!isProject && !isAdmin(user)) return jsonResponse({ success: false, error: 'Admin requis' });

  var sheet;
  if (isProject) {
    if (isArchivedYear(year) && !isAdmin(user))
      return jsonResponse({ success: false, error: "Cette annee est archivee (lecture seule). Seul l'administrateur peut la modifier." });
    sheet = ensureYearSheet(year); // creation paresseuse de l'onglet de l'annee
  } else {
    sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(USERS_SHEET);
  }
  if (!sheet) return jsonResponse({ success: false, error: 'Onglet introuvable' });

  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  if (isProject) {
    if (isVieScolaire(user) && !isVsCat(body['Categorie']))
      return jsonResponse({ success: false, error: 'Vie scolaire : creation limitee a vos categories' });
    body['ID_Projet']          = generateProjectId(body['Categorie'], sheet);
    // Le formulaire ne saisit pas le statut (il est recalcule a l'affichage depuis les
    // dates) : sans valeur par defaut la colonne reste vide dans la feuille et l'export.
    if (!body['Statut']) body['Statut'] = 'Planifié';
    body['Created_By']         = user.email;
    body['Deleted']            = '';
    body['Deleted_By']         = '';
    body['Deleted_Date']       = '';
    body['Locked']             = '';
    body['Locked_By']          = '';
    body['Locked_Date']        = '';
    body['Last_Modified_By']   = user.email;
    body['Last_Modified_Date'] = nowStr();
    addLog(user.email, user.role, 'add_project', 'Nouveau projet: ' + (body['Nom_Projet'] || '') + ' (' + body['ID_Projet'] + ')');
  }

  if (table === USERS_SHEET) {
    var plainPwd = body['Mot_de_Passe'] || generatePassword();
    body['Mot_de_Passe'] = hashPassword(plainPwd);
    body['Mdp_Initial']  = plainPwd;
    body['First_Login']  = '1';
    if (emailAlreadyRegistered(body['Email'])) return jsonResponse({ success: false, error: 'Email deja utilise' });
    body['Reset_Token']    = '';
    body['Reset_Expiry']   = '';
    body['Session_Token']  = '';
    body['Session_Expiry'] = '';
    addLog(user.email, user.role, 'add_user', 'Creation utilisateur: ' + body['Email'] + ' (' + (body['Role'] || 'enseignant') + ')');
  }

  var newRow = headers.map(function(h) { return body[h] !== undefined ? sanitizeCell(body[h]) : ''; });
  sheet.appendRow(newRow);
  var response = { success: true, message: 'Ajout reussi', id: body['ID_Projet'] || body['Email'] };
  if (table === USERS_SHEET) response.generated_password = body['Mdp_Initial'];
  return jsonResponse(response);
}

// ============================================================
// UPDATE (POST, avec audit trail + verrouillage)
// ============================================================

function handleUpdate(e) {
  var user = getAuthUser(e);
  if (!user) return jsonResponse({ success: false, error: 'Authentification requise' });

  var body  = JSON.parse(e.postData.contents);
  var year  = getYearParam(e);

  if (isArchivedYear(year) && !isAdmin(user))
    return jsonResponse({ success: false, error: "Cette annee est archivee (lecture seule). Seul l'administrateur peut la modifier." });

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(projetsSheetName(year));
  if (!sheet) return jsonResponse({ success: false, error: 'Onglet introuvable' });

  var data         = sheet.getDataRange().getValues();
  var headers      = data[0];
  var idIdx        = headers.indexOf('ID_Projet');
  var createdByIdx = headers.indexOf('Created_By');
  var catIdx       = headers.indexOf('Categorie');
  var lockedIdx    = headers.indexOf('Locked');
  var lmByIdx      = headers.indexOf('Last_Modified_By');
  var lmDateIdx    = headers.indexOf('Last_Modified_Date');

  for (var i = 1; i < data.length; i++) {
    if (data[i][idIdx] === body['ID_Projet']) {
      if (lockedIdx >= 0 && data[i][lockedIdx] && data[i][lockedIdx].toString() === '1') {
        if (!isAdminOrDirection(user))
          return jsonResponse({ success: false, error: 'Ce projet est verrouille. Contactez la direction pour le modifier.' });
      }

      var owner      = data[i][createdByIdx] ? data[i][createdByIdx].toString() : '';
      var projectCat = data[i][catIdx] ? data[i][catIdx].toString() : '';
      var refIdx     = headers.indexOf('Enseignant_Referent');
      var referent   = refIdx >= 0 ? (data[i][refIdx] || '').toString() : '';

      if (isVieScolaire(user) && !isVsCat(projectCat))
        return jsonResponse({ success: false, error: 'Vie scolaire : modification limitee a vos categories' });
      if (!isAdminOrDirection(user) && !isVieScolaire(user) && owner !== user.email && !isReferentOf(user, referent))
        return jsonResponse({ success: false, error: 'Vous ne pouvez modifier que vos propres projets' });

      for (var j = 0; j < headers.length; j++) {
        if (headers[j] === 'ID_Projet' || headers[j] === 'Created_By') continue;
        if (headers[j] === 'Deleted' || headers[j] === 'Deleted_By' || headers[j] === 'Deleted_Date') continue;
        if (headers[j] === 'Last_Modified_By' || headers[j] === 'Last_Modified_Date') continue;
        if (body[headers[j]] !== undefined) sheet.getRange(i + 1, j + 1).setValue(sanitizeCell(body[headers[j]]));
      }
      if (lmByIdx >= 0)   sheet.getRange(i + 1, lmByIdx + 1).setValue(user.email);
      if (lmDateIdx >= 0) sheet.getRange(i + 1, lmDateIdx + 1).setValue(nowStr());

      addLog(user.email, user.role, 'update_project', 'Modification: ' + body['ID_Projet'] + ' - ' + (body['Nom_Projet'] || ''));
      return jsonResponse({ success: true, message: 'Modification reussie' });
    }
  }
  return jsonResponse({ success: false, error: 'Projet introuvable' });
}

// ============================================================
// INITIALISATION v6
// ============================================================

function initializeSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var yr = currentSchoolYear();

  // Projets de l'annee courante (27 colonnes) — onglet date
  ensureYearSheet(yr);

  // Utilisateurs (11 colonnes v6 : +Session_Token, Session_Expiry)
  var u = ss.getSheetByName(USERS_SHEET);
  if (!u) {
    u = ss.insertSheet(USERS_SHEET);
    u.getRange(1, 1, 1, 12).setValues([['Email','Mot_de_Passe','Role','Nom','Prenom','Reset_Token','Reset_Expiry','Mdp_Initial','First_Login','Session_Token','Session_Expiry','Actif']]);
    u.getRange(1, 1, 1, 12).setFontWeight('bold').setBackground('#0053a3').setFontColor('white');
    u.setFrozenRows(1);
    var adminPwd = generatePassword();
    u.appendRow(['admin@egd.mg', hashPassword(adminPwd), 'admin', 'Administrateur', 'LFT', '', '', adminPwd, '1', '', '']);
    Logger.log('Admin cree : admin@egd.mg / ' + adminPwd);
  } else {
    var existingH = u.getRange(1, 1, 1, u.getLastColumn()).getValues()[0];
    var newCols = ['Reset_Token','Reset_Expiry','Mdp_Initial','First_Login','Session_Token','Session_Expiry','Actif'];
    for (var c = 0; c < newCols.length; c++) {
      if (existingH.indexOf(newCols[c]) < 0) {
        var col = u.getLastColumn() + 1;
        u.getRange(1, col).setValue(newCols[c]).setFontWeight('bold').setBackground('#0053a3').setFontColor('white');
      }
    }
  }

  // Emails autorises
  var em = ss.getSheetByName(EMAILS_SHEET);
  if (!em) {
    em = ss.insertSheet(EMAILS_SHEET);
    em.getRange(1, 1).setValue('Email').setFontWeight('bold').setBackground('#0053a3').setFontColor('white');
    em.setFrozenRows(1);
    em.appendRow(['admin@egd.mg']);
  }

  // Logs (10 colonnes)
  var logs = ss.getSheetByName(LOGS_SHEET);
  if (!logs) {
    logs = ss.insertSheet(LOGS_SHEET);
    logs.getRange(1, 1, 1, 10).setValues([['Date_Heure','Email','Role','Action','Detail','Pays','Ville','OS','Navigateur','Appareil']]);
    logs.getRange(1, 1, 1, 10).setFontWeight('bold').setBackground('#0053a3').setFontColor('white');
    logs.setFrozenRows(1);
  } else {
    var logH = logs.getRange(1, 1, 1, logs.getLastColumn()).getValues()[0];
    var newLogCols = ['Pays','Ville','OS','Navigateur','Appareil'];
    for (var lc = 0; lc < newLogCols.length; lc++) {
      if (logH.indexOf(newLogCols[lc]) < 0) {
        var lcol = logs.getLastColumn() + 1;
        logs.getRange(1, lcol).setValue(newLogCols[lc]).setFontWeight('bold').setBackground('#0053a3').setFontColor('white');
      }
    }
  }

  // Commentaires de l'annee courante — onglet date
  ensureCommentsSheet(yr);

  Logger.log('=== Initialisation v7 terminee ! ===');
  Logger.log('Annee scolaire courante : ' + yr);
  Logger.log('Onglets dates : ' + projetsSheetName(yr) + ', ' + commentsSheetName(yr));
  Logger.log('Bascule automatique le 4 juillet');
}

// ============================================================
// MIGRATION ONE-SHOT : Projets -> Projets_2025-2026
// A executer UNE SEULE FOIS dans l'editeur Apps Script.
// Idempotente : ne fait rien si la migration est deja faite.
// ============================================================

function migrateToYearlySheets() {
  var ss   = SpreadsheetApp.getActiveSpreadsheet();
  var year = '2025-2026'; // l'annee historique des donnees existantes
  var done = [];

  // 1) Projets -> Projets_2025-2026
  var oldP = ss.getSheetByName('Projets');
  var newPName = projetsSheetName(year);
  if (oldP && !ss.getSheetByName(newPName)) {
    oldP.setName(newPName);
    done.push('Projets -> ' + newPName);
  }

  // 2) Commentaires -> Commentaires_2025-2026
  var oldC = ss.getSheetByName('Commentaires');
  var newCName = commentsSheetName(year);
  if (oldC && !ss.getSheetByName(newCName)) {
    oldC.setName(newCName);
    done.push('Commentaires -> ' + newCName);
  }

  // 3) Preparer l'annee suivante (vide, avec en-tetes) pour la saisie anticipee
  var nextYear = '2026-2027';
  if (!ss.getSheetByName(projetsSheetName(nextYear))) {
    ensureYearSheet(nextYear);
    done.push('Cree ' + projetsSheetName(nextYear) + ' (vide)');
  }

  Logger.log(done.length ? ('Migration : ' + done.join(' | ')) : 'Rien a migrer (deja fait).');
  return done;
}

// ============================================================
// LIST YEARS (GET, public) — onglets Projets_* disponibles
// ============================================================

function handleListYears(e) {
  var ss     = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ss.getSheets();
  var years  = [];
  var pfx    = PROJETS_PREFIX + '_';
  for (var i = 0; i < sheets.length; i++) {
    var name = sheets[i].getName();
    if (name.indexOf(pfx) === 0) {
      years.push(name.substring(pfx.length));
    }
  }
  var current = currentSchoolYear();
  // S'assurer que l'annee courante figure toujours dans la liste
  if (years.indexOf(current) < 0) years.push(current);
  years.sort(); // ordre lexicographique = ordre chronologique pour "YYYY-YYYY"
  return jsonResponse({ success: true, years: years, current: current });
}

// ============================================================
// RECONDUCT (POST) — duplique un projet vers une autre annee
// ============================================================

/** Annee scolaire suivant celle passee : "2026-2027" -> "2027-2028". */
function nextSchoolYearOf(y) {
  var p = String(y).split('-');
  if (p.length !== 2) return y;
  return (parseInt(p[0], 10) + 1) + '-' + (parseInt(p[1], 10) + 1);
}

/**
 * Controle l'annee cible d'une reconduction.
 * On n'autorise que l'annee courante (cas normal de la rentree) ou l'annee suivante,
 * cette derniere reservee a la direction : un enseignant ne doit pas pouvoir creer par
 * megarde un onglet d'annee, aussitot publie a tous les visiteurs par list-years.
 * Retourne null si autorise, sinon le message d'erreur.
 */
function targetYearError(user, targetYear) {
  var cur = currentSchoolYear();
  if (targetYear === cur) return null;
  if (targetYear === nextSchoolYearOf(cur)) {
    return isAdminOrDirection(user) ? null
      : "Seules la direction et l'administration peuvent ouvrir l'annee " + targetYear + '.';
  }
  return "Annee cible non autorisee (" + targetYear + "). La reconduction vise " + cur + '.';
}

/** Index des projets deja reconduits dans l'onglet cible : cle "<annee>/<ID source>". */
function buildReconductIndex(tgtData, tgtHeaders) {
  var idx = tgtHeaders.indexOf('Reconduit_De');
  var seen = {};
  if (idx < 0) return seen;
  for (var i = 1; i < tgtData.length; i++) {
    var v = tgtData[i][idx];
    if (v) seen[v.toString()] = true;
  }
  return seen;
}

/**
 * Compteurs de numerotation par prefixe pour un onglet donne, calcules une seule fois.
 * Evite de relire toute la feuille a chaque projet lors d'une reconduction en lot.
 */
function buildIdCounters(tgtData) {
  var max = {};
  for (var i = 1; i < tgtData.length; i++) {
    var id = tgtData[i][0] ? tgtData[i][0].toString() : '';
    var m  = id.split('-');
    if (m.length === 2) {
      var n = parseInt(m[1], 10);
      if (!isNaN(n) && (!max[m[0]] || n > max[m[0]])) max[m[0]] = n;
    }
  }
  return max;
}

function prefixForCategory(categorie) {
  if (categorie && categorie.indexOf('AEFE') >= 0)          return 'AEFE';
  if (categorie && categorie.indexOf('Zone') >= 0)          return 'ZOI';
  if (categorie && categorie.indexOf('institution') >= 0)   return 'INST';
  if (categorie && categorie.indexOf('Clubs') >= 0)         return 'CLUB';
  if (categorie && categorie.indexOf('Internat') >= 0)      return 'INT';
  return 'LFT';
}

/** Construit la ligne du projet reconduit, sans l'ecrire. */
function buildReconductedRow(src, srcHeaders, tgtHeaders, user, sourceYear, sourceId, newId) {
  var copy = {};
  for (var h = 0; h < srcHeaders.length; h++) copy[srcHeaders[h]] = src[h];
  var reset = {
    'ID_Projet': newId,
    'Statut': 'Planifié',
    'Date_Debut': '', 'Date_Fin': '',
    'Created_By': user.email,
    'Deleted': '', 'Deleted_By': '', 'Deleted_Date': '',
    'Locked': '', 'Locked_By': '', 'Locked_Date': '',
    'Last_Modified_By': user.email,
    'Last_Modified_Date': nowStr(),
    'Reconduit_De': sourceYear + '/' + sourceId
  };
  return tgtHeaders.map(function(col) {
    if (reset.hasOwnProperty(col)) return sanitizeCell(reset[col]);
    var v = copy.hasOwnProperty(col) ? copy[col] : '';
    if (v instanceof Date) v = Utilities.formatDate(v, 'Indian/Antananarivo', 'yyyy-MM-dd');
    return sanitizeCell(v !== undefined && v !== null ? v.toString() : '');
  });
}

// ------------------------------------------------------------
// Reconduction unitaire
// ------------------------------------------------------------

function handleReconduct(e) {
  var user = getAuthUser(e);
  if (!user) return jsonResponse({ success: false, error: 'Authentification requise' });
  var di = extractDeviceInfo(e);

  var body       = JSON.parse(e.postData.contents);
  var sourceId   = (body.id || '').trim();
  var sourceYear = (body.sourceYear || '').trim() || currentSchoolYear();
  var targetYear = (body.targetYear || '').trim() || currentSchoolYear();
  var force      = body.force === true;

  if (!sourceId) return jsonResponse({ success: false, error: 'Projet source requis' });

  var yErr = targetYearError(user, targetYear);
  if (yErr) return jsonResponse({ success: false, error: yErr });

  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var srcSh = ss.getSheetByName(projetsSheetName(sourceYear));
  if (!srcSh) return jsonResponse({ success: false, error: 'Annee source introuvable' });

  var data       = srcSh.getDataRange().getValues();
  var srcHeaders = data[0];
  var idIdx      = srcHeaders.indexOf('ID_Projet');

  var src = null;
  for (var i = 1; i < data.length; i++) {
    if (data[i][idIdx] === sourceId) { src = data[i]; break; }
  }
  if (!src) return jsonResponse({ success: false, error: 'Projet source introuvable' });

  var catIdx = srcHeaders.indexOf('Categorie');
  var srcCat = catIdx >= 0 ? (src[catIdx] || '').toString() : '';
  if (isVieScolaire(user) && !isVsCat(srcCat))
    return jsonResponse({ success: false, error: 'Vie scolaire : reconduction limitee a vos categories' });

  var tgtSh      = ensureYearSheet(targetYear);
  var tgtData    = tgtSh.getDataRange().getValues();
  var tgtHeaders = tgtData[0];

  // Deja reconduit ? On previent plutot que de creer un doublon silencieux.
  var seen = buildReconductIndex(tgtData, tgtHeaders);
  if (!force && seen[sourceYear + '/' + sourceId]) {
    return jsonResponse({ success: false, already: true,
      error: 'Ce projet a deja ete reconduit en ' + targetYear + '.' });
  }

  var counters = buildIdCounters(tgtData);
  var prefix   = prefixForCategory(srcCat);
  var newId    = prefix + '-' + ('000' + ((counters[prefix] || 0) + 1)).slice(-3);

  tgtSh.appendRow(buildReconductedRow(src, srcHeaders, tgtHeaders, user, sourceYear, sourceId, newId));

  var nomIdx    = srcHeaders.indexOf('Nom_Projet');
  var nomProjet = nomIdx >= 0 ? (src[nomIdx] || '').toString() : sourceId;
  addLog(user.email, user.role, 'reconduct_project',
    'Reconduit ' + sourceId + ' (' + sourceYear + ') -> ' + newId + ' (' + targetYear + ') : ' + nomProjet, di);
  return jsonResponse({ success: true, message: 'Projet reconduit pour ' + targetYear, id: newId, year: targetYear });
}

// ------------------------------------------------------------
// Reconduction en lot — une seule requete, une seule ecriture
// ------------------------------------------------------------

function handleReconductBatch(e) {
  var user = getAuthUser(e);
  if (!user) return jsonResponse({ success: false, error: 'Authentification requise' });
  var di = extractDeviceInfo(e);

  var body       = JSON.parse(e.postData.contents);
  var ids        = body.ids || [];
  var sourceYear = (body.sourceYear || '').trim();
  var targetYear = (body.targetYear || '').trim() || currentSchoolYear();

  if (!ids.length)   return jsonResponse({ success: false, error: 'Aucun projet selectionne' });
  if (ids.length > 200) return jsonResponse({ success: false, error: 'Trop de projets en une fois (200 maximum)' });
  if (!sourceYear)   return jsonResponse({ success: false, error: 'Annee source requise' });
  if (sourceYear === targetYear) return jsonResponse({ success: false, error: "L'annee source et l'annee cible sont identiques" });

  var yErr = targetYearError(user, targetYear);
  if (yErr) return jsonResponse({ success: false, error: yErr });

  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var srcSh = ss.getSheetByName(projetsSheetName(sourceYear));
  if (!srcSh) return jsonResponse({ success: false, error: 'Annee source introuvable' });

  var data       = srcSh.getDataRange().getValues();
  var srcHeaders = data[0];
  var idIdx      = srcHeaders.indexOf('ID_Projet');
  var catIdx     = srcHeaders.indexOf('Categorie');
  var nomIdx     = srcHeaders.indexOf('Nom_Projet');
  var delIdx     = srcHeaders.indexOf('Deleted');

  // Index des lignes source par identifiant
  var byId = {};
  for (var i = 1; i < data.length; i++) {
    if (delIdx >= 0 && data[i][delIdx] && data[i][delIdx].toString() === '1') continue; // exclut la corbeille
    if (data[i][idIdx]) byId[data[i][idIdx].toString()] = data[i];
  }

  var tgtSh      = ensureYearSheet(targetYear);
  var tgtData    = tgtSh.getDataRange().getValues();
  var tgtHeaders = tgtData[0];
  var seen       = buildReconductIndex(tgtData, tgtHeaders);
  var counters   = buildIdCounters(tgtData);

  var rows = [], crees = [], ignores = [], erreurs = [];

  for (var k = 0; k < ids.length; k++) {
    var sid = String(ids[k]).trim();
    var src = byId[sid];
    if (!src) { erreurs.push({ id: sid, motif: 'introuvable dans ' + sourceYear }); continue; }

    var cat = catIdx >= 0 ? (src[catIdx] || '').toString() : '';
    if (isVieScolaire(user) && !isVsCat(cat)) {
      erreurs.push({ id: sid, motif: 'hors de vos categories' }); continue;
    }
    if (seen[sourceYear + '/' + sid]) {
      ignores.push({ id: sid, motif: 'deja reconduit' }); continue;
    }

    var prefix = prefixForCategory(cat);
    counters[prefix] = (counters[prefix] || 0) + 1;
    var newId = prefix + '-' + ('000' + counters[prefix]).slice(-3);

    rows.push(buildReconductedRow(src, srcHeaders, tgtHeaders, user, sourceYear, sid, newId));
    seen[sourceYear + '/' + sid] = true;
    crees.push({ id: newId, source: sid, nom: nomIdx >= 0 ? (src[nomIdx] || '').toString() : sid });
  }

  // Une seule ecriture groupee : indispensable pour tenir dans le temps d'execution GAS
  if (rows.length) {
    tgtSh.getRange(tgtSh.getLastRow() + 1, 1, rows.length, tgtHeaders.length).setValues(rows);
  }

  addLog(user.email, user.role, 'reconduct_batch',
    rows.length + ' projet(s) reconduit(s) de ' + sourceYear + ' vers ' + targetYear +
    ' (' + ignores.length + ' ignore(s), ' + erreurs.length + ' en erreur)', di);

  return jsonResponse({
    success: true, year: targetYear,
    crees: crees, ignores: ignores, erreurs: erreurs,
    message: rows.length + ' projet(s) reconduit(s) vers ' + targetYear
  });
}

// ============================================================
// SAUVEGARDE AUTOMATIQUE DU CLASSEUR
// Le Google Sheet est la base de donnees : une suppression de ligne, une
// colonne renommee ou une formule collee par erreur sont irreversibles une
// fois l'historique Drive expire. On duplique donc le classeur entier chaque
// nuit dans un dossier Drive, avec rotation.
// ============================================================

var BACKUP_FOLDER_NAME = 'LFT - Sauvegardes Suivi Projets';
var BACKUP_KEEP        = 30;   // nombre de copies conservees (30 jours d'historique)
var BACKUP_HOUR        = 2;    // heure de declenchement (nuit, Indian/Antananarivo)

/** Dossier Drive des sauvegardes, cree au premier appel. */
function getBackupFolder() {
  var it = DriveApp.getFoldersByName(BACKUP_FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(BACKUP_FOLDER_NAME);
}

/**
 * Copie le classeur complet dans le dossier de sauvegarde, puis purge les plus
 * anciennes copies. Appelee par le declencheur nocturne et par l'action
 * 'backup-now'. Retourne l'URL de la copie creee.
 */
function backupSpreadsheet() {
  var ss     = SpreadsheetApp.getActiveSpreadsheet();
  var folder = getBackupFolder();
  var stamp  = Utilities.formatDate(new Date(), 'Indian/Antananarivo', 'yyyy-MM-dd_HH-mm');
  var nom    = 'LFT-Projets_' + stamp;

  var copie = DriveApp.getFileById(ss.getId()).makeCopy(nom, folder);
  var supprimees = pruneBackups(folder);

  addLog('systeme', 'backup', 'backup_sheet',
         'Sauvegarde ' + nom + (supprimees ? ' (' + supprimees + ' ancienne(s) purgee(s))' : ''));
  return copie.getUrl();
}

/** Met a la corbeille les copies au-dela de BACKUP_KEEP, de la plus ancienne a la plus recente. */
function pruneBackups(folder) {
  var fichiers = [];
  var it = folder.getFiles();
  while (it.hasNext()) {
    var f = it.next();
    if (f.getName().indexOf('LFT-Projets_') === 0) {
      fichiers.push({ f: f, d: f.getDateCreated().getTime() });
    }
  }
  if (fichiers.length <= BACKUP_KEEP) return 0;
  fichiers.sort(function(a, b) { return a.d - b.d; });   // plus ancienne en tete
  var aSupprimer = fichiers.length - BACKUP_KEEP;
  for (var i = 0; i < aSupprimer; i++) fichiers[i].f.setTrashed(true);
  return aSupprimer;
}

/**
 * Installe (ou reinstalle) le declencheur nocturne.
 * A EXECUTER UNE FOIS depuis l'editeur Apps Script, apres avoir accorde
 * l'autorisation Drive demandee au premier lancement.
 */
function installBackupTrigger() {
  var existants = ScriptApp.getProjectTriggers();
  for (var i = 0; i < existants.length; i++) {
    if (existants[i].getHandlerFunction() === 'backupSpreadsheet') {
      ScriptApp.deleteTrigger(existants[i]);
    }
  }
  ScriptApp.newTrigger('backupSpreadsheet').timeBased().atHour(BACKUP_HOUR).everyDays(1).create();
  var url = backupSpreadsheet();   // une premiere sauvegarde immediate, pour verifier que tout passe
  Logger.log('Declencheur installe (chaque nuit vers ' + BACKUP_HOUR + 'h).');
  Logger.log('Premiere sauvegarde : ' + url);
  return url;
}

/** Etat des sauvegardes : nombre, date de la plus recente. Utilise par handleBackupNow. */
function backupStatus() {
  var folder = getBackupFolder();
  var n = 0, derniere = null;
  var it = folder.getFiles();
  while (it.hasNext()) {
    var f = it.next();
    if (f.getName().indexOf('LFT-Projets_') !== 0) continue;
    n++;
    var d = f.getDateCreated();
    if (!derniere || d > derniere) derniere = d;
  }
  return {
    nombre: n,
    derniere: derniere ? Utilities.formatDate(derniere, 'Indian/Antananarivo', 'yyyy-MM-dd HH:mm') : null,
    declencheur_actif: hasBackupTrigger()
  };
}

function hasBackupTrigger() {
  var t = ScriptApp.getProjectTriggers();
  for (var i = 0; i < t.length; i++) {
    if (t[i].getHandlerFunction() === 'backupSpreadsheet') return true;
  }
  return false;
}

/**
 * POST 'backup-now' (admin) : sauvegarde a la demande, avant une operation a
 * risque comme une reconduction en lot ou une purge de corbeille.
 */
function handleBackupNow(e) {
  var user = getAuthUser(e);
  if (!isAdmin(user)) return jsonResponse({ success: false, error: 'Acces refuse - Admin uniquement' });
  try {
    var url = backupSpreadsheet();
    var st  = backupStatus();
    addLog(user.email, user.role, 'backup_manuel', 'Sauvegarde declenchee manuellement');
    return jsonResponse({ success: true, message: 'Sauvegarde effectuee', url: url, etat: st });
  } catch (err) {
    // Cause la plus frequente : l'autorisation Drive n'a jamais ete accordee
    return jsonResponse({ success: false,
      error: 'Sauvegarde impossible : ' + err.toString() +
             " — executez installBackupTrigger() une fois depuis l'editeur Apps Script pour accorder l'acces a Drive." });
  }
}

/** POST 'backup-status' (admin) : etat des sauvegardes, sans rien creer. */
function handleBackupStatus(e) {
  var user = getAuthUser(e);
  if (!isAdmin(user)) return jsonResponse({ success: false, error: 'Acces refuse - Admin uniquement' });
  try {
    return jsonResponse({ success: true, etat: backupStatus() });
  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() });
  }
}

// ============================================================
// BROUILLONS GMAIL — transmission des identifiants (rentree)
// A executer depuis l'editeur Apps Script, sous le compte de l'administrateur :
// les brouillons sont crees dans la boite Gmail de l'administrateur, un par
// destinataire ; rien ne part tant qu'il ne les envoie pas lui-meme.
//   creerBrouillonsIdentifiants()       : cree les brouillons manquants (sans doublon)
//   mettreAJourBrouillonsIdentifiants() : regenere le contenu des brouillons existants
//                                          (apres retouche du texte ou de la mise en forme)
// Prerequis : le fichier Signature.gs (banniere de signature en base64) doit etre
// present dans le projet Apps Script — il n'est pas versionne dans git.
// ============================================================

var BROUILLONS_ANNEE      = '2026-2027';
var BROUILLONS_ANNEE_PREC = '2025-2026';
var BROUILLONS_SUJET   = "Plateforme de suivi des projets d'établissement — vos identifiants " + BROUILLONS_ANNEE;
var BROUILLONS_BOITE   = 'max.rafaliarison@egd.mg';   // seule boite autorisee a recevoir les brouillons
var BROUILLONS_SIGNAT  = 'Max William Rafaliarison';
var BROUILLONS_FRANCK  = 'franck.degueurce@egd.mg';   // lien mailto sur son nom dans le courriel
// Comptes crees a la rentree : ils recoivent la formulation « nouveau compte »
var BROUILLONS_NOUVEAUX = ["aina.rakotonindrina@egd.mg","alexandra.denage@egd.mg","candy.rakotoary@egd.mg","claire.doz@egd.mg","clarissa.behar@egd.mg","david.arnaud@egd.mg","david.lablanche@egd.mg","elisabeth.gau@egd.mg","faneva.rabehanitriniony@egd.mg","frederic.danchin@egd.mg","gwenaelle.lazou@egd.mg","herve.hourcq@egd.mg","jean.rio@egd.mg","jennifer.razanadrakoto@egd.mg","jerome.lucas@egd.mg","jonathan.ramontarison@egd.mg","jonathan.robert@egd.mg","juana.rakotoson@egd.mg","laetitia.andreu@egd.mg","laingo.nomenjanahary@egd.mg","laurent.gournier@egd.mg","loic.saunders@egd.mg","magali.roux@egd.mg","petrina.dacosta@egd.mg","philippe.vaillant@egd.mg","pierre.brault@egd.mg","remy.eudeline@egd.mg","sandrine.linder@egd.mg","veronique.andriambelo@egd.mg","yasser.ahmed@egd.mg","yves.guillemot@egd.mg"];

function htmlEsc(s) {
  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/**
 * Corps du courriel : HTML + version texte.
 * Charte graphique LFT / AEFE : bleu AEFE #0053a3, magenta AEFE #d40883, gradient
 * bleu -> magenta (bouton, filet), fonds #f0f4f8. Texte en Garamond, taille grande,
 * bleu nuit #073763 (demande de l'administrateur). Logo LFT charge depuis GitHub Pages ;
 * banniere de signature incorporee en image (cid) depuis Signature.gs, fichier local
 * non versionne qui doit exister dans le projet Apps Script.
 * Structure : en-tete (logo + titre), salutation, bouton d'acces, encadre identifiants,
 * premiere connexion (cas A/C) ou mot de passe oublie (cas B), reprise des projets,
 * disponibilite, signature.
 */
var BROUILLONS_LOGO     = APP_URL + 'logo-lft.jpg';
var BROUILLONS_SIGN_CID = 'signature';   // banniere de signature incorporee (Signature.gs)
// Version du modele, portee par le nom de la banniere jointe : l'incrementer apres
// toute retouche du texte ou de la mise en forme, puis lancer
// mettreAJourBrouillonsIdentifiants() — les brouillons a l'ancienne version sont
// refaits, ceux deja a jour sont sautes (convergence garantie, meme en plusieurs passes).
var BROUILLONS_MODELE   = '2026-09-14-3';
function nomBanniereSignature() { return 'signature-lft-' + BROUILLONS_MODELE + '.png'; }
function composerCourrielIdentifiants(d) {
  var BLEU = '#0053a3', MAG = '#d40883', TXT = '#073763', FOND = '#f0f4f8';
  var GRAD = 'background-color:' + BLEU + ';background-image:linear-gradient(90deg,' + BLEU + ' 0%,' + MAG + ' 100%);';
  var FONT = "font-family:Garamond,'EB Garamond',Georgia,'Times New Roman',serif;";
  var BASE = FONT + 'font-size:large;color:' + TXT + ';line-height:1.35;';
  var P    = '<p style="margin:0 0 10px">';
  var TITRE = '<p style="margin:0 0 4px;color:' + BLEU + '"><b>';
  var h = '<!--[if mso]><table role="presentation" width="640" cellpadding="0" cellspacing="0"><tr><td><![endif]-->' +
          '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:640px"><tr><td style="' + BASE + '">';
  var t = [];

  // En-tete : logo LFT + nom de l'etablissement, souligne d'un filet bleu -> magenta
  h += '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 12px"><tr>' +
       '<td width="72" style="padding:0 14px 6px 0;vertical-align:middle">' +
       '<a href="' + APP_URL + '" style="text-decoration:none"><img src="' + BROUILLONS_LOGO + '" width="64" height="64" alt="LFT" style="display:block;border-radius:50%"></a></td>' +
       '<td style="padding:0 0 6px;vertical-align:middle;' + BASE + '">' +
       '<span style="font-size:x-large;font-weight:bold;color:' + BLEU + '">Lycée Français de Tananarive</span><br>' +
       '<span style="font-size:medium;color:' + MAG + '">Suivi des projets d\'établissement &nbsp;·&nbsp; ' + BROUILLONS_ANNEE + '</span></td>' +
       '</tr><tr><td colspan="2" style="height:3px;line-height:3px;font-size:3px;' + GRAD + '">&nbsp;</td></tr></table>';
  t.push("LYCÉE FRANÇAIS DE TANANARIVE · Suivi des projets d'établissement · " + BROUILLONS_ANNEE, '');

  // Salutation + contexte
  h += P + 'Bonjour ' + htmlEsc(d.prenom) + ',</p>';
  t.push('Bonjour ' + d.prenom + ',', '');
  var intro = "La plateforme de suivi des projets d'établissement est ouverte pour l'année scolaire " + BROUILLONS_ANNEE +
              ". Vous pouvez dès à présent y déclarer vos projets et y reprendre, en quelques clics, ceux de l'année dernière.";
  h += P + intro + '</p>';
  t.push(intro, '');

  // Bouton d'acces (tableau : rendu fiable dans Gmail / Outlook), gradient AEFE
  h += '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:2px 0 12px"><tr><td style="border-radius:6px;padding:8px 22px;' + GRAD + '">' +
       '<a href="' + APP_URL + '" style="' + FONT + 'font-size:large;display:inline-block;color:#ffffff;text-decoration:none;font-weight:bold">Accéder à la plateforme</a>' +
       '</td></tr></table>';
  t.push('Plateforme : ' + APP_URL, '');

  // Encadre identifiants (fond gris tres clair, filet magenta)
  h += '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 12px;background-color:' + FOND + ';border-left:4px solid ' + MAG + '"><tr><td style="padding:8px 14px;' + BASE + '">';
  h += '<b style="color:' + BLEU + '">Identifiant :</b> ' + htmlEsc(d.email) + '<br>';
  t.push('Identifiant : ' + d.email);
  if (d.sit === 'B') {
    h += '<b style="color:' + BLEU + '">Mot de passe :</b> celui que vous avez choisi — vos identifiants restent inchangés.';
    t.push('Mot de passe : celui que vous avez choisi — vos identifiants restent inchangés.', '');
  } else {
    h += '<b style="color:' + BLEU + '">Mot de passe provisoire :</b> <span style="letter-spacing:.06em">' + htmlEsc(d.mdp) + '</span>' +
         (d.sit === 'A' ? " <i>(inchangé depuis l'année dernière)</i>" : '');
    t.push('Mot de passe provisoire : ' + d.mdp + (d.sit === 'A' ? " (inchangé depuis l'année dernière)" : ''), '');
  }
  h += '</td></tr></table>';

  // Premiere connexion (A/C) ou mot de passe oublie (B)
  if (d.sit === 'B') {
    h += P + "Connectez-vous avec le bouton « Connexion », en haut à droite. En cas d'oubli, cliquez sur « Mot de passe oublié ? » dans la fenêtre de connexion : vous recevrez un lien de réinitialisation, valable 24 heures.</p>";
    t.push("Connectez-vous avec le bouton « Connexion », en haut à droite. En cas d'oubli, cliquez sur « Mot de passe oublié ? » dans la fenêtre de connexion : vous recevrez un lien de réinitialisation, valable 24 heures.", '');
  } else {
    h += TITRE + 'Première connexion</b></p>' +
         '<ol style="margin:0 0 12px;padding-left:24px;' + BASE + '">' +
         '<li>Cliquez sur « Connexion », en haut à droite.</li>' +
         '<li>Saisissez votre adresse e-mail et le mot de passe provisoire ci-dessus.</li>' +
         '<li>Choisissez votre mot de passe personnel : 8 caractères au moins, avec une majuscule, une minuscule et un chiffre.</li>' +
         '</ol>';
    t.push('Première connexion :',
           '1. Cliquez sur « Connexion », en haut à droite.',
           '2. Saisissez votre adresse e-mail et le mot de passe provisoire ci-dessus.',
           '3. Choisissez votre mot de passe personnel : 8 caractères au moins, avec une majuscule, une minuscule et un chiffre.', '');
  }

  // Reprise des projets
  var reprise = 'après connexion, choisissez « ' + BROUILLONS_ANNEE_PREC + " » dans le sélecteur d'année, en haut à droite, cliquez sur « Reprendre des projets », " +
                'cochez les projets à reprendre, puis validez avec « Reconduire la sélection vers ' + BROUILLONS_ANNEE + ' ». ' +
                'Les fiches sont recopiées dans ' + BROUILLONS_ANNEE + " ; il ne vous reste qu'à en actualiser les dates.";
  h += TITRE + "Reprendre vos projets de l'année dernière</b></p>" + P + reprise.charAt(0).toUpperCase() + reprise.slice(1) + '</p>';
  t.push("Reprendre vos projets de l'année dernière : " + reprise, '');

  // Disponibilite + signature
  h += P + '<a href="mailto:' + BROUILLONS_FRANCK + '" style="color:' + BLEU + ';font-weight:bold;text-decoration:underline">Franck Degueurce</a>' +
       " et moi-même restons à votre disposition pour toute question ou proposition d'amélioration de notre système.</p>";
  t.push('Franck Degueurce (' + BROUILLONS_FRANCK + ") et moi-même restons à votre disposition pour toute question ou proposition d'amélioration de notre système.", '');
  h += '<p style="margin:14px 0 8px">Bien cordialement,</p>' +
       '<img src="cid:' + BROUILLONS_SIGN_CID + '" width="600" height="120" alt="' + htmlEsc(BROUILLONS_SIGNAT) + ' — Professeur de technologie — Lycée Français de Tananarive" ' +
       'style="display:block;width:600px;max-width:100%;height:auto;border:0">' +
       '</td></tr></table><!--[if mso]></td></tr></table><![endif]-->';
  t.push('Bien cordialement,', BROUILLONS_SIGNAT, 'Professeur de technologie', 'Lycée Français de Tananarive — AEFE',
         '+261 (0)20 23 425 25 · www.egd.mg · BP 4019 Ambatobe · 101 Antananarivo · Madagascar');
  var images = {}; images[BROUILLONS_SIGN_CID] = signatureBlob(nomBanniereSignature());
  return { html: typoFr(h), texte: t.join('\n'), inlineImages: images };
}

/** Espaces insécables à la française dans le HTML (texte seulement, jamais dans les balises). */
function typoFr(html) {
  return html.split(/(<[^>]*>)/).map(function (part, i) {
    if (i % 2 === 1) return part;   // balise
    return part.replace(/« /g, '«&nbsp;').replace(/ »/g, '&nbsp;»').replace(/ ([:;?!])/g, '&nbsp;$1');
  }).join('');
}

/** Garde : le script doit tourner sous la boite de l'administrateur. */
function verifierBoiteBrouillons() {
  var moi = Session.getEffectiveUser().getEmail().toLowerCase();
  if (moi !== BROUILLONS_BOITE) {
    throw new Error('Refus : ce script tourne sous ' + moi + ' et non ' + BROUILLONS_BOITE + '. Les brouillons iraient dans la mauvaise boite.');
  }
  return moi;
}

/** Adresse du destinataire d'un brouillon (« Nom <email> » ou « email »). */
function emailDestinataireBrouillon(message) {
  return (message.getTo() || '').toLowerCase().replace(/^.*<|>.*$/g, '').trim();
}

/**
 * Destinataires depuis l'onglet Utilisateurs : comptes actifs, roles enseignant
 * et vie_scolaire. Retourne { parEmail: {email -> d}, sansMdp: [emails] }.
 *   d = { email, prenom, sit (A/B/C), mdp }
 */
function chargerDestinatairesIdentifiants() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(USERS_SHEET);
  var data  = sheet.getDataRange().getValues();
  var H     = data[0];
  var iEmail = H.indexOf('Email'), iRole = H.indexOf('Role'), iPrenom = H.indexOf('Prenom'),
      iFirst = H.indexOf('First_Login'), iMdp = H.indexOf('Mdp_Initial'), iActif = H.indexOf('Actif');
  var nouveaux = {};
  for (var n = 0; n < BROUILLONS_NOUVEAUX.length; n++) nouveaux[BROUILLONS_NOUVEAUX[n]] = true;

  var parEmail = {}, sansMdp = [];
  for (var i = 1; i < data.length; i++) {
    var email = (data[i][iEmail] || '').toString().trim().toLowerCase();
    var role  = (data[i][iRole]  || '').toString();
    if (!email || email === BROUILLONS_BOITE) continue;
    if (role !== 'enseignant' && role !== 'vie_scolaire') continue;
    if (!isRowActive(data[i], iActif)) continue;

    var mdpInit = (data[i][iMdp] || '').toString().trim();
    var sit = nouveaux[email] ? 'C' : ((data[i][iFirst] || '').toString() === '1' && mdpInit ? 'A' : 'B');
    if (sit !== 'B' && !mdpInit) { sansMdp.push(email); continue; }   // ne jamais envoyer un mdp vide
    parEmail[email] = { email: email, prenom: (data[i][iPrenom] || '').toString(), sit: sit, mdp: mdpInit };
  }
  return { parEmail: parEmail, sansMdp: sansMdp };
}

function creerBrouillonsIdentifiants() {
  var moi = verifierBoiteBrouillons();
  // Brouillons deja presents avec ce sujet (reexecution sans doublon)
  var deja = {};
  var drafts = GmailApp.getDrafts();
  for (var k = 0; k < drafts.length; k++) {
    var m = drafts[k].getMessage();
    if (m.getSubject() === BROUILLONS_SUJET) deja[emailDestinataireBrouillon(m)] = true;
  }

  var dest = chargerDestinatairesIdentifiants();
  var crees = 0, ignores = 0, compte = { A: 0, B: 0, C: 0 };
  var emails = Object.keys(dest.parEmail).sort();
  for (var i = 0; i < emails.length; i++) {
    var d = dest.parEmail[emails[i]];
    if (deja[d.email]) { ignores++; continue; }
    var c = composerCourrielIdentifiants(d);
    GmailApp.createDraft(d.email, BROUILLONS_SUJET, c.texte, { htmlBody: c.html, inlineImages: c.inlineImages, name: BROUILLONS_SIGNAT });
    crees++; compte[d.sit]++;
  }
  var bilan = 'Brouillons crees : ' + crees + ' (A=' + compte.A + ', B=' + compte.B + ', C=' + compte.C + ')'
            + (ignores ? ' | deja presents ignores : ' + ignores : '')
            + (dest.sansMdp.length ? ' | SANS MOT DE PASSE (non crees) : ' + dest.sansMdp.join(', ') : '');
  Logger.log(bilan);
  addLog(moi, 'admin', 'brouillons_identifiants', bilan);
  return bilan;
}

var BROUILLONS_MAJ_TEMPS_MAX_S = 300;   // marge sous la limite de 6 min d'Apps Script : relancer pour finir

/** Vrai si le brouillon porte deja la banniere de signature de la version courante du modele. */
function brouillonDejaAJour(message) {
  var pj = message.getAttachments({ includeInlineImages: true, includeAttachments: true });
  var nom = nomBanniereSignature();
  for (var i = 0; i < pj.length; i++) if (pj[i].getName() === nom) return true;
  return false;
}

/**
 * Regenere le contenu (HTML + texte + signature incorporee) de chaque brouillon
 * deja cree, sans en changer le destinataire ni le sujet. Rien n'est envoye.
 * Les brouillons deja a la version BROUILLONS_MODELE sont sautes ; la fonction
 * s'arrete avant la limite de temps sans plus appeler Gmail — la relancer
 * jusqu'a ce que le journal n'indique plus de restants.
 */
function mettreAJourBrouillonsIdentifiants() {
  var debut = Date.now();
  var moi  = verifierBoiteBrouillons();
  var dest = chargerDestinatairesIdentifiants();
  var drafts = GmailApp.getDrafts();
  var maj = 0, deja = 0, inconnus = [], compte = { A: 0, B: 0, C: 0 }, restants = 0;
  for (var k = 0; k < drafts.length; k++) {
    if ((Date.now() - debut) / 1000 > BROUILLONS_MAJ_TEMPS_MAX_S) { restants = drafts.length - k; break; }
    var m = drafts[k].getMessage();
    if (m.getSubject() !== BROUILLONS_SUJET) continue;
    var email = emailDestinataireBrouillon(m);
    var d = dest.parEmail[email];
    if (!d) { inconnus.push(email); continue; }   // compte desactive ou retire entre-temps : brouillon laisse tel quel
    if (brouillonDejaAJour(m)) { deja++; continue; }
    var c = composerCourrielIdentifiants(d);
    drafts[k].update(d.email, BROUILLONS_SUJET, c.texte, { htmlBody: c.html, inlineImages: c.inlineImages, name: BROUILLONS_SIGNAT });
    maj++; compte[d.sit]++;
  }
  var bilan = 'Brouillons mis a jour (modele ' + BROUILLONS_MODELE + ') : ' + maj + ' (A=' + compte.A + ', B=' + compte.B + ', C=' + compte.C + ')'
            + (deja ? ' | deja a jour (sautes) : ' + deja : '')
            + (restants ? ' | TEMPS LIMITE ATTEINT, restants (au plus) : ' + restants + ' — relancer la fonction' : '')
            + (inconnus.length ? ' | NON MIS A JOUR (destinataire inconnu ou inactif) : ' + inconnus.join(', ') : '');
  Logger.log(bilan);
  addLog(moi, 'admin', 'brouillons_identifiants_maj', bilan);
  return bilan;
}

// ============================================================
// ROTATION DES IDENTIFIANTS PROVISOIRES COMPROMIS (22/09/2026)
// ------------------------------------------------------------
// Le fichier documents/Publipostage_Identifiants_LFT.xlsx (132 lignes : adresse
// + identifiant provisoire) a ete pousse dans le depot GitHub PUBLIC en mars 2026,
// puis retire du dernier etat mais pas de l'historique : il restait telechargeable.
// 103 comptes portaient encore exactement cet identifiant. Cette fonction les
// invalide tous en une passe.
//
// Portee : les comptes First_Login = '1', c'est-a-dire ceux qui ne se sont jamais
// connectes et utilisent donc encore leur identifiant provisoire. Un compte deja
// personnalise (First_Login = '0') n'est pas touche : son identifiant n'a jamais
// figure dans le fichier diffuse.
//
// Mode d'emploi :
//   1. rotationIdentifiantsCompromis(true)   -> simulation, n'ecrit rien
//   2. rotationIdentifiantsCompromis(false)  -> rotation reelle
//   3. Rediffuser ensuite les identifiants (brouillons Gmail).
// La valeur generee n'apparait jamais dans le journal : elle n'est ecrite que dans
// la colonne Mdp_Initial, exactement comme a la creation d'un compte.
// ============================================================

/** Valeur forte de 12 caracteres (alphabet sans caracteres ambigus), tiree avec
 *  Utilities.getUuid() : aleatoire cryptographique, contrairement a Math.random(). */
function valeurProvisoireForte() {
  var upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ', lower = 'abcdefghjkmnpqrstuvwxyz', digits = '23456789';
  var all = upper + lower + digits, hex = '', out = [];
  while (hex.length < 80) hex += Utilities.getUuid().replace(/-/g, '');
  function tire(alpha, i) { return alpha.charAt(parseInt(hex.substr(i * 2, 2), 16) % alpha.length); }
  out.push(tire(upper, 0), tire(lower, 1), tire(digits, 2));
  for (var i = 3; i < 12; i++) out.push(tire(all, i));
  for (var j = out.length - 1; j > 0; j--) {          // Fisher-Yates : melange uniforme
    var k = parseInt(hex.substr(30 + j * 2, 2), 16) % (j + 1), t = out[j]; out[j] = out[k]; out[k] = t;
  }
  return out.join('');
}

function rotationIdentifiantsCompromis(simulation) {
  var simu = (simulation !== false);
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(USERS_SHEET);
  if (!sheet) throw new Error('Onglet ' + USERS_SHEET + ' introuvable.');
  var data = sheet.getDataRange().getValues(), H = data[0];
  var iMail  = H.indexOf('Email'), iPass = H.indexOf('Mot_de_Passe'),
      iInit  = H.indexOf('Mdp_Initial'), iFirst = H.indexOf('First_Login'),
      iActif = H.indexOf('Actif');
  if (iMail < 0 || iPass < 0 || iInit < 0 || iFirst < 0) throw new Error('Colonnes attendues absentes.');

  var touches = [], intacts = 0;
  for (var r = 1; r < data.length; r++) {
    var email = (data[r][iMail] || '').toString().trim();
    if (!email) continue;
    // Un compte peut porter un identifiant provisoire sans que First_Login vaille '1'
    // (colonne restee vide) : le critere retenu est donc l'un OU l'autre.
    if (data[r][iFirst].toString().trim() !== '1' && !data[r][iInit].toString().trim()) { intacts++; continue; }
    if (!simu) {
      var v = valeurProvisoireForte();
      sheet.getRange(r + 1, iPass + 1).setValue(hashPassword(v));
      sheet.getRange(r + 1, iInit + 1).setValue(v);
      sheet.getRange(r + 1, iFirst + 1).setValue('1');
    }
    touches.push(email + (iActif >= 0 && data[r][iActif].toString().trim() === '0' ? ' (desactive)' : ''));
  }

  var bilan = (simu ? 'SIMULATION - rien n\'a ete ecrit. ' : 'ROTATION EFFECTUEE. ')
            + touches.length + ' compte(s) concerne(s), ' + intacts + ' compte(s) intact(s) (identifiant deja personnalise).'
            + (simu ? '\nRelancer avec rotationIdentifiantsCompromis(false) pour appliquer.'
                    : '\nLes anciens identifiants ne fonctionnent plus : rediffuser les nouveaux avant toute communication.')
            + '\nComptes : ' + touches.join(', ');
  if (!simu) addLog(Session.getEffectiveUser().getEmail(), 'admin', 'rotation_identifiants_compromis',
                    touches.length + ' identifiants provisoires regeneres (fuite dans l\'historique du depot public)');
  Logger.log(bilan);
  return bilan;
}
