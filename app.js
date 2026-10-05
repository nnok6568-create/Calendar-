// 개인용 할 일 관리 앱
// 흐름: 상태 변경 함수 → saveData() → render()
// file://에서 실행되어야 하므로 ES module을 쓰지 않는다.
(function () {
  'use strict';

  // ===== 상수 =====
  var STORAGE_KEY = 'todo-app-data';
  var SETTINGS_KEY = 'todo-app-settings';
  var DATA_VERSION = 2; // v2: 할 일(task)과 일정(event) 분리, 종료 시간 추가
  var CATEGORIES = { work: '업무', personal: '개인', etc: '기타' };
  var DEFAULT_CATEGORY = 'etc';
  var TYPES = { task: '할 일', event: '일정' };
  var DEFAULT_TYPE = 'task';
  // 할 일 중요도 (일정에는 없음). 정렬 순서는 상 → 중 → 하.
  var PRIORITIES = { high: '상', medium: '중', low: '하' };
  var PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };
  var DEFAULT_PRIORITY = 'medium';
  // 일정 반복 규칙. 반복 날짜는 저장하지 않고 그릴 때 계산한다 (occursOn).
  var REPEATS = { none: '반복 안 함', daily: '매일', weekly: '매주', monthly: '매월', yearly: '매년' };
  var LIST_VIEWS = ['day', 'week', 'month']; // 목록 보기: 하루 / 주간 / 월간
  var TITLE_MAX_LENGTH = 100;
  var TIME_STEP_MINUTES = 10; // 일정 시간은 10분 단위
  var MAX_DOTS = 3;
  var CALENDAR_CELLS = 42; // 6주 고정
  var WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
  // 고정 문자열 아이콘 (사용자 입력이 아니므로 innerHTML 사용 가능)
  var ICONS = {
    edit: '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/></svg>',
    delete: '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>'
  };
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  var TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/;

  // ===== 유틸 =====
  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function hasCategory(key) {
    return Object.prototype.hasOwnProperty.call(CATEGORIES, key);
  }

  function hasType(key) {
    return Object.prototype.hasOwnProperty.call(TYPES, key);
  }

  function hasRepeat(key) {
    return Object.prototype.hasOwnProperty.call(REPEATS, key);
  }

  function hasPriority(key) {
    return Object.prototype.hasOwnProperty.call(PRIORITIES, key);
  }

  // 할 일이면 올바른 중요도(기본 중), 일정이면 null
  function cleanPriority(type, value) {
    if (type !== 'task') return null;
    return hasPriority(value) ? value : DEFAULT_PRIORITY;
  }

  // Date → 로컬 시간 기준 "YYYY-MM-DD".
  // toISOString()은 UTC라서 한국 시간 오전 9시 전에 하루 전 날짜가 나오므로 쓰지 않는다.
  function toDateString(date) {
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
  }

  function todayString() {
    return toDateString(new Date());
  }

  function nowTimeString() {
    var d = new Date();
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  // "YYYY-MM-DD" → 로컬 자정 Date. new Date("YYYY-MM-DD")는 UTC로 해석되므로 직접 파싱한다.
  function parseDateString(str) {
    var parts = str.split('-');
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  }

  // 형식뿐 아니라 실제 존재하는 날짜인지 확인 (2026-02-30 등 거부)
  function isValidDateString(str) {
    return typeof str === 'string' && DATE_RE.test(str) &&
      toDateString(parseDateString(str)) === str;
  }

  // "HH:mm" → 10분 단위로 내린 "HH:mm". 형식이 틀리면 null.
  function normalizeTime(value) {
    var m = typeof value === 'string' && TIME_RE.exec(value);
    if (!m) return null;
    return m[1] + ':' + pad2(Math.floor(Number(m[2]) / TIME_STEP_MINUTES) * TIME_STEP_MINUTES);
  }

  function addDays(str, days) {
    var d = parseDateString(str);
    d.setDate(d.getDate() + days);
    return toDateString(d);
  }

  // 날짜 사이 일수 계산용 일련번호 (UTC 기준이라 서머타임 영향 없음)
  function dayNumber(str) {
    var p = str.split('-');
    return Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])) / 86400000;
  }

  // 이 항목이 dateStr 날짜에 나타나는지 (반복 일정 포함).
  // 매월 31일·매년 2월 29일처럼 그 날짜가 없는 달/해는 건너뛴다.
  function occursOn(item, dateStr) {
    if (item.repeat === 'none') return item.date === dateStr;
    if (dateStr < item.date || (item.repeatUntil && dateStr > item.repeatUntil)) return false;
    var start = item.date;
    switch (item.repeat) {
      case 'daily': return true;
      case 'weekly': return (dayNumber(dateStr) - dayNumber(start)) % 7 === 0;
      case 'monthly': return dateStr.slice(8) === start.slice(8);
      case 'yearly': return dateStr.slice(5) === start.slice(5);
      default: return false;
    }
  }

  // ===== 법정공휴일 =====
  // 인터넷 없이 동작해야 하므로 앱에 내장한다.
  // 양력 공휴일: [월-일, 이름, 토·일요일과 겹치면 대체공휴일 여부]
  var SOLAR_HOLIDAYS = [
    ['01-01', '신정', false],
    ['03-01', '삼일절', true],
    ['05-05', '어린이날', true],
    ['06-06', '현충일', false],
    ['08-15', '광복절', true],
    ['10-03', '개천절', true],
    ['10-09', '한글날', true],
    ['12-25', '성탄절', true]
  ];
  // 음력 공휴일의 양력 날짜: [설날, 부처님오신날, 추석]. 표에 없는 해는 양력 공휴일만 표시된다.
  // 해마다 한국천문연구원 월력요항으로 확인해 추가한다.
  var LUNAR_HOLIDAYS = {
    2024: ['02-10', '05-15', '09-17'],
    2025: ['01-29', '05-05', '10-06'],
    2026: ['02-17', '05-24', '09-25'],
    2027: ['02-07', '05-13', '09-15'],
    2028: ['01-27', '05-02', '10-03'],
    2029: ['02-13', '05-20', '09-22'],
    2030: ['02-03', '05-09', '09-12']
  };
  // 공직선거법상 공휴일인 선거일 (치러졌거나 법정 선거일이 정해진 것만). 임시공휴일은 넣지 않는다.
  var ELECTION_DAYS = {
    '2024-04-10': '국회의원선거',
    '2025-06-03': '대통령선거',
    '2026-06-03': '전국동시지방선거',
    '2028-04-12': '국회의원선거'
  };
  var holidayCache = Object.create(null);

  function isWeekend(dateStr) {
    var day = parseDateString(dateStr).getDay();
    return day === 0 || day === 6;
  }

  // 그 해의 공휴일 { 'YYYY-MM-DD': '이름' } (대체공휴일 포함).
  // 대체공휴일: 설날·추석 연휴는 일요일 또는 다른 공휴일과 겹칠 때,
  // 그 외(삼일절·어린이날·광복절·개천절·한글날·부처님오신날·성탄절)는 토·일요일 또는 다른 공휴일과 겹칠 때
  // 그 다음 첫 번째 평일(공휴일이 아닌 날)을 쉰다. 신정·현충일은 대체하지 않는다.
  function buildHolidays(year) {
    var byDate = Object.create(null);
    function put(date, name, base, rule) {
      (byDate[date] || (byDate[date] = [])).push({ name: name, base: base, rule: rule });
    }
    SOLAR_HOLIDAYS.forEach(function (h) {
      put(year + '-' + h[0], h[1], h[1], h[2] ? 'weekend' : 'none');
    });
    var lunar = LUNAR_HOLIDAYS[year];
    if (lunar) {
      [['설날', lunar[0]], ['추석', lunar[2]]].forEach(function (pair) {
        var day = year + '-' + pair[1];
        put(addDays(day, -1), pair[0] + ' 연휴', pair[0], 'sunday');
        put(day, pair[0], pair[0], 'sunday');
        put(addDays(day, 1), pair[0] + ' 연휴', pair[0], 'sunday');
      });
      put(year + '-' + lunar[1], '부처님오신날', '부처님오신날', 'weekend');
    }
    Object.keys(ELECTION_DAYS).forEach(function (date) {
      if (date.slice(0, 4) === String(year)) put(date, ELECTION_DAYS[date], ELECTION_DAYS[date], 'none');
    });

    var result = Object.create(null);
    Object.keys(byDate).sort().forEach(function (date) {
      var list = byDate[date];
      result[date] = list.map(function (h) { return h.name; }).join(' · ');
      var day = parseDateString(date).getDay();
      var cause = null;
      list.forEach(function (h) {
        if (h.rule === 'weekend' && (day === 0 || day === 6)) cause = cause || h;
        if (h.rule === 'sunday' && day === 0) cause = cause || h;
      });
      if (!cause && list.length > 1) {
        cause = list.filter(function (h) { return h.rule !== 'none'; })[0] || null;
      }
      if (!cause) return;
      var sub = addDays(date, 1);
      while (byDate[sub] || result[sub] || isWeekend(sub)) sub = addDays(sub, 1);
      result[sub] = '대체공휴일(' + cause.base + ')';
    });
    return result;
  }

  // 공휴일 이름 또는 null
  function holidayName(dateStr) {
    var year = Number(dateStr.slice(0, 4));
    if (!holidayCache[year]) holidayCache[year] = buildHolidays(year);
    return holidayCache[year][dateStr] || null;
  }

  // "매주 월요일", "매월 5일", "매년 10월 5일" (+ " · 10월 31일까지")
  function repeatLabel(repeat, dateStr, until) {
    if (repeat === 'none' || !isValidDateString(dateStr)) return REPEATS[repeat] || '';
    var d = parseDateString(dateStr);
    var label = REPEATS[repeat];
    if (repeat === 'weekly') label += ' ' + WEEKDAYS[d.getDay()] + '요일';
    else if (repeat === 'monthly') label += ' ' + d.getDate() + '일';
    else if (repeat === 'yearly') label += ' ' + (d.getMonth() + 1) + '월 ' + d.getDate() + '일';
    if (until) {
      var u = parseDateString(until);
      label += ' · ' + (u.getFullYear() !== d.getFullYear() ? u.getFullYear() + '년 ' : '') +
        (u.getMonth() + 1) + '월 ' + u.getDate() + '일까지';
    }
    return label;
  }

  // "2026-10-05" → "10월 5일 (월)"
  function formatDate(str) {
    var d = parseDateString(str);
    return (d.getMonth() + 1) + '월 ' + d.getDate() + '일 (' + WEEKDAYS[d.getDay()] + ')';
  }

  function formatMonth(year, month) {
    return year + '년 ' + (month + 1) + '월';
  }

  // 같은 밀리초에 여러 개를 만들어도 겹치지 않도록 증가 카운터 + 무작위 6자.
  // 그래도 호출하는 쪽(normalizeItem, addItem)에서 이미 쓰인 id인지 한 번 더 확인한다.
  var idCounter = 0;
  function generateId() {
    idCounter = (idCounter + 1) % 1679616; // 36^4
    return Date.now().toString(36) + '-' + idCounter.toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // ===== 상태 =====
  var today = todayString();
  var state = {
    items: [],
    selectedDate: today,
    viewYear: parseDateString(today).getFullYear(),
    viewMonth: parseDateString(today).getMonth(), // 0~11
    filter: 'all',
    hideCompleted: false,
    listView: 'day',
    editingId: null
  };

  // ===== 데이터 검증 =====
  // 저장소·가져오기 공용. 필수 필드(제목, 날짜)가 없으면 null, 나머지는 기본값으로 보정한다.
  // v1 데이터(type 없음)는 시간이 있으면 일정, 없으면 할 일로 옮긴다.
  function normalizeItem(raw, seenIds) {
    if (!raw || typeof raw !== 'object') return null;
    var title = typeof raw.title === 'string' ? raw.title.trim().slice(0, TITLE_MAX_LENGTH) : '';
    if (!title || !isValidDateString(raw.date)) return null;

    var id = typeof raw.id === 'string' && raw.id ? raw.id : null;
    while (!id || seenIds[id]) id = generateId();
    seenIds[id] = true;
    var createdAt = typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString();
    var type = hasType(raw.type) ? raw.type : (normalizeTime(raw.time) ? 'event' : 'task');
    var time = type === 'event' ? normalizeTime(raw.time) : null;
    var endTime = time ? normalizeTime(raw.endTime) : null;
    if (endTime && endTime <= time) endTime = null;
    var repeat = type === 'event' && hasRepeat(raw.repeat) ? raw.repeat : 'none';
    var repeatUntil = repeat !== 'none' && isValidDateString(raw.repeatUntil) && raw.repeatUntil >= raw.date
      ? raw.repeatUntil : null;

    return {
      id: id,
      type: type,
      title: title,
      category: hasCategory(raw.category) ? raw.category : DEFAULT_CATEGORY,
      date: raw.date,
      time: time,
      endTime: endTime,
      repeat: repeat,
      repeatUntil: repeatUntil,
      priority: cleanPriority(type, raw.priority),
      memo: typeof raw.memo === 'string' ? raw.memo : '',
      completed: type === 'task' && raw.completed === true,
      createdAt: createdAt,
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : createdAt
    };
  }

  function normalizeItems(list) {
    var seenIds = Object.create(null);
    var result = [];
    list.forEach(function (raw) {
      var item = normalizeItem(raw, seenIds);
      if (item) result.push(item);
    });
    return result;
  }

  // { version, items: [...] } 또는 배열 자체를 허용. 그 외는 null.
  function extractItems(data) {
    if (Array.isArray(data)) return data;
    if (data && typeof data === 'object' && Array.isArray(data.items)) return data.items;
    return null;
  }

  // ===== 저장소 =====
  function readStorage(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      console.warn('localStorage를 읽을 수 없습니다.', e);
      return null;
    }
  }

  // 성공하면 true. 용량 초과·저장 차단 등으로 실패하면 false.
  function writeStorage(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (e) {
      console.warn('localStorage에 저장할 수 없습니다.', e);
      return false;
    }
  }

  // 값이 없거나, JSON이 깨졌거나, 형식이 틀리거나, localStorage 접근이 막혀도 빈 배열로 시작한다.
  function loadData() {
    var raw = readStorage(STORAGE_KEY);
    if (!raw) return [];
    try {
      var list = extractItems(JSON.parse(raw));
      return list ? normalizeItems(list) : [];
    } catch (e) {
      console.warn('저장된 데이터가 손상되어 빈 상태로 시작합니다.', e);
      return [];
    }
  }

  // 저장에 실패하면 새로고침 때 변경 내용이 사라지므로 반드시 알린다.
  // 실패가 이어지는 동안에는 한 번만 알리고, 다시 성공하면 초기화한다.
  var saveFailed = false;
  function saveData() {
    var ok = writeStorage(STORAGE_KEY, JSON.stringify({ version: DATA_VERSION, items: state.items }));
    if (!ok && !saveFailed) {
      setStatus('저장하지 못했습니다. 새로고침하면 변경 내용이 사라질 수 있으니 "내보내기"로 백업해 주세요.', true);
    }
    saveFailed = !ok;
  }

  function loadSettings() {
    var raw = readStorage(SETTINGS_KEY);
    if (!raw) return;
    try {
      var s = JSON.parse(raw);
      if (!s || typeof s !== 'object') return;
      state.hideCompleted = s.hideCompleted === true;
      if (LIST_VIEWS.indexOf(s.listView) !== -1) state.listView = s.listView;
    } catch (e) {
      console.warn('설정 데이터가 손상되어 기본값을 사용합니다.', e);
    }
  }

  function saveSettings() {
    writeStorage(SETTINGS_KEY, JSON.stringify({
      hideCompleted: state.hideCompleted,
      listView: state.listView
    }));
  }

  // ===== 상태 변경 =====
  function commit() {
    saveData();
    render();
  }

  function findItem(id) {
    for (var i = 0; i < state.items.length; i++) {
      if (state.items[i].id === id) return state.items[i];
    }
    return null;
  }

  // 입력값 정리. 제목이 비었거나 날짜가 잘못되면 null.
  // 할 일은 시간이 없고, 일정은 시작 시간이 없으면 종일 일정이다.
  function cleanFields(fields) {
    var title = (fields.title || '').trim().slice(0, TITLE_MAX_LENGTH);
    var date = fields.date || state.selectedDate;
    if (!title || !isValidDateString(date)) return null;
    var type = hasType(fields.type) ? fields.type : DEFAULT_TYPE;
    var time = type === 'event' ? normalizeTime(fields.time) : null;
    var endTime = time ? normalizeTime(fields.endTime) : null;
    var repeat = type === 'event' && hasRepeat(fields.repeat) ? fields.repeat : 'none';
    var repeatUntil = repeat !== 'none' && isValidDateString(fields.repeatUntil) && fields.repeatUntil >= date
      ? fields.repeatUntil : null;
    return {
      type: type,
      title: title,
      category: hasCategory(fields.category) ? fields.category : DEFAULT_CATEGORY,
      date: date,
      time: time,
      endTime: endTime && endTime > time ? endTime : null,
      repeat: repeat,
      repeatUntil: repeatUntil,
      priority: cleanPriority(type, fields.priority),
      memo: (fields.memo || '').trim()
    };
  }

  // fields: { type, title, category?, date?, time?, endTime?, repeat?, repeatUntil?, memo? } → 추가된 항목 또는 null
  function addItem(fields) {
    var clean = cleanFields(fields);
    if (!clean) return null;

    var now = new Date().toISOString();
    var id = generateId();
    while (findItem(id)) id = generateId();
    var item = {
      id: id,
      type: clean.type,
      title: clean.title,
      category: clean.category,
      date: clean.date,
      time: clean.time,
      endTime: clean.endTime,
      repeat: clean.repeat,
      repeatUntil: clean.repeatUntil,
      priority: clean.priority,
      memo: clean.memo,
      completed: false,
      createdAt: now,
      updatedAt: now
    };
    state.items.push(item);
    commit();
    return item;
  }

  function updateItem(id, fields) {
    var item = findItem(id);
    var clean = cleanFields(fields);
    if (!item || !clean) return false;

    item.type = clean.type;
    item.title = clean.title;
    item.category = clean.category;
    item.date = clean.date;
    item.time = clean.time;
    item.endTime = clean.endTime;
    item.repeat = clean.repeat;
    item.repeatUntil = clean.repeatUntil;
    item.priority = clean.priority;
    item.memo = clean.memo;
    if (item.type === 'event') item.completed = false; // 일정에는 완료 개념이 없다
    item.updatedAt = new Date().toISOString();
    commit();
    return true;
  }

  function deleteItem(id) {
    var before = state.items.length;
    state.items = state.items.filter(function (item) { return item.id !== id; });
    if (state.items.length !== before) commit();
  }

  // 완료 토글은 가장 잦은 조작이라 목록 전체를 다시 그리지 않는다 (월간 보기는 행이 수천 개일 수 있음).
  // 그 행과 같은 묶음(중요도·날짜) 안의 순서, 캘린더만 고친다. 완료 항목 숨기기 중이면
  // 묶음·빈 상태 문구까지 바뀌므로 전체를 다시 그린다.
  function toggleItem(id) {
    var item = findItem(id);
    if (!item || item.type !== 'task') return;
    item.completed = !item.completed;
    item.updatedAt = new Date().toISOString();
    saveData();
    if (state.hideCompleted || !updateTaskRow(item)) {
      render();
      return;
    }
    renderCalendar(groupByDate(state.items)); // 날짜 칸의 "완료 n개" 읽기용 이름
  }

  // 화면의 그 할 일 행을 새로 만들어 바꾸고, 같은 목록(ul) 안을 다시 정렬한다. 행이 없으면 false.
  function updateTaskRow(item) {
    var old = findRow(item.id);
    if (!old) return false;
    var list = old.parentNode;
    list.replaceChild(createTaskElement(item), old);
    var rows = Array.prototype.slice.call(list.children);
    rows.sort(function (a, b) { return compareTasks(findItem(a.dataset.id), findItem(b.dataset.id)); });
    rows.forEach(function (row) { list.appendChild(row); });
    return true;
  }

  function selectDate(dateStr) {
    var d = parseDateString(dateStr);
    state.selectedDate = dateStr;
    state.viewYear = d.getFullYear();
    state.viewMonth = d.getMonth();
    els.formDate.value = dateStr;
    syncRepeat(els.formPicker); // 날짜가 바뀌면 "매주 ○요일" 문구도 바뀐다
    render();
  }

  function changeMonth(delta) {
    var d = new Date(state.viewYear, state.viewMonth + delta, 1);
    state.viewYear = d.getFullYear();
    state.viewMonth = d.getMonth();
    render();
  }

  // ===== 계산 =====
  function byCreated(a, b) {
    return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
  }

  // 할 일: 중요도(상 → 중 → 하) → 같은 중요도 안에서 미완료 먼저 → 생성순
  function compareTasks(a, b) {
    var pa = PRIORITY_ORDER[a.priority];
    var pb = PRIORITY_ORDER[b.priority];
    if (pa !== pb) return pa - pb;
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    return byCreated(a, b);
  }

  // 일정: 종일 먼저 → 시작 시간순 → 종료 시간순
  function compareEvents(a, b) {
    if (!a.time !== !b.time) return a.time ? 1 : -1;
    if (a.time !== b.time) return a.time < b.time ? -1 : 1;
    if ((a.endTime || '') !== (b.endTime || '')) return (a.endTime || '') < (b.endTime || '') ? -1 : 1;
    return byCreated(a, b);
  }

  function isTask(item) { return item.type === 'task'; }
  function isEvent(item) { return item.type === 'event'; }

  // 이미 끝난 일정 (지난 날짜, 또는 오늘이면서 종료/시작 시간이 지난 일정).
  // 반복 일정은 날짜마다 따로 판단하므로 그 회차의 날짜(dateStr)를 받는다.
  function isPastEvent(item, dateStr, todayStr, nowTime) {
    if (dateStr !== todayStr) return dateStr < todayStr;
    return !!item.time && (item.endTime || item.time) <= nowTime;
  }

  // 렌더 한 번에 한 번만 계산하는 날짜별 묶음. 반복 일정은 따로 모아 두고 itemsOn에서 날짜마다 확인한다.
  function groupByDate(items) {
    var map = Object.create(null);
    var repeating = [];
    items.forEach(function (item) {
      if (item.repeat !== 'none') repeating.push(item);
      else (map[item.date] || (map[item.date] = [])).push(item);
    });
    return { byDate: map, repeating: repeating };
  }

  // dateStr 날짜에 보이는 항목 (반복 일정의 회차 포함)
  function itemsOn(groups, dateStr) {
    var list = groups.byDate[dateStr] || [];
    var extra = groups.repeating.filter(function (item) { return occursOn(item, dateStr); });
    return extra.length ? list.concat(extra) : list;
  }

  // 진행률 기간: 선택한 날짜를 기준으로 하루 / 그 주(일~토) / 그 달 / 전체
  // 선택한 날짜 기준 기간: 목록 보기(하루/주간/월간)에 쓴다.
  function rangeOf(period) {
    var sel = state.selectedDate;
    var d = parseDateString(sel);
    switch (period) {
      case 'week':
        var start = addDays(sel, -d.getDay());
        var end = addDays(start, 6);
        return { start: start, end: end, label: formatDate(start) + ' ~ ' + formatDate(end) };
      case 'month':
        return {
          start: toDateString(new Date(d.getFullYear(), d.getMonth(), 1)),
          end: toDateString(new Date(d.getFullYear(), d.getMonth() + 1, 0)),
          label: formatMonth(d.getFullYear(), d.getMonth())
        };
      default:
        return { start: sel, end: sel, label: formatDate(sel) };
    }
  }

  function countCompleted(items) {
    return items.filter(function (item) { return item.completed; }).length;
  }

  // ===== 시간 선택 (10분 단위) =====
  // 시 select의 빈 값 = 시작: 종일 / 종료: 없음. 분 select는 시가 빈 값이면 비활성.
  function buildTimeSelect(hourSel, minuteSel, emptyLabel) {
    hourSel.appendChild(new Option(emptyLabel, ''));
    for (var h = 0; h < 24; h++) hourSel.appendChild(new Option(pad2(h) + '시', pad2(h)));
    for (var m = 0; m < 60; m += TIME_STEP_MINUTES) minuteSel.appendChild(new Option(pad2(m) + '분', pad2(m)));
    syncMinute(hourSel, minuteSel);
  }

  function syncMinute(hourSel, minuteSel) {
    minuteSel.disabled = !hourSel.value;
  }

  function readTime(hourSel, minuteSel) {
    return hourSel.value ? hourSel.value + ':' + minuteSel.value : null;
  }

  function writeTime(hourSel, minuteSel, value) {
    hourSel.value = value ? value.slice(0, 2) : '';
    minuteSel.value = value ? value.slice(3, 5) : '00';
    syncMinute(hourSel, minuteSel);
  }

  // 새 일정의 기본 시작 시간: 다음 정각 (23시 이후면 23:00)
  function defaultStartTime() {
    return pad2(Math.min(new Date().getHours() + 1, 23)) + ':00';
  }

  // 일정 입력 묶음 하나 (추가 폼, 수정 모달에 하나씩): 시작·종료 시간 + 반복 규칙.
  // dateInput은 그 폼의 날짜 칸 (반복 문구 "매주 월요일"과 반복 종료일 검사에 쓴다).
  function createTimePicker(prefix, dateInput) {
    var p = {
      fields: document.getElementById(prefix + '-time-fields'),
      startHour: document.getElementById(prefix + '-start-hour'),
      startMinute: document.getElementById(prefix + '-start-minute'),
      endHour: document.getElementById(prefix + '-end-hour'),
      endMinute: document.getElementById(prefix + '-end-minute'),
      repeat: document.getElementById(prefix + '-repeat'),
      repeatUntil: document.getElementById(prefix + '-repeat-until'),
      dateInput: dateInput
    };
    buildTimeSelect(p.startHour, p.startMinute, '종일');
    buildTimeSelect(p.endHour, p.endMinute, '없음');
    Object.keys(REPEATS).forEach(function (key) { p.repeat.appendChild(new Option(REPEATS[key], key)); });
    p.fields.addEventListener('change', function () {
      syncMinute(p.startHour, p.startMinute);
      // 종일이면 종료 시간도 의미가 없다
      p.endHour.disabled = !p.startHour.value;
      syncMinute(p.endHour, p.endMinute);
      if (p.endHour.disabled) p.endMinute.disabled = true;
      p.endHour.setCustomValidity('');
      syncRepeat(p);
    });
    dateInput.addEventListener('change', function () { syncRepeat(p); });
    syncRepeat(p);
    return p;
  }

  // 반복 선택지 문구를 날짜에 맞추고("매주 월요일"), 반복 안 함이면 종료일 칸을 끈다
  function syncRepeat(p) {
    Array.prototype.forEach.call(p.repeat.options, function (opt) {
      opt.textContent = repeatLabel(opt.value, p.dateInput.value, null);
    });
    p.repeatUntil.disabled = p.repeat.value === 'none';
    p.repeatUntil.min = p.dateInput.value || '';
    p.repeatUntil.setCustomValidity('');
  }

  function pickerSet(p, start, end, repeat, until) {
    writeTime(p.startHour, p.startMinute, start);
    writeTime(p.endHour, p.endMinute, start ? end : null);
    p.endHour.disabled = !start;
    if (!start) p.endMinute.disabled = true;
    p.endHour.setCustomValidity('');
    p.repeat.value = repeat || 'none';
    p.repeatUntil.value = until || '';
    syncRepeat(p);
  }

  function pickerGet(p) {
    var start = readTime(p.startHour, p.startMinute);
    var repeat = p.repeat.value;
    return {
      time: start,
      endTime: start ? readTime(p.endHour, p.endMinute) : null,
      repeat: repeat,
      repeatUntil: repeat !== 'none' && p.repeatUntil.value ? p.repeatUntil.value : null
    };
  }

  // 종료 시간이 시작보다 늦지 않거나 반복 종료일이 시작 날짜보다 빠르면 해당 칸에 오류를 표시하고 false
  function pickerValidate(p) {
    var t = pickerGet(p);
    var timeOk = !t.time || !t.endTime || t.endTime > t.time;
    p.endHour.setCustomValidity(timeOk ? '' : '종료 시간은 시작 시간보다 늦어야 합니다.');
    if (!timeOk) {
      p.endHour.reportValidity();
      return false;
    }
    var date = p.dateInput.value;
    var untilOk = !t.repeatUntil || !date || t.repeatUntil >= date;
    p.repeatUntil.setCustomValidity(untilOk ? '' : '반복 종료일은 시작 날짜와 같거나 늦어야 합니다.');
    if (!untilOk) p.repeatUntil.reportValidity();
    return untilOk;
  }

  function getCheckedType(name) {
    var checked = document.querySelector('input[name="' + name + '"]:checked');
    return checked ? checked.value : DEFAULT_TYPE;
  }

  function setCheckedType(name, type) {
    var radio = document.querySelector('input[name="' + name + '"][value="' + type + '"]');
    if (radio) radio.checked = true;
  }

  // 추가 폼의 종류(할 일/일정)에 맞게 시간 칸과 안내 문구를 바꾼다
  function applyFormType() {
    var type = getCheckedType('item-type');
    var isEventType = type === 'event';
    els.formPicker.fields.hidden = !isEventType;
    els.formPriority.hidden = isEventType;
    els.titleInput.placeholder = isEventType ? '일정을 입력하세요' : '할 일을 입력하세요';
    if (isEventType && !els.formPicker.startHour.value) pickerSet(els.formPicker, defaultStartTime(), null);
  }

  function applyEditType() {
    var type = getCheckedType('edit-type');
    els.editPicker.fields.hidden = type !== 'event';
    els.editPriorityField.hidden = type !== 'task';
    els.editDialogTitle.textContent = TYPES[type] + ' 수정';
  }

  // ===== 렌더링 =====
  var els = {};

  function cacheElements() {
    [
      ['selectedDateTitle', 'selected-date-title'],
      ['selectedHoliday', 'selected-holiday'],
      ['viewTabs', 'view-tabs'],
      ['form', 'item-form'],
      ['titleInput', 'item-title'],
      ['formCategory', 'item-category'],
      ['formPriority', 'item-priority'],
      ['editPriority', 'edit-priority'],
      ['editPriorityField', 'edit-priority-field'],
      ['formDate', 'item-date'],
      ['formMemo', 'item-memo'],
      ['dayLists', 'day-lists'],
      ['eventList', 'event-list'],
      ['eventEmpty', 'event-empty'],
      ['eventCount', 'event-count'],
      ['taskList', 'task-list'],
      ['taskEmpty', 'task-empty'],
      ['taskCount', 'task-count'],
      ['todayBtn', 'today-btn'],
      ['exportBtn', 'export-btn'],
      ['importBtn', 'import-btn'],
      ['importFile', 'import-file'],
      ['prevMonth', 'prev-month'],
      ['nextMonth', 'next-month'],
      ['monthTitle', 'month-title'],
      ['calendarGrid', 'calendar-grid'],
      ['filterTabs', 'filter-tabs'],
      ['hideCompleted', 'hide-completed'],
      ['status', 'status'],
      ['liveStatus', 'live-status'],
      ['liveAlert', 'live-alert'],
      ['editDialog', 'edit-dialog'],
      ['editDialogTitle', 'edit-dialog-title'],
      ['editForm', 'edit-form'],
      ['editTitle', 'edit-title'],
      ['editCategory', 'edit-category'],
      ['editDate', 'edit-date'],
      ['editMemo', 'edit-memo'],
      ['editCancel', 'edit-cancel']
    ].forEach(function (pair) {
      els[pair[0]] = document.getElementById(pair[1]);
    });
    els.formPicker = createTimePicker('item', els.formDate);
    els.editPicker = createTimePicker('edit', els.editDate);
  }

  function render() {
    var groups = groupByDate(state.items);
    renderCalendar(groups);
    renderDayPanel(groups);
    renderControls();
  }

  function renderCalendar(groups) {
    var y = state.viewYear;
    var m = state.viewMonth;
    var offset = new Date(y, m, 1).getDay();
    var todayStr = todayString();
    var cells = [];
    // 주간 보기면 목록에 나오는 주를 캘린더에서도 표시
    var week = state.listView === 'week' ? rangeOf('week') : null;

    els.monthTitle.textContent = formatMonth(y, m);

    for (var i = 0; i < CALENDAR_CELLS; i++) {
      var d = new Date(y, m, 1 - offset + i);
      var dateStr = toDateString(d);
      var items = itemsOn(groups, dateStr);
      var btn = el('button', 'calendar-day');
      btn.type = 'button';
      btn.dataset.date = dateStr;

      if (d.getMonth() !== m) btn.classList.add('is-other-month');
      if (d.getDay() === 0) btn.classList.add('is-sun');
      if (d.getDay() === 6) btn.classList.add('is-sat');
      var holiday = holidayName(dateStr);
      if (holiday) {
        btn.classList.add('is-holiday');
        btn.title = holiday;
      }
      if (dateStr === todayStr) {
        btn.classList.add('is-today');
        btn.setAttribute('aria-current', 'date');
      }
      if (week && dateStr >= week.start && dateStr <= week.end) btn.classList.add('is-in-range');
      var selected = dateStr === state.selectedDate;
      if (selected) btn.classList.add('is-selected');
      btn.setAttribute('aria-pressed', String(selected));

      var label = (d.getMonth() + 1) + '월 ' + d.getDate() + '일' + (holiday ? ' ' + holiday : '');
      btn.appendChild(el('span', 'day-number', String(d.getDate())));

      if (items.length) {
        var events = items.filter(isEvent).sort(compareEvents);
        var tasks = items.filter(isTask).sort(compareTasks);
        var done = countCompleted(tasks);
        if (events.length) label += ', 일정 ' + events.length + '개';
        if (tasks.length) label += ', 할 일 ' + tasks.length + '개 (완료 ' + done + '개)';
        // 표시: 일정은 막대, 할 일은 점 (일정 먼저)
        var dots = el('span', 'day-dots');
        events.concat(tasks).slice(0, MAX_DOTS).forEach(function (item) {
          // 반복하지 않는 일정은 카테고리와 관계없이 파란색 (dot--once)
          var once = isEvent(item) && item.repeat === 'none';
          dots.appendChild(el('span', 'dot dot--' + item.category + (isEvent(item) ? ' dot--event' : '') + (once ? ' dot--once' : '')));
        });
        if (items.length > MAX_DOTS) {
          dots.appendChild(el('span', 'day-more', '+' + (items.length - MAX_DOTS)));
        }
        btn.appendChild(dots);
      }
      btn.setAttribute('aria-label', label);
      cells.push(btn);
    }
    els.calendarGrid.replaceChildren.apply(els.calendarGrid, cells);
  }

  // 목록 보기 기간의 날짜들 (하루 보기면 선택한 날 하나)
  function viewDates() {
    var range = rangeOf(state.listView);
    var dates = [];
    for (var d = range.start; d <= range.end; d = addDays(d, 1)) dates.push(d);
    return dates;
  }

  // 오른쪽 목록: 하루 / 주간 / 월간. 일정·할 일 구역은 그대로 두고,
  // 주간·월간이면 각 구역 안을 날짜별로 묶는다.
  function renderDayPanel(groups) {
    var view = state.listView;
    var isDay = view === 'day';
    var todayStr = todayString();
    var nowTime = nowTimeString();

    // 제목: 하루면 날짜(+ 오늘, 공휴일), 주간·월간이면 기간
    var title = isDay ? formatDate(state.selectedDate) : rangeOf(view).label;
    if (isDay && state.selectedDate === todayStr) title += ' · 오늘';
    els.selectedDateTitle.textContent = title;
    var holiday = isDay ? holidayName(state.selectedDate) : null;
    els.selectedHoliday.textContent = holiday || '';
    els.selectedHoliday.hidden = !holiday;

    var inFilter = function (item) { return state.filter === 'all' || item.category === state.filter; };
    var days = viewDates().map(function (date) {
      var all = itemsOn(groups, date);
      var shown = all.filter(inFilter);
      var tasks = shown.filter(isTask);
      return {
        date: date,
        allEventCount: all.filter(isEvent).length,
        allTaskCount: all.filter(isTask).length,
        events: shown.filter(isEvent).sort(compareEvents),
        tasks: tasks,
        visibleTasks: (state.hideCompleted
          ? tasks.filter(function (item) { return !item.completed; })
          : tasks.slice()).sort(compareTasks)
      };
    });
    var total = function (fn) { return days.reduce(function (n, day) { return n + fn(day); }, 0); };
    var where = isDay ? '' : view === 'week' ? '이 주에 ' : '이 달에 ';

    // 일정
    renderList(els.eventList, days, 'events', isDay, todayStr, function (item, date) {
      return createEventElement(item, isPastEvent(item, date, todayStr, nowTime));
    });
    var eventCount = total(function (day) { return day.events.length; });
    els.eventCount.textContent = eventCount ? String(eventCount) : '';
    setEmpty(els.eventEmpty, eventCount ? '' :
      total(function (day) { return day.allEventCount; }) ? '이 카테고리에 일정이 없습니다.' : where + '일정이 없습니다.');

    // 할 일
    renderList(els.taskList, days, 'visibleTasks', isDay, todayStr, createTaskElement, true);
    var tasks = [].concat.apply([], days.map(function (day) { return day.tasks; }));
    els.taskCount.textContent = tasks.length ? String(tasks.length) : '';
    var empty = '';
    if (!total(function (day) { return day.allTaskCount; })) empty = where + '할 일이 없습니다.';
    else if (!tasks.length) empty = '이 카테고리에 할 일이 없습니다.';
    else if (!total(function (day) { return day.visibleTasks.length; })) empty = '모든 할 일을 완료했습니다. (완료 항목 숨김 중)';
    setEmpty(els.taskEmpty, empty);
  }

  // 하루 보기는 항목만, 주간·월간은 날짜 머리글 + 항목 묶음. 항목 없는 날은 건너뛴다.
  // 날짜 머리글을 누르면 그 날의 하루 보기로 간다.
  // byPriority: 하루 보기의 할 일은 중요도(상/중/하) 묶음으로 나눈다 (items는 이미 중요도순 정렬).
  function renderList(listEl, days, key, isDay, todayStr, create, byPriority) {
    var nodes = [];
    days.forEach(function (day) {
      var items = day[key];
      if (!items.length) return;
      var rows = items.map(function (item) { return create(item, day.date); });
      if (isDay) {
        nodes.push.apply(nodes, byPriority ? priorityGroups(items, rows) : rows);
        return;
      }
      var head = el('button', 'date-heading');
      head.type = 'button';
      head.dataset.gotoDate = day.date;
      head.appendChild(el('span', 'date-heading-text', formatDate(day.date)));
      if (day.date === todayStr) head.appendChild(el('span', 'date-heading-today', '오늘'));
      var holiday = holidayName(day.date);
      if (holiday) {
        head.classList.add('is-holiday');
        head.appendChild(el('span', 'date-heading-holiday', holiday));
      }
      head.setAttribute('aria-label', formatDate(day.date) + (holiday ? ' ' + holiday : '') + ', 하루 보기로 보기');
      var list = el('ul', 'item-list');
      list.replaceChildren.apply(list, rows);
      var group = el('li', 'date-group');
      group.appendChild(head);
      group.appendChild(list);
      nodes.push(group);
    });
    listEl.replaceChildren.apply(listEl, nodes);
  }

  // 중요도 머리글 + 그 중요도의 할 일 묶음. 할 일이 없는 중요도는 건너뛴다.
  function priorityGroups(items, rows) {
    return Object.keys(PRIORITIES).map(function (key) {
      var groupRows = rows.filter(function (row, i) { return items[i].priority === key; });
      if (!groupRows.length) return null;
      var head = el('h4', 'priority-heading');
      head.appendChild(el('span', 'priority priority--' + key, PRIORITIES[key]));
      head.appendChild(el('span', 'priority-heading-text', '중요도 ' + PRIORITIES[key]));
      head.appendChild(el('span', 'priority-heading-count', String(groupRows.length)));
      var list = el('ul', 'item-list');
      list.replaceChildren.apply(list, groupRows);
      var group = el('li', 'priority-group priority-group--' + key);
      group.appendChild(head);
      group.appendChild(list);
      return group;
    }).filter(Boolean);
  }

  function setEmpty(node, message) {
    node.textContent = message;
    node.hidden = !message;
  }

  // 제목·배지·메모 (할 일/일정 공통). 사용자 입력은 항상 textContent로 넣는다 (XSS 방지).
  function createItemBody(item) {
    var body = el('div', 'item-body');
    var main = el('div', 'item-main');
    if (item.priority) {
      var priority = el('span', 'priority priority--' + item.priority, PRIORITIES[item.priority]);
      priority.setAttribute('aria-label', '중요도 ' + PRIORITIES[item.priority]);
      priority.title = '중요도 ' + PRIORITIES[item.priority];
      main.appendChild(priority);
    }
    main.appendChild(el('span', 'item-title', item.title));
    main.appendChild(el('span', 'badge badge--' + item.category, CATEGORIES[item.category]));
    if (item.repeat !== 'none') {
      var repeat = el('span', 'item-repeat', repeatLabel(item.repeat, item.date, item.repeatUntil));
      repeat.setAttribute('aria-label', '반복: ' + repeat.textContent);
      main.appendChild(repeat);
    }
    body.appendChild(main);
    if (item.memo) body.appendChild(el('p', 'item-memo', item.memo));
    return body;
  }

  function createActions(item) {
    var actions = el('div', 'item-actions');
    actions.appendChild(createIconButton('edit', 'item-edit', '수정', item.title));
    actions.appendChild(createIconButton('delete', 'item-delete', '삭제', item.title));
    return actions;
  }

  function createTaskElement(item) {
    var li = el('li', 'item item--task' + (item.completed ? ' is-completed' : ''));
    li.dataset.id = item.id;

    // 40px 터치 영역을 위해 체크박스를 label로 감싼다
    var checkWrap = el('label', 'item-check-wrap');
    var check = el('input', 'item-check');
    check.type = 'checkbox';
    check.checked = item.completed;
    check.setAttribute('aria-label', item.title + ' 완료');
    checkWrap.appendChild(check);

    li.appendChild(checkWrap);
    li.appendChild(createItemBody(item));
    // 완료한 할 일은 완료 체크(해제)만 할 수 있다. 수정·삭제하려면 먼저 체크를 푼다.
    if (!item.completed) li.appendChild(createActions(item));
    return li;
  }

  // 일정: 체크박스 대신 시간 칸 (종일 / 시작 / 시작–종료)
  function createEventElement(item, isPast) {
    // 반복하지 않는 일정은 파란색(is-once), 반복 일정은 카테고리 색
    var li = el('li', 'item item--event item--' + item.category +
      (item.repeat === 'none' ? ' is-once' : ' is-repeating') + (isPast ? ' is-past' : ''));
    li.dataset.id = item.id;

    var when = el('div', 'event-time');
    if (item.time) {
      when.appendChild(el('span', 'event-start', item.time));
      if (item.endTime) when.appendChild(el('span', 'event-end', item.endTime));
      when.setAttribute('aria-label', item.endTime ? item.time + '부터 ' + item.endTime + '까지' : item.time);
    } else {
      when.appendChild(el('span', 'event-start', '종일'));
    }

    li.appendChild(when);
    li.appendChild(createItemBody(item));
    li.appendChild(createActions(item));
    return li;
  }

  // 아이콘 SVG는 한 번만 해석해 두고 복제한다 (월간 보기처럼 행이 많으면 매번 innerHTML이 크게 느려짐)
  var iconCache = Object.create(null);
  function iconNode(action) {
    if (!iconCache[action]) {
      var tpl = document.createElement('template');
      tpl.innerHTML = ICONS[action];
      iconCache[action] = tpl.content.firstChild;
    }
    return iconCache[action].cloneNode(true);
  }

  function createIconButton(action, className, label, title) {
    var btn = el('button', 'icon-btn ' + className);
    btn.type = 'button';
    btn.dataset.action = action;
    btn.title = label;
    btn.setAttribute('aria-label', title + ' ' + label);
    btn.appendChild(iconNode(action));
    return btn;
  }

  function renderControls() {
    Array.prototype.forEach.call(els.filterTabs.querySelectorAll('[data-filter]'), function (btn) {
      btn.setAttribute('aria-pressed', String(btn.dataset.filter === state.filter));
    });
    Array.prototype.forEach.call(els.viewTabs.querySelectorAll('[data-view]'), function (btn) {
      btn.setAttribute('aria-pressed', String(btn.dataset.view === state.listView));
    });
    els.hideCompleted.checked = state.hideCompleted;
  }

  // 화면 토스트 + 화면 읽기 프로그램용 알림.
  // 토스트는 평소 숨겨져(display: none) 있어 그 자체로는 읽히지 않으므로, 항상 DOM에 있는
  // 별도 영역(#live-status, 오류는 #live-alert)에 같은 문구를 넣는다.
  var statusTimer = null;
  function setStatus(message, isError) {
    // 오류가 떠 있는 동안 일반 안내로 덮어쓰지 않는다 (예: 저장 실패 직후 "추가했습니다")
    if (!isError && !els.status.hidden && els.status.classList.contains('is-error')) return;
    clearTimeout(statusTimer);
    els.status.textContent = message;
    els.status.classList.toggle('is-error', !!isError);
    els.status.hidden = false;
    statusTimer = setTimeout(function () { els.status.hidden = true; }, isError ? 6000 : 3000);

    var live = isError ? els.liveAlert : els.liveStatus;
    els.liveAlert.textContent = '';
    els.liveStatus.textContent = '';
    // 같은 문구가 연달아 와도 다시 읽히도록 비운 뒤 다음 틱에 넣는다
    setTimeout(function () { live.textContent = message; }, 50);
  }

  // ===== 수정 모달 =====
  function openEditDialog(id) {
    var item = findItem(id);
    if (!item) return;
    state.editingId = id;
    setCheckedType('edit-type', item.type);
    els.editTitle.value = item.title;
    els.editCategory.value = item.category;
    els.editPriority.value = item.priority || DEFAULT_PRIORITY;
    els.editDate.value = item.date;
    pickerSet(els.editPicker, item.type === 'event' ? item.time : null, item.endTime, item.repeat, item.repeatUntil);
    els.editMemo.value = item.memo;
    applyEditType();
    els.editDialog.showModal();
    els.editTitle.focus();
  }

  function submitEdit() {
    if (!els.editTitle.value.trim()) {
      els.editTitle.value = '';
      els.editTitle.reportValidity();
      return;
    }
    var type = getCheckedType('edit-type');
    if (type === 'event' && !pickerValidate(els.editPicker)) return;
    var item = findItem(state.editingId);
    var oldDate = item && item.date;
    var times = pickerGet(els.editPicker);
    var ok = updateItem(state.editingId, {
      type: type,
      title: els.editTitle.value,
      category: els.editCategory.value,
      date: els.editDate.value,
      time: times.time,
      endTime: times.endTime,
      repeat: times.repeat,
      repeatUntil: times.repeatUntil,
      priority: els.editPriority.value,
      memo: els.editMemo.value
    });
    if (!ok) {
      els.editDate.reportValidity();
      return;
    }
    els.editDialog.close();
    if (item.date !== oldDate) setStatus(formatDate(item.date) + '로 옮겼습니다.');
  }

  // ===== 백업 =====
  function exportData() {
    var json = JSON.stringify({ version: DATA_VERSION, items: state.items }, null, 2);
    var url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    var a = el('a');
    a.href = url;
    a.download = 'todo-backup-' + todayString() + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    setStatus(state.items.length + '개 항목을 내보냈습니다.');
  }

  // 잘못된 파일이면 기존 데이터는 건드리지 않고 오류만 표시한다.
  function importFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var data;
      try {
        data = JSON.parse(reader.result);
      } catch (e) {
        setStatus('가져오기 실패: JSON 파일이 아닙니다.', true);
        return;
      }
      var list = extractItems(data);
      if (!list) {
        setStatus('가져오기 실패: 할 일 백업 파일 형식이 아닙니다.', true);
        return;
      }
      var items = normalizeItems(list);
      if (list.length && !items.length) {
        setStatus('가져오기 실패: 올바른 할 일 항목이 없습니다.', true);
        return;
      }
      if (!confirm('현재 항목 ' + state.items.length + '개를 파일의 ' + items.length +
          '개로 바꿉니다. 계속할까요?')) return;

      state.items = items;
      commit();
      var skipped = list.length - items.length;
      setStatus(items.length + '개 항목을 가져왔습니다.' + (skipped ? ' (잘못된 항목 ' + skipped + '개 건너뜀)' : ''));
    };
    reader.onerror = function () {
      setStatus('가져오기 실패: 파일을 읽을 수 없습니다.', true);
    };
    reader.readAsText(file);
  }

  // ===== 포커스 이동 (키보드 사용자) =====
  function findRow(id) {
    return id ? els.dayLists.querySelector('.item[data-id="' + CSS.escape(id) + '"]') : null;
  }

  // 같은 구역(일정/할 일)에서 바로 아래(없으면 위) 항목의 id. 주간·월간 보기의 날짜 묶음도 넘나든다.
  function neighborId(row) {
    var rows = Array.prototype.slice.call(row.closest('.list-section').querySelectorAll('.item'));
    var i = rows.indexOf(row);
    var next = rows[i + 1] || rows[i - 1];
    return next ? next.dataset.id : null;
  }

  // 그 항목의 selector 요소로 포커스. 항목이 없거나 그 요소가 없으면 제목 입력칸으로.
  function focusRow(id, selector) {
    var row = findRow(id);
    // 완료한 할 일에는 수정·삭제 버튼이 없으므로 체크박스로
    var target = row && (row.querySelector(selector) || row.querySelector('.item-edit') || row.querySelector('.item-check'));
    (target || els.titleInput).focus();
  }

  // ===== 이벤트 =====
  // 리스너는 초기화 때 한 번만 등록하고, 다시 그려지는 영역은 부모에 위임한다.
  function bindEvents() {
    els.form.addEventListener('change', function (e) {
      if (e.target.name === 'item-type') applyFormType();
    });

    els.form.addEventListener('submit', function (e) {
      e.preventDefault();
      var type = getCheckedType('item-type');
      if (type === 'event' && !pickerValidate(els.formPicker)) return;
      var times = pickerGet(els.formPicker);
      var item = addItem({
        type: type,
        title: els.titleInput.value,
        category: els.formCategory.value,
        date: els.formDate.value,
        time: times.time,
        endTime: times.endTime,
        repeat: times.repeat,
        repeatUntil: times.repeatUntil,
        priority: els.formPriority.value,
        memo: els.formMemo.value
      });
      if (item) {
        els.titleInput.value = '';
        els.formMemo.value = '';
        els.formPriority.value = DEFAULT_PRIORITY;
        if (type === 'event') pickerSet(els.formPicker, defaultStartTime(), null);
        // 추가한 항목이 화면에 안 보이는 경우(다른 날짜, 다른 카테고리 필터)에는 보이게 옮기고 알린다
        var notes = [];
        if (item.date !== state.selectedDate) {
          notes.push(formatDate(item.date) + '에 ' + TYPES[item.type] + '을(를) 추가했습니다');
        }
        if (state.filter !== 'all' && item.category !== state.filter) {
          state.filter = 'all';
          notes.push(CATEGORIES[item.category] + ' 항목이라 필터를 "전체"로 바꿨습니다');
        }
        if (item.date !== state.selectedDate) selectDate(item.date);
        else if (notes.length) render();
        if (notes.length) setStatus(notes.join(' · ') + '.');
      } else {
        els.titleInput.value = els.titleInput.value.trim();
      }
      els.titleInput.focus();
    });

    els.todayBtn.addEventListener('click', function () { selectDate(todayString()); });
    els.prevMonth.addEventListener('click', function () { changeMonth(-1); });
    els.nextMonth.addEventListener('click', function () { changeMonth(1); });

    els.calendarGrid.addEventListener('click', function (e) {
      var btn = e.target.closest('.calendar-day');
      if (btn) selectDate(btn.dataset.date);
    });

    els.filterTabs.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-filter]');
      if (!btn) return;
      state.filter = btn.dataset.filter;
      render();
    });

    els.viewTabs.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-view]');
      if (!btn) return;
      state.listView = btn.dataset.view;
      saveSettings();
      render();
    });

    els.hideCompleted.addEventListener('change', function () {
      state.hideCompleted = els.hideCompleted.checked;
      saveSettings();
      render();
    });

    els.dayLists.addEventListener('change', function (e) {
      if (!e.target.classList.contains('item-check')) return;
      var row = e.target.closest('.item');
      var id = row.dataset.id;
      var fallbackId = neighborId(row);
      toggleItem(id);
      // 다시 그려진 항목에만 체크 애니메이션을 주고, 체크박스로 포커스 복원 (키보드 사용자).
      // 완료 항목 숨기기로 목록에서 빠졌으면 옆 항목으로, 그것도 없으면 제목 입력칸으로.
      var li = findRow(id);
      if (li) {
        li.classList.add('is-just-toggled');
        li.querySelector('.item-check').focus();
      } else {
        focusRow(fallbackId, '.item-check');
      }
    });

    els.dayLists.addEventListener('click', function (e) {
      // 주간·월간 보기의 날짜 머리글 → 그 날의 하루 보기
      var heading = e.target.closest('[data-goto-date]');
      if (heading) {
        state.listView = 'day';
        saveSettings();
        selectDate(heading.dataset.gotoDate);
        els.selectedDateTitle.focus();
        return;
      }
      var btn = e.target.closest('[data-action]');
      if (!btn) return;
      var id = btn.closest('.item').dataset.id;
      if (btn.dataset.action === 'edit') {
        openEditDialog(id);
      } else if (btn.dataset.action === 'delete') {
        var item = findItem(id);
        var question = item && item.repeat !== 'none'
          ? '"' + item.title + '" 반복 일정 전체(' + repeatLabel(item.repeat, item.date, item.repeatUntil) + ')를 삭제할까요?'
          : '"' + (item && item.title) + '"을(를) 삭제할까요?';
        if (item && confirm(question)) {
          var fallbackId = neighborId(btn.closest('.item'));
          deleteItem(id);
          focusRow(fallbackId, '.item-delete'); // 이어서 지우기 쉽도록 옆 항목의 삭제 버튼으로
        }
      }
    });

    els.editForm.addEventListener('change', function (e) {
      if (e.target.name !== 'edit-type') return;
      applyEditType();
      if (getCheckedType('edit-type') === 'event' && !els.editPicker.startHour.value) {
        pickerSet(els.editPicker, defaultStartTime(), null);
      }
    });
    els.editForm.addEventListener('submit', function (e) {
      e.preventDefault();
      submitEdit();
    });
    els.editCancel.addEventListener('click', function () { els.editDialog.close(); });
    // 모달 바깥(배경) 클릭 시 닫기. ESC는 <dialog> 기본 동작.
    // 입력칸에서 글자를 드래그해 배경에서 놓으면 click 대상이 dialog가 되므로,
    // 누른 곳과 뗀 곳이 모두 배경일 때만 닫는다.
    var pressedOnBackdrop = false;
    els.editDialog.addEventListener('pointerdown', function (e) {
      pressedOnBackdrop = e.target === els.editDialog;
    });
    els.editDialog.addEventListener('click', function (e) {
      if (pressedOnBackdrop && e.target === els.editDialog) els.editDialog.close();
      pressedOnBackdrop = false;
    });
    els.editDialog.addEventListener('close', function () {
      var id = state.editingId;
      state.editingId = null;
      var editBtn = id && els.dayLists.querySelector('[data-id="' + CSS.escape(id) + '"] .item-edit');
      if (editBtn) editBtn.focus();
    });

    els.exportBtn.addEventListener('click', exportData);
    els.importBtn.addEventListener('click', function () { els.importFile.click(); });
    els.importFile.addEventListener('change', function () {
      var file = els.importFile.files[0];
      els.importFile.value = ''; // 같은 파일을 다시 선택할 수 있게
      if (file) importFile(file);
    });
  }

  // ===== 초기화 =====
  function init() {
    cacheElements();
    state.items = loadData();
    loadSettings();
    els.formDate.value = state.selectedDate;
    applyFormType();
    bindEvents();
    render();
    registerServiceWorker();
  }

  // 홈 화면에 설치한 앱이 오프라인에서도 열리도록 서비스 워커 등록.
  // 웹 주소(http/https)일 때만 — 파일로 열기(file://)나 Streamlit iframe(about:srcdoc)에서는 건너뛴다.
  function registerServiceWorker() {
    if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
    navigator.serviceWorker.register('sw.js').catch(function (e) {
      console.warn('서비스 워커를 등록하지 못했습니다.', e);
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
