/**
 * ============================================================
 * LFT - Suivi des Projets d'Etablissement - v6 (SECURISE)
 * Google Apps Script - API Backend
 * Lycee Francais de Tananarive - AEFE
 * ============================================================
 *
 * SECURITE v6 :
 * - Authentification par token de session (UUID, expire 8h)
 * - Plus de mot de passe dans les URL (GET)
 * - Toutes les actions sensibles passent par POST
 * - Verification des roles cote serveur sur chaque action
 *
 * ONGLETS REQUIS :
 * - "Projets"          (27 colonnes)
 * - "Utilisateurs"     (11 colonnes : +Session_Token, Session_Expiry)
 * - "Emails_Autorises" (1 colonne)
 * - "Logs"             (10 colonnes)
 * - "Commentaires"     (5 colonnes)
 *
 * ROLES :
 * - admin        : Tout
 * - direction    : CRUD tous projets, corbeille, verrouillage
 * - vie_scolaire : CRUD "Clubs et activites" + "Projets de l'Internat"
 * - enseignant   : cree, modifie et supprime SES projets uniquement
 */

var PROJETS_SHEET  = 'Projets';
var USERS_SHEET    = 'Utilisateurs';
var EMAILS_SHEET   = 'Emails_Autorises';
var LOGS_SHEET     = 'Logs';
var COMMENTS_SHEET = 'Commentaires';
var ADMIN_EMAIL    = 'max.rafaliarison@aefe.fr';
var APP_URL        = 'https://lyceefrancaisdetananarive.github.io/lft-suivi-projets/';
var SESSION_HOURS  = 8;

var VS_CATS = ['Clubs et activités', "Projets de l'Internat"];

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
  var hashed = hashPassword(password);
  for (var i = 1; i < data.length; i++) {
    if (data[i][emailIdx] && data[i][emailIdx].toString().toLowerCase().trim() === email.toLowerCase().trim()
        && data[i][passIdx] === hashed) {
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

  if (tokenIdx < 0 || expiryIdx < 0) return null;

  for (var i = 1; i < data.length; i++) {
    if (data[i][tokenIdx] && data[i][tokenIdx].toString().trim() === token) {
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
  // Fallback email+password (pour change-password premiere connexion)
  var email = (e.parameter.email || '').trim().toLowerCase();
  var password = e.parameter.password || '';
  if (email && password) {
    return authenticate(email, password);
  }
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

function generateProjectId(categorie) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PROJETS_SHEET);
  var data  = sheet.getDataRange().getValues();
  var prefix  = 'LFT';
  if (categorie && categorie.indexOf('AEFE') >= 0)          prefix = 'AEFE';
  else if (categorie && categorie.indexOf('Zone') >= 0)     prefix = 'ZOI';
  else if (categorie && categorie.indexOf('institution') >= 0) prefix = 'INST';
  else if (categorie && categorie.indexOf('Clubs') >= 0)    prefix = 'CLUB';
  else if (categorie && categorie.indexOf('Internat') >= 0) prefix = 'INT';
  var maxNum = 0;
  for (var i = 1; i < data.length; i++) {
    var id = data[i][0] ? data[i][0].toString() : '';
    if (id.indexOf(prefix + '-') === 0) {
      var num = parseInt(id.split('-')[1]);
      if (num > maxNum) maxNum = num;
    }
  }
  return prefix + '-' + ('000' + (maxNum + 1)).slice(-3);
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
      // Commentaires
      case 'add-comment':          return handleAddComment(e);
      // Admin
      case 'list-trash':           return handleListTrash(e);
      case 'get-logs':             return handleGetLogs(e);
      case 'list-emails':          return handleListEmails(e);
      case 'add-email':            return handleAddEmail(e);
      case 'delete-email':         return handleDeleteEmail(e);
      case 'change-role':          return handleChangeRole(e);
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
  sheet.appendRow([email, hashed, 'enseignant', nom, prenom, '', '', password, '1', '', '']);
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

  for (var i = 1; i < data.length; i++) {
    if (data[i][emailIdx] && data[i][emailIdx].toString().toLowerCase().trim() === email) {
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
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PROJETS_SHEET);
  if (!sheet) return jsonResponse({ success: false, error: 'Onglet introuvable' });

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return jsonResponse({ success: true, data: [] });

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
  return jsonResponse({ success: true, data: results });
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

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PROJETS_SHEET);
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
  var table = body.table || PROJETS_SHEET;

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(table);
  if (!sheet) return jsonResponse({ success: false, error: 'Onglet introuvable' });

  var data    = sheet.getDataRange().getValues();
  var headers = data[0];

  if (table === PROJETS_SHEET) {
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

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PROJETS_SHEET);
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

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PROJETS_SHEET);
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

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PROJETS_SHEET);
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

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PROJETS_SHEET);
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

  if (!projectId || !comment) return jsonResponse({ success: false, error: 'Projet et commentaire requis' });
  if (comment.length > 1000) return jsonResponse({ success: false, error: 'Commentaire trop long (max 1000 car.)' });

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var cs = ss.getSheetByName(COMMENTS_SHEET);
  if (!cs) {
    cs = ss.insertSheet(COMMENTS_SHEET);
    cs.getRange(1, 1, 1, 5).setValues([['ID_Projet', 'Date_Heure', 'Email', 'Nom_Prenom', 'Commentaire']]);
    cs.getRange(1, 1, 1, 5).setFontWeight('bold').setBackground('#0053a3').setFontColor('white');
    cs.setFrozenRows(1);
  }

  var nomPrenom = (user.prenom || '') + ' ' + (user.nom || '');
  cs.appendRow([projectId, nowStr(), user.email, nomPrenom.trim(), comment]);
  addLog(user.email, user.role, 'add_comment', 'Commentaire sur ' + projectId, di);
  return jsonResponse({ success: true, message: 'Commentaire ajoute' });
}

function handleListComments(e) {
  var projectId = (e.parameter.id || '').trim();
  if (!projectId) return jsonResponse({ success: false, error: 'ID projet requis' });

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var cs = ss.getSheetByName(COMMENTS_SHEET);
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

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PROJETS_SHEET);
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
  var table = e.parameter.table || body.table || body._table || PROJETS_SHEET;

  if (table === USERS_SHEET && !isAdmin(user)) return jsonResponse({ success: false, error: 'Admin requis' });

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(table);
  if (!sheet) return jsonResponse({ success: false, error: 'Onglet introuvable' });

  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  if (table === PROJETS_SHEET) {
    if (isVieScolaire(user) && !isVsCat(body['Categorie']))
      return jsonResponse({ success: false, error: 'Vie scolaire : creation limitee a vos categories' });
    body['ID_Projet']          = generateProjectId(body['Categorie']);
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
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PROJETS_SHEET);
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

  // Projets (27 colonnes)
  var p = ss.getSheetByName(PROJETS_SHEET);
  if (!p) {
    p = ss.insertSheet(PROJETS_SHEET);
    var ph = ['ID_Projet','Nom_Projet','Categorie','Echelle','Axe_Projet_Etablissement','Sous_Axe','Disciplines_Mobilisees','Niveaux_Concernes','Description','Objectifs_Pedagogiques','Statut','Priorite','Date_Debut','Date_Fin','Partenariats','Ressources_Necessaires','Modalite_Valorisation','Enseignant_Referent','Created_By','Deleted','Deleted_By','Deleted_Date','Locked','Locked_By','Locked_Date','Last_Modified_By','Last_Modified_Date'];
    p.getRange(1, 1, 1, ph.length).setValues([ph]);
    p.getRange(1, 1, 1, ph.length).setFontWeight('bold').setBackground('#0053a3').setFontColor('white');
    p.setFrozenRows(1);
  } else {
    var existingH = p.getRange(1, 1, 1, p.getLastColumn()).getValues()[0];
    var newCols = ['Deleted','Deleted_By','Deleted_Date','Locked','Locked_By','Locked_Date','Last_Modified_By','Last_Modified_Date'];
    for (var c = 0; c < newCols.length; c++) {
      if (existingH.indexOf(newCols[c]) < 0) {
        var col = p.getLastColumn() + 1;
        p.getRange(1, col).setValue(newCols[c]).setFontWeight('bold').setBackground('#0053a3').setFontColor('white');
      }
    }
  }

  // Utilisateurs (11 colonnes v6 : +Session_Token, Session_Expiry)
  var u = ss.getSheetByName(USERS_SHEET);
  if (!u) {
    u = ss.insertSheet(USERS_SHEET);
    u.getRange(1, 1, 1, 11).setValues([['Email','Mot_de_Passe','Role','Nom','Prenom','Reset_Token','Reset_Expiry','Mdp_Initial','First_Login','Session_Token','Session_Expiry']]);
    u.getRange(1, 1, 1, 11).setFontWeight('bold').setBackground('#0053a3').setFontColor('white');
    u.setFrozenRows(1);
    var adminPwd = generatePassword();
    u.appendRow(['admin@egd.mg', hashPassword(adminPwd), 'admin', 'Administrateur', 'LFT', '', '', adminPwd, '1', '', '']);
    Logger.log('Admin cree : admin@egd.mg / ' + adminPwd);
  } else {
    var existingH = u.getRange(1, 1, 1, u.getLastColumn()).getValues()[0];
    var newCols = ['Reset_Token','Reset_Expiry','Mdp_Initial','First_Login','Session_Token','Session_Expiry'];
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

  // Commentaires
  var cs = ss.getSheetByName(COMMENTS_SHEET);
  if (!cs) {
    cs = ss.insertSheet(COMMENTS_SHEET);
    cs.getRange(1, 1, 1, 5).setValues([['ID_Projet','Date_Heure','Email','Nom_Prenom','Commentaire']]);
    cs.getRange(1, 1, 1, 5).setFontWeight('bold').setBackground('#0053a3').setFontColor('white');
    cs.setFrozenRows(1);
  }

  Logger.log('=== Initialisation v6 terminee ! ===');
  Logger.log('Nouvelles colonnes Utilisateurs : Session_Token, Session_Expiry');
  Logger.log('Toutes les actions sensibles passent par POST');
  Logger.log('Authentification par token de session (8h)');
}
