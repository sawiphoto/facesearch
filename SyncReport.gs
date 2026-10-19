/** Small audit payload shared by manual and scheduled synchronization logs. */
function newSyncReport_() {
  var labels = { personIndex: 'ดัชนีบุคลากร', photoIndex: 'ดัชนีภาพ', personnel: 'รายชื่อและกลุ่มสาระ',
    personPhotos: 'ไฟล์รายการภาพรายบุคคล', classification: 'หมวดภาพตามจำนวนใบหน้า', avatars: 'Avatar',
    directory: 'สารบัญหน้าเว็บ', deletionQueue: 'รายการแจ้งลบ', triggers: 'รอบ sync อัตโนมัติ' };
  var stages = {};
  Object.keys(labels).forEach(function(key) { stages[key] = { label: labels[key], status: 'NOT_RUN', detail: 'ยังไม่ได้ทำงาน' }; });
  return { id: Utilities.getUuid(), overall: 'RUNNING', startedAt: new Date().toISOString(), stages: stages, peopleCount: 0, photoCount: 0 };
}
function markSyncStage_(report, key, status, detail, counts) {
  report.stages[key] = { label: report.stages[key].label, status: status, detail: detail, counts: counts || {} };
  console.log('SYNC_STAGE ' + report.id + ' ' + key + ' ' + status + ' ' + detail);
}
function finishSyncReport_(report, fatal) {
  var incomplete = Object.keys(report.stages).some(function(key) {
    return ['PARTIAL','FAILED','NOT_RUN'].indexOf(report.stages[key].status) !== -1;
  });
  report.overall = fatal ? 'FAILED' : incomplete ? 'PARTIAL' : 'SUCCESS';
  report.finishedAt = new Date().toISOString();
  report.durationMs = new Date(report.finishedAt).getTime() - new Date(report.startedAt).getTime();
  return report;
}
function formatNum_(n) {
  if (n === null || n === undefined) return '0';
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function syncReportDetail_(report) {
  var overallStatus = report.overall === 'SUCCESS' ? 'สำเร็จ' : report.overall === 'PARTIAL' ? 'สำเร็จบางส่วน' : 'ไม่สำเร็จ';
  var lines = [];
  lines.push('ซิงค์' + overallStatus + ': บุคลากร ' + formatNum_(report.peopleCount) + ' คน | รูปภาพ ' + formatNum_(report.photoCount) + ' รูป');

  var stages = report.stages || {};

  if (stages.personIndex) {
    if (stages.personIndex.status === 'FAILED') {
      lines.push('• ดัชนีบุคลากร: ไม่สำเร็จ (' + (stages.personIndex.detail || 'เกิดข้อผิดพลาด') + ')');
    } else {
      var pNames = (stages.personIndex.counts && stages.personIndex.counts.names) || 0;
      lines.push('• ดัชนีบุคลากร: ' + formatNum_(pNames) + ' รายชื่อ');
    }
  }

  if (stages.photoIndex) {
    if (stages.photoIndex.status === 'FAILED') {
      lines.push('• ดัชนีภาพ: ไม่สำเร็จ (' + (stages.photoIndex.detail || 'เกิดข้อผิดพลาด') + ')');
    } else {
      var pPhotos = (stages.photoIndex.counts && stages.photoIndex.counts.sourcePhotos) || 0;
      lines.push('• ดัชนีภาพ: ' + formatNum_(pPhotos) + ' รูป');
    }
  }

  if (stages.personnel) {
    if (stages.personnel.status === 'FAILED') {
      lines.push('• กลุ่มสาระ: ไม่สำเร็จ (' + (stages.personnel.detail || 'เกิดข้อผิดพลาด') + ')');
    } else {
      var c = stages.personnel.counts || {};
      lines.push('• กลุ่มสาระ: ' + formatNum_(c.categories || 0) + ' กลุ่ม (' + formatNum_(c.people || report.peopleCount) + ' คน)');
    }
  }

  if (stages.personPhotos) {
    if (stages.personPhotos.status === 'FAILED') {
      lines.push('• ไฟล์ภาพรายบุคคล: ไม่สำเร็จ (' + (stages.personPhotos.detail || 'เกิดข้อผิดพลาด') + ')');
    } else {
      var pp = stages.personPhotos.counts || {};
      lines.push('• ไฟล์ภาพรายบุคคล: เดิม ' + formatNum_(pp.unchanged || 0) + ' / ใหม่ ' + formatNum_(pp.updated || 0));
    }
  }

  if (stages.classification) {
    if (stages.classification.status === 'FAILED') {
      lines.push('• จัดหมวดใบหน้า: ไม่สำเร็จ (' + (stages.classification.detail || 'เกิดข้อผิดพลาด') + ')');
    } else {
      var cl = stages.classification.counts || {};
      var st = cl.sourceTotals || {};
      var classDetail = '• จัดหมวดใบหน้า: ' + formatNum_(cl.referencedPhotos || report.photoCount) + ' รูป';
      if (st.single !== undefined) {
        classDetail += ' (เดี่ยว ' + formatNum_(st.single) + ' | กลุ่ม ' + formatNum_(st.small_group) + ' | หมู่ ' + formatNum_(st.large_group) + ')';
      }
      lines.push(classDetail);
    }
  }

  if (stages.avatars) {
    var av = stages.avatars.counts || {};
    var readyCount = av.ready !== undefined ? av.ready : 0;
    var totalCount = av.total !== undefined ? av.total : (av.ready || 0);
    if (stages.avatars.status === 'SUCCESS') {
      lines.push('• Avatar: สำเร็จ (' + formatNum_(readyCount) + '/' + formatNum_(totalCount) + ' คน)');
    } else if (stages.avatars.status === 'PARTIAL') {
      lines.push('• Avatar: สำเร็จบางส่วน (พร้อม ' + formatNum_(readyCount) + '/' + formatNum_(totalCount) + ' คน)');
    } else if (stages.avatars.status === 'FAILED') {
      lines.push('• Avatar: ไม่สำเร็จ (' + (stages.avatars.detail || 'เกิดข้อผิดพลาด') + ')');
    } else {
      lines.push('• Avatar: ยังไม่ได้ทำงาน');
    }
  }

  if (stages.directory) {
    if (stages.directory.status === 'FAILED') {
      lines.push('• สารบัญหน้าเว็บ: ไม่สำเร็จ (' + (stages.directory.detail || 'เกิดข้อผิดพลาด') + ')');
    }
  }

  if (stages.deletionQueue) {
    if (stages.deletionQueue.status === 'FAILED') {
      lines.push('• คิวแจ้งลบ: ไม่สำเร็จ (' + (stages.deletionQueue.detail || 'เกิดข้อผิดพลาด') + ')');
    } else if (stages.deletionQueue.status !== 'SKIPPED') {
      var dq = stages.deletionQueue.counts || {};
      lines.push('• คิวแจ้งลบ: ' + formatNum_(dq.people || 0) + ' รายการ');
    }
  }

  if (stages.triggers) {
    if (stages.triggers.status === 'FAILED') {
      lines.push('• รอบ Auto Sync: ไม่สำเร็จ (' + (stages.triggers.detail || 'เกิดข้อผิดพลาด') + ')');
    } else {
      var tr = stages.triggers.counts || {};
      lines.push('• รอบ Auto Sync: ' + formatNum_(tr.count || 0) + ' รอบ (ทุก 6 ชม.)');
    }
  }

  return lines.join('\n');
}

/**
 * สร้างออบเจกต์บันทึกประวัติการซิงค์แบบกระชับ 10 บรรทัด (8 คีย์หลัก) สำหรับบันทึกใน logs.json (v10.4)
 */
function buildCompactSyncLogEntry_(timestamp, activityType, detail, photoCount, syncReport) {
  var rep = syncReport || {};
  var stages = rep.stages || {};
  var rawDetail = String(detail || '');

  // 1. รอบเวลาและระยะเวลาประมวลผล (cycle)
  var cycleMatch = rawDetail.match(/รอบเวลา\s*([0-9]{1,2}:[0-9]{2}\s*น\.)/);
  var cycleLabel = cycleMatch ? ('รอบเวลา ' + cycleMatch[1]) : (String(activityType || '').indexOf('AUTO_SYNC') === 0 ? 'ซิงค์อัตโนมัติ' : 'ซิงค์ด้วยตนเอง');
  var durationSec = (typeof rep.durationMs === 'number' && rep.durationMs >= 0) ? (rep.durationMs / 1000).toFixed(1) : null;
  var cycleStr = durationSec !== null ? (cycleLabel + ' (ใช้เวลา ' + durationSec + ' วินาที)') : cycleLabel;

  // 2. สรุปภาพรวม (summary)
  var overall = rep.overall || (String(activityType || '').indexOf('FAILED') !== -1 ? 'FAILED' : (String(activityType || '').indexOf('PARTIAL') !== -1 ? 'PARTIAL' : 'SUCCESS'));
  var overallText = overall === 'SUCCESS' ? 'ซิงค์สำเร็จ' : (overall === 'PARTIAL' ? 'ซิงค์สำเร็จบางส่วน' : 'ซิงค์ไม่สำเร็จ');
  var peopleCount = rep.peopleCount !== undefined ? rep.peopleCount : ((stages.personnel && stages.personnel.counts && stages.personnel.counts.people) || 0);
  var catCount = (stages.personnel && stages.personnel.counts && stages.personnel.counts.categories) || 0;
  var pCount = rep.photoCount !== undefined ? rep.photoCount : (photoCount || 0);
  var failedStages = [];
  Object.keys(stages).forEach(function(k) {
    if (stages[k] && stages[k].status === 'FAILED') {
      failedStages.push((stages[k].label || k) + ': ' + (stages[k].detail || 'ล้มเหลว'));
    }
  });
  var summaryStr = overallText + ': บุคลากร ' + formatNum_(peopleCount) + ' คน' + (catCount ? (' (' + formatNum_(catCount) + ' กลุ่ม)') : '') + ' | รูปภาพ ' + formatNum_(pCount) + ' รูป';
  if (failedStages.length > 0) {
    summaryStr += ' [' + failedStages.join('; ') + ']';
  } else if (overall === 'FAILED' && rawDetail) {
    var oneLineErr = rawDetail.replace(/\r?\n/g, ' ').trim();
    if (oneLineErr) summaryStr += ' [' + oneLineErr + ']';
  }

  // 3. ดัชนีต้นทาง (index)
  var pNames = (stages.personIndex && stages.personIndex.counts && stages.personIndex.counts.names) || 0;
  var srcPhotos = (stages.photoIndex && stages.photoIndex.counts && stages.photoIndex.counts.sourcePhotos) || 0;
  var indexStr = 'ดัชนีบุคลากร ' + formatNum_(pNames) + ' รายชื่อ | ดัชนีภาพ ' + formatNum_(srcPhotos) + ' รูป';

  // 4. การอัปเดตไฟล์รายบุคคล (updates)
  var ppCounts = (stages.personPhotos && stages.personPhotos.counts) || {};
  var updatesStr = 'ไฟล์ภาพรายบุคคล: อัปเดตใหม่ ' + formatNum_(ppCounts.updated || 0) + ' คน / ข้อมูลเดิม ' + formatNum_(ppCounts.unchanged || 0) + ' คน';

  // 5. หมวดหมู่ใบหน้า (categories)
  var clCounts = (stages.classification && stages.classification.counts) || {};
  var st = clCounts.sourceTotals || {};
  var categoriesStr = 'เดี่ยว ' + formatNum_(st.single || 0) + ' | กลุ่ม ' + formatNum_(st.small_group || 0) + ' | หมู่ ' + formatNum_(st.large_group || 0) + ' รูป';
  if (clCounts.unknown && clCounts.unknown > 0) {
    categoriesStr += ' (ยังไม่จัดหมวด ' + formatNum_(clCounts.unknown) + ' รูป)';
  }

  // 6. สถานะระบบย่อย (system)
  var avStage = stages.avatars || {};
  var avCounts = avStage.counts || {};
  var avReady = avCounts.ready !== undefined ? avCounts.ready : 0;
  var avTotal = avCounts.total !== undefined ? avCounts.total : avReady;
  var avPart = avStage.status === 'FAILED' ? 'Avatar ไม่สำเร็จ' : ('Avatar ' + formatNum_(avReady) + '/' + formatNum_(avTotal) + ' คน');

  var dqStage = stages.deletionQueue || {};
  var dqCounts = dqStage.counts || {};
  var dqPart = dqStage.status === 'FAILED' ? 'คิวแจ้งลบ ไม่สำเร็จ' : ('คิวแจ้งลบ ' + formatNum_(dqCounts.people || 0) + ' รายการ');

  var trStage = stages.triggers || {};
  var trCounts = trStage.counts || {};
  var trPart = trStage.status === 'FAILED' ? 'Auto Sync ไม่สำเร็จ' : (trStage.status === 'PARTIAL' && !trCounts.count ? ('Auto Sync บางส่วน') : ('Auto Sync ' + formatNum_(trCounts.count || 0) + ' รอบ'));

  var systemStr = avPart + ' | ' + dqPart + ' | ' + trPart;

  return {
    timestamp: timestamp,
    activityType: activityType,
    cycle: cycleStr,
    summary: summaryStr,
    index: indexStr,
    updates: updatesStr,
    categories: categoriesStr,
    system: systemStr
  };
}

/**
 * ทำความสะอาดและย่อรายการซิงค์เดิมใน logs.json ที่ยังติด syncReport ก้อนใหญ่ หรือซ้ำซ้อนในรอบเดียวกัน (v10.4)
 */
function compactExistingSyncLogs_(logs) {
  if (!Array.isArray(logs)) return [];
  var seenReportIds = Object.create(null);
  var cleaned = [];

  for (var i = 0; i < logs.length; i++) {
    var entry = logs[i];
    if (!entry || typeof entry !== 'object') continue;
    var act = String(entry.activityType || '');
    var isSyncEntry = act.indexOf('AUTO_SYNC') === 0 || act.indexOf('SYSTEM_SYNC') === 0;

    if (isSyncEntry && entry.syncReport && entry.syncReport.id) {
      if (seenReportIds[entry.syncReport.id]) {
        // ตัดรายการ SYSTEM_SYNC ที่ถูกบันทึกซ้ำจากรอบ Auto Sync เดียวกันออก
        continue;
      }
      seenReportIds[entry.syncReport.id] = true;
    }

    if (isSyncEntry && entry.syncReport) {
      cleaned.push(buildCompactSyncLogEntry_(
        entry.timestamp || '',
        act,
        entry.detail || '',
        entry.photoCount || 0,
        entry.syncReport
      ));
    } else {
      cleaned.push(entry);
    }
  }
  return cleaned;
}

