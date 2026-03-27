/**
 * ============================================================
 * LFT - Suivi des Projets d'Etablissement - v5
 * Google Apps Script - API Backend
 * Lycee Francais de Tananarive - AEFE
 * ============================================================
 *
 * ONGLETS REQUIS :
 * - "Projets"          (27 colonnes v5 : +Deleted, Deleted_By, Deleted_Date, Locked, Locked_By, Locked_Date, Last_Modified_By, Last_Modified_Date)
 * - "Utilisateurs"     (9 colonnes)
 * - "Emails_Autorises" (1 colonne)
 * - "Logs"             (10 colonnes)
 * - "Commentaires"     (5 colonnes : ID_Projet, Date_Heure, Email, Nom_Prenom, Commentaire)
 *
 * ROLES :
 * - admin        : Tout (projets, utilisateurs, logs, corbeille, verrouillage)
 * - direction    : CRUD tous projets, corbeille, verrouillage, commentaires
 * - vie_scolaire : CRUD "Clubs et activites" + "Projets de l'Internat"
 * - enseignant   : cree, modifie et supprime (corbeille) SES projets uniquement
 *
 * FONCTIONNALITES v5 :
 * - Corbeille (soft delete) avec restauration
 * - Suppression definitive (admin/direction)
 * - Verrouillage de projet (admin/direction)
 * - Commentaires sur les projets
 * - Notifications email (suppression/restauration)
 * - Audit : Last_Modified_By/Date sur chaque modification
 * - Export CSV
 */

var PROJETS_SHEET  = 'Projets';
var USERS_SHEET    = 'Utilisateurs';
var EMAILS_SHEET   = 'Emails_Autorises';
var LOGS_SHEET     = 'Logs';
var COMMENTS_SHEET = 'Commentaires';
var ADMIN_EMAIL    = 'max.rafaliarison@aefe.fr';
var APP_URL        = 'https://lyceefrancaisdetananarive.github.io/lft-suivi-projets/';

// Categories accessibles a la Vie scolaire
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
    if (data[i][emailIdx] === email && data[i][passIdx] === hashed) {
      return {
        email:       data[i][emailIdx],
        role:        data[i][roleIdx],
        nom:         data[i][nomIdx],
        prenom:      data[i][prenomIdx],
        first_login: firstIdx >= 0 ? (data[i][firstIdx].toString() === '1') : false
      };
    }
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

/**
 * Envoie une notification email a l'enseignant referent d'un projet
 */
function notifyProjectOwner(ownerEmail, projectName, projectId, actionType, actorEmail) {
  try {
    if (!ownerEmail || ownerEmail === actorEmail) return; // pas de notif si c'est soi-meme
    var subject, body;
    if (actionType === 'delete') {
      subject = 'LFT Projets - Votre projet a ete place en corbeille';
      body = 'Bonjour,\n\n'
        + 'Votre projet "' + projectName + '" (' + projectId + ') a ete place en corbeille par ' + actorEmail + '.\n\n'
        + 'Si cette action n\'est pas volontaire, contactez l\'administrateur ou la direction pour le restaurer.\n\n'
        + 'Plateforme : ' + APP_URL + '\n\n'
        + 'Cordialement,\nSysteme automatique - LFT Projets';
    } else if (actionType === 'restore') {
      subject = 'LFT Projets - Votre projet a ete restaure';
      body = 'Bonjour,\n\n'
        + 'Votre projet "' + projectName + '" (' + projectId + ') a ete restaure par ' + actorEmail + '.\n'
        + 'Il est de nouveau visible sur la plateforme.\n\n'
        + 'Plateforme : ' + APP_URL + '\n\n'
        + 'Cordialement,\nSysteme automatique - LFT Projets';
    } else if (actionType === 'permanent-delete') {
      subject = 'LFT Projets - Votre projet a ete supprime definitivement';
      body = 'Bonjour,\n\n'
        + 'Votre projet "' + projectName + '" (' + projectId + ') a ete supprime definitivement par ' + actorEmail + '.\n'
        + 'Cette action est irreversible.\n\n'
        + 'Plateforme : ' + APP_URL + '\n\n'
        + 'Cordialement,\nSysteme automatique - LFT Projets';
    } else if (actionType === 'lock') {
      subject = 'LFT Projets - Votre projet a ete valide et verrouille';
      body = 'Bonjour,\n\n'
        + 'Votre projet "' + projectName + '" (' + projectId + ') a ete valide et verrouille par ' + actorEmail + '.\n'
        + 'Il ne peut plus etre modifie. Contactez la direction si des modifications sont necessaires.\n\n'
        + 'Plateforme : ' + APP_URL + '\n\n'
        + 'Cordialement,\nSysteme automatique - LFT Projets';
    } else if (actionType === 'unlock') {
      subject = 'LFT Projets - Votre projet a ete deverrouille';
      body = 'Bonjour,\n\n'
        + 'Votre projet "' + projectName + '" (' + projectId + ') a ete deverrouille par ' + actorEmail + '.\n'
        + 'Vous pouvez de nouveau le modifier.\n\n'
        + 'Plateforme : ' + APP_URL + '\n\n'
        + 'Cordialement,\nSysteme automatique - LFT Projets';
    }
    if (subject && body) {
      MailApp.sendEmail({ to: ownerEmail, subject: subject, body: body });
    }
  } catch (e) { /* silencieux */ }
}

// ============================================================
// ROUTING
// ============================================================

function doGet(e) {
  try {
    switch (e.parameter.action) {
      case 'login':              return handleLogin(e);
      case 'list':               return handleList(e);
      case 'list-trash':         return handleListTrash(e);
      case 'delete':             return handleDelete(e);
      case 'permanent-delete':   return handlePermanentDelete(e);
      case 'list-emails':        return handleListEmails(e);
      case 'delete-email':       return handleDeleteEmail(e);
      case 'forgot-password':    return handleForgotPassword(e);
      case 'request-deletion':   return handleRequestDeletion(e);
      case 'get-logs':           return handleGetLogs(e);
      case 'list-comments':      return handleListComments(e);
      case 'export':             return handleExport(e);
      default: return jsonResponse({ success: false, error: 'Action non reconnue' });
    }
  } catch (err) { return jsonResponse({ success: false, error: err.toString() }); }
}

function doPost(e) {
  try {
    switch (e.parameter.action) {
      case 'add':                  return handleAdd(e);
      case 'update':               return handleUpdate(e);
      case 'register':             return handleRegister(e);
      case 'confirm-reset':        return handleConfirmReset(e);
      case 'add-email':            return handleAddEmail(e);
      case 'change-role':          return handleChangeRole(e);
      case 'change-password':      return handleChangePassword(e);
      case 'admin-reset-password': return handleAdminResetPassword(e);
      case 'restore':              return handleRestore(e);
      case 'lock-project':         return handleLockProject(e);
      case 'unlock-project':       return handleUnlockProject(e);
      case 'add-comment':          return handleAddComment(e);
      default: return jsonResponse({ success: false, error: 'Action non reconnue' });
    }
  } catch (err) { return jsonResponse({ success: false, error: err.toString() }); }
}

// ============================================================
// AUTH : LOGIN
// ============================================================

function handleLogin(e) {
  var email = (e.parameter.email || '').trim().toLowerCase();
  var di    = extractDeviceInfo(e);
  var user  = authenticate(email, e.parameter.password);
  if (!user) {
    addLog(email, '', 'login_fail', 'Identifiants incorrects', di);
    return jsonResponse({ success: false, error: 'Identifiants incorrects' });
  }
  addLog(user.email, user.role, 'login', 'Connexion reussie', di);
  return jsonResponse({ success: true, user: user });
}

// ============================================================
// AUTH : REGISTER (style Pronote)
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
  sheet.appendRow([email, hashed, 'enseignant', nom, prenom, '', '', password, '1']);
  addLog(email, 'enseignant', 'register', 'Nouveau compte: ' + prenom + ' ' + nom, di);
  return jsonResponse({ success: true, message: 'Compte cree avec succes !', generated_password: password, user: { email: email, role: 'enseignant', nom: nom, prenom: prenom, first_login: true } });
}

// ============================================================
// AUTH : CHANGE PASSWORD
// ============================================================

function handleChangePassword(e) {
  var body        = JSON.parse(e.postData.contents);
  var email       = (e.parameter.email || '').trim().toLowerCase();
  var oldPassword = e.parameter.password || '';
  var newPassword = body.new_password || '';
  var di          = extractDeviceInfo(e);

  var user = authenticate(email, oldPassword);
  if (!user) return jsonResponse({ success: false, error: 'Mot de passe actuel incorrect' });

  if (!newPassword || newPassword.length < 8)
    return jsonResponse({ success: false, error: 'Le nouveau mot de passe doit contenir au moins 8 caracteres' });
  if (!/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/[0-9]/.test(newPassword))
    return jsonResponse({ success: false, error: 'Le mot de passe doit contenir au moins une majuscule, une minuscule et un chiffre' });
  if (newPassword === oldPassword)
    return jsonResponse({ success: false, error: 'Le nouveau mot de passe doit etre different de l\'ancien' });

  var sheet   = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(USERS_SHEET);
  var data    = sheet.getDataRange().getValues();
  var headers = data[0];
  var emailIdx = headers.indexOf('Email');
  var passIdx  = headers.indexOf('Mot_de_Passe');
  var firstIdx = headers.indexOf('First_Login');
  var initIdx  = headers.indexOf('Mdp_Initial');

  for (var i = 1; i < data.length; i++) {
    if (data[i][emailIdx] && data[i][emailIdx].toString().toLowerCase() === email) {
      sheet.getRange(i + 1, passIdx + 1).setValue(hashPassword(newPassword));
      if (firstIdx >= 0) sheet.getRange(i + 1, firstIdx + 1).setValue('0');
      if (initIdx >= 0) sheet.getRange(i + 1, initIdx + 1).setValue('');
      addLog(email, user.role, 'change_password', 'Mot de passe modifie' + (user.first_login ? ' (premiere connexion)' : ''), di);
      return jsonResponse({ success: true, message: 'Mot de passe modifie avec succes !', user: { email: user.email, role: user.role, nom: user.nom, prenom: user.prenom, first_login: false } });
    }
  }
  return jsonResponse({ success: false, error: 'Utilisateur introuvable' });
}

// ============================================================
// AUTH : ADMIN RESET PASSWORD
// ============================================================

function handleAdminResetPassword(e) {
  var admin = authenticate(e.parameter.email, e.parameter.password);
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
      addLog(e.parameter.email, admin.role, 'admin_reset_password', 'Reinitialisation mdp: ' + targetEmail, di);
      return jsonResponse({ success: true, message: 'Mot de passe reinitialise et envoye par email a ' + targetEmail });
    }
  }
  return jsonResponse({ success: false, error: 'Utilisateur introuvable' });
}

// ============================================================
// AUTH : FORGOT PASSWORD
// ============================================================

function handleForgotPassword(e) {
  var email = (e.parameter.email || '').trim().toLowerCase();
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
  var email    = (e.parameter.email    || '').trim().toLowerCase();
  var password = (e.parameter.password || '');
  var user     = authenticate(email, password);
  if (!user) return jsonResponse({ success: false, error: 'Authentification requise' });

  MailApp.sendEmail({
    to: ADMIN_EMAIL,
    subject: 'LFT Projets - Demande de suppression de compte : ' + email,
    body: 'Un utilisateur a demande la suppression de son compte.\n\n- Email : ' + email + '\n- Nom : ' + (user.prenom || '') + ' ' + (user.nom || '') + '\n- Role : ' + (user.role || '') + '\n- Date : ' + nowStr()
  });
  addLog(email, user.role, 'request_deletion', 'Demande de suppression envoyee');
  return jsonResponse({ success: true, message: "Demande envoyee a l'administrateur." });
}

// ============================================================
// LIST PROJECTS (exclut les supprimes)
// ============================================================

function handleList(e) {
  var table = e.parameter.table || PROJETS_SHEET;

  if (table === USERS_SHEET) {
    var user = authenticate(e.parameter.email, e.parameter.password);
    if (!isAdmin(user)) return jsonResponse({ success: false, error: 'Acces refuse' });
  }

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(table);
  if (!sheet) return jsonResponse({ success: false, error: 'Onglet introuvable' });

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return jsonResponse({ success: true, data: [] });

  var headers = data[0];
  var deletedIdx = headers.indexOf('Deleted');
  var results = [];
  for (var i = 1; i < data.length; i++) {
    // Exclure les projets supprimes (Deleted = 1)
    if (table === PROJETS_SHEET && deletedIdx >= 0 && data[i][deletedIdx] && data[i][deletedIdx].toString() === '1') continue;

    var row = {};
    for (var j = 0; j < headers.length; j++) {
      var val = data[i][j];
      if (val instanceof Date) val = Utilities.formatDate(val, 'Indian/Antananarivo', 'yyyy-MM-dd');
      row[headers[j]] = val !== undefined && val !== null ? val.toString() : '';
    }
    if (table === USERS_SHEET) {
      delete row['Mot_de_Passe'];
      delete row['Reset_Token'];
      delete row['Reset_Expiry'];
    }
    results.push(row);
  }
  return jsonResponse({ success: true, data: results });
}

// ============================================================
// LIST TRASH (admin/direction uniquement)
// ============================================================

function handleListTrash(e) {
  var user = authenticate(e.parameter.email, e.parameter.password);
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
// DELETE (soft delete → corbeille + notification)
// ============================================================

function handleDelete(e) {
  var table = e.parameter.table || PROJETS_SHEET;
  var user  = authenticate(e.parameter.email, e.parameter.password);
  if (!user) return jsonResponse({ success: false, error: 'Authentification requise' });
  var di = extractDeviceInfo(e);

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(table);
  if (!sheet) return jsonResponse({ success: false, error: 'Onglet introuvable' });

  var data    = sheet.getDataRange().getValues();
  var headers = data[0];

  if (table === PROJETS_SHEET) {
    var targetId     = e.parameter.id;
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

        // Permissions :
        // - Admin/Direction : peut supprimer tout
        // - Vie scolaire : peut supprimer dans ses categories
        // - Enseignant : peut supprimer SES propres projets
        if (isVieScolaire(user)) {
          if (!isVsCat(projectCat))
            return jsonResponse({ success: false, error: 'Vie scolaire : suppression limitee a vos categories' });
        } else if (!isAdminOrDirection(user)) {
          if (owner !== e.parameter.email)
            return jsonResponse({ success: false, error: 'Vous ne pouvez supprimer que vos propres projets' });
        }

        // Soft delete
        if (deletedIdx >= 0) sheet.getRange(i + 1, deletedIdx + 1).setValue('1');
        if (delByIdx >= 0)   sheet.getRange(i + 1, delByIdx + 1).setValue(e.parameter.email);
        if (delDateIdx >= 0) sheet.getRange(i + 1, delDateIdx + 1).setValue(nowStr());

        addLog(e.parameter.email, user.role, 'delete_project', 'Corbeille: ' + targetId + ' - ' + nomProjet, di);
        notifyProjectOwner(owner, nomProjet, targetId, 'delete', e.parameter.email);
        return jsonResponse({ success: true, message: 'Projet place en corbeille' });
      }
    }
    return jsonResponse({ success: false, error: 'Introuvable' });
  }

  // Suppression utilisateur (hard delete, admin uniquement)
  if (table === USERS_SHEET) {
    if (!isAdmin(user)) return jsonResponse({ success: false, error: 'Admin requis' });
    var targetEmail = e.parameter.email_target;
    if (targetEmail === e.parameter.email) return jsonResponse({ success: false, error: 'Impossible de supprimer votre propre compte' });
    var emailIdx = headers.indexOf('Email');
    for (var i = 1; i < data.length; i++) {
      if (data[i][emailIdx] === targetEmail) {
        sheet.deleteRow(i + 1);
        addLog(e.parameter.email, user.role, 'delete_user', 'Suppression compte: ' + targetEmail, di);
        return jsonResponse({ success: true, message: 'Supprime' });
      }
    }
    return jsonResponse({ success: false, error: 'Introuvable' });
  }

  return jsonResponse({ success: false, error: 'Table non supportee' });
}

// ============================================================
// RESTORE (restaurer depuis la corbeille + notification)
// ============================================================

function handleRestore(e) {
  var user = authenticate(e.parameter.email, e.parameter.password);
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

      addLog(e.parameter.email, user.role, 'restore_project', 'Restaure: ' + targetId + ' - ' + nomProjet, di);
      notifyProjectOwner(owner, nomProjet, targetId, 'restore', e.parameter.email);
      return jsonResponse({ success: true, message: 'Projet restaure avec succes' });
    }
  }
  return jsonResponse({ success: false, error: 'Projet introuvable' });
}

// ============================================================
// PERMANENT DELETE (suppression definitive + notification)
// ============================================================

function handlePermanentDelete(e) {
  var user = authenticate(e.parameter.email, e.parameter.password);
  if (!canManageTrash(user)) return jsonResponse({ success: false, error: 'Admin/Direction requis' });
  var di = extractDeviceInfo(e);

  var targetId = e.parameter.id;
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
      addLog(e.parameter.email, user.role, 'permanent_delete', 'Supprime definitivement: ' + targetId + ' - ' + nomProjet, di);
      notifyProjectOwner(owner, nomProjet, targetId, 'permanent-delete', e.parameter.email);
      return jsonResponse({ success: true, message: 'Projet supprime definitivement' });
    }
  }
  return jsonResponse({ success: false, error: 'Projet introuvable' });
}

// ============================================================
// LOCK / UNLOCK PROJECT (admin/direction)
// ============================================================

function handleLockProject(e) {
  var user = authenticate(e.parameter.email, e.parameter.password);
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
      if (lockByIdx >= 0)   sheet.getRange(i + 1, lockByIdx + 1).setValue(e.parameter.email);
      if (lockDateIdx >= 0) sheet.getRange(i + 1, lockDateIdx + 1).setValue(nowStr());
      addLog(e.parameter.email, user.role, 'lock_project', 'Verrouille: ' + targetId + ' - ' + nomProjet, di);
      notifyProjectOwner(owner, nomProjet, targetId, 'lock', e.parameter.email);
      return jsonResponse({ success: true, message: 'Projet verrouille' });
    }
  }
  return jsonResponse({ success: false, error: 'Introuvable' });
}

function handleUnlockProject(e) {
  var user = authenticate(e.parameter.email, e.parameter.password);
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
      addLog(e.parameter.email, user.role, 'unlock_project', 'Deverrouille: ' + targetId + ' - ' + nomProjet, di);
      notifyProjectOwner(owner, nomProjet, targetId, 'unlock', e.parameter.email);
      return jsonResponse({ success: true, message: 'Projet deverrouille' });
    }
  }
  return jsonResponse({ success: false, error: 'Introuvable' });
}

// ============================================================
// COMMENTS
// ============================================================

function handleAddComment(e) {
  var user = authenticate(e.parameter.email, e.parameter.password);
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
  // Plus recents en premier
  results.reverse();
  return jsonResponse({ success: true, data: results });
}

// ============================================================
// EXPORT (CSV)
// ============================================================

function handleExport(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PROJETS_SHEET);
  if (!sheet) return jsonResponse({ success: false, error: 'Onglet introuvable' });

  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var deletedIdx = headers.indexOf('Deleted');

  // Colonnes a exporter (exclure les colonnes techniques)
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
      // Echapper les guillemets et le point-virgule
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
// GET LOGS
// ============================================================

function handleGetLogs(e) {
  var user = authenticate(e.parameter.email, e.parameter.password);
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
// CHANGE ROLE
// ============================================================

function handleChangeRole(e) {
  var admin = authenticate(e.parameter.email, e.parameter.password);
  if (!isAdmin(admin)) return jsonResponse({ success: false, error: 'Admin requis' });

  var body        = JSON.parse(e.postData.contents);
  var targetEmail = (body.email || '').trim().toLowerCase();
  var newRole     = (body.role  || '').trim().toLowerCase();

  if (['admin', 'direction', 'vie_scolaire', 'enseignant'].indexOf(newRole) < 0)
    return jsonResponse({ success: false, error: 'Role invalide' });
  if (targetEmail === e.parameter.email.trim().toLowerCase())
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
      addLog(e.parameter.email, admin.role, 'change_role', targetEmail + ': ' + oldRole + ' -> ' + newRole);
      return jsonResponse({ success: true, message: 'Role modifie : ' + oldRole + ' -> ' + newRole });
    }
  }
  return jsonResponse({ success: false, error: 'Utilisateur introuvable' });
}

// ============================================================
// EMAILS AUTORISES
// ============================================================

function handleListEmails(e) {
  var user = authenticate(e.parameter.email, e.parameter.password);
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
  var user = authenticate(e.parameter.email, e.parameter.password);
  if (!isAdmin(user)) return jsonResponse({ success: false, error: 'Acces refuse' });
  var body     = JSON.parse(e.postData.contents);
  var newEmail = (body.email || body.Email || '').trim().toLowerCase();
  if (!newEmail.endsWith('@egd.mg'))
    return jsonResponse({ success: false, error: 'Seules les adresses @egd.mg sont autorisees' });
  if (isEmailAuthorized(newEmail))
    return jsonResponse({ success: false, error: 'Cette adresse est deja dans la liste' });
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(EMAILS_SHEET);
  sheet.appendRow([newEmail]);
  addLog(e.parameter.email, user.role, 'add_email', 'Ajout email autorise: ' + newEmail);
  return jsonResponse({ success: true, message: 'Email ajoute a la liste' });
}

function handleDeleteEmail(e) {
  var user = authenticate(e.parameter.email, e.parameter.password);
  if (!isAdmin(user)) return jsonResponse({ success: false, error: 'Acces refuse' });
  var targetEmail = (e.parameter.target || e.parameter.email_target || '').trim().toLowerCase();
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(EMAILS_SHEET);
  if (!sheet) return jsonResponse({ success: false, error: 'Onglet introuvable' });
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] && data[i][0].toString().toLowerCase().trim() === targetEmail) {
      sheet.deleteRow(i + 1);
      addLog(e.parameter.email, user.role, 'delete_email', 'Suppression email autorise: ' + targetEmail);
      return jsonResponse({ success: true, message: 'Email supprime de la liste' });
    }
  }
  return jsonResponse({ success: false, error: 'Email introuvable' });
}

// ============================================================
// ADD
// ============================================================

function handleAdd(e) {
  var table = e.parameter.table || PROJETS_SHEET;
  var user  = authenticate(e.parameter.email, e.parameter.password);
  if (!user) return jsonResponse({ success: false, error: 'Authentification requise' });
  if (table === USERS_SHEET && !isAdmin(user)) return jsonResponse({ success: false, error: 'Admin requis' });

  var body  = JSON.parse(e.postData.contents);
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(table);
  if (!sheet) return jsonResponse({ success: false, error: 'Onglet introuvable' });

  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  if (table === PROJETS_SHEET) {
    if (isVieScolaire(user) && !isVsCat(body['Categorie']))
      return jsonResponse({ success: false, error: 'Vie scolaire : creation limitee a vos categories' });
    body['ID_Projet']          = generateProjectId(body['Categorie']);
    body['Created_By']         = e.parameter.email;
    body['Deleted']            = '';
    body['Deleted_By']         = '';
    body['Deleted_Date']       = '';
    body['Locked']             = '';
    body['Locked_By']          = '';
    body['Locked_Date']        = '';
    body['Last_Modified_By']   = e.parameter.email;
    body['Last_Modified_Date'] = nowStr();
    addLog(e.parameter.email, user.role, 'add_project', 'Nouveau projet: ' + (body['Nom_Projet'] || '') + ' (' + body['ID_Projet'] + ')');
  }

  if (table === USERS_SHEET) {
    var plainPwd = body['Mot_de_Passe'] || generatePassword();
    body['Mot_de_Passe'] = hashPassword(plainPwd);
    body['Mdp_Initial']  = plainPwd;
    body['First_Login']  = '1';
    if (emailAlreadyRegistered(body['Email'])) return jsonResponse({ success: false, error: 'Email deja utilise' });
    body['Reset_Token']  = '';
    body['Reset_Expiry'] = '';
    addLog(e.parameter.email, user.role, 'add_user', 'Creation utilisateur: ' + body['Email'] + ' (' + (body['Role'] || 'enseignant') + ')');
  }

  var newRow = headers.map(function(h) { return body[h] !== undefined ? body[h] : ''; });
  sheet.appendRow(newRow);
  var response = { success: true, message: 'Ajout reussi', id: body['ID_Projet'] || body['Email'] };
  if (table === USERS_SHEET) response.generated_password = body['Mdp_Initial'];
  return jsonResponse(response);
}

// ============================================================
// UPDATE (avec audit trail + verification verrouillage)
// ============================================================

function handleUpdate(e) {
  var user = authenticate(e.parameter.email, e.parameter.password);
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
      // Verifier verrouillage
      if (lockedIdx >= 0 && data[i][lockedIdx] && data[i][lockedIdx].toString() === '1') {
        if (!isAdminOrDirection(user))
          return jsonResponse({ success: false, error: 'Ce projet est verrouille. Contactez la direction pour le modifier.' });
      }

      var owner      = data[i][createdByIdx];
      var projectCat = data[i][catIdx] ? data[i][catIdx].toString() : '';

      if (isVieScolaire(user) && !isVsCat(projectCat))
        return jsonResponse({ success: false, error: 'Vie scolaire : modification limitee a vos categories' });
      if (!isAdminOrDirection(user) && !isVieScolaire(user) && owner !== e.parameter.email)
        return jsonResponse({ success: false, error: 'Vous ne pouvez modifier que vos propres projets' });

      for (var j = 0; j < headers.length; j++) {
        if (headers[j] === 'ID_Projet' || headers[j] === 'Created_By') continue;
        if (headers[j] === 'Deleted' || headers[j] === 'Deleted_By' || headers[j] === 'Deleted_Date') continue;
        if (headers[j] === 'Last_Modified_By' || headers[j] === 'Last_Modified_Date') continue;
        if (body[headers[j]] !== undefined) sheet.getRange(i + 1, j + 1).setValue(body[headers[j]]);
      }
      // Audit trail
      if (lmByIdx >= 0)   sheet.getRange(i + 1, lmByIdx + 1).setValue(e.parameter.email);
      if (lmDateIdx >= 0) sheet.getRange(i + 1, lmDateIdx + 1).setValue(nowStr());

      addLog(e.parameter.email, user.role, 'update_project', 'Modification: ' + body['ID_Projet'] + ' - ' + (body['Nom_Projet'] || ''));
      return jsonResponse({ success: true, message: 'Modification reussie' });
    }
  }
  return jsonResponse({ success: false, error: 'Projet introuvable' });
}

// ============================================================
// INITIALISATION v5
// ============================================================

function initializeSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // Projets (27 colonnes v5)
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

  // Utilisateurs (9 colonnes)
  var u = ss.getSheetByName(USERS_SHEET);
  if (!u) {
    u = ss.insertSheet(USERS_SHEET);
    u.getRange(1, 1, 1, 9).setValues([['Email','Mot_de_Passe','Role','Nom','Prenom','Reset_Token','Reset_Expiry','Mdp_Initial','First_Login']]);
    u.getRange(1, 1, 1, 9).setFontWeight('bold').setBackground('#0053a3').setFontColor('white');
    u.setFrozenRows(1);
    var adminPwd = generatePassword();
    u.appendRow(['admin@egd.mg', hashPassword(adminPwd), 'admin', 'Administrateur', 'LFT', '', '', adminPwd, '1']);
    Logger.log('Admin cree : admin@egd.mg / ' + adminPwd);
  } else {
    var existingH = u.getRange(1, 1, 1, u.getLastColumn()).getValues()[0];
    var newCols = ['Reset_Token','Reset_Expiry','Mdp_Initial','First_Login'];
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

  // Commentaires (5 colonnes)
  var cs = ss.getSheetByName(COMMENTS_SHEET);
  if (!cs) {
    cs = ss.insertSheet(COMMENTS_SHEET);
    cs.getRange(1, 1, 1, 5).setValues([['ID_Projet','Date_Heure','Email','Nom_Prenom','Commentaire']]);
    cs.getRange(1, 1, 1, 5).setFontWeight('bold').setBackground('#0053a3').setFontColor('white');
    cs.setFrozenRows(1);
  }

  Logger.log('=== Initialisation v5 terminee ! ===');
  Logger.log('Nouvelles colonnes Projets : Deleted, Locked, Last_Modified_By/Date');
  Logger.log('Nouvel onglet : Commentaires');
  Logger.log('Vie scolaire : acces Clubs et activites + Projets de l\'Internat');
}
