const test = require('node:test');
const assert = require('node:assert');

// Logic extracted from Index.html
function formatThaiMonthYear(dateStr) {
  if (!dateStr || dateStr === "" || dateStr === "0000-00" || dateStr === "0000-00-00") return "ไม่ระบุวันที่/กิจกรรมทั่วไป";
  var parts = dateStr.split("-");
  if (parts.length < 2) return "ไม่ระบุวันที่/กิจกรรมทั่วไป";
  
  var year = parseInt(parts[0], 10);
  var month = parseInt(parts[1], 10);
  var thaiYear = isNaN(year) || year === 0 ? "" : (year + 543);
  
  if (isNaN(month) || month < 1 || month > 12) {
    return thaiYear ? ("กิจกรรมประจำปี " + thaiYear) : "ไม่ระบุวันที่/กิจกรรมทั่วไป";
  }
  
  var thaiMonths = [
    "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
    "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"
  ];
  
  var thaiMonth = thaiMonths[month - 1] || "ไม่ระบุเดือน";
  return thaiMonth + (thaiYear ? " " + thaiYear : "");
}

function formatThaiDate(dateStr) {
  if (!dateStr || dateStr === "0000-00-00") return "ไม่ระบุวันที่";
  const thaiMonthsShort = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  const parts = dateStr.split('-');
  if (parts.length < 3) return dateStr;
  const d = parseInt(parts[2], 10);
  const m = parseInt(parts[1], 10);
  const y = parseInt(parts[0], 10);
  if (isNaN(d) || isNaN(m) || m < 1 || m > 12) return dateStr;
  const thaiYear = isNaN(y) ? '' : (y + 543);
  return d + " " + thaiMonthsShort[m - 1] + (thaiYear ? " " + thaiYear : "");
}

function parseThaiMonthFromText(text) {
  if (!text) return null;
  var s = text.toLowerCase();
  var monthMap = [
    { num: '01', regex: /(?:^|[\s\d\-_./])(?:ม\.?ค\.?|มกรา|มกราคม)(?:$|[\s\d\-_./])/i },
    { num: '02', regex: /(?:^|[\s\d\-_./])(?:ก\.?พ\.?|กุมภา|กุมภาพันธ์)(?:$|[\s\d\-_./])/i },
    { num: '03', regex: /(?:^|[\s\d\-_./])(?:มี\.?ค\.?|มีนา|มีนาคม)(?:$|[\s\d\-_./])/i },
    { num: '04', regex: /(?:^|[\s\d\-_./])(?:เม\.?ย\.?|เมษา|เมษายน)(?:$|[\s\d\-_./])/i },
    { num: '05', regex: /(?:^|[\s\d\-_./])(?:พ\.?ค\.?|พฤษภา|พฤษภาคม)(?:$|[\s\d\-_./])/i },
    { num: '06', regex: /(?:^|[\s\d\-_./])(?:มิ\.?ย\.?|มิถุนา|มิถุนายน)(?:$|[\s\d\-_./])/i },
    { num: '07', regex: /(?:^|[\s\d\-_./])(?:ก\.?ค\.?|กรกฎา|กรกฎาคม)(?:$|[\s\d\-_./])/i },
    { num: '08', regex: /(?:^|[\s\d\-_./])(?:ส\.?ค\.?|สิงหา|สิงหาคม)(?:$|[\s\d\-_./])/i },
    { num: '09', regex: /(?:^|[\s\d\-_./])(?:ก\.?ย\.?|กันยา|กันยายน)(?:$|[\s\d\-_./])/i },
    { num: '10', regex: /(?:^|[\s\d\-_./])(?:ต\.?ค\.?|ตุลา|ตุลาคม)(?:$|[\s\d\-_./])/i },
    { num: '11', regex: /(?:^|[\s\d\-_./])(?:พ\.?ย\.?|พฤศจิกา|พฤศจิกายน)(?:$|[\s\d\-_./])/i },
    { num: '12', regex: /(?:^|[\s\d\-_./])(?:ธ\.?ค\.?|ธันวา|ธันวาคม)(?:$|[\s\d\-_./])/i }
  ];

  var matches = [];
  monthMap.forEach(function(m) {
    var match = s.match(m.regex);
    if (match) {
      matches.push({ num: m.num, index: match.index });
    }
  });

  if (matches.length > 0) {
    matches.sort(function(a, b) { return a.index - b.index; });
    return matches[0].num;
  }

  var m = text.match(/(?:19|20|25)\d{2}[-_/](\d{1,2})[-_/]\d{1,2}/);
  if (m) {
    var mm = parseInt(m[1], 10);
    if (mm >= 1 && mm <= 12) return (mm < 10 ? "0" : "") + mm;
  }
  return null;
}

function parseThaiYearFromText(text) {
  if (!text) return null;
  var m = text.match(/(?:ปี\s*|พ\.?ศ\.?\s*)?(25[3-7]\d)/);
  if (m) return m[1];
  var mCE = text.match(/(?:ปี\s*|ค\.?ศ\.?\s*)?(20[1-3]\d)/);
  if (mCE) return (parseInt(mCE[1], 10) + 543).toString();
  var mShort = text.match(/(?:ปี\s*|'|\/|-|\.|\s)([5-7]\d)(?:\s|$|[-_\/.])/);
  if (mShort) {
    var num = parseInt(mShort[1], 10);
    if (num >= 50 && num <= 79) return (2500 + num).toString();
  }
  return null;
}

function buildPhotoHierarchyIndex(photos) {
  var hierarchy = {
    years: {}, // thaiYear -> { thaiYear, yearKey, count, months: {} }
    totalCount: (photos || []).length
  };

  // รายชื่อโฟลเดอร์ย่อยของกลุ่มสาระการประเมิน PA ครู ที่ต้องยุบรวมเข้าโฟลเดอร์กิจกรรมใหญ่
  var paSubfolders = ['การงาน', 'คณิต', 'คณิต2', 'สุขศึกษา', 'แนะแนว', 'ห้องสมุด', 'ศิลปะ', 'ต่างประเทศ', 'วิทย์', 'สังคม'];

  // 1. แยกกลุ่มรูปภาพที่มีชื่อกิจกรรม (โฟลเดอร์เดียวกัน) และรูปที่ไม่มีชื่อกิจกรรม
  var eventGroups = {};
  var standalonePhotos = [];
  (photos || []).forEach(function(p) {
    if (p.event && p.event.trim() !== "") {
      var rawEvent = p.event.trim();
      var eName = rawEvent;
      // หากเป็นโฟลเดอร์ย่อยของกลุ่มสาระประเมิน PA ให้ยุบรวมเข้ากิจกรรมใหญ่ "กย 24 ประเมิน PA ครู"
      if (paSubfolders.indexOf(rawEvent) !== -1) {
        eName = 'กย 24 ประเมิน PA ครู';
        p._subEventName = rawEvent;
      }
      if (!eventGroups[eName]) eventGroups[eName] = [];
      eventGroups[eName].push(p);
    } else {
      standalonePhotos.push(p);
    }
  });

  // 2. วิเคราะห์ปีและเดือนที่แท้จริงของแต่ละกิจกรรม (Canonical Date Resolution)
  // ป้องกันปัญหากิจกรรมเดียวกันแตกตัวไปอยู่ข้ามปีเพราะวันที่อัปโหลด Drive หรือ EXIF หลุด
  Object.keys(eventGroups).forEach(function(eName) {
    var photosInEvent = eventGroups[eName];
    var nameMonth = parseThaiMonthFromText(eName);
    var nameYear = parseThaiYearFromText(eName);

    if (nameYear) {
      // โฟลเดอร์ระบุปี พ.ศ. ชัดเจนในชื่อ (เช่น "อบรม google app ปี 2563" หรือ "15-16 พ.ย.69 ...")
      // ล็อกปีตามชื่อกิจกรรมเสมอ ห้ามให้วันที่อัปโหลดใน Google Drive มาเขียนทับเด็ดขาด
      var canonicalThaiYear = nameYear;
      var canonicalYearKey = (parseInt(nameYear, 10) - 543).toString();
      var canonicalMonthKey = "";

      if (nameMonth) {
        canonicalMonthKey = canonicalYearKey + "-" + nameMonth;
      } else {
        // ไม่ได้ระบุเดือนในชื่อ: ตรวจสอบว่ามีรูปภาพใดมีเดือนในปฏิทินของปีนี้จริงหรือไม่
        var matchingPhotoInYear = photosInEvent.find(function(p) {
          return p.date && p.date.indexOf(canonicalYearKey + "-") === 0;
        });
        if (matchingPhotoInYear && matchingPhotoInYear.date.split('-').length >= 2) {
          canonicalMonthKey = matchingPhotoInYear.date.split('-')[0] + "-" + matchingPhotoInYear.date.split('-')[1];
        } else {
          // หากไม่มีวันที่ตรงกับปีจริง (เช่น วันที่ของรูปทั้งหมดเป็นวันอัปโหลด Drive) ให้จัดเข้าหมวดกิจกรรมประจำปี
          canonicalMonthKey = canonicalYearKey + "-00";
        }
      }

      var canonicalThaiMonthName = formatThaiMonthYear(canonicalMonthKey);
      var eventKey = eName + "_" + canonicalMonthKey;

      photosInEvent.forEach(function(p) {
        p._thaiYear = canonicalThaiYear;
        p._yearKey = canonicalYearKey;
        p._monthKey = canonicalMonthKey;
        p._thaiMonthName = canonicalThaiMonthName;
        p._eventKey = eventKey;
        p._eventName = eName;
      });
    } else if (nameMonth) {
      // โฟลเดอร์ระบุเดือนชัดเจน แต่ไม่ระบุปี (เช่น "กค 2 ต้อนรับครูพละใหม่") -> รวมเป็น 1 กิจกรรมเดียวเสมอ
      var matchingPhoto = photosInEvent.find(function(p) {
        if (!p.date) return false;
        var parts = p.date.split('-');
        return parts.length >= 2 && parts[1] === nameMonth;
      });

      var canonicalThaiYear = null;
      var canonicalYearKey = "0000";
      if (matchingPhoto) {
        var yCE = parseInt(matchingPhoto.date.split('-')[0], 10);
        if (!isNaN(yCE)) {
          canonicalYearKey = matchingPhoto.date.split('-')[0];
          canonicalThaiYear = (yCE + 543).toString();
        }
      } else {
        var yearCounts = {};
        photosInEvent.forEach(function(p) {
          if (p.date) {
            var y = parseInt(p.date.split('-')[0], 10);
            if (!isNaN(y)) {
              var ty = (y + 543).toString();
              yearCounts[ty] = (yearCounts[ty] || 0) + 1;
            }
          }
        });
        var yKeys = Object.keys(yearCounts).sort(function(a, b) { return yearCounts[b] - yearCounts[a]; });
        if (yKeys.length > 0) {
          canonicalThaiYear = yKeys[0];
          canonicalYearKey = (parseInt(canonicalThaiYear, 10) - 543).toString();
        }
      }

      var canonicalMonthKey = canonicalYearKey + "-" + nameMonth;
      var canonicalThaiMonthName = formatThaiMonthYear(canonicalMonthKey);
      var eventKey = eName + "_" + canonicalMonthKey;

      photosInEvent.forEach(function(p) {
        p._thaiYear = canonicalThaiYear;
        p._yearKey = canonicalYearKey;
        p._monthKey = canonicalMonthKey;
        p._thaiMonthName = canonicalThaiMonthName;
        p._eventKey = eventKey;
        p._eventName = eName;
      });
    } else {
      // กิจกรรมไม่ได้ระบุเดือนและปีในชื่อ (เช่น กิจกรรมทั่วไป "ปัจฉิมนิเทศ") -> จัดกลุ่มตามปีจริงของรูป
      var byYear = {};
      photosInEvent.forEach(function(p) {
        var yStr = "0000";
        var tyStr = "ไม่ระบุปี";
        if (p.date && p.date.split('-').length >= 1) {
          var y = parseInt(p.date.split('-')[0], 10);
          if (!isNaN(y)) {
            yStr = p.date.split('-')[0];
            tyStr = (y + 543).toString();
          }
        }
        if (!byYear[tyStr]) byYear[tyStr] = { yearKey: yStr, photos: [] };
        byYear[tyStr].photos.push(p);
      });

      Object.keys(byYear).forEach(function(tyStr) {
        var subGroup = byYear[tyStr];
        var ymCounts = {};
        subGroup.photos.forEach(function(p) {
          if (p.date && p.date.split('-').length >= 2) {
            var ym = p.date.split('-')[0] + '-' + p.date.split('-')[1];
            ymCounts[ym] = (ymCounts[ym] || 0) + 1;
          }
        });
        var ymArr = Object.keys(ymCounts).sort(function(a, b) { return ymCounts[b] - ymCounts[a]; });
        var canonicalMonthKey = ymArr.length > 0 ? ymArr[0] : (subGroup.yearKey + "-00");
        var canonicalThaiMonthName = formatThaiMonthYear(canonicalMonthKey);
        var eventKey = eName + "_" + canonicalMonthKey;

        subGroup.photos.forEach(function(p) {
          p._thaiYear = tyStr;
          p._yearKey = subGroup.yearKey;
          p._monthKey = canonicalMonthKey;
          p._thaiMonthName = canonicalThaiMonthName;
          p._eventKey = eventKey;
          p._eventName = eName;
        });
      });
    }
  });

  // 3. ประมวลผลรูปถ่ายทั่วไปที่ไม่ได้ผูกกับโฟลเดอร์กิจกรรม
  standalonePhotos.forEach(function(p) {
    var thaiYear = "ไม่ระบุปี";
    var yearKey = "0000";
    var monthKey = "0000-00";
    var thaiMonthName = "ไม่ระบุวันที่/กิจกรรมทั่วไป";
    var eventKey = "UNSPECIFIED";
    var eventName = "ภาพทั่วไป / ไม่ระบุวันที่";

    if (p.date && p.date.trim() !== "" && p.date !== "0000-00-00") {
      var parts = p.date.split('-');
      if (parts.length >= 1) {
        var y = parseInt(parts[0], 10);
        if (!isNaN(y)) {
          thaiYear = (y + 543).toString();
          yearKey = parts[0];
        }
      }
      if (parts.length >= 2) {
        monthKey = parts[0] + '-' + parts[1];
        thaiMonthName = formatThaiMonthYear(p.date);
      }
      eventKey = p.date;
      eventName = formatThaiDate(p.date);
    }

    p._thaiYear = thaiYear;
    p._yearKey = yearKey;
    p._monthKey = monthKey;
    p._thaiMonthName = thaiMonthName;
    p._eventKey = eventKey;
    p._eventName = eventName;
  });

  // 4. สร้างโครงสร้างต้นไม้ดัชนี (Tree Hierarchy)
  (photos || []).forEach(function(p) {
    var thaiYear = p._thaiYear;
    var yearKey = p._yearKey;
    var monthKey = p._monthKey;
    var thaiMonthName = p._thaiMonthName;
    var eventKey = p._eventKey;
    var eventName = p._eventName;

    // Ensure Year
    if (!hierarchy.years[thaiYear]) {
      hierarchy.years[thaiYear] = {
        thaiYear: thaiYear,
        yearKey: yearKey,
        count: 0,
        months: {}
      };
    }
    hierarchy.years[thaiYear].count++;

    // Ensure Month
    var yearObj = hierarchy.years[thaiYear];
    if (!yearObj.months[monthKey]) {
      yearObj.months[monthKey] = {
        monthKey: monthKey,
        thaiMonthName: thaiMonthName,
        count: 0,
        events: {}
      };
    }
    yearObj.months[monthKey].count++;

    // Ensure Event
    var monthObj = yearObj.months[monthKey];
    if (!monthObj.events[eventKey]) {
      monthObj.events[eventKey] = {
        eventKey: eventKey,
        eventName: eventName,
        count: 0
      };
    }
    monthObj.events[eventKey].count++;
  });

  return hierarchy;
}

function filterAndComputeBadges(photos, filterYear, filterMonth, activeGroupMode) {
  // 1. dateFiltered
  const dateFiltered = photos.filter(function(photo) {
    if (filterYear && filterYear !== 'ALL') {
      let pYear = photo._thaiYear;
      if (!pYear && photo.date) {
        const y = parseInt(photo.date.split('-')[0], 10);
        if (!isNaN(y)) pYear = (y + 543).toString();
      }
      if (pYear !== filterYear) return false;
    }

    if (filterMonth && filterMonth !== '') {
      if (filterMonth.indexOf("MONTH:") === 0) {
        const targetMonthKey = filterMonth.substring(6);
        let pMonth = photo._monthKey;
        if (!pMonth && photo.date) {
          const parts = photo.date.split('-');
          if (parts.length >= 2) pMonth = parts[0] + '-' + parts[1];
        }
        if (pMonth !== targetMonthKey) return false;
      } else if (filterMonth.indexOf("EVENT:") === 0) {
        const targetEventKey = filterMonth.substring(6);
        if (photo._eventKey !== targetEventKey) return false;
      }
    }
    return true;
  });

  // 2. Count dynamic badges
  let countSingle = 0;
  let countSmall = 0;
  let countLarge = 0;
  dateFiltered.forEach(function(photo) {
    if (photo.groupCategory === 'single') countSingle++;
    else if (photo.groupCategory === 'small_group') countSmall++;
    else if (photo.groupCategory === 'large_group') countLarge++;
  });

  // 3. Category slicing
  let filtered = dateFiltered;
  if (activeGroupMode !== 'all') {
    filtered = dateFiltered.filter(photo => photo.groupCategory === activeGroupMode);
  }

  return {
    dateFilteredCount: dateFiltered.length,
    countSingle,
    countSmall,
    countLarge,
    renderedCount: filtered.length
  };
}

test('buildPhotoHierarchyIndex cleans event names and does not duplicate date in parentheses', () => {
  const samplePhotos = [
    { id: '1', date: '2026-10-06', event: 'อบรม google app ปี 2569', groupCategory: 'single' },
    { id: '2', date: '2026-10-06', event: 'อบรม google app ปี 2569', groupCategory: 'small_group' },
    { id: '3', date: '2026-10-15', event: '', groupCategory: 'large_group' }
  ];

  const hierarchy = buildPhotoHierarchyIndex(samplePhotos);
  const year2569 = hierarchy.years['2569'];
  assert.ok(year2569);
  const monthOct = year2569.months['2026-10'];
  assert.ok(monthOct);

  // Event with name should NOT have appended date in eventName
  const event1 = monthOct.events['อบรม google app ปี 2569_2026-10'];
  assert.ok(event1, 'Event should exist under canonical month key');
  assert.strictEqual(event1.eventName, 'อบรม google app ปี 2569');
  assert.strictEqual(event1.count, 2);

  // Event without name should use formatted date
  const event2 = monthOct.events['2026-10-15'];
  assert.strictEqual(event2.eventName, '15 ต.ค. 2569');
  assert.strictEqual(event2.count, 1);
});

test('Dynamic category badges accurately reflect filtered month and event', () => {
  const samplePhotos = [
    // 2569-02: 13 photos (2 single, 5 small, 6 large)
    { id: 's1', date: '2026-02-01', event: 'งานวิชาการ', groupCategory: 'single' },
    { id: 's2', date: '2026-02-01', event: 'งานวิชาการ', groupCategory: 'single' },
    { id: 'm1', date: '2026-02-01', event: 'งานวิชาการ', groupCategory: 'small_group' },
    { id: 'm2', date: '2026-02-01', event: 'งานวิชาการ', groupCategory: 'small_group' },
    { id: 'm3', date: '2026-02-02', event: 'งานกีฬา', groupCategory: 'small_group' },
    { id: 'm4', date: '2026-02-02', event: 'งานกีฬา', groupCategory: 'small_group' },
    { id: 'm5', date: '2026-02-02', event: 'งานกีฬา', groupCategory: 'small_group' },
    { id: 'l1', date: '2026-02-01', event: 'งานวิชาการ', groupCategory: 'large_group' },
    { id: 'l2', date: '2026-02-01', event: 'งานวิชาการ', groupCategory: 'large_group' },
    { id: 'l3', date: '2026-02-02', event: 'งานกีฬา', groupCategory: 'large_group' },
    { id: 'l4', date: '2026-02-02', event: 'งานกีฬา', groupCategory: 'large_group' },
    { id: 'l5', date: '2026-02-02', event: 'งานกีฬา', groupCategory: 'large_group' },
    { id: 'l6', date: '2026-02-02', event: 'งานกีฬา', groupCategory: 'large_group' },
    // 2568-05: 10 other photos
    { id: 'old1', date: '2025-05-10', event: 'ปีก่อน', groupCategory: 'single' }
  ];

  buildPhotoHierarchyIndex(samplePhotos);

  // Test 1: All years, all months
  const resAll = filterAndComputeBadges(samplePhotos, 'ALL', '', 'all');
  assert.strictEqual(resAll.dateFilteredCount, 14);
  assert.strictEqual(resAll.countSingle, 3);
  assert.strictEqual(resAll.countSmall, 5);
  assert.strictEqual(resAll.countLarge, 6);

  // Test 2: Filter by Year 2569 and Month 2026-02
  const resFeb = filterAndComputeBadges(samplePhotos, '2569', 'MONTH:2026-02', 'all');
  assert.strictEqual(resFeb.dateFilteredCount, 13);
  assert.strictEqual(resFeb.countSingle, 2);
  assert.strictEqual(resFeb.countSmall, 5);
  assert.strictEqual(resFeb.countLarge, 6);
  assert.strictEqual(resFeb.countSingle + resFeb.countSmall + resFeb.countLarge, 13);
  assert.strictEqual(resFeb.renderedCount, 13);

  // Test 3: Filter by Year 2569 and Month 2026-02, but user toggles single category ('single')
  const resFebSingle = filterAndComputeBadges(samplePhotos, '2569', 'MONTH:2026-02', 'single');
  // Dynamic badges must STILL show 2, 5, 6 (not 2, 0, 0)!
  assert.strictEqual(resFebSingle.countSingle, 2);
  assert.strictEqual(resFebSingle.countSmall, 5);
  assert.strictEqual(resFebSingle.countLarge, 6);
  // Rendered photos should only be the 2 single photos
  assert.strictEqual(resFebSingle.renderedCount, 2);

  // Test 4: Filter by specific event 'งานกีฬา_2026-02'
  const resSport = filterAndComputeBadges(samplePhotos, '2569', 'EVENT:งานกีฬา_2026-02', 'all');
  assert.strictEqual(resSport.dateFilteredCount, 7);
  assert.strictEqual(resSport.countSingle, 0);
  assert.strictEqual(resSport.countSmall, 3);
  assert.strictEqual(resSport.countLarge, 4);
  assert.strictEqual(resSport.renderedCount, 7);
});

test('Canonical date resolution unifies split photos into single event under correct month and year', () => {
  // Simulating user bug report:
  // 1 photo with EXIF date '2026-07-06'
  // 32 photos with Drive upload date '2025-11-19'
  // Event folder: 'กค 2 ต้อนรับครูพละใหม่'
  const photos = [
    { id: 'p1', date: '2026-07-06', event: 'กค 2 ต้อนรับครูพละใหม่', groupCategory: 'single' }
  ];
  for (let i = 2; i <= 33; i++) {
    photos.push({
      id: 'p' + i,
      date: '2025-11-19',
      event: 'กค 2 ต้อนรับครูพละใหม่',
      groupCategory: i % 2 === 0 ? 'small_group' : 'large_group'
    });
  }

  const hierarchy = buildPhotoHierarchyIndex(photos);

  // Must only exist in Year 2569
  assert.ok(hierarchy.years['2569'], 'Year 2569 should exist');
  assert.strictEqual(hierarchy.years['2569'].count, 33);
  assert.strictEqual(hierarchy.years['2568'], undefined, 'Year 2568 should NOT contain this event');

  // Month must be 2026-07
  const monthJuly = hierarchy.years['2569'].months['2026-07'];
  assert.ok(monthJuly, 'Month 2026-07 should exist');
  assert.strictEqual(monthJuly.count, 33);

  // Event key must be unified
  const expectedEventKey = 'กค 2 ต้อนรับครูพละใหม่_2026-07';
  const evt = monthJuly.events[expectedEventKey];
  assert.ok(evt, 'Unified event key should exist');
  assert.strictEqual(evt.eventName, 'กค 2 ต้อนรับครูพละใหม่');
  assert.strictEqual(evt.count, 33);

  // Filter test: Selecting this event must return all 33 photos
  const filteredRes = filterAndComputeBadges(photos, '2569', 'EVENT:' + expectedEventKey, 'all');
  assert.strictEqual(filteredRes.renderedCount, 33);
  assert.strictEqual(filteredRes.dateFilteredCount, 33);
});

test('parseThaiMonthFromText handles Thai abbreviations with token boundary without false positives like ศักยภาพครู', () => {
  // Test case from user bug report:
  const eventTitle = 'ตค 8 การอบรมเชิงปฏิบัติการการพัฒนาศักยภาพครูสู่การเลื่อนวิทยฐานะด้วยการใช้ปัญญาประดิษฐ์';
  const month = parseThaiMonthFromText(eventTitle);
  assert.strictEqual(month, '10', 'Should detect month 10 (ตค), not month 05 (from พค inside ศักยภาพครู)');

  // Test word containing letters พค inside standard text without space/boundary
  assert.strictEqual(parseThaiMonthFromText('ศักยภาพครู'), null, 'Should not match พค inside single compound word');
  assert.strictEqual(parseThaiMonthFromText('สภาพความพร้อม'), null, 'Should not match พค inside compound word');

  // Multi-event index resolution
  const photos = [
    { id: 't1', date: '2026-10-08', event: eventTitle, groupCategory: 'single' }
  ];
  const hierarchy = buildPhotoHierarchyIndex(photos);
  assert.ok(hierarchy.years['2569'], 'Year 2569 must exist');
  assert.ok(hierarchy.years['2569'].months['2026-10'], 'Month 2026-10 must exist');
  assert.strictEqual(hierarchy.years['2569'].months['2026-05'], undefined, 'Month 2026-05 must NOT exist');
});

test('Strict name year priority places Year 2563 events under Year 2563 and not overwritten by Drive upload date 2569', () => {
  // Photos for events in Year 2563 with Drive upload date '2026-10-06'
  const photos = [
    { id: 'y1', date: '2026-10-06', event: 'อบรม google app ปี 2563', groupCategory: 'single' },
    { id: 'y2', date: '2026-10-06', event: 'อบรม google app ปี 2563', groupCategory: 'small_group' },
    { id: 'y3', date: '2026-10-06', event: 'วันไหว้ครู ปี 2563', groupCategory: 'large_group' },
    { id: 'y4', date: '2026-10-06', event: 'อบรมวิจัยชั้นเรียน 63 ปี 2563', groupCategory: 'single' },
    { id: 'y5', date: '2026-10-06', event: 'ตค 8 การอบรมครู 2569', groupCategory: 'single' }
  ];

  const hierarchy = buildPhotoHierarchyIndex(photos);

  // Year 2563 must exist and contain 4 photos
  assert.ok(hierarchy.years['2563'], 'Year 2563 must exist in hierarchy');
  assert.strictEqual(hierarchy.years['2563'].count, 4);

  // Year 2569 must exist and contain only 1 photo (not 5 photos)
  assert.ok(hierarchy.years['2569'], 'Year 2569 must exist in hierarchy');
  assert.strictEqual(hierarchy.years['2569'].count, 1);

  // 2563 events must be grouped under 'กิจกรรมประจำปี 2563' (canonicalMonthKey: '2020-00')
  const month2563 = hierarchy.years['2563'].months['2020-00'];
  assert.ok(month2563, 'canonicalMonthKey 2020-00 must exist');
  assert.strictEqual(month2563.thaiMonthName, 'กิจกรรมประจำปี 2563');
  assert.strictEqual(month2563.count, 4);
  assert.ok(month2563.events['อบรม google app ปี 2563_2020-00']);
  assert.ok(month2563.events['วันไหว้ครู ปี 2563_2020-00']);
  assert.ok(month2563.events['อบรมวิจัยชั้นเรียน 63 ปี 2563_2020-00']);

  // Under 2569, month 2026-10 must NOT contain any of the 2563 events
  const month2569Oct = hierarchy.years['2569'].months['2026-10'];
  assert.ok(month2569Oct, 'Month 2026-10 in 2569 should exist');
  assert.strictEqual(month2569Oct.count, 1);
  assert.strictEqual(month2569Oct.events['อบรม google app ปี 2563_2020-00'], undefined);
});

test('Subfolder PA evaluation events (การงาน, คณิต, สุขศึกษา) are unified under กย 24 ประเมิน PA ครู', () => {
  const photos = [
    { id: 'pa1', date: '2026-09-24', event: 'กย 24 ประเมิน PA ครู', groupCategory: 'single' },
    { id: 'pa2', date: '2026-10-06', event: 'การงาน', groupCategory: 'small_group' },
    { id: 'pa3', date: '2026-10-06', event: 'คณิต', groupCategory: 'small_group' },
    { id: 'pa4', date: '2026-10-06', event: 'คณิต2', groupCategory: 'large_group' },
    { id: 'pa5', date: '2026-10-06', event: 'สุขศึกษา', groupCategory: 'single' }
  ];

  const hierarchy = buildPhotoHierarchyIndex(photos);

  // Must only exist under Year 2569
  assert.ok(hierarchy.years['2569'], 'Year 2569 must exist');
  assert.strictEqual(hierarchy.years['2569'].count, 5);

  // Month must be resolved to 2026-09 from "กย 24"
  const monthSep = hierarchy.years['2569'].months['2026-09'];
  assert.ok(monthSep, 'Month 2026-09 must exist');
  assert.strictEqual(monthSep.count, 5);

  // Unified event
  const expectedKey = 'กย 24 ประเมิน PA ครู_2026-09';
  const evt = monthSep.events[expectedKey];
  assert.ok(evt, 'Unified event must exist');
  assert.strictEqual(evt.eventName, 'กย 24 ประเมิน PA ครู');
  assert.strictEqual(evt.count, 5);

  // No separate subfolder events should exist in months
  assert.strictEqual(monthSep.events['การงาน_2026-09'], undefined);
  assert.strictEqual(monthSep.events['คณิต_2026-09'], undefined);

  // Filtering by unified event should return all 5 photos
  const filtered = filterAndComputeBadges(photos, '2569', 'EVENT:' + expectedKey, 'all');
  assert.strictEqual(filtered.renderedCount, 5);
  assert.strictEqual(filtered.countSingle, 2);
  assert.strictEqual(filtered.countSmall, 2);
  assert.strictEqual(filtered.countLarge, 1);
});

test('parseThaiYearFromText parses dot-delimited short Thai years like 15-16 พ.ย.69 พิชิต สวน.', () => {
  assert.strictEqual(parseThaiYearFromText('15-16 พ.ย.69 พิชิต สวน.'), '2569');
  assert.strictEqual(parseThaiYearFromText('24 ก.ค. 68 อบรม'), '2568');
  assert.strictEqual(parseThaiYearFromText('อบรม google app ปี 2563'), '2563');
  assert.strictEqual(parseThaiYearFromText('อบรมวิจัยชั้นเรียน 63 ปี 2563'), '2563');
});

test('buildPhotoHierarchyIndex with empty photo array resets totalCount to 0 and empty years map', () => {
  const emptyHierarchy = buildPhotoHierarchyIndex([]);
  assert.strictEqual(emptyHierarchy.totalCount, 0, 'Total photos count must be 0');
  assert.deepStrictEqual(Object.keys(emptyHierarchy.years), [], 'Years map must be completely empty');

  // Verify badges calculation for 0 photos
  const badgesResult = filterAndComputeBadges([], 'ALL', '', 'all');
  assert.strictEqual(badgesResult.countSingle, 0);
  assert.strictEqual(badgesResult.countSmall, 0);
  assert.strictEqual(badgesResult.countLarge, 0);
  assert.strictEqual(badgesResult.renderedCount, 0);
  assert.strictEqual(badgesResult.dateFilteredCount, 0);
});


