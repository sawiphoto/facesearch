// Derived from Index.html v10.3; retain identical year/date classification.
function webFormatThaiMonthYear_(dateStr) {
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

    // ฟังก์ชันแปลงวันที่เป็น วัน เดือนย่อ พ.ศ. เช่น 12 ต.ค. 2569

function webFormatThaiDate_(dateStr) {
      if (!dateStr || dateStr === "" || dateStr === "0000-00-00") return "ไม่ระบุวันที่";
      var parts = dateStr.split("-");
      if (parts.length < 3) return dateStr;
      
      var year = parseInt(parts[0], 10);
      var month = parseInt(parts[1], 10);
      var day = parseInt(parts[2], 10);
      
      var thaiMonthsShort = [
        "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
        "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."
      ];
      
      var thaiYear = year + 543;
      var thaiMonth = thaiMonthsShort[month - 1] || ("เดือน " + month);
      return day + " " + thaiMonth + " " + thaiYear;
    }

function webExtractSortableThaiYear_(p) {
      if (!p) return 0;
      var raw = (p._thaiYear && p._thaiYear !== "ไม่ระบุปี") ? p._thaiYear : (p.year || "");
      var num = parseInt(String(raw).trim(), 10);
      if (!isNaN(num)) {
        if (num >= 2400 && num <= 2700) return num;
        if (num >= 1900 && num <= 2200) return num + 543;
      }
      var fromEvent = webParseThaiYearFromText_(p._eventName || p.event || "");
      if (fromEvent) {
        var evNum = parseInt(fromEvent, 10);
        if (!isNaN(evNum)) return evNum;
      }
      if (p.date && p.date !== "0000-00-00") {
        var yPart = parseInt(String(p.date).split('-')[0], 10);
        if (!isNaN(yPart) && yPart > 1900) return yPart + 543;
      }
      return 0;
    }

function webExtractEffectivePhotoDate_(p) {
      if (!p || !p.date || typeof p.date !== "string") return "0000-00-00";
      var d = p.date.trim();
      if (!d || d === "0000-00-00") return "0000-00-00";
      if (p._yearKey && p._yearKey !== "0000") {
        // ใช้เฉพาะวันที่ที่ปี ค.ศ. ตรงกับปีจริงของภาพ ป้องกันไม่ให้วันอัปโหลด Drive (เช่น 2026-10-06 ของภาพปี 2563) มาแซงคิว
        if (d.indexOf(p._yearKey + "-") === 0) return d;
        return "0000-00-00";
      }
      return d;
    }

function webComparePhotosByYearAndDateDesc_(a, b) {
      // 1. เรียงตามปี พ.ศ. ที่แท้จริง (ใหม่สุดไปเก่าสุด เช่น 2569 -> 2568 -> ... -> 2563 -> ไม่ระบุปี)
      var yearA = webExtractSortableThaiYear_(a);
      var yearB = webExtractSortableThaiYear_(b);
      if (yearA !== yearB) {
        return yearB - yearA;
      }

      // 2. ภายในปีเดียวกัน เรียงตามเดือนของกิจกรรม (_monthKey เช่น 2026-10 -> 2026-09 -> 2026-00)
      var monthA = (a && a._monthKey) ? String(a._monthKey) : "0000-00";
      var monthB = (b && b._monthKey) ? String(b._monthKey) : "0000-00";
      if (monthA !== monthB) {
        return monthB.localeCompare(monthA);
      }

      // 3. ภายในเดือนเดียวกัน เรียงตามวันที่ถ่ายจริง (ไม่ใช่วันอัปโหลดข้ามปี)
      var dateA = webExtractEffectivePhotoDate_(a);
      var dateB = webExtractEffectivePhotoDate_(b);
      if (dateA !== dateB) {
        return dateB.localeCompare(dateA);
      }

      // 4. ภายในวัน/กิจกรรมเดียวกัน จัดกลุ่มตามชื่อกิจกรรมและรหัสภาพให้เป็นระเบียบคงที่
      var evA = (a && (a._eventName || a.event)) ? String(a._eventName || a.event) : "";
      var evB = (b && (b._eventName || b.event)) ? String(b._eventName || b.event) : "";
      if (evA !== evB) {
        return evA.localeCompare(evB, 'th');
      }

      var idA = (a && (a.photoId || a.id)) ? String(a.photoId || a.id) : "";
      var idB = (b && (b.photoId || b.id)) ? String(b.photoId || b.id) : "";
      return idA.localeCompare(idB);
    }

    // ฟังก์ชันช่วยแยกแยะชื่อเดือนไทยจากข้อความ พร้อมระบบ Token Boundary ป้องกันการชนกับคำไทยทั่วไป

function webParseThaiMonthFromText_(text) {
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

    // ฟังก์ชันช่วยแยกแยะปี พ.ศ. จากข้อความ

function webParseThaiYearFromText_(text) {
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

    // ฟังก์ชันจัดทำดัชนีลำดับชั้น Year -> Month -> Event ล่วงหน้าใน RAM พร้อมระบบรวมกิจกรรม (Canonical Event Resolution)

function webBuildPhotoHierarchyIndex_(photos) {
      var hierarchy = {
        years: {}, // thaiYear -> { thaiYear, yearKey, count, months: {} }
        totalCount: (photos || []).length
      };

      // รายชื่อและรูปแบบโฟลเดอร์ย่อยที่ต้องยุบรวมเข้าโฟลเดอร์กิจกรรมใหญ่ (Universal Subfolder Resolution)
      var paSubfolders = ['การงาน', 'คณิต', 'คณิต2', 'สุขศึกษา', 'แนะแนว', 'ห้องสมุด', 'ศิลปะ', 'ต่างประเทศ', 'วิทย์', 'สังคม', 'คอมพิวเตอร์'];
      var isGenericSubfolder = function(name) {
        if (!name) return false;
        var t = name.trim();
        if (paSubfolders.indexOf(t) !== -1) return true;
        if (/^(?:ม|ป)\.\s*[1-6](?:\/\d+)?$/i.test(t)) return true;
        if (/^ห้อง\s*\d+$/i.test(t)) return true;
        if (/^(?:สีน้ำเงิน|สีม่วง|สีส้ม|สีเขียว|สีแดง|สีฟ้า|สีชมพู|สีเหลือง|สีขาว)$/.test(t)) return true;
        if (/^(?:เช้า|เย็น|ภาคเช้า|ภาคบ่าย)$/.test(t)) return true;
        if (/^(?:รูป|ไฟล์รูป|วิดีโอ|วีดีโอ)$/.test(t)) return true;
        if (/^อื่นๆ\d*$/.test(t)) return true;
        return false;
      };

      // แมปสำรองสำหรับโฟลเดอร์ย่อยในอดีต (Defense-in-Depth Fallback Map)
      var subfolderFallbackMap = {
        'ม.4': { event: 'เลือกตั้งประธานสภานักเรียน63 ปี 2563', year: '2563' },
        'ม.1': { event: 'คริสต์มาส66', year: '2566' },
        'ไฟล์รูป': { event: 'วีดีโอเกษียณ66', year: '2566' },
        'สีส้ม': { event: 'ค่ายฝึกปฏิบัติการสร้างนักวิทย์สนุกคิดนอกห้องเรียน 2567 (8-9 ตุลาคม 2567) ณ มหาวิทยาลัยวลัยลักษณ์', year: '2567' },
        'สีม่วง': { event: 'ค่ายฝึกปฏิบัติการสร้างนักวิทย์สนุกคิดนอกห้องเรียน 2567 (8-9 ตุลาคม 2567) ณ มหาวิทยาลัยวลัยลักษณ์', year: '2567' },
        'สีน้ำเงิน': { event: 'ค่ายฝึกปฏิบัติการสร้างนักวิทย์สนุกคิดนอกห้องเรียน 2567 (8-9 ตุลาคม 2567) ณ มหาวิทยาลัยวลัยลักษณ์', year: '2567' },
        'สีแดง': { event: 'ค่ายฝึกปฏิบัติการสร้างนักวิทย์สนุกคิดนอกห้องเรียน 2567 (8-9 ตุลาคม 2567) ณ มหาวิทยาลัยวลัยลักษณ์', year: '2567' },
        'สีเขียว': { event: 'ค่ายฝึกปฏิบัติการสร้างนักวิทย์สนุกคิดนอกห้องเรียน 2567 (8-9 ตุลาคม 2567) ณ มหาวิทยาลัยวลัยลักษณ์', year: '2567' },
        'วิดีโอ': { event: 'พิธีพุทธาภิเษก', year: '2567' }
      };

      // 1. แยกกลุ่มรูปภาพที่มีชื่อกิจกรรม และรูปที่ไม่มีชื่อกิจกรรม (จัดกลุ่มตาม Event และ Year เพื่อป้องกันการแย่งปี)
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
            if (!p.year) p.year = '2569';
          } else if (subfolderFallbackMap[rawEvent]) {
            eName = subfolderFallbackMap[rawEvent].event;
            p._subEventName = rawEvent;
            if (!p.year) p.year = subfolderFallbackMap[rawEvent].year;
          }
          if (p.subfolder && p.subfolder.trim() !== "") {
            p._subEventName = p.subfolder.trim();
          }

          // ตรวจสอบปีของรูปภาพ: ลำดับ 1. p.year -> 2. webParseThaiYearFromText_(eName) -> 3. p.date
          var photoYear = (p.year && p.year.trim() !== "") ? p.year.trim() : webParseThaiYearFromText_(eName);
          if (!photoYear && p.date && p.date.trim() !== "") {
            var yPart = parseInt(p.date.split('-')[0], 10);
            if (!isNaN(yPart) && yPart > 1900) photoYear = (yPart + 543).toString();
          }
          var groupKey = eName + (photoYear ? ("___" + photoYear) : "");

          if (!eventGroups[groupKey]) {
            eventGroups[groupKey] = {
              eventName: eName,
              groupYear: photoYear || "",
              photos: []
            };
          }
          eventGroups[groupKey].photos.push(p);
        } else {
          standalonePhotos.push(p);
        }
      });

      // 2. วิเคราะห์ปีและเดือนที่แท้จริงของแต่ละกิจกรรม (Canonical Date Resolution)
      // ป้องกันปัญหากิจกรรมเดียวกันแตกตัวไปอยู่ข้ามปีเพราะวันที่อัปโหลด Drive หรือ EXIF หลุด
      Object.keys(eventGroups).forEach(function(groupKey) {
        var groupObj = eventGroups[groupKey];
        var eName = groupObj.eventName;
        var photosInEvent = groupObj.photos;
        var nameMonth = webParseThaiMonthFromText_(eName);
        var nameYear = webParseThaiYearFromText_(eName);

        // ตรวจสอบ Explicit Year จากคีย์ p.year ในกลุ่มนี้
        var explicitYear = groupObj.groupYear || "";
        if (!explicitYear) {
          for (var i = 0; i < photosInEvent.length; i++) {
            if (photosInEvent[i].year && photosInEvent[i].year.trim() !== "") {
              explicitYear = photosInEvent[i].year.trim();
              break;
            }
          }
        }

        var targetYear = explicitYear || nameYear;

        if (targetYear) {
          // มีปี พ.ศ. ชัดเจน: ล็อกปีตามนี้เสมอ ห้ามให้วันที่อัปโหลด Drive (2026-10-06) มาเขียนทับเด็ดขาด
          var canonicalThaiYear = targetYear;
          var canonicalYearKey = (parseInt(targetYear, 10) - 543).toString();
          var canonicalMonthKey = "";

          if (nameMonth) {
            canonicalMonthKey = canonicalYearKey + "-" + nameMonth;
          } else {
            // ไม่ได้ระบุเดือนในชื่อ: ค้นหาเดือนที่พบบ่อยที่สุดจากรูปภาพที่มีวันที่ตรงกับปีนี้
            var ymCounts = {};
            photosInEvent.forEach(function(p) {
              if (p.date && p.date.indexOf(canonicalYearKey + "-") === 0) {
                var parts = p.date.split('-');
                if (parts.length >= 2) {
                  var ym = canonicalYearKey + "-" + parts[1];
                  ymCounts[ym] = (ymCounts[ym] || 0) + 1;
                }
              }
            });
            var ymArr = Object.keys(ymCounts).sort(function(a, b) { return ymCounts[b] - ymCounts[a]; });
            if (ymArr.length > 0) {
              canonicalMonthKey = ymArr[0];
            } else {
              // หากไม่มีวันที่ตรงกับปีจริง (เช่น วันที่ของรูปทั้งหมดเป็นวันอัปโหลด Drive) ให้จัดเข้าหมวดกิจกรรมประจำปี
              canonicalMonthKey = canonicalYearKey + "-00";
            }
          }

          var canonicalThaiMonthName = webFormatThaiMonthYear_(canonicalMonthKey);
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
          // โฟลเดอร์ระบุเดือนชัดเจน แต่ไม่ระบุปี -> ค้นหาปีที่ตรงกับเดือนนี้มากที่สุด
          var yearCounts = {};
          photosInEvent.forEach(function(p) {
            if (p.date) {
              var parts = p.date.split('-');
              if (parts.length >= 2 && parts[1] === nameMonth) {
                var y = parseInt(parts[0], 10);
                if (!isNaN(y)) {
                  var ty = (y + 543).toString();
                  yearCounts[ty] = (yearCounts[ty] || 0) + 1;
                }
              }
            }
          });
          var yKeys = Object.keys(yearCounts).sort(function(a, b) { return yearCounts[b] - yearCounts[a]; });
          var canonicalThaiYear = yKeys.length > 0 ? yKeys[0] : "ไม่ระบุปี";
          var canonicalYearKey = canonicalThaiYear !== "ไม่ระบุปี" ? (parseInt(canonicalThaiYear, 10) - 543).toString() : "0000";

          var canonicalMonthKey = canonicalYearKey + "-" + nameMonth;
          var canonicalThaiMonthName = webFormatThaiMonthYear_(canonicalMonthKey);
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
          // กิจกรรมไม่ได้ระบุเดือนและปีในชื่อ -> จัดกลุ่มตามปีจริงของรูป
          var byYear = {};
          photosInEvent.forEach(function(p) {
            var yStr = "0000";
            var tyStr = "ไม่ระบุปี";
            if (p.year && p.year.trim() !== "") {
              tyStr = p.year.trim();
              yStr = (parseInt(tyStr, 10) - 543).toString();
            } else if (p.date && p.date.split('-').length >= 1) {
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
            var canonicalThaiMonthName = webFormatThaiMonthYear_(canonicalMonthKey);
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

        // ลำดับความสำคัญปี: 1. p.year -> 2. p.date
        if (p.year && p.year.trim() !== "") {
          thaiYear = p.year.trim();
          var yCE = parseInt(thaiYear, 10) - 543;
          yearKey = isNaN(yCE) ? "0000" : yCE.toString();
        } else if (p.date && p.date.trim() !== "" && p.date !== "0000-00-00") {
          var parts = p.date.split('-');
          if (parts.length >= 1) {
            var y = parseInt(parts[0], 10);
            if (!isNaN(y)) {
              thaiYear = (y + 543).toString();
              yearKey = parts[0];
            }
          }
        }

        if (p.date && p.date.trim() !== "" && p.date !== "0000-00-00") {
          var parts = p.date.split('-');
          if (parts.length >= 2) {
            monthKey = (yearKey !== "0000" ? yearKey : parts[0]) + '-' + parts[1];
            thaiMonthName = webFormatThaiMonthYear_(monthKey);
          }
          eventKey = p.date;
          eventName = webFormatThaiDate_(p.date);
        } else if (yearKey !== "0000") {
          monthKey = yearKey + "-00";
          thaiMonthName = "กิจกรรมประจำปี " + thaiYear;
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
            count: 0,
            subfolders: {}
          };
        }
        monthObj.events[eventKey].count++;
        var sub = p.subfolder || p._subEventName;
        if (sub && typeof sub === 'string' && sub.trim() !== '') {
          monthObj.events[eventKey].subfolders[sub.trim()] = true;
        }
      });

      return hierarchy;
    }