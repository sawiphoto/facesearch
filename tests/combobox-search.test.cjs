const assert = require('assert');

// Logic extracted from Index.html Combobox Search
function buildComboboxItems(hierarchy, selectedYear) {
  var targetYears = [];
  if (!selectedYear || selectedYear === 'ALL') {
    targetYears = Object.keys(hierarchy.years || {}).sort(function(a, b) {
      if (a === "ไม่ระบุปี") return 1;
      if (b === "ไม่ระบุปี") return -1;
      return b.localeCompare(a);
    });
  } else if (hierarchy.years[selectedYear]) {
    targetYears = [selectedYear];
  }

  var scopeCount = 0;
  targetYears.forEach(function(y) {
    scopeCount += hierarchy.years[y] ? hierarchy.years[y].count : 0;
  });

  var topOptionLabel = "🟣 ทุกกิจกรรม (" + scopeCount + ")";
  var comboboxItems = [];

  comboboxItems.push({
    value: "",
    label: "🟣 ทุกกิจกรรม",
    displayTitle: topOptionLabel,
    type: "ALL",
    count: scopeCount,
    searchKey: "ทุกกิจกรรม ทั้งหมด all " + scopeCount
  });

  targetYears.forEach(function(y) {
    var yObj = hierarchy.years[y];
    if (!yObj || !yObj.months) return;

    var monthsArr = Object.keys(yObj.months).sort(function(a, b) {
      if (a === "0000-00") return 1;
      if (b === "0000-00") return -1;
      return b.localeCompare(a);
    });

    monthsArr.forEach(function(mKey) {
      var mObj = yObj.months[mKey];
      var thaiYearNum = (mKey && mKey !== "0000-00") ? (parseInt(mKey.split('-')[0]) + 543) : "";

      comboboxItems.push({
        value: "MONTH:" + mKey,
        label: "📅 " + mObj.thaiMonthName,
        displayTitle: "📅 " + mObj.thaiMonthName + " (" + mObj.count + ")",
        type: "MONTH",
        count: mObj.count,
        searchKey: mObj.thaiMonthName + " " + mKey + " " + thaiYearNum + " " + mObj.count
      });

      var eventsArr = Object.keys(mObj.events || {}).sort(function(a, b) {
        return b.localeCompare(a);
      });

      eventsArr.forEach(function(eKey) {
        var eObj = mObj.events[eKey];
        var extraSearch = "";
        if (eObj.eventName === 'กย 24 ประเมิน PA ครู') {
          extraSearch = " การงาน คณิต คณิต2 สุขศึกษา แนะแนว ห้องสมุด ศิลปะ ต่างประเทศ วิทย์ สังคม";
        }
        comboboxItems.push({
          value: "EVENT:" + eKey,
          label: "• " + eObj.eventName,
          displayTitle: "• " + eObj.eventName + " (" + eObj.count + ")",
          type: "EVENT",
          count: eObj.count,
          searchKey: eObj.eventName + extraSearch + " " + mObj.thaiMonthName + " " + thaiYearNum + " " + (eKey || "") + " " + eObj.count
        });
      });
    });
  });

  return comboboxItems;
}

function filterComboboxItems(items, query) {
  var q = (query || "").trim().toLowerCase();
  if (!q) return items;
  return items.filter(function(item) {
    if (item.type === 'ALL') return false;
    return item.searchKey.toLowerCase().indexOf(q) !== -1;
  });
}

// Sample hierarchy data
const sampleHierarchy = {
  years: {
    "2569": {
      count: 35,
      months: {
        "2026-10": {
          thaiMonthName: "ตุลาคม 2569",
          count: 20,
          events: {
            "วันแม่_2026-10-01": { eventName: "วันแม่", count: 8 },
            "การอบรมพัฒนาครู_2026-10-08": { eventName: "การอบรมพัฒนาครู", count: 12 }
          }
        },
        "2026-09": {
          thaiMonthName: "กันยายน 2569",
          count: 10,
          events: {
            "กย 24 ประเมิน PA ครู_2026-09": { eventName: "กย 24 ประเมิน PA ครู", count: 10 }
          }
        },
        "2026-08": {
          thaiMonthName: "สิงหาคม 2569",
          count: 5,
          events: {
            "วันวิทยาศาสตร์_2026-08-18": { eventName: "วันวิทยาศาสตร์", count: 5 }
          }
        }
      }
    }
  },
  totalCount: 35
};

// Test 1: Build items structure
const allItems = buildComboboxItems(sampleHierarchy, 'ALL');
assert.equal(allItems.length, 8, 'Should have 1 ALL, 3 MONTHs, 4 EVENTs');
assert.equal(allItems[0].type, 'ALL');
assert.equal(allItems[1].type, 'MONTH');
assert.equal(allItems[2].type, 'EVENT');
console.log('✅ Test 1 Passed: Build items count and hierarchy correct');

// Test 2: Search by Event Name
const searchEvent = filterComboboxItems(allItems, 'อบรม');
assert.equal(searchEvent.length, 1);
assert.equal(searchEvent[0].value, 'EVENT:การอบรมพัฒนาครู_2026-10-08');
console.log('✅ Test 2 Passed: Search by event keyword ->', searchEvent[0].label);

// Test 2.5: Search by Subfolder keyword (e.g. คณิต) -> finds PA evaluation
const searchSubfolder = filterComboboxItems(allItems, 'คณิต');
assert.equal(searchSubfolder.length, 1);
assert.equal(searchSubfolder[0].value, 'EVENT:กย 24 ประเมิน PA ครู_2026-09');
console.log('✅ Test 2.5 Passed: Search by subfolder keyword "คณิต" finds unified event ->', searchSubfolder[0].label);

// Test 3: Search by Month Name
const searchMonth = filterComboboxItems(allItems, 'ตุลา');
// Should match the month "ตุลาคม 2569" as well as its events because their searchKey includes month name
assert(searchMonth.length >= 1);
assert.equal(searchMonth[0].value, 'MONTH:2026-10');
console.log('✅ Test 3 Passed: Search by month keyword ->', searchMonth.map(i => i.label));

// Test 4: Search by Year
const searchYear = filterComboboxItems(allItems, '2569');
assert(searchYear.length >= 2, 'Should match all months and events containing 2569');
console.log('✅ Test 4 Passed: Search by year -> found', searchYear.length, 'matches');

// Test 5: Empty query returns all items
const emptySearch = filterComboboxItems(allItems, '');
assert.equal(emptySearch.length, 8);
console.log('✅ Test 5 Passed: Empty search returns all items');

// Test 6: Non-matching query returns empty array
const noMatch = filterComboboxItems(allItems, 'ไม่มีคำนี้');
assert.equal(noMatch.length, 0);
console.log('✅ Test 6 Passed: Non-matching query returns empty array');

// Test 7: Combobox state when no person is selected
function getComboboxState(selectedPerson, items, topLabel) {
  if (!selectedPerson) {
    return {
      placeholder: "👆 กรุณาเลือกบุคลากรด้านบนก่อน",
      guidanceRequired: true
    };
  }
  return {
    placeholder: topLabel || "🟣 ทุกกิจกรรม",
    guidanceRequired: false
  };
}

const unselectedState = getComboboxState(null, [], "🟣 ทุกกิจกรรม (0)");
assert.equal(unselectedState.placeholder, "👆 กรุณาเลือกบุคลากรด้านบนก่อน");
assert.equal(unselectedState.guidanceRequired, true);
console.log('✅ Test 7 Passed: Unselected state correctly returns teacher guidance prompt');

// Test 8: Combobox state when a person is selected
const selectedState = getComboboxState({ name: "คุณครูทดสอบ" }, allItems, "🟣 ทุกกิจกรรม (25)");
assert.equal(selectedState.placeholder, "🟣 ทุกกิจกรรม (25)");
assert.equal(selectedState.guidanceRequired, false);
console.log('✅ Test 8 Passed: Selected state correctly returns photo count placeholder');

// Test 9: Teacher with 0 photos resets combobox to 🟣 ทุกกิจกรรม (0)
const emptyHierarchy = { years: {}, totalCount: 0 };
const zeroItems = buildComboboxItems(emptyHierarchy, 'ALL');
assert.equal(zeroItems.length, 1, 'Should have exactly 1 ALL item');
assert.equal(zeroItems[0].type, 'ALL');
assert.equal(zeroItems[0].count, 0);
assert.equal(zeroItems[0].displayTitle, '🟣 ทุกกิจกรรม (0)');
const zeroState = getComboboxState({ name: "คุณครูที่ยังไม่มีรูป" }, zeroItems, zeroItems[0].displayTitle);
assert.equal(zeroState.placeholder, "🟣 ทุกกิจกรรม (0)");
console.log('✅ Test 9 Passed: Teacher with 0 photos correctly resets combobox to ทุกกิจกรรม (0)');

console.log('🎉 ALL COMBOBOX SEARCH TESTS PASSED 100%!');

