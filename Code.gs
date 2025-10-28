/* =========================================================
   Recicla App – 5º Primaria (Web App + Google Sheets)
   ========================================================= */

// Si tu script NO está ligado al Sheet, pega aquí el ID del Spreadsheet.
// (El ID es la parte entre /d/ y /edit en la URL del Google Sheet)
var SS_ID = ''; // Ej: '1AbCDeFGh123...'. Si está ligado, déjalo vacío.

var SHEETS = {
  SETTINGS: 'Settings',
  STUDENTS: 'Students',
  CONTAINERS: 'Containers',
  LOG: 'RecyclingLog',
  CHALLENGES: 'Challenges',
  REWARDS: 'Rewards',
  REDEMPTIONS: 'Redemptions',
  CONTENT: 'Content'
};

function doGet(e) {
  var tmpl = HtmlService.createTemplateFromFile('Index');
  tmpl.initial = { settings: getSettings_() };
  return tmpl.evaluate()
    .setTitle(getSetting_('SCHOOL_NAME') || 'Recicla App')
    .setFaviconUrl('https://ssl.gstatic.com/docs/spreadsheets/favicon.ico')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/* ------------------ Helpers Sheets ------------------ */
function getSpreadsheet_() {
  var ss = SS_ID ? SpreadsheetApp.openById(SS_ID) : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('No se encontró la hoja de cálculo. Si el proyecto es independiente, rellena SS_ID.');
  return ss;
}
function getSheet_(name) {
  var ss = getSpreadsheet_();
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  return sh;
}
function getSettings_() {
  var sh = getSheet_(SHEETS.SETTINGS);
  var rows = sh.getDataRange().getValues();
  var obj = {};
  for (var i = 1; i < rows.length; i++) {
    var k = rows[i][0];
    var v = rows[i][1];
    if (k) obj[String(k).trim()] = v;
  }
  return obj;
}
function getSetting_(key, fallback) {
  if (typeof fallback === 'undefined') fallback = '';
  var s = getSettings_();
  return (s.hasOwnProperty(key) && s[key] !== null && s[key] !== '') ? s[key] : fallback;
}
function nowISO_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss");
}
function toObj_(headers, row) {
  var o = {};
  for (var i = 0; i < headers.length; i++) {
    o[headers[i]] = row[i];
  }
  return o;
}
function findRowIndexByValue_(sh, colIndex1Based, value) {
  var rows = Math.max(sh.getLastRow() - 1, 0);
  if (rows <= 0) return -1;
  var rng = sh.getRange(2, colIndex1Based, rows, 1);
  var vals = rng.getValues();
  for (var i = 0; i < vals.length; i++) {
    if (vals[i][0] === value) return i + 2;
  }
  return -1;
}

/* ------------------ Seguridad sencilla ------------------ */
function isAdmin_(email, adminKeyProvided) {
  var emails = String(getSetting_('ADMIN_EMAILS','')).split(';');
  for (var i = 0; i < emails.length; i++) {
    emails[i] = String(emails[i]).trim().toLowerCase();
    if (!emails[i]) { emails.splice(i,1); i--; }
  }
  var adminKey = String(getSetting_('ADMIN_KEY','')).trim();
  var userEmail = '';
  try { userEmail = (Session.getActiveUser() && Session.getActiveUser().getEmail()) || ''; } catch(e) {}
  userEmail = String(userEmail).toLowerCase();
  var byEmail = userEmail && emails.indexOf(userEmail) !== -1;
  var byKey = adminKeyProvided && (String(adminKeyProvided).trim() === adminKey);
  return byEmail || byKey;
}

/* ------------------ Estudiantes ------------------ */
function upsertStudent(profile) {
  var sh = getSheet_(SHEETS.STUDENTS);
  if (sh.getLastRow() === 0) {
    sh.appendRow(['StudentID','Name','Group','Class','Email','Points','CreatedAt','LastActiveAt']);
  }
  var idx = findRowIndexByValue_(sh, 1, profile.studentId);
  var now = nowISO_();
  if (idx > 0) {
    var rng = sh.getRange(idx, 1, 1, 8);
    var row = rng.getValues()[0];
    row[1] = profile.name || row[1];
    row[2] = profile.group || row[2];
    row[3] = profile.className || row[3];
    row[4] = profile.email || row[4];
    row[7] = now;
    rng.setValues([row]);
  } else {
    sh.appendRow([profile.studentId, profile.name, profile.group, profile.className, profile.email || '', 0, now, now]);
  }
  return getStudent(profile.studentId);
}
function getStudent(studentId) {
  var sh = getSheet_(SHEETS.STUDENTS);
  if (sh.getLastRow() < 2) return null;
  var headers = sh.getRange(1,1,1,8).getValues()[0];
  var data = sh.getRange(2,1,sh.getLastRow()-1,8).getValues();
  for (var i = 0; i < data.length; i++) {
    if (data[i][0] === studentId) return toObj_(headers, data[i]);
  }
  return null;
}

/* ------------------ Registro por QR ------------------ */
function logRecycling(payload) {
  var qrText = payload.qrText;
  var studentId = payload.studentId;
  var count = Math.max(1, Number(payload.count || 1));
  var parts = String(qrText || '').split('|');
  if (parts.length < 4 || parts[0] !== 'RCP') return { ok:false, error:'QR no válido.' };

  var material = parts[1];
  var containerId = parts[2];
  if (material !== 'PLASTICO') return { ok:false, error:'Este QR no es de plástico (es ' + material + ').' };

  // Contenedor activo
  var shC = getSheet_(SHEETS.CONTAINERS);
  var idxC = findRowIndexByValue_(shC, 1, containerId);
  if (idxC <= 0) return { ok:false, error:'Contenedor no registrado.' };
  var rowC = shC.getRange(idxC,1,1,5).getValues()[0];
  var active = String(rowC[3]).toUpperCase() === 'TRUE';
  if (!active) return { ok:false, error:'Contenedor inactivo.' };

  // Estudiante
  var st = getStudent(studentId);
  if (!st) return { ok:false, error:'Estudiante no registrado en la app.' };

  // Puntos
  var pointsPerDeposit = Number(getSetting_('POINTS_PER_DEPOSIT', 10));
  var points = pointsPerDeposit * count;

  // Reto semanal
  var ch = getActiveChallenge_();
  var challengeId = '';
  if (ch) {
    challengeId = ch.ChallengeID;
    var progress = getStudentWeeklyDeposits_(studentId, ch.StartDate, ch.EndDate);
    var goal = Number(ch.Goal || getSetting_('WEEKLY_GOAL_DEPOSITS',5));
    var bonus = Number(ch.BonusPoints || getSetting_('WEEKLY_BONUS_POINTS',20));
    var willReach = progress + count >= goal && progress < goal;
    if (willReach) points += bonus;
  }

  // Log
  var sh = getSheet_(SHEETS.LOG);
  if (sh.getLastRow() === 0) {
    sh.appendRow(['Timestamp','StudentID','StudentName','Group','Class','Material','ContainerID','Count','Points','ChallengeID','SourceQR']);
  }
  var ts = nowISO_();
  sh.appendRow([ts, studentId, st.Name, st.Group, st.Class, material, containerId, count, points, challengeId, qrText]);

  // Suma puntos
  var shS = getSheet_(SHEETS.STUDENTS);
  var idxS = findRowIndexByValue_(shS, 1, studentId);
  if (idxS > 0) {
    var currentPoints = Number(shS.getRange(idxS, 6).getValue() || 0);
    shS.getRange(idxS, 6).setValue(currentPoints + points);
    shS.getRange(idxS, 8).setValue(ts);
  }

  return { ok:true, pointsAwarded: points, challengeId: challengeId };
}

function getActiveChallenge_() {
  var sh = getSheet_(SHEETS.CHALLENGES);
  if (sh.getLastRow() < 2) return null;
  var headers = sh.getRange(1,1,1,8).getValues()[0];
  var data = sh.getRange(2,1,sh.getLastRow()-1,8).getValues();
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  for (var i = 0; i < data.length; i++) {
    var ch = toObj_(headers, data[i]);
    if (String(ch.Status).toUpperCase() === 'ACTIVE' &&
        String(ch.StartDate) <= today && today <= String(ch.EndDate)) {
      return ch;
    }
  }
  return null;
}
function getStudentWeeklyDeposits_(studentId, startDate, endDate) {
  var sh = getSheet_(SHEETS.LOG);
  if (sh.getLastRow() < 2) return 0;
  var headers = sh.getRange(1,1,1,11).getValues()[0];
  var data = sh.getRange(2,1,sh.getLastRow()-1,11).getValues();
  var sum = 0;
  for (var i = 0; i < data.length; i++) {
    var r = toObj_(headers, data[i]);
    var d = String(r.Timestamp).slice(0,10);
    if (r.StudentID === studentId && d >= startDate && d <= endDate) {
      sum += Number(r.Count || 0);
    }
  }
  return sum;
}

/* ------------------ Progreso y rankings ------------------ */
function getMySummary(studentId) {
  var st = getStudent(studentId);
  if (!st) return { ok:false, error:'Estudiante no encontrado' };
  var total = Number(st.Points || 0);

  var sh = getSheet_(SHEETS.LOG);
  var headers = sh.getLastRow() ? sh.getRange(1,1,1,11).getValues()[0] : [];
  var deposits = 0;
  if (sh.getLastRow() > 1) {
    var data = sh.getRange(2,1,sh.getLastRow()-1,11).getValues();
    for (var i=0;i<data.length;i++){
      var r = toObj_(headers, data[i]);
      if (r.StudentID === studentId) deposits += Number(r.Count || 0);
    }
  }

  var ch = getActiveChallenge_();
  var challenge = null;
  if (ch) {
    var done = getStudentWeeklyDeposits_(studentId, ch.StartDate, ch.EndDate);
    challenge = { id: ch.ChallengeID, goal: Number(ch.Goal), done: done, start: ch.StartDate, end: ch.EndDate, bonus: Number(ch.BonusPoints) };
  }
  return { ok:true, points: total, deposits: deposits, challenge: challenge };
}

function getLeaderboard(scope, filter) {
  var sh = getSheet_(SHEETS.STUDENTS);
  if (sh.getLastRow() < 2) return [];
  var headers = sh.getRange(1,1,1,8).getValues()[0];
  var data = sh.getRange(2,1,sh.getLastRow()-1,8).getValues();
  var rows = [];
  var i, s;

  if (scope === 'student') {
    var arr = [];
    for (i=0;i<data.length;i++){
      s = toObj_(headers, data[i]);
      if (!filter || (s.Class === filter || s.Group === filter)) {
        arr.push({ name:s.Name, id:s.StudentID, class:s.Class, group:s.Group, points:Number(s.Points||0) });
      }
    }
    arr.sort(function(a,b){ return b.points - a.points; });
    return arr.slice(0,20);
  }

  if (scope === 'class') {
    var byClass = {};
    for (i=0;i<data.length;i++){
      s = toObj_(headers, data[i]);
      if (filter && s.Group !== filter) continue;
      byClass[s.Class] = (byClass[s.Class]||0) + Number(s.Points||0);
    }
    for (var k in byClass) if (byClass.hasOwnProperty(k)) rows.push({ class:k, points:byClass[k] });
    rows.sort(function(a,b){ return b.points - a.points; });
    return rows.slice(0,10);
  }

  if (scope === 'group') {
    var byGroup = {};
    for (i=0;i<data.length;i++){
      s = toObj_(headers, data[i]);
      byGroup[s.Group] = (byGroup[s.Group]||0) + Number(s.Points||0);
    }
    for (var g in byGroup) if (byGroup.hasOwnProperty(g)) rows.push({ group:g, points:byGroup[g] });
    rows.sort(function(a,b){ return b.points - a.points; });
    return rows.slice(0,10);
  }

  return [];
}

/* ------------------ Recompensas ------------------ */
function listRewards() {
  var sh = getSheet_(SHEETS.REWARDS);
  if (sh.getLastRow() < 2) return [];
  var headers = sh.getRange(1,1,1,6).getValues()[0];
  var values = sh.getRange(2,1,sh.getLastRow()-1,6).getValues();
  var out = [];
  for (var i=0;i<values.length;i++){
    var r = toObj_(headers, values[i]);
    if (String(r.Active).toUpperCase() === 'TRUE') out.push(r);
  }
  return out;
}
function redeemReward(studentId, rewardId, approvedBy) {
  var rewards = listRewards();
  var reward = null;
  for (var i=0;i<rewards.length;i++) { if (rewards[i].RewardID === rewardId) { reward = rewards[i]; break; } }
  if (!reward) return { ok:false, error:'Recompensa no disponible' };

  var st = getStudent(studentId);
  if (!st) return { ok:false, error:'Estudiante no existe' };

  var cost = Number(reward.CostPoints || 0);
  var points = Number(st.Points || 0);
  if (points < cost) return { ok:false, error:'Te faltan ' + (cost - points) + ' puntos.' };

  var shS = getSheet_(SHEETS.STUDENTS);
  var idxS = findRowIndexByValue_(shS, 1, studentId);
  shS.getRange(idxS, 6).setValue(points - cost);

  var shR = getSheet_(SHEETS.REDEMPTIONS);
  if (shR.getLastRow() === 0) {
    shR.appendRow(['Timestamp','StudentID','RewardID','PointsSpent','ApprovedBy','Notes']);
  }
  shR.appendRow([nowISO_(), studentId, rewardId, cost, approvedBy || 'N/A', '']);

  return { ok:true, newBalance: points - cost };
}

/* ------------------ Educación ------------------ */
function getContent(type) { // 'tip' | 'fact' | 'all'
  var sh = getSheet_(SHEETS.CONTENT);
  if (sh.getLastRow() < 2) return [];
  var headers = sh.getRange(1,1,1,5).getValues()[0];
  var rows = sh.getRange(2,1,sh.getLastRow()-1,5).getValues();
  var out = [];
  for (var i=0;i<rows.length;i++){
    var r = toObj_(headers, rows[i]);
    if (!type || type === 'all' || r.Category === type) out.push(r);
  }
  return out.slice(0, 50);
}

/* ------------------ Reportes (docentes) ------------------ */
function getDashboardStats(adminKey) {
  if (!isAdmin_('', adminKey)) return { ok:false, error:'No autorizado' };
  var sh = getSheet_(SHEETS.LOG);
  var total = sh.getLastRow() > 1 ? sh.getLastRow()-1 : 0;

  var byMat = {};
  if (total > 0) {
    var headers = sh.getRange(1,1,1,11).getValues()[0];
    var data = sh.getRange(2,1,sh.getLastRow()-1,11).getValues();
    for (var i=0;i<data.length;i++){
      var r = toObj_(headers, data[i]);
      var m = r.Material;
      byMat[m] = (byMat[m] || 0) + Number(r.Count || 0);
    }
  }
  return {
    ok:true,
    totalDeposits: total,
    byMaterial: byMat,
    topStudents: getLeaderboard('student').slice(0,5),
    topClasses: getLeaderboard('class').slice(0,5)
  };
}

function exportCSV(adminKey) {
  if (!isAdmin_('', adminKey)) return { ok:false, error:'No autorizado' };
  var sh = getSheet_(SHEETS.LOG);
  if (sh.getLastRow() < 1) return { ok:false, error:'Sin datos' };
  var values = sh.getDataRange().getDisplayValues();
  var lines = [];
  for (var i=0;i<values.length;i++){
    var row = values[i];
    for (var j=0;j<row.length;j++){
      var x = String(row[j]);
      if (x.indexOf('"') !== -1) x = x.replace(/"/g, '""');
      if (x.indexOf(',') !== -1) x = '"' + x + '"';
      row[j] = x;
    }
    lines.push(row.join(','));
  }
  var csv = lines.join('\n');
  var blob = Utilities.newBlob(csv, 'text/csv', 'RecyclingLog.csv');
  var file = DriveApp.createFile(blob);
  return { ok:true, fileId: file.getId(), url: file.getUrl() };
}

/* ------------------ Recordatorios (triggers) ------------------ */
function sendDailyReminders() {
  var days = 7;
  var sh = getSheet_(SHEETS.STUDENTS);
  if (sh.getLastRow() < 2) return;
  var headers = sh.getRange(1,1,1,8).getValues()[0];
  var data = sh.getRange(2,1,sh.getLastRow()-1,8).getValues();
  var today = new Date();
  for (var i=0;i<data.length;i++){
    var s = toObj_(headers, data[i]);
    var email = String(s.Email || '').trim();
    if (!email) continue;
    var last = s.LastActiveAt ? new Date(s.LastActiveAt) : null;
    var inactive = !last || ((today - last) / (1000*3600*24) >= days);
    if (inactive) {
      GmailApp.sendEmail(email, '¡Suma puntos reciclando!',
        'Hola ' + s.Name + ' 👋\n\n¿Ya reciclaste plástico esta semana? Cada depósito suma puntos y te acerca a premios ecológicos.\n\n¡Vamos! 🌱');
    }
  }
}

function rollWeeklyChallenge() {
  var tz = Session.getScriptTimeZone();
  var today = new Date();
  var day = today.getDay(); // 0 dom, 1 lun
  var diffToMonday = (day === 0 ? -6 : 1 - day);
  var monday = new Date(today); monday.setDate(today.getDate() + diffToMonday);
  var sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
  function fmt(d){ return Utilities.formatDate(d, tz, 'yyyy-MM-dd'); }

  var sh = getSheet_(SHEETS.CHALLENGES);
  if (sh.getLastRow() === 0) {
    sh.appendRow(['ChallengeID','StartDate','EndDate','Type','Goal','BonusPoints','Status','Description']);
  }
  var lastRow = sh.getLastRow();
  if (lastRow > 1) {
    var rng = sh.getRange(2,7,lastRow-1,1);
    var vals = rng.getValues();
    for (var i=0;i<vals.length;i++){
      if (String(vals[i][0]).toUpperCase() === 'ACTIVE') vals[i][0] = 'CLOSED';
    }
    rng.setValues(vals);
  }
  var id = 'WEEK-' + fmt(monday);
  var goal = Number(getSetting_('WEEKLY_GOAL_DEPOSITS', 5));
  var bonus = Number(getSetting_('WEEKLY_BONUS_POINTS', 20));
  sh.appendRow([id, fmt(monday), fmt(sunday), 'deposits', goal, bonus, 'ACTIVE', 'Logra ' + goal + ' depósitos esta semana']);
}

/* ------------------ Generar QR (opcional) ------------------ */
function insertContainerQRCodes() {
  var base = 'https://quickchart.io/qr?size=250&text=';
  var sh = getSheet_(SHEETS.CONTAINERS);
  var last = sh.getLastRow();
  if (last < 2) return 0;
  for (var r = 2; r <= last; r++) {
    var payload = sh.getRange(r,5).getValue(); // QRPayload
    if (!payload) continue;
    var url = base + encodeURIComponent(payload);
    var img = UrlFetchApp.fetch(url).getBlob().setName('qr.png');
    sh.insertImage(img, 6, r);
  }
  return last - 1;
}
