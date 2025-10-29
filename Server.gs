/* Recicla App – Backend sin '...' */

var SS_ID = '';  // Si NO está ligado al Sheet, pega aquí el ID del Spreadsheet (entre /d/ y /edit)

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
function ping(){ return 'ok'; }

/* ========== Helpers ========== */
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
function looksLikeSettingKey_(value) {
  var key = collapseWhitespace_(value);
  if (!key) return false;
  if (key.indexOf('//') === 0 || key.indexOf('#') === 0) return false;
  return /^[A-Z0-9_]+$/.test(key);
}

function isSettingsHeaderLabel_(value) {
  var label = collapseWhitespace_(value).toLowerCase();
  if (!label) return false;
  var headerLabels = ['key','keys','clave','claves','config','configuracion','configuration','setting','settings','parametro','parameter','nombre','value','values','valor','valores','dato','datos','data','contenido'];
  return headerLabels.indexOf(label) !== -1;
}

function isSettingsHeaderRow_(row, index, treatFirstRowAsHeader) {
  if (!row) return false;
  if (index === 0) {
    if (treatFirstRowAsHeader) return true;
    var first = collapseWhitespace_(row[0]).toLowerCase();
    var second = collapseWhitespace_(row[1]).toLowerCase();
    if (!first && !second) return false;
    if (isSettingsHeaderLabel_(first) || isSettingsHeaderLabel_(second)) return true;
  }
  return false;
}

function getSettings_() {
  var sh = getSheet_(SHEETS.SETTINGS);
  var lastRow = sh.getLastRow();
  if (lastRow === 0) return {};

  var lastCol = sh.getLastColumn();
  if (lastCol === 0) return {};

  var rows = sh.getRange(1, 1, lastRow, lastCol).getDisplayValues();
  var obj = {};
  var i, j;

  var firstRow = rows[0] || [];
  var firstRowKeyCount = 0;
  for (j = 0; j < firstRow.length; j++) {
    if (looksLikeSettingKey_(firstRow[j])) firstRowKeyCount++;
  }

  var secondRow = rows.length > 1 ? rows[1] : null;
  var secondRowHasKey = secondRow ? looksLikeSettingKey_(secondRow[0]) : false;
  var hasHorizontalHeader = rows.length > 1 && firstRowKeyCount >= 2 && !secondRowHasKey;

  for (i = 0; i < rows.length; i++) {
    if (isSettingsHeaderRow_(rows[i], i, hasHorizontalHeader)) continue;
    if (hasHorizontalHeader && i === 1) continue;

    var key = collapseWhitespace_(rows[i][0]);
    if (!key || key.indexOf('//') === 0 || key.indexOf('#') === 0) continue;

    var values = [];
    for (j = 1; j < rows[i].length; j++) {
      var raw = rows[i][j];
      if (!raw && raw !== 0) continue;

      var normalized = String(raw).replace(/\r\n?/g, '\n').trim();
      if (normalized) values.push(normalized);
    }

    if (!obj.hasOwnProperty(key)) {
      obj[key] = values.length ? values.join('\n') : '';
    }
  }

  if (hasHorizontalHeader) {
    for (j = 0; j < firstRow.length; j++) {
      var headerKey = collapseWhitespace_(firstRow[j]);
      if (!headerKey || headerKey.indexOf('//') === 0 || headerKey.indexOf('#') === 0 || isSettingsHeaderLabel_(headerKey)) continue;

      var parts = [];
      for (i = 1; i < rows.length; i++) {
        var cell = rows[i][j];
        if (!cell && cell !== 0) continue;
        var value = String(cell).replace(/\r\n?/g, '\n').trim();
        if (value) parts.push(value);
      }
      if (!parts.length) continue;

      if (!obj.hasOwnProperty(headerKey) || !obj[headerKey]) {
        obj[headerKey] = parts.join('\n');
      }
    }
  }
  return obj;
}
function getSetting_(key, fallback){ if(typeof fallback==='undefined') fallback='';
  var s=getSettings_(); return (s.hasOwnProperty(key)&&s[key]!==null&&s[key]!=='')?s[key]:fallback;
}
function nowISO_(){ return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss"); }
function toObj_(headers,row){ var o={},i; for(i=0;i<headers.length;i++){ o[headers[i]]=row[i]; } return o; }

/* === Comparar SIEMPRE COMO TEXTO (evita problema '0501'→501) === */
function findRowIndexByValue_(sh, col, value){
  var rows=Math.max(sh.getLastRow()-1,0); if(rows<=0) return -1;
  var vals=sh.getRange(2,col,rows,1).getValues(); var target=String(value).trim(); var i;
  for(i=0;i<vals.length;i++){ if(String(vals[i][0]).trim()==target) return i+2; } return -1;
}

/* ========== Seguridad simple ========== */
function collapseWhitespace_(value){
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function splitConfigList_(raw){
  if (!raw && raw !== 0) return [];
  return String(raw)
    .replace(/\r\n?/g, '\n')
    .split(/[;,\n|]+/)
    .map(function(part){ return collapseWhitespace_(part); })
    .filter(function(part){ return part.length > 0; });
}

function getAdminAuthState_(email, adminKeyProvided){
  var allowedEmails = splitConfigList_(getSetting_('ADMIN_EMAILS', ''))
    .map(function(e){ return e.toLowerCase(); });
  var adminKeys = splitConfigList_(getSetting_('ADMIN_KEY', ''));
  var providedKey = collapseWhitespace_(adminKeyProvided);
  var providedKeyLower = providedKey.toLowerCase();

  var userEmail = collapseWhitespace_(email);
  if (!userEmail) {
    try {
      userEmail = collapseWhitespace_((Session.getActiveUser() && Session.getActiveUser().getEmail()) || '');
    } catch (err) {
      userEmail = '';
    }
  }
  var userEmailLower = userEmail.toLowerCase();

  var byEmail = userEmail && allowedEmails.indexOf(userEmailLower) !== -1;
  var byKey = false;
  if (providedKey) {
    byKey = adminKeys.some(function(key){
      var normalized = collapseWhitespace_(key);
      return normalized && (normalized === providedKey || normalized.toLowerCase() === providedKeyLower);
    });
  }

  return {
    allowed: byEmail || byKey,
    byEmail: byEmail,
    byKey: byKey,
    providedKey: providedKey,
    configured: allowedEmails.length > 0 || adminKeys.length > 0
  };
}

function validateAdminAccess_(adminKeyProvided){
  var state = getAdminAuthState_('', adminKeyProvided);
  if (state.allowed) {
    return {ok:true, method: state.byEmail ? 'email' : 'key'};
  }
  if (!state.configured) {
    return {ok:false,error:'No hay docentes configurados. Define ADMIN_EMAILS o ADMIN_KEY en Settings.'};
  }
  if (state.providedKey) {
    return {ok:false,error:'Clave docente incorrecta.'};
  }
  return {ok:false,error:'No autorizado'};
}

function isAdmin_(email, adminKeyProvided){
  return getAdminAuthState_(email, adminKeyProvided).allowed;
}

/* ========== Estudiantes ========== */
function upsertStudent(profile){
  var sh=getSheet_(SHEETS.STUDENTS);
  if(sh.getLastRow()===0){ sh.appendRow(['StudentID','Name','Group','Class','Email','Points','CreatedAt','LastActiveAt']); }
  var idx=findRowIndexByValue_(sh,1,profile.studentId); var now=nowISO_();
  if(idx>0){
    var rng=sh.getRange(idx,1,1,8), row=rng.getValues()[0];
    row[1]=profile.name||row[1]; row[2]=profile.group||row[2]; row[3]=profile.className||row[3]; row[4]=profile.email||row[4]; row[7]=now;
    rng.setValues([row]);
  } else {
    sh.appendRow([profile.studentId,profile.name,profile.group,profile.className,profile.email||'',0,now,now]);
  }
  return getStudent(profile.studentId);
}
function getStudent(studentId){
  var sh=getSheet_(SHEETS.STUDENTS); if(sh.getLastRow()<2) return null;
  var headers=sh.getRange(1,1,1,8).getValues()[0]; var data=sh.getRange(2,1,sh.getLastRow()-1,8).getValues();
  var target=String(studentId).trim(), i; for(i=0;i<data.length;i++){ if(String(data[i][0]).trim()==target) return toObj_(headers,data[i]); }
  return null;
}

/* ========== Registro por QR ========== */
function logRecycling(payload){
  var qrText=payload.qrText, studentId=payload.studentId, count=Math.max(1,Number(payload.count||1));
  var parts=String(qrText||'').split('|'); if(parts.length<4||parts[0]!=='RCP') return {ok:false,error:'QR no válido.'};
  var material=parts[1], containerId=parts[2]; if(material!=='PLASTICO') return {ok:false,error:'Este QR no es de plástico (es '+material+').'};
  var shC=getSheet_(SHEETS.CONTAINERS), idxC=findRowIndexByValue_(shC,1,containerId); if(idxC<=0) return {ok:false,error:'Contenedor no registrado.'};
  var rowC=shC.getRange(idxC,1,1,5).getValues()[0]; if(String(rowC[3]).toUpperCase()!=='TRUE') return {ok:false,error:'Contenedor inactivo.'};
  var st=getStudent(studentId); if(!st) return {ok:false,error:'Estudiante no registrado en la app.'};
  var pointsPerDeposit=Number(getSetting_('POINTS_PER_DEPOSIT',10)); var points=pointsPerDeposit*count;

  var ch=getActiveChallenge_(), challengeId='';
  if(ch){
    challengeId=ch.ChallengeID;
    var progress=getStudentWeeklyDeposits_(studentId,ch.StartDate,ch.EndDate);
    var goal=Number(ch.Goal||getSetting_('WEEKLY_GOAL_DEPOSITS',5));
    var bonus=Number(ch.BonusPoints||getSetting_('WEEKLY_BONUS_POINTS',20));
    if(progress+count>=goal && progress<goal) points+=bonus;
  }

  var sh=getSheet_(SHEETS.LOG);
  if(sh.getLastRow()===0){ sh.appendRow(['Timestamp','StudentID','StudentName','Group','Class','Material','ContainerID','Count','Points','ChallengeID','SourceQR']); }
  var ts=nowISO_();
  sh.appendRow([ts,studentId,st.Name,st.Group,st.Class,material,containerId,count,points,challengeId,qrText]);

  var shS=getSheet_(SHEETS.STUDENTS), idxS=findRowIndexByValue_(shS,1,studentId);
  if(idxS>0){ var curr=Number(shS.getRange(idxS,6).getValue()||0); shS.getRange(idxS,6).setValue(curr+points); shS.getRange(idxS,8).setValue(ts); }
  return {ok:true, pointsAwarded:points, challengeId:challengeId};
}

function getActiveChallenge_(){
  var sh=getSheet_(SHEETS.CHALLENGES); if(sh.getLastRow()<2) return null;
  var headers=sh.getRange(1,1,1,8).getValues()[0]; var data=sh.getRange(2,1,sh.getLastRow()-1,8).getValues();
  var today=Utilities.formatDate(new Date(),Session.getScriptTimeZone(),'yyyy-MM-dd'); var i;
  for(i=0;i<data.length;i++){ var ch=toObj_(headers,data[i]);
    if(String(ch.Status).toUpperCase()==='ACTIVE' && String(ch.StartDate)<=today && today<=String(ch.EndDate)) return ch; }
  return null;
}
function getStudentWeeklyDeposits_(studentId,startDate,endDate){
  var sh=getSheet_(SHEETS.LOG); if(sh.getLastRow()<2) return 0;
  var headers=sh.getRange(1,1,1,11).getValues()[0]; var data=sh.getRange(2,1,sh.getLastRow()-1,11).getValues();
  var sum=0,i; for(i=0;i<data.length;i++){ var r=toObj_(headers,data[i]), d=String(r.Timestamp).slice(0,10);
    if(String(r.StudentID).trim()==String(studentId).trim() && d>=startDate && d<=endDate) sum+=Number(r.Count||0); }
  return sum;
}

/* ========== Progreso y rankings ========== */
function getMySummary(studentId){
  var st=getStudent(studentId); if(!st) return {ok:false,error:'Estudiante no encontrado'};
  var total=Number(st.Points||0), deposits=0, sh=getSheet_(SHEETS.LOG);
  if(sh.getLastRow()>1){ var headers=sh.getRange(1,1,1,11).getValues()[0], data=sh.getRange(2,1,sh.getLastRow()-1,11).getValues(), i;
    for(i=0;i<data.length;i++){ var r=toObj_(headers,data[i]); if(String(r.StudentID).trim()==String(studentId).trim()) deposits+=Number(r.Count||0); } }
  var ch=getActiveChallenge_(), challenge=null; if(ch){ var done=getStudentWeeklyDeposits_(studentId,ch.StartDate,ch.EndDate);
    challenge={id:ch.ChallengeID,goal:Number(ch.Goal),done:done,start:ch.StartDate,end:ch.EndDate,bonus:Number(ch.BonusPoints)}; }
  return {ok:true, points:total, deposits:deposits, challenge:challenge};
}

function getLeaderboard(scope,filter){
  var sh=getSheet_(SHEETS.STUDENTS); if(sh.getLastRow()<2) return [];
  var headers=sh.getRange(1,1,1,8).getValues()[0], data=sh.getRange(2,1,sh.getLastRow()-1,8).getValues(), i,s,rows;
  if(scope==='student'){ var arr=[]; for(i=0;i<data.length;i++){ s=toObj_(headers,data[i]);
      if(!filter || (s.Class===filter || s.Group===filter)){ arr.push({name:s.Name,id:s.StudentID,class:s.Class,group:s.Group,points:Number(s.Points||0)}); } }
    arr.sort(function(a,b){return b.points-a.points;}); return arr.slice(0,20); }
  if(scope==='class'){ var byClass={}; for(i=0;i<data.length;i++){ s=toObj_(headers,data[i]); if(filter&&s.Group!==filter) continue;
      byClass[s.Class]=(byClass[s.Class]||0)+Number(s.Points||0); } rows=[]; for(var k in byClass){ if(byClass.hasOwnProperty(k)) rows.push({class:k,points:byClass[k]}); }
    rows.sort(function(a,b){return b.points-a.points;}); return rows.slice(0,10); }
  if(scope==='group'){ var byGroup={}; for(i=0;i<data.length;i++){ s=toObj_(headers,data[i]); byGroup[s.Group]=(byGroup[s.Group]||0)+Number(s.Points||0); }
    rows=[]; for(var g in byGroup){ if(byGroup.hasOwnProperty(g)) rows.push({group:g,points:byGroup[g]}); }
    rows.sort(function(a,b){return b.points-a.points;}); return rows.slice(0,10); }
  return [];
}

/* ========== Recompensas ========== */
function listRewards(){
  var sh=getSheet_(SHEETS.REWARDS); if(sh.getLastRow()<2) return [];
  var headers=sh.getRange(1,1,1,6).getValues()[0], values=sh.getRange(2,1,sh.getLastRow()-1,6).getValues(), out=[], i;
  for(i=0;i<values.length;i++){ var r=toObj_(headers,values[i]); if(String(r.Active).toUpperCase()==='TRUE') out.push(r); }
  return out;
}
function redeemReward(studentId,rewardId,approvedBy){
  var rewards=listRewards(), reward=null, i; for(i=0;i<rewards.length;i++){ if(rewards[i].RewardID===rewardId){ reward=rewards[i]; break; } }
  if(!reward) return {ok:false,error:'Recompensa no disponible'};
  var st=getStudent(studentId); if(!st) return {ok:false,error:'Estudiante no existe'};
  var cost=Number(reward.CostPoints||0), points=Number(st.Points||0); if(points<cost) return {ok:false,error:'Te faltan '+(cost-points)+' puntos.'};
  var shS=getSheet_(SHEETS.STUDENTS), idxS=findRowIndexByValue_(shS,1,studentId); shS.getRange(idxS,6).setValue(points-cost);
  var shR=getSheet_(SHEETS.REDEMPTIONS); if(shR.getLastRow()===0){ shR.appendRow(['Timestamp','StudentID','RewardID','PointsSpent','ApprovedBy','Notes']); }
  shR.appendRow([nowISO_(),studentId,rewardId,cost,approvedBy||'N/A','']); return {ok:true,newBalance:points-cost};
}

/* ========== Educación ========== */
function getContent(type){
  var sh=getSheet_(SHEETS.CONTENT); if(sh.getLastRow()<2) return [];
  var headers=sh.getRange(1,1,1,5).getValues()[0], rows=sh.getRange(2,1,sh.getLastRow()-1,5).getValues(), out=[], i;
  for(i=0;i<rows.length;i++){ var r=toObj_(headers,rows[i]); if(!type||type==='all'||r.Category===type) out.push(r); }
  return out.slice(0,50);
}

/* ========== Reportes ========== */
function getDashboardStats(adminKey){
  var auth = validateAdminAccess_(adminKey);
  if(!auth.ok) return auth;
  var sh=getSheet_(SHEETS.LOG), total=sh.getLastRow()>1?sh.getLastRow()-1:0, byMat={};
  if(total>0){ var headers=sh.getRange(1,1,1,11).getValues()[0], data=sh.getRange(2,1,sh.getLastRow()-1,11).getValues(), i;
    for(i=0;i<data.length;i++){ var r=toObj_(headers,data[i]); var m=r.Material; byMat[m]=(byMat[m]||0)+Number(r.Count||0); } }
  return {ok:true,totalDeposits:total,byMaterial:byMat,topStudents:getLeaderboard('student').slice(0,5),topClasses:getLeaderboard('class').slice(0,5)};
}

function exportCSV(adminKey){
  var auth = validateAdminAccess_(adminKey);
  if(!auth.ok) return auth;
  var sh=getSheet_(SHEETS.LOG); if(sh.getLastRow()<1) return {ok:false,error:'Sin datos'};
  var values=sh.getDataRange().getDisplayValues(), lines=[], i,j;
  for(i=0;i<values.length;i++){ var row=values[i]; for(j=0;j<row.length;j++){ var x=String(row[j]);
      if(x.indexOf('"')!==-1) x=x.replace(/"/g,'""'); if(x.indexOf(',')!==-1) x='"'+x+'"'; row[j]=x; } lines.push(row.join(',')); }
  var csv=lines.join('\n'); var blob=Utilities.newBlob(csv,'text/csv','RecyclingLog.csv'); var file=DriveApp.createFile(blob);
  return {ok:true,fileId:file.getId(),url:file.getUrl()};
}

/* ========== Triggers ========== */
function sendDailyReminders(){
  var days=7, sh=getSheet_(SHEETS.STUDENTS); if(sh.getLastRow()<2) return;
  var headers=sh.getRange(1,1,1,8).getValues()[0], data=sh.getRange(2,1,sh.getLastRow()-1,8).getValues(), today=new Date(), i;
  for(i=0;i<data.length;i++){ var s=toObj_(headers,data[i]), email=String(s.Email||'').trim(); if(!email) continue;
    var last=s.LastActiveAt?new Date(s.LastActiveAt):null, inactive=!last||((today-last)/(1000*3600*24)>=days);
    if(inactive){ GmailApp.sendEmail(email,'Suma puntos reciclando','Hola '+s.Name+'\n\n¿Ya reciclaste plástico esta semana? Cada depósito suma puntos y te acerca a premios ecológicos.\n\n¡Vamos!'); } }
}
function rollWeeklyChallenge(){
  var tz=Session.getScriptTimeZone(), today=new Date(), day=today.getDay(), diffToMonday=(day===0?-6:1-day);
  var monday=new Date(today); monday.setDate(today.getDate()+diffToMonday); var sunday=new Date(monday); sunday.setDate(monday.getDate()+6);
  function fmt(d){ return Utilities.formatDate(d,tz,'yyyy-MM-dd'); }
  var sh=getSheet_(SHEETS.CHALLENGES); if(sh.getLastRow()===0){ sh.appendRow(['ChallengeID','StartDate','EndDate','Type','Goal','BonusPoints','Status','Description']); }
  var lastRow=sh.getLastRow(); if(lastRow>1){ var rng=sh.getRange(2,7,lastRow-1,1), vals=rng.getValues(), i; for(i=0;i<vals.length;i++){ if(String(vals[i][0]).toUpperCase()==='ACTIVE') vals[i][0]='CLOSED'; } rng.setValues(vals); }
  var id='WEEK-'+fmt(monday), goal=Number(getSetting_('WEEKLY_GOAL_DEPOSITS',5)), bonus=Number(getSetting_('WEEKLY_BONUS_POINTS',20));
  sh.appendRow([id,fmt(monday),fmt(sunday),'deposits',goal,bonus,'ACTIVE','Logra '+goal+' depósitos esta semana']);
}

/* ========== QR opcional ========== */
function insertContainerQRCodes(){
  var base='https://quickchart.io/qr?size=250&text=', sh=getSheet_(SHEETS.CONTAINERS), last=sh.getLastRow(); if(last<2) return 0;
  var r; for(r=2;r<=last;r++){ var payload=sh.getRange(r,5).getValue(); if(!payload) continue;
    var url=base+encodeURIComponent(payload), img=UrlFetchApp.fetch(url).getBlob().setName('qr.png'); sh.insertImage(img,6,r); }
  return last-1;
}
