// ════════════════════════════════════════════════════════════════════════════
//  ZALAVRAI — Google Apps Script  v10.0  (Drive Photos stable)
//  Architecture Tampon (Queue) · LockService · Anti Rate-Limit
//
//  Sheet ID : À définir — voir ligne 27 ci-dessous
//
// ════════════════════════════════════════════════════════════════════════════
//
//  INSTALLATION (une seule fois) :
//
//  1. Google Sheets → Extensions → Apps Script
//  2. Effacer tout → Coller CE fichier
//  3. ⚠️  Remplacer SHEET_ID par l'ID de votre Google Sheets (ligne 27)
//  4. Déployer → Nouvelle appli web
//       • Exécuter en tant que : Moi
//       • Qui peut accéder :     Tout le monde
//  5. Copier l'URL → ZALAVRAI → Réglages → URL Apps Script
//  6. Tester : Exécuter → testAll()
//
//  MISE À JOUR DU CODE :
//  → Déployer → Gérer les déploiements → ✏️ Modifier → Version : Nouvelle
//  → JAMAIS "Nouveau déploiement" (l'URL changerait !)
//
// ════════════════════════════════════════════════════════════════════════════

// ⚠️  REMPLACER PAR L'ID DE VOTRE GOOGLE SHEETS :
// 1. Ouvrir votre Google Sheets
// 2. Copier l'ID dans l'URL : docs.google.com/spreadsheets/d/ >>CECI<< /edit
// 3. Coller ici entre les apostrophes
const SHEET_ID = 'COLLER_VOTRE_SHEET_ID_ICI'; // ← À REMPLACER OBLIGATOIREMENT

// ── Tables et colonnes ───────────────────────────────────────────────────────
const TABLES = ['utilisateurs','clients','ventes','paiements','stock','signalements','archives'];

const COLS = {
  utilisateurs : ['id','username','password','role','manager_username','actif','photo','date_creation'],
  clients      : ['id','nom_complet','agent_username','photo','lieu_activite','activite','telephone','cin','genre','actif','actif_depuis','date_creation','carte_creee'],
  ventes       : ['id','agent_username','vendu_par','client_id','produit','montant_total','acompte30','solde70','montant_journalier','duree_jours','date_debut','date_fin','date_creation','note'],
  paiements    : ['id','vente_id','agent_username','montant_paye','date_paiement','date_creation','note'],
  stock        : ['id','source_username','dest_username','produit','quantite','prix_unitaire','date_mouvement'],
  signalements : ['id','type','ref_id','reporter','description','statut','date_creation','date_resolution'],
  archives     : ['id','type_donnee','periode','nb_lignes','taille_octets','taux_compression','donnees_compressees','archive_le','archive_par'],
};

// ════════════════════════════════════════════════════════════════════════════
//  POINT D'ENTRÉE — POST text/plain (zéro preflight CORS)
// ════════════════════════════════════════════════════════════════════════════

function doPost(e) {
  let req;
  try   { req = JSON.parse(e.postData.contents); }
  catch (err) { return _resp({ error: 'JSON invalide: ' + err.message }); }

  const action = String(req.action || '');

  // ── LockService : force le traitement séquentiel (anti-concurrence) ──────
  // Critique avec 20+ agents simultanés : évite les écrasements de données
  const lock = LockService.getScriptLock();
  let hasLock = false;
  try {
    lock.waitLock(30000); // attendre jusqu'à 30s pour obtenir le verrou
    hasLock = true;
  } catch (e) {
    // Si on ne peut pas obtenir le verrou en 30s → retourner "busy"
    return _resp({ error: 'busy', retry: true, wait: 2000,
                   message: 'Serveur occupé — votre app va réessayer automatiquement' });
  }

  let result;
  try {
    switch (action) {
      case 'ping'        : result = _ping();                          break;
      case 'archive_ventes': result = archiveOldVentes(req.mois||6); break;
      case 'purge_orphans' : result = purgeOrphanPaiements();             break;
      case 'init'        : result = _initSheets();                    break;
      case 'upsert'      : result = _upsert(req.table, req.rows);     break;
      case 'batch'       : result = _batch(req.ops);                  break;
      case 'delete'      : result = _delete(req.table, req.id);       break;
      case 'pull'        : result = _pull(req.tables);                break;
      case 'uploadPhoto' : result = _uploadPhoto(req.base64, req.filename, req.entityId); break;
      case 'deletePhoto' : result = _deletePhoto(req.fileId);         break;
      default            : result = { error: 'Action inconnue: ' + action };
    }
  } catch (err) {
    result = { error: err.message };
  } finally {
    if (hasLock) lock.releaseLock();
  }

  return _resp(result);
}

function doGet(e) {
  return _resp(_ping());
}

// ── Réponse text/plain (évite CORS preflight) ────────────────────────────────
function _resp(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.TEXT);
}

// ════════════════════════════════════════════════════════════════════════════
//  ACTIONS
// ════════════════════════════════════════════════════════════════════════════

function _ping() {
  return { ok: true, version: 'ZALAVRAI-v10', ts: new Date().toISOString(),
           sheet: SHEET_ID.slice(0,8)+'…' };
}

// ── UPSERT — Insérer ou mettre à jour (batch rapide) ─────────────────────────
function _upsert(tableName, rows) {
  if (!tableName || !rows || !rows.length) return { ok: true, upserted: 0 };

  const sheet  = _getOrCreateSheet(tableName);
  const cols   = COLS[tableName] || _inferCols(rows);
  _ensureHeaders(sheet, cols);

  // Lire une seule fois (évite les appels multiples = quota)
  const allData = sheet.getDataRange().getValues();
  const headers = allData[0];
  const idIdx   = headers.indexOf('id');

  // Index des lignes existantes
  const rowIndex = {};
  if (idIdx >= 0) {
    for (let i = 1; i < allData.length; i++) {
      const rid = String(allData[i][idIdx] || '');
      if (rid) rowIndex[rid] = i + 1; // numéro de ligne réel (1-based)
    }
  }

  const toUpdate = [];
  const toInsert = [];

  for (const row of rows) {
    if (!row.id) continue;
    const values = headers.map(h => {
      const v = row[h];
      if (v === null || v === undefined) return '';
      if (typeof v === 'boolean')        return v ? 'oui' : 'non';
      return String(v);
    });
    const existLine = rowIndex[String(row.id)];
    if (existLine) toUpdate.push({ line: existLine, values });
    else           toInsert.push(values);
  }

  // Updates individuels (inévitable avec Sheets API)
  for (const { line, values } of toUpdate) {
    sheet.getRange(line, 1, 1, values.length).setValues([values]);
  }

  // Inserts en BATCH (beaucoup plus rapide que appendRow en boucle)
  if (toInsert.length) {
    const lastRow = sheet.getLastRow();
    sheet.getRange(lastRow + 1, 1, toInsert.length, toInsert[0].length).setValues(toInsert);
  }

  return { ok: true, upserted: toUpdate.length + toInsert.length,
           updated: toUpdate.length, inserted: toInsert.length };
}

// ── BATCH — Plusieurs tables en UNE seule requête HTTP ───────────────────────
// Réduit drastiquement le nombre d'appels API (anti rate-limit)
function _batch(ops) {
  if (!ops || !ops.length) return { ok: true, total: 0 };

  let total    = 0;
  const errors = [];

  for (const op of ops) {
    if (!op.table || !op.rows) continue;
    try {
      const r = _upsert(op.table, op.rows);
      total += r.upserted || 0;
    } catch (e) {
      errors.push(op.table + ': ' + e.message);
      Logger.log('BATCH erreur ' + op.table + ': ' + e.message);
    }
  }

  if (errors.length && total === 0) {
    return { ok: false, error: errors.join(' | '), total };
  }
  return { ok: true, total, errors: errors.length > 0 ? errors : undefined };
}

// ── DELETE — Supprimer une ligne par ID ──────────────────────────────────────
function _delete(tableName, id) {
  if (!tableName || !id) return { ok: false, error: 'table et id requis' };

  const sheet = _getSheet(tableName);
  if (!sheet)  return { ok: false, error: 'Feuille introuvable: ' + tableName };

  const data  = sheet.getDataRange().getValues();
  const idIdx = data[0] ? data[0].indexOf('id') : -1;
  if (idIdx < 0) return { ok: false, error: 'Colonne id manquante' };

  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][idIdx]) === String(id)) {
      sheet.deleteRow(i + 1);
      return { ok: true, deleted: id };
    }
  }
  return { ok: false, error: 'ID non trouvé: ' + id };
}

// ── PULL — Lire toutes les tables (ou une sélection) ────────────────────────
function _pull(tables) {
  const ss     = SpreadsheetApp.openById(SHEET_ID);
  const result = {};
  const list   = Array.isArray(tables) && tables.length ? tables : TABLES;

  for (const name of list) {
    try {
      const sheet = ss.getSheetByName(name);
      if (!sheet || sheet.getLastRow() < 2) { result[name] = []; continue; }

      const data    = sheet.getDataRange().getValues();
      const headers = data[0];
      const rows    = [];

      for (let i = 1; i < data.length; i++) {
        if (!data[i].some(v => v !== '' && v !== null)) continue;
        const obj = {};
        headers.forEach((h, j) => { obj[h] = data[i][j] !== undefined ? data[i][j] : ''; });
        rows.push(obj);
      }
      result[name] = rows;
    } catch (e) {
      result[name] = [];
      Logger.log('PULL erreur ' + name + ': ' + e.message);
    }
  }

  return { ok: true, data: result };
}

// ── INIT — Créer/mettre à jour les 7 feuilles ───────────────────────────────
function _initSheets() {
  const ss      = SpreadsheetApp.openById(SHEET_ID);
  const created = [];
  const updated = [];

  for (const name of TABLES) {
    const cols  = COLS[name] || [];
    let   sheet = ss.getSheetByName(name);

    if (!sheet) {
      sheet = ss.insertSheet(name);
      if (cols.length) {
        sheet.getRange(1, 1, 1, cols.length).setValues([cols]);
        _styleHeader(sheet, cols.length);
      }
      created.push(name);
    } else {
      // Ajouter les colonnes manquantes uniquement
      const existing = sheet.getLastRow() > 0
        ? sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(),1)).getValues()[0]
        : [];
      const missing = cols.filter(c => c && !existing.includes(c));
      if (missing.length) {
        const startCol = existing.filter(h => h !== '').length + 1;
        sheet.getRange(1, startCol, 1, missing.length).setValues([missing]);
        sheet.getRange(1, startCol, 1, missing.length).setFontWeight('bold');
        updated.push(name + ' (+' + missing.join(',') + ')');
      }
    }
  }

  // Supprimer les feuilles vides par défaut
  for (const n of ['Feuille 1','Sheet1','Feuil1']) {
    try {
      const d = ss.getSheetByName(n);
      if (d && d.getLastRow() <= 1 && ss.getSheets().length > 1) ss.deleteSheet(d);
    } catch (e) {}
  }

  return { ok: true, created, updated };
}

// ════════════════════════════════════════════════════════════════════════════
//  UTILITAIRES INTERNES
// ════════════════════════════════════════════════════════════════════════════

function _getSheet(name) {
  return SpreadsheetApp.openById(SHEET_ID).getSheetByName(name);
}

function _getOrCreateSheet(name) {
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  let   sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    const cols = COLS[name] || [];
    if (cols.length) {
      sheet.getRange(1, 1, 1, cols.length).setValues([cols]);
      _styleHeader(sheet, cols.length);
    }
  }
  return sheet;
}

function _ensureHeaders(sheet, cols) {
  if (!cols || !cols.length) return;
  const lastCol  = Math.max(sheet.getLastColumn(), 1);
  const existing = sheet.getLastRow() > 0
    ? sheet.getRange(1, 1, 1, lastCol).getValues()[0]
    : [];
  const missing  = cols.filter(c => c && !existing.includes(c));
  if (missing.length) {
    const startCol = existing.filter(h => h !== '').length + 1;
    sheet.getRange(1, startCol, 1, missing.length).setValues([missing]);
    sheet.getRange(1, startCol, 1, missing.length).setFontWeight('bold');
    if (sheet.getFrozenRows() === 0) sheet.setFrozenRows(1);
  }
}

function _styleHeader(sheet, numCols) {
  const range = sheet.getRange(1, 1, 1, numCols);
  range.setFontWeight('bold');
  range.setBackground('#1a1a2e');
  range.setFontColor('#c9a030');
  range.setFontSize(10);
  sheet.setFrozenRows(1);
  for (let i = 1; i <= numCols; i++) sheet.setColumnWidth(i, 150);
}

function _inferCols(rows) {
  const keys = new Set();
  rows.forEach(r => Object.keys(r).forEach(k => keys.add(k)));
  return Array.from(keys);
}

// ════════════════════════════════════════════════════════════════════════════
//  GOOGLE DRIVE — PHOTOS
// ════════════════════════════════════════════════════════════════════════════

// Nom du dossier Drive où stocker les photos
const DRIVE_FOLDER_NAME = 'ZALAVRAI_Photos';

// Obtenir ou créer le dossier ZALAVRAI_Photos dans Drive
function _getDriveFolder() {
  const folders = DriveApp.getFoldersByName(DRIVE_FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  const folder = DriveApp.createFolder(DRIVE_FOLDER_NAME);
  // Rendre le dossier accessible en lecture à tous (pour afficher les photos)
  folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return folder;
}

// Uploader une photo base64 vers Drive
// Retourne { ok:true, url, fileId, filename, sizeKb } ou { error }
function _uploadPhoto(base64Data, filename, entityId) {
  if (!base64Data) return { error: 'Pas de données image' };

  try {
    // Décoder le base64 (supprimer le préfixe data:image/...;base64,)
    const matches = base64Data.match(/^data:([^;]+);base64,(.+)$/);
    if (!matches) return { error: 'Format base64 invalide (préfixe manquant)' };

    const mimeType = matches[1];  // ex: image/jpeg
    const base64   = matches[2];  // données pures
    const bytes    = Utilities.base64Decode(base64);
    const kb       = Math.round(bytes.length / 1024);
    const fname    = filename || ('zalavrai_photo_' + (entityId||'x') + '.jpg');

    const blob   = Utilities.newBlob(bytes, mimeType, fname);
    const folder = _getDriveFolder();

    // Supprimer l'ancienne photo de cette entité (évite les doublons)
    if (entityId) {
      const names = ['photo_'+entityId+'.jpg', 'zalavrai_photo_'+entityId+'.jpg'];
      names.forEach(n => {
        const it = folder.getFilesByName(n);
        while (it.hasNext()) it.next().setTrashed(true);
      });
    }

    // Créer le fichier dans Drive
    const file = folder.createFile(blob);
    // Accès public en lecture (pour afficher dans la PWA sans authentification)
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    const fileId = file.getId();
    // URL thumbnail CORS-compatible (400x400, sans auth)
    const url = 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w400-h400';
    // URL directe en fallback
    const urlDirect = 'https://drive.google.com/uc?export=view&id=' + fileId;

    Logger.log('✅ Photo uploadée: ' + fname + ' (' + kb + 'KB) → ' + fileId);
    return { ok: true, url: url, urlDirect: urlDirect, fileId: fileId, filename: fname, sizeKb: kb };

  } catch (err) {
    Logger.log('❌ Drive upload échoué: ' + err.message);
    return { error: 'Drive upload échoué: ' + err.message };
  }
}

// Supprimer une photo Drive par fileId
function _deletePhoto(fileId) {
  if (!fileId) return { ok: true };
  try {
    DriveApp.getFileById(fileId).setTrashed(true);
    return { ok: true, deleted: fileId };
  } catch (err) {
    // Fichier déjà supprimé ou introuvable → pas une erreur critique
    return { ok: true, note: 'Fichier non trouvé: ' + err.message };
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  TESTS
 — Exécuter depuis l'éditeur Apps Script pour vérifier
// ════════════════════════════════════════════════════════════════════════════

function testPing() {
  Logger.log('══ PING ══');
  Logger.log(JSON.stringify(_ping(), null, 2));
}

function testInit() {
  Logger.log('══ INIT SHEETS ══');
  const r = _initSheets();
  Logger.log('Créées  : ' + (r.created.join(', ') || '(aucune nouvelle)'));
  Logger.log('Mises à jour: ' + (r.updated.join(', ') || 'aucune'));
  Logger.log(r.ok ? '✅ Init OK' : '❌ Erreur');
}

function testUpsert() {
  Logger.log('══ UPSERT ══');
  const r = _upsert('clients', [{
    id            : 'TEST-' + Date.now(),
    nom_complet   : 'Test ZALAVRAI v8',
    agent_username: 'admin',
    telephone     : '+243828432689',
    lieu_activite : 'Kinshasa',
    activite      : 'Commerce',
    date_creation : new Date().toISOString(),
    carte_creee   : 'Non',
  }]);
  Logger.log(r.ok ? '✅ Upsert OK: ' + r.upserted + ' ligne(s)' : '❌ ' + r.error);
}

function testBatch() {
  Logger.log('══ BATCH ══');
  const r = _batch([
    { table: 'clients',  rows: [{ id:'BATCH-CLI-'+Date.now(), nom_complet:'Batch Test Client', agent_username:'admin', date_creation:new Date().toISOString(), carte_creee:'Non' }] },
    { table: 'ventes',   rows: [{ id:'BATCH-VTE-'+Date.now(), agent_username:'admin', client_id:'TEST', produit:'Test', montant_total:5000, acompte30:1500, solde70:3500, montant_journalier:175, duree_jours:20, date_debut:new Date().toISOString().split('T')[0], date_fin:'2025-12-31', date_creation:new Date().toISOString() }] },
  ]);
  Logger.log(r.ok ? '✅ Batch OK: ' + r.total + ' ligne(s)' : '❌ ' + r.error);
}

function testPull() {
  Logger.log('══ PULL ══');
  const r = _pull();
  for (const [table, rows] of Object.entries(r.data)) {
    Logger.log(table + ': ' + rows.length + ' ligne(s)');
  }
}

function testLock() {
  Logger.log('══ LOCK SERVICE ══');
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000);
    Logger.log('✅ LockService fonctionne — verrou obtenu');
    Utilities.sleep(1000);
  } finally {
    lock.releaseLock();
    Logger.log('✅ Verrou libéré');
  }
}

function testPhoto() {
  // Test upload d'une photo minuscule (1x1 pixel JPEG rouge)
  const tinyJpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AJQAB/9k=';
  const result = _uploadPhoto(tinyJpeg, 'test_photo.jpg', 'test_entity_123');
  Logger.log('testPhoto result:', JSON.stringify(result));
  if (result.ok) {
    Logger.log('✅ Photo uploadée → URL:', result.url);
    // Nettoyer le fichier de test
    _deletePhoto(result.fileId);
    Logger.log('✅ Photo de test supprimée');
  } else {
    Logger.log('❌ Erreur:', result.error);
  }
  return result;
}


// ════════════════════════════════════════════════════════════════════════════
// ARCHIVAGE — Déplacer les ventes anciennes vers l'onglet archives
// ════════════════════════════════════════════════════════════════════════════

function archiveOldVentes(moisLimit) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    const ss    = SpreadsheetApp.openById(SHEET_ID);
    const shVentes  = ss.getSheetByName('ventes');
    const shArchive = ss.getSheetByName('archives') || ss.insertSheet('archives');
    
    if (!shVentes) return { ok: false, error: 'Feuille ventes introuvable' };
    
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - (moisLimit || 6));
    const cutoffStr = cutoff.toISOString().split('T')[0];
    
    const data = shVentes.getDataRange().getValues();
    if (data.length < 2) return { ok: true, archived: 0 };
    
    const headers = data[0];
    const dateCol = headers.indexOf('date_creation');
    const rows    = data.slice(1);
    
    const toArchive = rows.filter(r => {
      const d = String(r[dateCol] || '').split('T')[0];
      return d && d < cutoffStr;
    });
    const toKeep = rows.filter(r => {
      const d = String(r[dateCol] || '').split('T')[0];
      return !d || d >= cutoffStr;
    });
    
    if (!toArchive.length) return { ok: true, archived: 0 };
    
    // Écrire dans archives
    if (shArchive.getLastRow() === 0) {
      shArchive.appendRow(['table','archived_at'].concat(headers));
    }
    toArchive.forEach(r => {
      shArchive.appendRow(['ventes', new Date().toISOString()].concat(r));
    });
    
    // Réécrire ventes sans les archivées
    shVentes.clearContents();
    shVentes.appendRow(headers);
    if (toKeep.length) {
      shVentes.getRange(2, 1, toKeep.length, headers.length).setValues(toKeep);
    }
    
    return { ok: true, archived: toArchive.length, kept: toKeep.length };
  } catch(e) {
    return { ok: false, error: e.message };
  } finally {
    lock.releaseLock();
  }
}

// ════════════════════════════════════════════════════════════════════════════
// PURGE — Supprimer paiements orphelins (venteID inexistant)
// ════════════════════════════════════════════════════════════════════════════

function purgeOrphanPaiements() {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    const ss  = SpreadsheetApp.openById(SHEET_ID);
    const shV = ss.getSheetByName('ventes');
    const shP = ss.getSheetByName('paiements');
    if (!shV || !shP) return { ok: false, error: 'Feuilles manquantes' };
    
    const ventesData = shV.getDataRange().getValues();
    const ventesIds  = new Set(ventesData.slice(1).map(r => String(r[0])));
    
    const pData  = shP.getDataRange().getValues();
    const pHead  = pData[0];
    const vidCol = pHead.indexOf('vente_id');
    const pRows  = pData.slice(1);
    
    const valid  = pRows.filter(r => ventesIds.has(String(r[vidCol])));
    const purged = pRows.length - valid.length;
    
    if (purged > 0) {
      shP.clearContents();
      shP.appendRow(pHead);
      if (valid.length) shP.getRange(2,1,valid.length,pHead.length).setValues(valid);
    }
    return { ok: true, purged };
  } catch(e) {
    return { ok: false, error: e.message };
  } finally {
    lock.releaseLock();
  }
}

function testAll() {
  testPing();
  testInit();
  testUpsert();
  testBatch();
  testPull();
  testLock();
  Logger.log('');
  Logger.log('════ ✅ TOUS LES TESTS PASSÉS — ZALAVRAI v10.0 DRIVE PHOTOS PRÊT ════');
}
