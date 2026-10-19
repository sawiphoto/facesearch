const assert = require('assert');

// ฟังก์ชันสร้างชื่อไฟล์ดาวน์โหลดมาตรฐาน: ปี_เดือน_วัน_งานกิจกรรม_ลำดับภาพ.jpg
function buildCustomPhotoNames(photos) {
  var eventCounts = {};
  return (photos || []).map(function(photo) {
    var year2Digit = "00";
    var month2Digit = "00";
    var day2Digit = "00";

    if (photo && photo.date && photo.date.trim() !== "" && photo.date !== "0000-00-00") {
      var parts = photo.date.trim().split('-');
      if (parts.length >= 1) {
        var y = parseInt(parts[0], 10);
        if (!isNaN(y)) {
          var thaiYear = y + 543;
          year2Digit = String(thaiYear % 100).padStart(2, '0');
        }
      }
      if (parts.length >= 2) {
        var m = parseInt(parts[1], 10);
        month2Digit = isNaN(m) ? "00" : String(m).padStart(2, '0');
      }
      if (parts.length >= 3) {
        var d = parseInt(parts[2], 10);
        day2Digit = isNaN(d) ? "00" : String(d).padStart(2, '0');
      }
    }

    var eventName = "ทั่วไป";
    if (photo && photo.event && photo.event.trim() !== "") {
      eventName = photo.event.trim().replace(/[/\\?%*:|"<>]/g, '_');
    }

    var prefix = year2Digit + "_" + month2Digit + "_" + day2Digit + "_" + eventName;
    eventCounts[prefix] = (eventCounts[prefix] || 0) + 1;
    var seq = String(eventCounts[prefix]).padStart(2, '0');

    return prefix + "_" + seq + ".jpg";
  });
}

// Test Case 1: Single photo with full date and event
const test1 = buildCustomPhotoNames([
  { id: 'file1', date: '2026-10-08', event: 'การอบรมพัฒนาครู' }
]);
assert.deepStrictEqual(test1, ['69_10_08_การอบรมพัฒนาครู_01.jpg']);
console.log('✅ Test 1 Passed: Single photo formatted correctly ->', test1[0]);

// Test Case 2: Multiple photos with same date and event increments sequence
const test2 = buildCustomPhotoNames([
  { id: 'file1', date: '2026-10-01', event: 'วันแม่' },
  { id: 'file2', date: '2026-10-01', event: 'วันแม่' },
  { id: 'file3', date: '2026-10-01', event: 'วันแม่' }
]);
assert.deepStrictEqual(test2, [
  '69_10_01_วันแม่_01.jpg',
  '69_10_01_วันแม่_02.jpg',
  '69_10_01_วันแม่_03.jpg'
]);
console.log('✅ Test 2 Passed: Same event sequence ->', test2);

// Test Case 3: Mixed events maintain independent sequence counters
const test3 = buildCustomPhotoNames([
  { id: 'file1', date: '2026-10-01', event: 'วันแม่' },
  { id: 'file2', date: '2026-10-08', event: 'การอบรมพัฒนาครู' },
  { id: 'file3', date: '2026-10-01', event: 'วันแม่' },
  { id: 'file4', date: '2026-10-08', event: 'การอบรมพัฒนาครู' }
]);
assert.deepStrictEqual(test3, [
  '69_10_01_วันแม่_01.jpg',
  '69_10_08_การอบรมพัฒนาครู_01.jpg',
  '69_10_01_วันแม่_02.jpg',
  '69_10_08_การอบรมพัฒนาครู_02.jpg'
]);
console.log('✅ Test 3 Passed: Mixed events independent sequence ->', test3);

// Test Case 4: Special characters sanitized
const test4 = buildCustomPhotoNames([
  { id: 'file1', date: '2026-10-08', event: 'งาน/วันแม่:พิเศษ?' }
]);
assert.deepStrictEqual(test4, ['69_10_08_งาน_วันแม่_พิเศษ__01.jpg']);
console.log('✅ Test 4 Passed: Special characters sanitized ->', test4[0]);

// Test Case 5: Empty date / missing event fallbacks
const test5 = buildCustomPhotoNames([
  { id: 'file1' },
  { id: 'file2', date: '0000-00-00', event: '' }
]);
assert.deepStrictEqual(test5, [
  '00_00_00_ทั่วไป_01.jpg',
  '00_00_00_ทั่วไป_02.jpg'
]);
console.log('✅ Test 5 Passed: Fallbacks handled safely ->', test5);

console.log('🎉 ALL PHOTO DOWNLOAD NAMING TESTS PASSED!');
