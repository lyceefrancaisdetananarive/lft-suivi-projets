/**
 * ============================================================
 * LFT - Suivi des Projets d'Etablissement - v2
 * Google Apps Script - API Backend
 * Lycee Francais de Tananarive - AEFE
 * ============================================================
 *
 * ONGLETS REQUIS :
 * - "Projets" (19 colonnes)
 * - "Utilisateurs" (5 colonnes : Email, Mot_de_Passe, Role, Nom, Prenom)
 * - "Emails_Autorises" (1 colonne : Email)
 */

const PROJETS_SHEET = 'Projets';
const USERS_SHEET = 'Utilisateurs';
const EMAILS_SHEET = 'Emails_Autorises';

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
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const emailIdx = headers.indexOf('Email');
  const passIdx = headers.indexOf('Mot_de_Passe');
  const roleIdx = headers.indexOf('Role');
  const nomIdx = headers.indexOf('Nom');
  const prenomIdx = headers.indexOf('Prenom');
  const hashed = hashPassword(password);
  for (let i = 1; i < data.length; i++) {
    if (data[i][emailIdx] === email && data[i][passIdx] === hashed) {
      return { email: data[i][emailIdx], role: data[i][roleIdx], nom: data[i][nomIdx], prenom: data[i][prenomIdx] };
    }
  }
  return null;
}

function isAdmin(user) { return user && user.role === 'admin'; }

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
  const data = sheet.getDataRange().getValues();
  const emailIdx = data[0].indexOf('Email');
  for (let i = 1; i < data.length; i++) {
    if (data[i][emailIdx] && data[i][emailIdx].toString().toLowerCase().trim() === email.toLowerCase().trim()) return true;
  }
  return false;
}

function generateProjectId(categorie) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PROJETS_SHEET);
  const data = sheet.getDataRange().getValues();
  let prefix = 'LFT';
  if (categorie && categorie.includes('AEFE')) prefix = 'AEFE';
  else if (categorie && categorie.includes('Zone')) prefix = 'ZOI';
  else if (categorie && categorie.includes('institutionnel')) prefix = 'INST';
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

// ============================================================
// HANDLERS
// ============================================================

function doGet(e) {
  try {
    switch (e.parameter.action) {
      case 'login': return handleLogin(e);
      case 'list': return handleList(e);
      case 'delete': return handleDelete(e);
      case 'list-emails': return handleListEmails(e);
      case 'delete-email': return handleDeleteEmail(e);
      default: return jsonResponse({ success: false, error: 'Action non reconnue' });
    }
  } catch (err) { return jsonResponse({ success: false, error: err.toString() }); }
}

function doPost(e) {
  try {
    switch (e.parameter.action) {
      case 'add': return handleAdd(e);
      case 'update': return handleUpdate(e);
      case 'register': return handleRegister(e);
      case 'reset-password': return handleResetPassword(e);
      case 'add-email': return handleAddEmail(e);
      default: return jsonResponse({ success: false, error: 'Action non reconnue' });
    }
  } catch (err) { return jsonResponse({ success: false, error: err.toString() }); }
}

// ============================================================
// AUTH : LOGIN
// ============================================================

function handleLogin(e) {
  const user = authenticate(e.parameter.email, e.parameter.password);
  if (!user) return jsonResponse({ success: false, error: 'Identifiants incorrects' });
  return jsonResponse({ success: true, user: user });
}

// ============================================================
// AUTH : REGISTER (self-registration for authorized emails)
// ============================================================

function handleRegister(e) {
  const body = JSON.parse(e.postData.contents);
  const email = (body.Email || '').trim().toLowerCase();
  const password = body.Mot_de_Passe || '';
  const nom = (body.Nom || '').trim();
  const prenom = (body.Prenom || '').trim();

  // Validation email @egd.mg
  if (!email.endsWith('@egd.mg')) {
    return jsonResponse({ success: false, error: 'Seules les adresses @egd.mg sont autorisees' });
  }
  if (!password || password.length < 4) {
    return jsonResponse({ success: false, error: 'Le mot de passe doit contenir au moins 4 caracteres' });
  }
  if (!nom || !prenom) {
    return jsonResponse({ success: false, error: 'Nom et prenom requis' });
  }

  // Verifier que l'email est dans la liste autorisee
  if (!isEmailAuthorized(email)) {
    return jsonResponse({ success: false, error: 'Cette adresse email n\'est pas autorisee. Contactez l\'administrateur pour etre ajoute a la liste.' });
  }

  // Verifier que l'email n'est pas deja enregistre
  if (emailAlreadyRegistered(email)) {
    return jsonResponse({ success: false, error: 'Un compte existe deja avec cette adresse. Utilisez "Mot de passe oublie" si necessaire.' });
  }

  // Creer le compte
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(USERS_SHEET);
  const hashed = hashPassword(password);
  sheet.appendRow([email, hashed, 'enseignant', nom, prenom]);

  return jsonResponse({ success: true, message: 'Compte cree avec succes !', user: { email, role: 'enseignant', nom, prenom } });
}

// ============================================================
// AUTH : RESET PASSWORD
// ============================================================

function handleResetPassword(e) {
  const body = JSON.parse(e.postData.contents);
  const email = (body.Email || '').trim().toLowerCase();
  const newPassword = body.Nouveau_Mot_de_Passe || '';

  if (!email.endsWith('@egd.mg')) {
    return jsonResponse({ success: false, error: 'Adresse email invalide' });
  }
  if (!newPassword || newPassword.length < 4) {
    return jsonResponse({ success: false, error: 'Le nouveau mot de passe doit contenir au moins 4 caracteres' });
  }

  // Verifier que le compte existe
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(USERS_SHEET);
  if (!sheet) return jsonResponse({ success: false, error: 'Erreur systeme' });
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const emailIdx = headers.indexOf('Email');
  const passIdx = headers.indexOf('Mot_de_Passe');

  for (let i = 1; i < data.length; i++) {
    if (data[i][emailIdx] && data[i][emailIdx].toString().toLowerCase().trim() === email) {
      // Mettre a jour le mot de passe
      sheet.getRange(i + 1, passIdx + 1).setValue(hashPassword(newPassword));
      return jsonResponse({ success: true, message: 'Mot de passe reinitialise avec succes' });
    }
  }

  return jsonResponse({ success: false, error: 'Aucun compte trouve avec cette adresse email' });
}

// ============================================================
// EMAILS AUTORISES (admin only)
// ============================================================

function handleListEmails(e) {
  const user = authenticate(e.parameter.email, e.parameter.password);
  if (!isAdmin(user)) return jsonResponse({ success: false, error: 'Acces refuse' });

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(EMAILS_SHEET);
  if (!sheet) return jsonResponse({ success: true, data: [] });
  const data = sheet.getDataRange().getValues();
  const emails = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) emails.push(data[i][0].toString());
  }
  return jsonResponse({ success: true, data: emails });
}

function handleAddEmail(e) {
  const user = authenticate(e.parameter.email, e.parameter.password);
  if (!isAdmin(user)) return jsonResponse({ success: false, error: 'Acces refuse' });

  const body = JSON.parse(e.postData.contents);
  const newEmail = (body.email || '').trim().toLowerCase();

  if (!newEmail.endsWith('@egd.mg')) {
    return jsonResponse({ success: false, error: 'Seules les adresses @egd.mg sont autorisees' });
  }

  // Verifier si deja dans la liste
  if (isEmailAuthorized(newEmail)) {
    return jsonResponse({ success: false, error: 'Cette adresse est deja dans la liste' });
  }

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(EMAILS_SHEET);
  sheet.appendRow([newEmail]);
  return jsonResponse({ success: true, message: 'Email ajoute a la liste' });
}

function handleDeleteEmail(e) {
  const user = authenticate(e.parameter.email, e.parameter.password);
  if (!isAdmin(user)) return jsonResponse({ success: false, error: 'Acces refuse' });

  const targetEmail = (e.parameter.target || '').trim().toLowerCase();
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(EMAILS_SHEET);
  if (!sheet) return jsonResponse({ success: false, error: 'Onglet introuvable' });

  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] && data[i][0].toString().toLowerCase().trim() === targetEmail) {
      sheet.deleteRow(i + 1);
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
    if (table === USERS_SHEET) delete row['Mot_de_Passe'];
    results.push(row);
  }
  return jsonResponse({ success: true, data: results });
}

// ============================================================
// ADD (Projets ou Utilisateurs)
// ============================================================

function handleAdd(e) {
  const table = e.parameter.table || PROJETS_SHEET;
  const user = authenticate(e.parameter.email, e.parameter.password);
  if (!user) return jsonResponse({ success: false, error: 'Authentification requise' });
  if (table === USERS_SHEET && !isAdmin(user)) return jsonResponse({ success: false, error: 'Admin requis' });

  const body = JSON.parse(e.postData.contents);
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(table);
  if (!sheet) return jsonResponse({ success: false, error: 'Onglet introuvable' });

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  if (table === PROJETS_SHEET) {
    body['ID_Projet'] = generateProjectId(body['Categorie']);
    body['Created_By'] = e.parameter.email;
  }

  if (table === USERS_SHEET) {
    if (body['Mot_de_Passe']) body['Mot_de_Passe'] = hashPassword(body['Mot_de_Passe']);
    if (emailAlreadyRegistered(body['Email'])) return jsonResponse({ success: false, error: 'Email deja utilise' });
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

  const body = JSON.parse(e.postData.contents);
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PROJETS_SHEET);
  if (!sheet) return jsonResponse({ success: false, error: 'Onglet introuvable' });

  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idIdx = headers.indexOf('ID_Projet');
  const createdByIdx = headers.indexOf('Created_By');

  for (let i = 1; i < data.length; i++) {
    if (data[i][idIdx] === body['ID_Projet']) {
      if (!isAdmin(user) && data[i][createdByIdx] !== e.parameter.email) {
        return jsonResponse({ success: false, error: 'Vous ne pouvez modifier que vos propres projets' });
      }
      for (let j = 0; j < headers.length; j++) {
        if (headers[j] === 'ID_Projet' || headers[j] === 'Created_By') continue;
        if (body[headers[j]] !== undefined) sheet.getRange(i + 1, j + 1).setValue(body[headers[j]]);
      }
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
  const user = authenticate(e.parameter.email, e.parameter.password);
  if (!user) return jsonResponse({ success: false, error: 'Authentification requise' });

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(table);
  if (!sheet) return jsonResponse({ success: false, error: 'Onglet introuvable' });
  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  if (table === PROJETS_SHEET) {
    const targetId = e.parameter.id;
    const idIdx = headers.indexOf('ID_Projet');
    const createdByIdx = headers.indexOf('Created_By');
    for (let i = 1; i < data.length; i++) {
      if (data[i][idIdx] === targetId) {
        if (!isAdmin(user) && data[i][createdByIdx] !== e.parameter.email) {
          return jsonResponse({ success: false, error: 'Vous ne pouvez supprimer que vos propres projets' });
        }
        sheet.deleteRow(i + 1);
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
      if (data[i][emailIdx] === targetEmail) { sheet.deleteRow(i + 1); return jsonResponse({ success: true, message: 'Supprime' }); }
    }
    return jsonResponse({ success: false, error: 'Introuvable' });
  }
  return jsonResponse({ success: false, error: 'Table non supportee' });
}

// ============================================================
// INITIALISATION
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

  // Utilisateurs
  let u = ss.getSheetByName(USERS_SHEET);
  if (!u) {
    u = ss.insertSheet(USERS_SHEET);
    u.getRange(1, 1, 1, 5).setValues([['Email','Mot_de_Passe','Role','Nom','Prenom']]);
    u.getRange(1, 1, 1, 5).setFontWeight('bold').setBackground('#0053a3').setFontColor('white');
    u.setFrozenRows(1);
    u.appendRow(['admin@egd.mg', hashPassword('admin2025'), 'admin', 'Administrateur', 'LFT']);
  }

  // Emails autorises
  let em = ss.getSheetByName(EMAILS_SHEET);
  if (!em) {
    em = ss.insertSheet(EMAILS_SHEET);
    em.getRange(1, 1).setValue('Email');
    em.getRange(1, 1).setFontWeight('bold').setBackground('#0053a3').setFontColor('white');
    em.setFrozenRows(1);
    // Ajouter l'admin par defaut
    em.appendRow(['admin@egd.mg']);
  }

  Logger.log('Initialisation terminee ! Admin: admin@egd.mg / admin2025');
}
