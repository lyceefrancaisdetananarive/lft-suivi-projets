/**
 * ============================================================
 * LFT - Suivi des Projets d'Etablissement - v4
 * Google Apps Script - API Backend
 * Lycee Francais de Tananarive - AEFE
 * ============================================================
 *
 * ONGLETS REQUIS :
 * - "Projets"         (19 colonnes)
 * - "Utilisateurs"    (9 colonnes : Email, Mot_de_Passe, Role, Nom, Prenom, Reset_Token, Reset_Expiry, Mdp_Initial, First_Login)
 * - "Emails_Autorises"(1 colonne  : Email)
 * - "Logs"            (10 colonnes : Date_Heure, Email, Role, Action, Detail, Pays, Ville, OS, Navigateur, Appareil)
 *
 * ROLES :
 * - admin        : CRUD projets + gestion utilisateurs + logs
 * - direction    : CRUD projets uniquement (sans gestion utilisateurs)
 * - vie_scolaire : CRUD uniquement dans la categorie "Clubs et activites"
 * - enseignant   : cree et modifie SES projets uniquement (pas de suppression)
 *
 * AUTH STYLE PRONOTE :
 * - Mot de passe genere automatiquement (8 car. maj+min+chiffres)
 * - Premiere connexion = changement obligatoire
 * - Admin peut reinitialiser le mdp d'un utilisateur (notification par mail)
 * - Mdp initial visible par l'admin dans le Google Sheet
 */

const PROJETS_SHEET  = 'Projets';
const USERS_SHEET    = 'Utilisateurs';
const EMAILS_SHEET   = 'Emails_Autorises';
const LOGS_SHEET     = 'Logs';
const ADMIN_EMAIL    = 'max.rafaliarison@aefe.fr';
const APP_URL        = 'https://lyceefrancaisdetananarive.github.io/lft-suivi-projets/';

// ============================================================
// UTILITAIRES
// ============================================================

function hashPassword(password) {
  const raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password);
  return raw.map(b => ('0' + ((b + 256) % 256).toString(16)).slice(-2)).join('');
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Genere un mot de passe style Pronote/Index Education
 * 8 caracteres : majuscules + minuscules + chiffres
 * Exclut les caracteres ambigus (0, O, l, 1, I)
 */
function generatePassword() {
  var upper  = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  var lower  = 'abcdefghjkmnpqrstuvwxyz';
  var digits = '23456789';
  var all    = upper + lower + digits;
  var pwd    = '';
  // Garantir au moins 1 de chaque type
  pwd += upper.charAt(Math.floor(Math.random() * upper.length));
  pwd += lower.charAt(Math.floor(Math.random() * lower.length));
  pwd += digits.charAt(Math.floor(Math.random() * digits.length));
  for (var i = 3; i < 8; i++) {
    pwd += all.charAt(Math.floor(Math.random() * all.length));
  }
  // Melanger
  pwd = pwd.split('').sort(function() { return Math.random() - 0.5; }).join('');
  return pwd;
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
function canDeleteProject(user)   { return isAdminOrDirection(user) || isVieScolaire(user); }

var VIE_SCOLAIRE_CAT = 'Clubs et activités';

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

/**
 * Ajoute une entree de log enrichie (RGPD : donnees techniques uniquement)
 * @param {string} email
 * @param {string} role
 * @param {string} action
 * @param {string} detail
 * @param {object} [deviceInfo] - {pays, ville, os, navigateur, appareil}
 */
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
    var now = Utilities.formatDate(new Date(), 'Indian/Antananarivo', 'yyyy-MM-dd HH:mm:ss');
    var di  = deviceInfo || {};
    logs.appendRow([
      now,
      email || '',
      role || '',
      action || '',
      detail || '',
      di.pays || '',
      di.ville || '',
      di.os || '',
      di.navigateur || '',
      di.appareil || ''
    ]);
  } catch (e) { /* Ne pas faire echouer la requete a cause des logs */ }
}

/**
 * Extrait les infos device depuis les parametres de la requete
 */
function extractDeviceInfo(e) {
  var p = e.parameter || {};
  return {
    pays:       p.d_pays || '',
    ville:      p.d_ville || '',
    os:         p.d_os || '',
    navigateur: p.d_nav || '',
    appareil:   p.d_app || ''
  };
}

// ============================================================
// ROUTING
// ============================================================

function doGet(e) {
  try {
    switch (e.parameter.action) {
      case 'login':              return handleLogin(e);
      case 'list':               return handleList(e);
      case 'delete':             return handleDelete(e);
      case 'list-emails':        return handleListEmails(e);
      case 'delete-email':       return handleDeleteEmail(e);
      case 'forgot-password':    return handleForgotPassword(e);
      case 'request-deletion':   return handleRequestDeletion(e);
      case 'get-logs':           return handleGetLogs(e);
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
      default: return jsonResponse({ success: false, error: 'Action non reconnue' });
    }
  } catch (err) { return jsonResponse({ success: false, error: err.toString() }); }
}

// ============================================================
// AUTH : LOGIN (retourne first_login pour forcer le changement)
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
// AUTH : REGISTER (style Pronote — mdp auto-genere)
// ============================================================

function handleRegister(e) {
  var body   = JSON.parse(e.postData.contents);
  var email  = (body.Email || '').trim().toLowerCase();
  var nom    = (body.Nom    || '').trim();
  var prenom = (body.Prenom || '').trim();
  var di     = extractDeviceInfo(e);

  if (!email.endsWith('@egd.mg')) {
    return jsonResponse({ success: false, error: 'Seules les adresses @egd.mg sont autorisees' });
  }
  if (!nom || !prenom) {
    return jsonResponse({ success: false, error: 'Nom et prenom requis' });
  }
  if (!isEmailAuthorized(email)) {
    addLog(email, '', 'register_denied', 'Email non autorise', di);
    return jsonResponse({ success: false, error: "Vous n'etes pas inscrit(e) sur la liste des enseignants du lycee. Merci de contacter l'administrateur." });
  }
  if (emailAlreadyRegistered(email)) {
    return jsonResponse({ success: false, error: "Un compte existe deja avec cette adresse. Utilisez \"Mot de passe oublie\" si necessaire." });
  }

  var password = generatePassword();
  var sheet    = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(USERS_SHEET);
  var hashed   = hashPassword(password);
  // 9 colonnes : Email, Mot_de_Passe, Role, Nom, Prenom, Reset_Token, Reset_Expiry, Mdp_Initial, First_Login
  sheet.appendRow([email, hashed, 'enseignant', nom, prenom, '', '', password, '1']);
  addLog(email, 'enseignant', 'register', 'Nouveau compte: ' + prenom + ' ' + nom, di);
  return jsonResponse({
    success: true,
    message: 'Compte cree avec succes !',
    generated_password: password,
    user: { email: email, role: 'enseignant', nom: nom, prenom: prenom, first_login: true }
  });
}

// ============================================================
// AUTH : CHANGE PASSWORD (premiere connexion ou volontaire)
// ============================================================

function handleChangePassword(e) {
  var body        = JSON.parse(e.postData.contents);
  var email       = (e.parameter.email || '').trim().toLowerCase();
  var oldPassword = e.parameter.password || '';
  var newPassword = body.new_password || '';
  var di          = extractDeviceInfo(e);

  var user = authenticate(email, oldPassword);
  if (!user) return jsonResponse({ success: false, error: 'Mot de passe actuel incorrect' });

  if (!newPassword || newPassword.length < 8) {
    return jsonResponse({ success: false, error: 'Le nouveau mot de passe doit contenir au moins 8 caracteres' });
  }
  // Verifier complexite (comme Pronote : 1 maj + 1 min + 1 chiffre)
  if (!/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
    return jsonResponse({ success: false, error: 'Le mot de passe doit contenir au moins une majuscule, une minuscule et un chiffre' });
  }
  if (newPassword === oldPassword) {
    return jsonResponse({ success: false, error: 'Le nouveau mot de passe doit etre different de l\'ancien' });
  }

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
      if (initIdx >= 0) sheet.getRange(i + 1, initIdx + 1).setValue(''); // Effacer le mdp initial par securite
      addLog(email, user.role, 'change_password', 'Mot de passe modifie' + (user.first_login ? ' (premiere connexion)' : ''), di);
      return jsonResponse({
        success: true,
        message: 'Mot de passe modifie avec succes !',
        user: { email: user.email, role: user.role, nom: user.nom, prenom: user.prenom, first_login: false }
      });
    }
  }
  return jsonResponse({ success: false, error: 'Utilisateur introuvable' });
}

// ============================================================
// AUTH : ADMIN RESET PASSWORD (reinit par l'admin + envoi mail)
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

      // Envoyer le nouveau mot de passe par mail
      var subject = 'LFT Projets - Reinitialisation de votre mot de passe';
      var mailBody = 'Bonjour ' + prenom + ' ' + nom + ',\n\n'
        + 'Votre mot de passe pour la plateforme LFT - Suivi des projets a ete reinitialise par l\'administrateur.\n\n'
        + 'Voici vos nouveaux identifiants :\n'
        + '- Adresse : ' + APP_URL + '\n'
        + '- Email : ' + targetEmail + '\n'
        + '- Mot de passe temporaire : ' + newPwd + '\n\n'
        + 'Vous serez invite(e) a choisir un nouveau mot de passe personnel lors de votre prochaine connexion.\n\n'
        + 'Cordialement,\nL\'equipe LFT - Lycee Francais de Tananarive';

      MailApp.sendEmail({ to: targetEmail, subject: subject, body: mailBody });
      addLog(e.parameter.email, admin.role, 'admin_reset_password', 'Reinitialisation mdp: ' + targetEmail, di);
      return jsonResponse({ success: true, message: 'Mot de passe reinitialise et envoye par email a ' + targetEmail });
    }
  }
  return jsonResponse({ success: false, error: 'Utilisateur introuvable' });
}

// ============================================================
// AUTH : FORGOT PASSWORD (envoi du lien par email)
// ============================================================

function handleForgotPassword(e) {
  var email = (e.parameter.email || '').trim().toLowerCase();
  var di    = extractDeviceInfo(e);
  if (!email.endsWith('@egd.mg')) {
    return jsonResponse({ success: false, error: 'Adresse email invalide' });
  }

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
      var subject   = 'LFT Projets - Reinitialisation de mot de passe';
      var body      = 'Bonjour,\n\n'
        + 'Vous avez demande une reinitialisation de votre mot de passe pour la plateforme LFT - Suivi des projets d\'etablissement.\n\n'
        + 'Cliquez sur ce lien pour definir un nouveau mot de passe (valide 24 heures) :\n'
        + resetLink + '\n\n'
        + 'Si vous n\'etes pas a l\'origine de cette demande, ignorez simplement cet email.\n\n'
        + 'Cordialement,\nL\'equipe LFT - Lycee Francais de Tananarive';

      MailApp.sendEmail({ to: email, subject: subject, body: body });
      addLog(email, '', 'forgot_password', 'Lien de reinitialisation envoye', di);
      return jsonResponse({ success: true, message: 'Un email de reinitialisation a ete envoye a ' + email });
    }
  }

  return jsonResponse({ success: true, message: 'Si cette adresse est associee a un compte, un email de reinitialisation a ete envoye.' });
}

// ============================================================
// AUTH : CONFIRM RESET (verification token + nouveau mot de passe)
// ============================================================

function handleConfirmReset(e) {
  var body        = JSON.parse(e.postData.contents);
  var token       = (body.token    || '').trim();
  var newPassword = (body.password || '');

  if (!token) return jsonResponse({ success: false, error: 'Token manquant' });
  if (!newPassword || newPassword.length < 8) {
    return jsonResponse({ success: false, error: 'Le mot de passe doit contenir au moins 8 caracteres' });
  }
  if (!/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
    return jsonResponse({ success: false, error: 'Le mot de passe doit contenir au moins une majuscule, une minuscule et un chiffre' });
  }

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
      if (isNaN(expiry) || new Date().getTime() > expiry) {
        return jsonResponse({ success: false, error: 'Ce lien de reinitialisation a expire. Veuillez refaire la demande.' });
      }
      sheet.getRange(i + 1, passIdx  + 1).setValue(hashPassword(newPassword));
      sheet.getRange(i + 1, tokenIdx + 1).setValue('');
      sheet.getRange(i + 1, expiryIdx + 1).setValue('');
      if (firstIdx >= 0) sheet.getRange(i + 1, firstIdx + 1).setValue('0');
      if (initIdx >= 0) sheet.getRange(i + 1, initIdx + 1).setValue('');

      var email = data[i][emailIdx].toString();
      addLog(email, '', 'password_reset', 'Mot de passe reinitialise via lien email');
      return jsonResponse({ success: true, message: 'Mot de passe modifie avec succes. Vous pouvez maintenant vous connecter.' });
    }
  }

  return jsonResponse({ success: false, error: 'Token invalide ou expire' });
}

// ============================================================
// REQUEST DELETION (enseignant demande suppression de son compte)
// ============================================================

function handleRequestDeletion(e) {
  var email    = (e.parameter.email    || '').trim().toLowerCase();
  var password = (e.parameter.password || '');
  var user     = authenticate(email, password);
  if (!user) return jsonResponse({ success: false, error: 'Authentification requise' });

  var subject = 'LFT Projets - Demande de suppression de compte : ' + email;
  var body    = 'Bonjour,\n\n'
    + 'Un utilisateur a demande la suppression de son compte sur la plateforme LFT Projets.\n\n'
    + 'Details :\n'
    + '- Email  : ' + email + '\n'
    + '- Nom    : ' + (user.prenom || '') + ' ' + (user.nom || '') + '\n'
    + '- Role   : ' + (user.role   || '') + '\n'
    + '- Date   : ' + new Date().toLocaleString('fr-FR') + '\n\n'
    + 'Pour supprimer ce compte, connectez-vous en tant qu\'administrateur et accedez au panel d\'administration.\n\n'
    + 'Cordialement,\nSysteme automatique - LFT Projets';

  MailApp.sendEmail({ to: ADMIN_EMAIL, subject: subject, body: body });
  addLog(email, user.role, 'request_deletion', 'Demande de suppression envoyee a ' + ADMIN_EMAIL);
  return jsonResponse({ success: true, message: "Votre demande de suppression de compte a ete envoyee a l'administrateur." });
}

// ============================================================
// GET LOGS (admin uniquement — avec colonnes enrichies)
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
// CHANGE ROLE (admin uniquement)
// ============================================================

function handleChangeRole(e) {
  var admin = authenticate(e.parameter.email, e.parameter.password);
  if (!isAdmin(admin)) return jsonResponse({ success: false, error: 'Admin requis' });

  var body        = JSON.parse(e.postData.contents);
  var targetEmail = (body.email || '').trim().toLowerCase();
  var newRole     = (body.role  || '').trim().toLowerCase();

  if (['admin', 'direction', 'vie_scolaire', 'enseignant'].indexOf(newRole) < 0) {
    return jsonResponse({ success: false, error: 'Role invalide' });
  }
  if (targetEmail === e.parameter.email.trim().toLowerCase()) {
    return jsonResponse({ success: false, error: 'Vous ne pouvez pas changer votre propre role' });
  }

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
      return jsonResponse({ success: true, message: 'Role modifie : ' + oldRole + ' → ' + newRole });
    }
  }
  return jsonResponse({ success: false, error: 'Utilisateur introuvable' });
}

// ============================================================
// EMAILS AUTORISES (admin uniquement)
// ============================================================

function handleListEmails(e) {
  var user = authenticate(e.parameter.email, e.parameter.password);
  if (!isAdmin(user)) return jsonResponse({ success: false, error: 'Acces refuse' });

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(EMAILS_SHEET);
  if (!sheet) return jsonResponse({ success: true, data: [] });

  var data   = sheet.getDataRange().getValues();
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

  if (!newEmail.endsWith('@egd.mg')) {
    return jsonResponse({ success: false, error: 'Seules les adresses @egd.mg sont autorisees' });
  }
  if (isEmailAuthorized(newEmail)) {
    return jsonResponse({ success: false, error: 'Cette adresse est deja dans la liste' });
  }

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
// LIST (Projets ou Utilisateurs)
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
  var results = [];
  for (var i = 1; i < data.length; i++) {
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
      // Garder Mdp_Initial et First_Login pour l'admin
    }
    results.push(row);
  }
  return jsonResponse({ success: true, data: results });
}

// ============================================================
// ADD (Projets ou Utilisateurs)
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
    if (isVieScolaire(user) && body['Categorie'] !== VIE_SCOLAIRE_CAT) {
      return jsonResponse({ success: false, error: 'Vie scolaire : vous ne pouvez creer que dans la categorie "' + VIE_SCOLAIRE_CAT + '"' });
    }
    body['ID_Projet']  = generateProjectId(body['Categorie']);
    body['Created_By'] = e.parameter.email;
    addLog(e.parameter.email, user.role, 'add_project', 'Nouveau projet: ' + (body['Nom_Projet'] || '') + ' (' + body['ID_Projet'] + ')');
  }

  if (table === USERS_SHEET) {
    // Generer un mot de passe style Pronote si non fourni
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
  // Retourner le mdp genere pour l'admin
  if (table === USERS_SHEET) {
    response.generated_password = body['Mdp_Initial'];
  }
  return jsonResponse(response);
}

// ============================================================
// UPDATE (Projets)
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

  for (var i = 1; i < data.length; i++) {
    if (data[i][idIdx] === body['ID_Projet']) {
      var owner = data[i][createdByIdx];
      var projectCat = data[i][catIdx] ? data[i][catIdx].toString() : '';
      if (isVieScolaire(user) && projectCat !== VIE_SCOLAIRE_CAT) {
        return jsonResponse({ success: false, error: 'Vie scolaire : modification limitee a la categorie "' + VIE_SCOLAIRE_CAT + '"' });
      }
      if (!isAdminOrDirection(user) && !isVieScolaire(user) && owner !== e.parameter.email) {
        return jsonResponse({ success: false, error: 'Vous ne pouvez modifier que vos propres projets' });
      }
      for (var j = 0; j < headers.length; j++) {
        if (headers[j] === 'ID_Projet' || headers[j] === 'Created_By') continue;
        if (body[headers[j]] !== undefined) sheet.getRange(i + 1, j + 1).setValue(body[headers[j]]);
      }
      addLog(e.parameter.email, user.role, 'update_project', 'Modification: ' + body['ID_Projet'] + ' - ' + (body['Nom_Projet'] || ''));
      return jsonResponse({ success: true, message: 'Modification reussie' });
    }
  }
  return jsonResponse({ success: false, error: 'Projet introuvable' });
}

// ============================================================
// DELETE (Projets ou Utilisateurs)
// ============================================================

function handleDelete(e) {
  var table = e.parameter.table || PROJETS_SHEET;
  var user  = authenticate(e.parameter.email, e.parameter.password);
  if (!user) return jsonResponse({ success: false, error: 'Authentification requise' });

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(table);
  if (!sheet) return jsonResponse({ success: false, error: 'Onglet introuvable' });

  var data    = sheet.getDataRange().getValues();
  var headers = data[0];

  if (table === PROJETS_SHEET) {
    if (!canDeleteProject(user)) {
      return jsonResponse({ success: false, error: 'Seuls les administrateurs et la direction peuvent supprimer des projets' });
    }
    var targetId  = e.parameter.id;
    var idIdx     = headers.indexOf('ID_Projet');
    var nomIdx    = headers.indexOf('Nom_Projet');
    var catIdx    = headers.indexOf('Categorie');
    for (var i = 1; i < data.length; i++) {
      if (data[i][idIdx] === targetId) {
        if (isVieScolaire(user) && data[i][catIdx] !== VIE_SCOLAIRE_CAT) {
          return jsonResponse({ success: false, error: 'Vie scolaire : suppression limitee a la categorie "' + VIE_SCOLAIRE_CAT + '"' });
        }
        var nomProjet = data[i][nomIdx] || targetId;
        sheet.deleteRow(i + 1);
        addLog(e.parameter.email, user.role, 'delete_project', 'Suppression: ' + targetId + ' - ' + nomProjet);
        return jsonResponse({ success: true, message: 'Supprime' });
      }
    }
    return jsonResponse({ success: false, error: 'Introuvable' });
  }

  if (table === USERS_SHEET) {
    if (!isAdmin(user)) return jsonResponse({ success: false, error: 'Admin requis' });
    var targetEmail = e.parameter.email_target;
    if (targetEmail === e.parameter.email) return jsonResponse({ success: false, error: 'Impossible de supprimer votre propre compte' });
    var emailIdx = headers.indexOf('Email');
    for (var i = 1; i < data.length; i++) {
      if (data[i][emailIdx] === targetEmail) {
        sheet.deleteRow(i + 1);
        addLog(e.parameter.email, user.role, 'delete_user', 'Suppression compte: ' + targetEmail);
        return jsonResponse({ success: true, message: 'Supprime' });
      }
    }
    return jsonResponse({ success: false, error: 'Introuvable' });
  }

  return jsonResponse({ success: false, error: 'Table non supportee' });
}

// ============================================================
// INITIALISATION v4 (executer manuellement depuis l'editeur GAS)
// ============================================================

function initializeSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // Projets
  var p = ss.getSheetByName(PROJETS_SHEET);
  if (!p) {
    p = ss.insertSheet(PROJETS_SHEET);
    p.getRange(1, 1, 1, 19).setValues([['ID_Projet','Nom_Projet','Categorie','Echelle','Axe_Projet_Etablissement','Sous_Axe','Disciplines_Mobilisees','Niveaux_Concernes','Description','Objectifs_Pedagogiques','Statut','Priorite','Date_Debut','Date_Fin','Partenariats','Ressources_Necessaires','Modalite_Valorisation','Enseignant_Referent','Created_By']]);
    p.getRange(1, 1, 1, 19).setFontWeight('bold').setBackground('#0053a3').setFontColor('white');
    p.setFrozenRows(1);
  }

  // Utilisateurs (9 colonnes v4)
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
    // Migration v3 → v4 : ajouter les colonnes manquantes
    var existingHeaders = u.getRange(1, 1, 1, u.getLastColumn()).getValues()[0];
    var newCols = ['Reset_Token', 'Reset_Expiry', 'Mdp_Initial', 'First_Login'];
    for (var c = 0; c < newCols.length; c++) {
      if (existingHeaders.indexOf(newCols[c]) < 0) {
        var col = u.getLastColumn() + 1;
        u.getRange(1, col).setValue(newCols[c]).setFontWeight('bold').setBackground('#0053a3').setFontColor('white');
      }
    }
  }

  // Emails autorises
  var em = ss.getSheetByName(EMAILS_SHEET);
  if (!em) {
    em = ss.insertSheet(EMAILS_SHEET);
    em.getRange(1, 1).setValue('Email');
    em.getRange(1, 1).setFontWeight('bold').setBackground('#0053a3').setFontColor('white');
    em.setFrozenRows(1);
    em.appendRow(['admin@egd.mg']);
  }

  // Logs (10 colonnes v4)
  var logs = ss.getSheetByName(LOGS_SHEET);
  if (!logs) {
    logs = ss.insertSheet(LOGS_SHEET);
    logs.getRange(1, 1, 1, 10).setValues([['Date_Heure','Email','Role','Action','Detail','Pays','Ville','OS','Navigateur','Appareil']]);
    logs.getRange(1, 1, 1, 10).setFontWeight('bold').setBackground('#0053a3').setFontColor('white');
    logs.setFrozenRows(1);
  } else {
    // Migration : ajouter les colonnes enrichies si absentes
    var logHeaders = logs.getRange(1, 1, 1, logs.getLastColumn()).getValues()[0];
    var newLogCols = ['Pays', 'Ville', 'OS', 'Navigateur', 'Appareil'];
    for (var lc = 0; lc < newLogCols.length; lc++) {
      if (logHeaders.indexOf(newLogCols[lc]) < 0) {
        var lcol = logs.getLastColumn() + 1;
        logs.getRange(1, lcol).setValue(newLogCols[lc]).setFontWeight('bold').setBackground('#0053a3').setFontColor('white');
      }
    }
  }

  Logger.log('=== Initialisation v4 terminee ! ===');
  Logger.log('Pensez a executer initializeSheets() pour migrer les colonnes existantes.');
  Logger.log('Pensez a redeployer le script (Nouvelle version) apres la mise a jour.');
}
