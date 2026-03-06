/**
 * ============================================================
 * LFT - Suivi des Projets d'Etablissement - v3
 * Google Apps Script - API Backend
 * Lycee Francais de Tananarive - AEFE
 * ============================================================
 *
 * ONGLETS REQUIS :
 * - "Projets"         (19 colonnes)
 * - "Utilisateurs"    (7 colonnes : Email, Mot_de_Passe, Role, Nom, Prenom, Reset_Token, Reset_Expiry)
 * - "Emails_Autorises"(1 colonne  : Email)
 * - "Logs"            (5 colonnes : Date_Heure, Email, Role, Action, Detail)
 *
 * ROLES :
 * - admin      : CRUD projets + gestion utilisateurs + logs
 * - direction  : CRUD projets uniquement (sans gestion utilisateurs)
 * - enseignant : crée et modifie SES projets uniquement (pas de suppression)
 *
 * Apres deploiement, mettre a jour APP_URL avec l'URL GitHub Pages.
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

function authenticate(email, password) {
  if (!email || !password) return null;
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(USERS_SHEET);
  if (!sheet) return null;
  const data    = sheet.getDataRange().getValues();
  const headers = data[0];
  const emailIdx  = headers.indexOf('Email');
  const passIdx   = headers.indexOf('Mot_de_Passe');
  const roleIdx   = headers.indexOf('Role');
  const nomIdx    = headers.indexOf('Nom');
  const prenomIdx = headers.indexOf('Prenom');
  const hashed = hashPassword(password);
  for (let i = 1; i < data.length; i++) {
    if (data[i][emailIdx] === email && data[i][passIdx] === hashed) {
      return {
        email:  data[i][emailIdx],
        role:   data[i][roleIdx],
        nom:    data[i][nomIdx],
        prenom: data[i][prenomIdx]
      };
    }
  }
  return null;
}

function isAdmin(user)            { return user && user.role === 'admin'; }
function isDirection(user)        { return user && user.role === 'direction'; }
function isAdminOrDirection(user) { return user && (user.role === 'admin' || user.role === 'direction'); }
function canDeleteProject(user)   { return isAdminOrDirection(user); }

function isEmailAuthorized(email) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(EMAILS_SHEET);
  if (!sheet) return false;
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] && data[i][0].toString().toLowerCase().trim() === email.toLowerCase().trim()) return true;
  }
  return false;
}

function emailAlreadyRegistered(email) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(USERS_SHEET);
  if (!sheet) return false;
  const data     = sheet.getDataRange().getValues();
  const emailIdx = data[0].indexOf('Email');
  for (let i = 1; i < data.length; i++) {
    if (data[i][emailIdx] && data[i][emailIdx].toString().toLowerCase().trim() === email.toLowerCase().trim()) return true;
  }
  return false;
}

function generateProjectId(categorie) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PROJETS_SHEET);
  const data  = sheet.getDataRange().getValues();
  let prefix  = 'LFT';
  if (categorie && categorie.includes('AEFE'))          prefix = 'AEFE';
  else if (categorie && categorie.includes('Zone'))     prefix = 'ZOI';
  else if (categorie && categorie.includes('institution')) prefix = 'INST';
  else if (categorie && categorie.includes('Internat')) prefix = 'INT';
  let maxNum = 0;
  for (let i = 1; i < data.length; i++) {
    const id = data[i][0] ? data[i][0].toString() : '';
    if (id.startsWith(prefix + '-')) {
      const num = parseInt(id.split('-')[1]);
      if (num > maxNum) maxNum = num;
    }
  }
  return prefix + '-' + String(maxNum + 1).padStart(3, '0');
}

function addLog(email, role, action, detail) {
  try {
    const ss   = SpreadsheetApp.getActiveSpreadsheet();
    let logs   = ss.getSheetByName(LOGS_SHEET);
    if (!logs) {
      logs = ss.insertSheet(LOGS_SHEET);
      logs.getRange(1, 1, 1, 5).setValues([['Date_Heure', 'Email', 'Role', 'Action', 'Detail']]);
      logs.getRange(1, 1, 1, 5).setFontWeight('bold').setBackground('#0053a3').setFontColor('white');
      logs.setFrozenRows(1);
    }
    const now = Utilities.formatDate(new Date(), 'Indian/Antananarivo', 'yyyy-MM-dd HH:mm:ss');
    logs.appendRow([now, email || '', role || '', action || '', detail || '']);
  } catch (e) { /* Ne pas faire echouer la requete a cause des logs */ }
}

// ============================================================
// ROUTING
// ============================================================

function doGet(e) {
  try {
    switch (e.parameter.action) {
      case 'login':            return handleLogin(e);
      case 'list':             return handleList(e);
      case 'delete':           return handleDelete(e);
      case 'list-emails':      return handleListEmails(e);
      case 'delete-email':     return handleDeleteEmail(e);
      case 'forgot-password':  return handleForgotPassword(e);
      case 'request-deletion': return handleRequestDeletion(e);
      case 'get-logs':         return handleGetLogs(e);
      default: return jsonResponse({ success: false, error: 'Action non reconnue' });
    }
  } catch (err) { return jsonResponse({ success: false, error: err.toString() }); }
}

function doPost(e) {
  try {
    switch (e.parameter.action) {
      case 'add':           return handleAdd(e);
      case 'update':        return handleUpdate(e);
      case 'register':      return handleRegister(e);
      case 'confirm-reset': return handleConfirmReset(e);
      case 'add-email':     return handleAddEmail(e);
      default: return jsonResponse({ success: false, error: 'Action non reconnue' });
    }
  } catch (err) { return jsonResponse({ success: false, error: err.toString() }); }
}

// ============================================================
// AUTH : LOGIN
// ============================================================

function handleLogin(e) {
  const email = (e.parameter.email || '').trim().toLowerCase();
  const user  = authenticate(email, e.parameter.password);
  if (!user) {
    addLog(email, '', 'login_fail', 'Identifiants incorrects');
    return jsonResponse({ success: false, error: 'Identifiants incorrects' });
  }
  addLog(user.email, user.role, 'login', 'Connexion reussie');
  return jsonResponse({ success: true, user: user });
}

// ============================================================
// AUTH : REGISTER (auto-inscription pour emails autorises)
// ============================================================

function handleRegister(e) {
  const body   = JSON.parse(e.postData.contents);
  const email  = (body.Email || '').trim().toLowerCase();
  const password = body.Mot_de_Passe || '';
  const nom    = (body.Nom    || '').trim();
  const prenom = (body.Prenom || '').trim();

  if (!email.endsWith('@egd.mg')) {
    return jsonResponse({ success: false, error: 'Seules les adresses @egd.mg sont autorisees' });
  }
  if (!password || password.length < 6) {
    return jsonResponse({ success: false, error: 'Le mot de passe doit contenir au moins 6 caracteres' });
  }
  if (!nom || !prenom) {
    return jsonResponse({ success: false, error: 'Nom et prenom requis' });
  }
  if (!isEmailAuthorized(email)) {
    addLog(email, '', 'register_denied', 'Email non autorise');
    return jsonResponse({ success: false, error: "Vous n'etes pas inscrit(e) sur la liste des enseignants du lycee. Merci de contacter l'administrateur." });
  }
  if (emailAlreadyRegistered(email)) {
    return jsonResponse({ success: false, error: "Un compte existe deja avec cette adresse. Utilisez \"Mot de passe oublie\" si necessaire." });
  }

  const sheet  = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(USERS_SHEET);
  const hashed = hashPassword(password);
  // 7 colonnes : Email, Mot_de_Passe, Role, Nom, Prenom, Reset_Token, Reset_Expiry
  sheet.appendRow([email, hashed, 'enseignant', nom, prenom, '', '']);
  addLog(email, 'enseignant', 'register', 'Nouveau compte: ' + prenom + ' ' + nom);
  return jsonResponse({ success: true, message: 'Compte cree avec succes !', user: { email, role: 'enseignant', nom, prenom } });
}

// ============================================================
// AUTH : FORGOT PASSWORD (envoi du lien par email)
// ============================================================

function handleForgotPassword(e) {
  const email = (e.parameter.email || '').trim().toLowerCase();
  if (!email.endsWith('@egd.mg')) {
    return jsonResponse({ success: false, error: 'Adresse email invalide' });
  }

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(USERS_SHEET);
  if (!sheet) return jsonResponse({ success: false, error: 'Erreur systeme' });

  const data     = sheet.getDataRange().getValues();
  const headers  = data[0];
  const emailIdx = headers.indexOf('Email');
  const tokenIdx = headers.indexOf('Reset_Token');
  const expiryIdx= headers.indexOf('Reset_Expiry');

  for (let i = 1; i < data.length; i++) {
    if (data[i][emailIdx] && data[i][emailIdx].toString().toLowerCase().trim() === email) {
      // Generer un token UUID valide 24h
      const token  = Utilities.getUuid();
      const expiry = new Date().getTime() + 24 * 60 * 60 * 1000;
      sheet.getRange(i + 1, tokenIdx  + 1).setValue(token);
      sheet.getRange(i + 1, expiryIdx + 1).setValue(expiry.toString());

      // Envoyer l'email de reinitialisation
      const resetLink = APP_URL + '?reset=' + token;
      const subject   = 'LFT Projets - Reinitialisation de mot de passe';
      const body      = 'Bonjour,\n\n'
        + 'Vous avez demande une reinitialisation de votre mot de passe pour la plateforme LFT - Suivi des projets d\'etablissement.\n\n'
        + 'Cliquez sur ce lien pour definir un nouveau mot de passe (valide 24 heures) :\n'
        + resetLink + '\n\n'
        + 'Si vous n\'etes pas a l\'origine de cette demande, ignorez simplement cet email.\n\n'
        + 'Cordialement,\nL\'equipe LFT - Lycee Francais de Tananarive';

      MailApp.sendEmail({ to: email, subject: subject, body: body });
      addLog(email, '', 'forgot_password', 'Lien de reinitialisation envoye');
      return jsonResponse({ success: true, message: 'Un email de reinitialisation a ete envoye a ' + email });
    }
  }

  // Reponse generique pour eviter l'enumeration d'emails
  return jsonResponse({ success: true, message: 'Si cette adresse est associee a un compte, un email de reinitialisation a ete envoye.' });
}

// ============================================================
// AUTH : CONFIRM RESET (verification token + nouveau mot de passe)
// ============================================================

function handleConfirmReset(e) {
  const body        = JSON.parse(e.postData.contents);
  const token       = (body.token    || '').trim();
  const newPassword = (body.password || '');

  if (!token) return jsonResponse({ success: false, error: 'Token manquant' });
  if (!newPassword || newPassword.length < 6) {
    return jsonResponse({ success: false, error: 'Le mot de passe doit contenir au moins 6 caracteres' });
  }

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(USERS_SHEET);
  if (!sheet) return jsonResponse({ success: false, error: 'Erreur systeme' });

  const data      = sheet.getDataRange().getValues();
  const headers   = data[0];
  const emailIdx  = headers.indexOf('Email');
  const passIdx   = headers.indexOf('Mot_de_Passe');
  const tokenIdx  = headers.indexOf('Reset_Token');
  const expiryIdx = headers.indexOf('Reset_Expiry');

  for (let i = 1; i < data.length; i++) {
    if (data[i][tokenIdx] && data[i][tokenIdx].toString().trim() === token) {
      // Verifier l'expiration
      const expiry = parseInt(data[i][expiryIdx].toString());
      if (isNaN(expiry) || new Date().getTime() > expiry) {
        return jsonResponse({ success: false, error: 'Ce lien de reinitialisation a expire. Veuillez refaire la demande.' });
      }
      // Mettre a jour le mot de passe et effacer le token
      sheet.getRange(i + 1, passIdx  + 1).setValue(hashPassword(newPassword));
      sheet.getRange(i + 1, tokenIdx + 1).setValue('');
      sheet.getRange(i + 1, expiryIdx + 1).setValue('');

      const email = data[i][emailIdx].toString();
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
  const email    = (e.parameter.email    || '').trim().toLowerCase();
  const password = (e.parameter.password || '');
  const user     = authenticate(email, password);
  if (!user) return jsonResponse({ success: false, error: 'Authentification requise' });

  const subject = 'LFT Projets - Demande de suppression de compte : ' + email;
  const body    = 'Bonjour,\n\n'
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
// GET LOGS (admin uniquement)
// ============================================================

function handleGetLogs(e) {
  const user = authenticate(e.parameter.email, e.parameter.password);
  if (!isAdmin(user)) return jsonResponse({ success: false, error: 'Acces refuse - Admin uniquement' });

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(LOGS_SHEET);
  if (!sheet) return jsonResponse({ success: true, data: [] });

  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return jsonResponse({ success: true, data: [] });

  const headers = data[0];
  const results = [];
  // 200 dernieres entrees, les plus recentes en premier
  const start = Math.max(1, data.length - 200);
  for (let i = data.length - 1; i >= start; i--) {
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = data[i][j] !== undefined ? data[i][j].toString() : '';
    }
    results.push(row);
  }
  return jsonResponse({ success: true, data: results });
}

// ============================================================
// EMAILS AUTORISES (admin uniquement)
// ============================================================

function handleListEmails(e) {
  const user = authenticate(e.parameter.email, e.parameter.password);
  if (!isAdmin(user)) return jsonResponse({ success: false, error: 'Acces refuse' });

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(EMAILS_SHEET);
  if (!sheet) return jsonResponse({ success: true, data: [] });

  const data   = sheet.getDataRange().getValues();
  const emails = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) emails.push(data[i][0].toString());
  }
  return jsonResponse({ success: true, data: emails });
}

function handleAddEmail(e) {
  const user = authenticate(e.parameter.email, e.parameter.password);
  if (!isAdmin(user)) return jsonResponse({ success: false, error: 'Acces refuse' });

  const body     = JSON.parse(e.postData.contents);
  const newEmail = (body.email || body.Email || '').trim().toLowerCase();

  if (!newEmail.endsWith('@egd.mg')) {
    return jsonResponse({ success: false, error: 'Seules les adresses @egd.mg sont autorisees' });
  }
  if (isEmailAuthorized(newEmail)) {
    return jsonResponse({ success: false, error: 'Cette adresse est deja dans la liste' });
  }

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(EMAILS_SHEET);
  sheet.appendRow([newEmail]);
  addLog(e.parameter.email, user.role, 'add_email', 'Ajout email autorise: ' + newEmail);
  return jsonResponse({ success: true, message: 'Email ajoute a la liste' });
}

function handleDeleteEmail(e) {
  const user = authenticate(e.parameter.email, e.parameter.password);
  if (!isAdmin(user)) return jsonResponse({ success: false, error: 'Acces refuse' });

  const targetEmail = (e.parameter.target || e.parameter.email_target || '').trim().toLowerCase();
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(EMAILS_SHEET);
  if (!sheet) return jsonResponse({ success: false, error: 'Onglet introuvable' });

  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
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
  const table = e.parameter.table || PROJETS_SHEET;

  if (table === USERS_SHEET) {
    const user = authenticate(e.parameter.email, e.parameter.password);
    if (!isAdmin(user)) return jsonResponse({ success: false, error: 'Acces refuse' });
  }

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(table);
  if (!sheet) return jsonResponse({ success: false, error: 'Onglet introuvable' });

  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return jsonResponse({ success: true, data: [] });

  const headers = data[0];
  const results = [];
  for (let i = 1; i < data.length; i++) {
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      let val = data[i][j];
      if (val instanceof Date) val = Utilities.formatDate(val, 'Indian/Antananarivo', 'yyyy-MM-dd');
      row[headers[j]] = val !== undefined && val !== null ? val.toString() : '';
    }
    // Ne jamais exposer le mot de passe ni les tokens de reinitialisation
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
// ADD (Projets ou Utilisateurs)
// ============================================================

function handleAdd(e) {
  const table = e.parameter.table || PROJETS_SHEET;
  const user  = authenticate(e.parameter.email, e.parameter.password);
  if (!user) return jsonResponse({ success: false, error: 'Authentification requise' });
  if (table === USERS_SHEET && !isAdmin(user)) return jsonResponse({ success: false, error: 'Admin requis' });

  const body  = JSON.parse(e.postData.contents);
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(table);
  if (!sheet) return jsonResponse({ success: false, error: 'Onglet introuvable' });

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  if (table === PROJETS_SHEET) {
    body['ID_Projet']  = generateProjectId(body['Categorie']);
    body['Created_By'] = e.parameter.email;
    addLog(e.parameter.email, user.role, 'add_project', 'Nouveau projet: ' + (body['Nom_Projet'] || '') + ' (' + body['ID_Projet'] + ')');
  }

  if (table === USERS_SHEET) {
    if (body['Mot_de_Passe']) body['Mot_de_Passe'] = hashPassword(body['Mot_de_Passe']);
    if (emailAlreadyRegistered(body['Email'])) return jsonResponse({ success: false, error: 'Email deja utilise' });
    body['Reset_Token']  = '';
    body['Reset_Expiry'] = '';
    addLog(e.parameter.email, user.role, 'add_user', 'Creation utilisateur: ' + body['Email'] + ' (' + (body['Role'] || 'enseignant') + ')');
  }

  const newRow = headers.map(h => body[h] !== undefined ? body[h] : '');
  sheet.appendRow(newRow);
  return jsonResponse({ success: true, message: 'Ajout reussi', id: body['ID_Projet'] || body['Email'] });
}

// ============================================================
// UPDATE (Projets)
// ============================================================

function handleUpdate(e) {
  const user = authenticate(e.parameter.email, e.parameter.password);
  if (!user) return jsonResponse({ success: false, error: 'Authentification requise' });

  const body  = JSON.parse(e.postData.contents);
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PROJETS_SHEET);
  if (!sheet) return jsonResponse({ success: false, error: 'Onglet introuvable' });

  const data         = sheet.getDataRange().getValues();
  const headers      = data[0];
  const idIdx        = headers.indexOf('ID_Projet');
  const createdByIdx = headers.indexOf('Created_By');

  for (let i = 1; i < data.length; i++) {
    if (data[i][idIdx] === body['ID_Projet']) {
      const owner = data[i][createdByIdx];
      // Admin et Direction peuvent modifier n'importe quel projet
      // Enseignant : seulement ses propres projets
      if (!isAdminOrDirection(user) && owner !== e.parameter.email) {
        return jsonResponse({ success: false, error: 'Vous ne pouvez modifier que vos propres projets' });
      }
      for (let j = 0; j < headers.length; j++) {
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
  const table = e.parameter.table || PROJETS_SHEET;
  const user  = authenticate(e.parameter.email, e.parameter.password);
  if (!user) return jsonResponse({ success: false, error: 'Authentification requise' });

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(table);
  if (!sheet) return jsonResponse({ success: false, error: 'Onglet introuvable' });

  const data    = sheet.getDataRange().getValues();
  const headers = data[0];

  if (table === PROJETS_SHEET) {
    // Seuls Admin et Direction peuvent supprimer des projets
    if (!canDeleteProject(user)) {
      return jsonResponse({ success: false, error: 'Seuls les administrateurs et la direction peuvent supprimer des projets' });
    }
    const targetId  = e.parameter.id;
    const idIdx     = headers.indexOf('ID_Projet');
    const nomIdx    = headers.indexOf('Nom_Projet');
    for (let i = 1; i < data.length; i++) {
      if (data[i][idIdx] === targetId) {
        const nomProjet = data[i][nomIdx] || targetId;
        sheet.deleteRow(i + 1);
        addLog(e.parameter.email, user.role, 'delete_project', 'Suppression: ' + targetId + ' - ' + nomProjet);
        return jsonResponse({ success: true, message: 'Supprime' });
      }
    }
    return jsonResponse({ success: false, error: 'Introuvable' });
  }

  if (table === USERS_SHEET) {
    if (!isAdmin(user)) return jsonResponse({ success: false, error: 'Admin requis' });
    const targetEmail = e.parameter.email_target;
    if (targetEmail === e.parameter.email) return jsonResponse({ success: false, error: 'Impossible de supprimer votre propre compte' });
    const emailIdx = headers.indexOf('Email');
    for (let i = 1; i < data.length; i++) {
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
// INITIALISATION (executer manuellement depuis l'editeur GAS)
// ============================================================

function initializeSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Projets
  let p = ss.getSheetByName(PROJETS_SHEET);
  if (!p) {
    p = ss.insertSheet(PROJETS_SHEET);
    p.getRange(1, 1, 1, 19).setValues([['ID_Projet','Nom_Projet','Categorie','Echelle','Axe_Projet_Etablissement','Sous_Axe','Disciplines_Mobilisees','Niveaux_Concernes','Description','Objectifs_Pedagogiques','Statut','Priorite','Date_Debut','Date_Fin','Partenariats','Ressources_Necessaires','Modalite_Valorisation','Enseignant_Referent','Created_By']]);
    p.getRange(1, 1, 1, 19).setFontWeight('bold').setBackground('#0053a3').setFontColor('white');
    p.setFrozenRows(1);
  }

  // Utilisateurs (7 colonnes avec Reset_Token et Reset_Expiry)
  let u = ss.getSheetByName(USERS_SHEET);
  if (!u) {
    u = ss.insertSheet(USERS_SHEET);
    u.getRange(1, 1, 1, 7).setValues([['Email','Mot_de_Passe','Role','Nom','Prenom','Reset_Token','Reset_Expiry']]);
    u.getRange(1, 1, 1, 7).setFontWeight('bold').setBackground('#0053a3').setFontColor('white');
    u.setFrozenRows(1);
    u.appendRow(['admin@egd.mg', hashPassword('admin2025'), 'admin', 'Administrateur', 'LFT', '', '']);
  } else {
    // Migration : ajouter les colonnes manquantes si necessaire
    const existingHeaders = u.getRange(1, 1, 1, u.getLastColumn()).getValues()[0];
    if (!existingHeaders.includes('Reset_Token')) {
      const col = u.getLastColumn() + 1;
      u.getRange(1, col).setValue('Reset_Token').setFontWeight('bold').setBackground('#0053a3').setFontColor('white');
    }
    if (!existingHeaders.includes('Reset_Expiry')) {
      const col = u.getLastColumn() + 1;
      u.getRange(1, col).setValue('Reset_Expiry').setFontWeight('bold').setBackground('#0053a3').setFontColor('white');
    }
  }

  // Emails autorises
  let em = ss.getSheetByName(EMAILS_SHEET);
  if (!em) {
    em = ss.insertSheet(EMAILS_SHEET);
    em.getRange(1, 1).setValue('Email');
    em.getRange(1, 1).setFontWeight('bold').setBackground('#0053a3').setFontColor('white');
    em.setFrozenRows(1);
    em.appendRow(['admin@egd.mg']);
  }

  // Logs
  let logs = ss.getSheetByName(LOGS_SHEET);
  if (!logs) {
    logs = ss.insertSheet(LOGS_SHEET);
    logs.getRange(1, 1, 1, 5).setValues([['Date_Heure','Email','Role','Action','Detail']]);
    logs.getRange(1, 1, 1, 5).setFontWeight('bold').setBackground('#0053a3').setFontColor('white');
    logs.setFrozenRows(1);
  }

  Logger.log('=== Initialisation v3 terminee ! ===');
  Logger.log('Admin par defaut : admin@egd.mg / admin2025');
  Logger.log('Pensez a mettre a jour APP_URL si l URL GitHub Pages a change !');
  Logger.log('Pensez a ajouter les colonnes Reset_Token et Reset_Expiry si la feuille Utilisateurs existait deja.');
}
