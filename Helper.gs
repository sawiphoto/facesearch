/**
 * Helper.gs
 * รวบรวมฟังก์ชันยูทิลิตี้และฟังก์ชันช่วยจัดรูปแบบข้อมูลย่อยๆ
 */

/**
 * ดึงเฉพาะ File ID รูปภาพจากข้อมูลใน photo_index.json
 */
function extractPhotoIds(photoEntry) {
  var ids = [];
  if (Array.isArray(photoEntry)) {
    photoEntry.forEach(function(item) {
      if (typeof item === "string") {
        ids.push(item);
      } else if (item && typeof item === "object") {
        var fileId = item.fileId || item.id || item.file_id || item.url;
        if (fileId) {
          ids.push(cleanFileId(fileId));
        }
      }
    });
  } else if (typeof photoEntry === "string") {
    ids.push(cleanFileId(photoEntry));
  }
  return ids;
}

/**
 * ตัด URL ให้เหลือแค่ File ID หากจำเป็น
 */
function cleanFileId(idOrUrl) {
  if (idOrUrl.indexOf("id=") !== -1) {
    var parts = idOrUrl.split("id=");
    return parts[1].split("&")[0];
  }
  if (idOrUrl.indexOf("/d/") !== -1) {
    var parts = idOrUrl.split("/d/");
    return parts[1].split("/")[0];
  }
  return idOrUrl;
}

/**
 * จัดการตัวอักษรเพื่อไม่ให้ภาษาไทยหรือช่องว่างส่งผลกับการจับคู่คีย์
 */
function normalizeText(text) {
  if (!text) return "";
  return text.toString().toLowerCase().replace(/[\s\-_]/g, "");
}

/**
 * ค้นหาบุคคลใน Map แบบสืบค้นยืดหยุ่นสะกดผิด (Fuzzy Name Matching)
 */
function findFuzzyPerson(name, personMap) {
  var normalized = normalizeText(name);
  // 1. ค้นหาแบบตรงตัวก่อน
  if (personMap[normalized]) {
    return personMap[normalized];
  }
  
  // 2. ถ้าไม่เจอตรงตัว ให้ไล่ค้นหาด้วยเกณฑ์ความคล้ายคลึง Levenshtein Distance
  var keys = Object.keys(personMap);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    // อนุญาตให้สะกดต่างกันได้ไม่เกิน 2 ตัวอักษร
    if (getLevenshteinDistance(normalized, key) <= 2) {
      return personMap[key];
    }
  }
  return null;
}

/**
 * คำนวณระยะห่างระหว่างข้อความสองตัว (Levenshtein Distance)
 */
function getLevenshteinDistance(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  
  var matrix = [];
  for (var i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (var j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  
  for (var i = 1; i <= b.length; i++) {
    for (var j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // แทนที่ (Substitution)
          matrix[i][j - 1] + 1,     // แทรก (Insertion)
          matrix[i - 1][j] + 1      // ลบ (Deletion)
        );
      }
    }
  }
  return matrix[b.length][a.length];
}
