(() => {
  'use strict';

  const STORAGE_KEY = 'saturday.attendance.v1';
  const UI_KEY = 'saturday.ui.v1';
  const TABS = ['attendance', 'students', 'history'];

  const STATUSES = [
    { id: 'present', short: 'P', label: 'Present' },
    { id: 'late', short: 'L', label: 'Late' },
    { id: 'absent', short: 'A', label: 'Absent' },
    { id: 'excused', short: 'E', label: 'Excused' },
  ];
  const STATUS_IDS = new Set(STATUSES.map((s) => s.id));

  // ---------- Storage (localStorage survives closing the browser and restarting the device) ----------
  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch {
        return false;
      }
    },
  };

  // Ask the browser not to evict our data when disk space runs low
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  // ---------- Helpers ----------
  const $ = (sel) => document.querySelector(sel);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  const sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

  const toDateStr = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const todayStr = () => toDateStr(new Date());
  const parseDate = (s) => {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  };
  const prettyDate = (s) =>
    parseDate(s).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
  const shiftDate = (s, days) => {
    const d = parseDate(s);
    d.setDate(d.getDate() + days);
    return toDateStr(d);
  };

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // ---------- Data ----------
  // Shape: { classes: [{ id, name, students: [{ id, name }] }], records: { classId: { 'YYYY-MM-DD': { studentId: status } } } }
  const emptyData = () => ({ classes: [], records: {} });

  // Keeps only well-formed data so a corrupt save or bad backup file can't break the app
  function sanitize(raw) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.classes)) return null;
    const classes = raw.classes
      .filter((c) => c && typeof c.id === 'string' && typeof c.name === 'string')
      .map((c) => ({
        id: c.id,
        name: c.name,
        students: (Array.isArray(c.students) ? c.students : [])
          .filter((s) => s && typeof s.id === 'string' && typeof s.name === 'string')
          .map((s) => ({ id: s.id, name: s.name })),
      }));

    const records = {};
    const src = raw.records && typeof raw.records === 'object' ? raw.records : {};
    for (const c of classes) {
      const days = src[c.id];
      if (!days || typeof days !== 'object') continue;
      const studentIds = new Set(c.students.map((s) => s.id));
      for (const [day, marks] of Object.entries(days)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !marks || typeof marks !== 'object') continue;
        const clean = {};
        for (const [sid, status] of Object.entries(marks)) {
          if (studentIds.has(sid) && STATUS_IDS.has(status)) clean[sid] = status;
        }
        if (Object.keys(clean).length) (records[c.id] ||= {})[day] = clean;
      }
    }
    return { classes, records };
  }

  // ---------- State ----------
  let data = sanitize(store.get(STORAGE_KEY, null)) || emptyData();
  const savedUi = store.get(UI_KEY, null) || {};
  let selectedId = typeof savedUi.selectedId === 'string' ? savedUi.selectedId : null;
  let tab = TABS.includes(savedUi.tab) ? savedUi.tab : 'attendance';
  let date = todayStr();

  function save() {
    if (!store.set(STORAGE_KEY, data)) toast('⚠️ Could not save. Browser storage is blocked or full.');
  }
  const saveUi = () => store.set(UI_KEY, { selectedId, tab });
  const currentClass = () => data.classes.find((c) => c.id === selectedId) || null;

  // Applies fn to a copy of the marks for the selected date, dropping empty days/classes
  function updateMarks(cls, fn) {
    const days = data.records[cls.id] || {};
    const marks = { ...(days[date] || {}) };
    fn(marks);
    if (Object.keys(marks).length) days[date] = marks;
    else delete days[date];
    if (Object.keys(days).length) data.records[cls.id] = days;
    else delete data.records[cls.id];
    save();
  }

  // ---------- Elements ----------
  const classList = $('#classList');
  const noClasses = $('#noClasses');
  const addClassForm = $('#addClassForm');
  const classInput = $('#classInput');
  const welcome = $('#welcome');
  const classPanel = $('#classPanel');
  const classNameEl = $('#className');
  const tabsEl = $('#tabs');
  const studentCount = $('#studentCount');

  const dateInput = $('#dateInput');
  const dateLabel = $('#dateLabel');
  const rollToolbar = $('#rollToolbar');
  const summary = $('#summary');
  const allPresentBtn = $('#allPresentBtn');
  const clearDayBtn = $('#clearDayBtn');
  const rollList = $('#rollList');
  const rollEmpty = $('#rollEmpty');

  const addStudentForm = $('#addStudentForm');
  const studentInput = $('#studentInput');
  const studentList = $('#studentList');
  const studentsEmpty = $('#studentsEmpty');

  const historyContent = $('#historyContent');
  const historyBody = $('#historyBody');
  const sessionList = $('#sessionList');
  const sessionCount = $('#sessionCount');
  const historyEmpty = $('#historyEmpty');

  const importInput = $('#importInput');
  const toastEl = $('#toast');

  let toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.hidden = true;
    }, 2800);
  }

  // ---------- Rendering ----------
  function countMarks(marks) {
    const counts = { present: 0, late: 0, absent: 0, excused: 0 };
    for (const status of Object.values(marks)) counts[status]++;
    return counts;
  }

  function chip(label, n, kind) {
    const c = el('span', `chip chip-${kind}`);
    c.append(el('strong', '', String(n)), document.createTextNode(` ${label}`));
    return c;
  }

  function renderClasses() {
    classList.replaceChildren(
      ...[...data.classes].sort(byName).map((c) => {
        const b = el('button', 'class-item');
        b.type = 'button';
        b.dataset.id = c.id;
        b.classList.toggle('active', c.id === selectedId);
        if (c.id === selectedId) b.setAttribute('aria-current', 'true');
        b.title = plural(c.students.length, 'student');
        b.append(el('span', 'class-item-name', c.name), el('span', 'pill', String(c.students.length)));
        const li = el('li');
        li.append(b);
        return li;
      })
    );
    noClasses.hidden = data.classes.length > 0;
  }

  function renderAttendance(cls) {
    dateInput.value = date;
    dateLabel.textContent = date === todayStr() ? `${prettyDate(date)} · Today` : prettyDate(date);

    const marks = data.records[cls.id]?.[date] || {};
    const students = [...cls.students].sort(byName);

    rollList.replaceChildren(
      ...students.map((s) => {
        const status = marks[s.id] || '';
        const li = el('li', 'roll-item');
        li.dataset.id = s.id;
        if (status) li.dataset.status = status;

        const group = el('div', 'seg');
        group.setAttribute('role', 'group');
        group.setAttribute('aria-label', `Attendance for ${s.name}`);
        for (const st of STATUSES) {
          const b = el('button', `seg-btn s-${st.id}`);
          b.type = 'button';
          b.dataset.status = st.id;
          b.title = st.label;
          b.setAttribute('aria-pressed', String(status === st.id));
          b.append(el('span', 'full', st.label), el('span', 'short', st.short));
          group.append(b);
        }

        li.append(el('span', 'roll-name', s.name), group);
        return li;
      })
    );

    const counts = countMarks(marks);
    const marked = Object.keys(marks).length;
    summary.replaceChildren(
      ...STATUSES.map((st) => chip(st.label, counts[st.id], st.id)),
      chip('Not marked', students.length - marked, 'unmarked')
    );
    allPresentBtn.disabled = marked === students.length;
    clearDayBtn.disabled = marked === 0;
    rollToolbar.hidden = students.length === 0;
    rollEmpty.hidden = students.length > 0;
  }

  function renderStudents(cls) {
    const students = [...cls.students].sort(byName);
    studentList.replaceChildren(
      ...students.map((s) => {
        const li = el('li', 'student-item');
        li.dataset.id = s.id;
        const rename = el('button', 'ghost small', 'Rename');
        rename.type = 'button';
        rename.dataset.action = 'rename';
        const remove = el('button', 'ghost small danger', 'Remove');
        remove.type = 'button';
        remove.dataset.action = 'remove';
        const actions = el('div', 'row-actions');
        actions.append(rename, remove);
        li.append(el('span', 'student-name', s.name), actions);
        return li;
      })
    );
    studentsEmpty.hidden = students.length > 0;
  }

  function renderHistory(cls) {
    const days = data.records[cls.id] || {};
    const dates = Object.keys(days).sort().reverse();
    const students = [...cls.students].sort(byName);

    historyBody.replaceChildren(
      ...students.map((s) => {
        const counts = { present: 0, late: 0, absent: 0, excused: 0 };
        for (const d of dates) {
          const status = days[d][s.id];
          if (status) counts[status]++;
        }
        const counted = counts.present + counts.late + counts.absent;
        const rate = counted ? Math.round(((counts.present + counts.late) / counted) * 100) : null;

        const tr = el('tr');
        tr.append(el('th', '', s.name));
        for (const st of STATUSES) tr.append(el('td', 'num', String(counts[st.id])));
        tr.append(el('td', 'num rate', rate === null ? '—' : `${rate}%`));
        return tr;
      })
    );

    sessionList.replaceChildren(
      ...dates.map((d) => {
        const counts = countMarks(days[d]);
        const b = el('button', 'session');
        b.type = 'button';
        b.dataset.date = d;
        b.title = 'Open this day';
        b.append(
          el('span', '', prettyDate(d)),
          el('span', 'session-counts', `${counts.present + counts.late} here · ${counts.absent} absent · ${counts.excused} excused`)
        );
        const li = el('li');
        li.append(b);
        return li;
      })
    );
    sessionCount.textContent = `(${dates.length})`;

    historyContent.hidden = dates.length === 0;
    historyEmpty.hidden = dates.length > 0;
  }

  function render() {
    if (!currentClass()) selectedId = data.classes.length ? [...data.classes].sort(byName)[0].id : null;
    saveUi();
    renderClasses();

    const cls = currentClass();
    welcome.hidden = Boolean(cls);
    classPanel.hidden = !cls;
    if (!cls) return;

    classNameEl.textContent = cls.name;
    studentCount.textContent = cls.students.length;
    tabsEl.querySelectorAll('button[data-tab]').forEach((b) => {
      const on = b.dataset.tab === tab;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
    });
    for (const name of TABS) $(`#tab-${name}`).hidden = name !== tab;

    renderAttendance(cls);
    renderStudents(cls);
    renderHistory(cls);
  }

  // ---------- Classes ----------
  addClassForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = classInput.value.trim();
    if (!name) {
      classInput.value = '';
      classInput.focus();
      return;
    }
    if (data.classes.some((c) => sameName(c.name, name))) {
      toast(`A class named "${name}" already exists.`);
      classInput.select();
      return;
    }
    const cls = { id: uid(), name, students: [] };
    data.classes.push(cls);
    selectedId = cls.id;
    tab = 'students';
    save();
    render();
    classInput.value = '';
    studentInput.focus();
  });

  classList.addEventListener('click', (e) => {
    const b = e.target.closest('.class-item');
    if (!b) return;
    selectedId = b.dataset.id;
    render();
  });

  $('#renameClassBtn').addEventListener('click', () => {
    const cls = currentClass();
    if (!cls) return;
    const name = prompt('Rename class', cls.name)?.trim();
    if (!name || name === cls.name) return;
    if (data.classes.some((c) => c !== cls && sameName(c.name, name))) {
      toast(`A class named "${name}" already exists.`);
      return;
    }
    cls.name = name;
    save();
    render();
  });

  $('#deleteClassBtn').addEventListener('click', () => {
    const cls = currentClass();
    if (!cls) return;
    const ok = confirm(
      `Delete the class "${cls.name}"?\n\nThis removes its ${plural(cls.students.length, 'student')} and all of its attendance records. This can't be undone.`
    );
    if (!ok) return;
    data.classes = data.classes.filter((c) => c !== cls);
    delete data.records[cls.id];
    selectedId = null;
    save();
    render();
    toast(`Deleted "${cls.name}".`);
  });

  tabsEl.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (!b) return;
    tab = b.dataset.tab;
    render();
  });

  // ---------- Attendance ----------
  dateInput.addEventListener('change', () => {
    date = dateInput.value || todayStr();
    render();
  });
  $('#prevWeekBtn').addEventListener('click', () => {
    date = shiftDate(date, -7);
    render();
  });
  $('#nextWeekBtn').addEventListener('click', () => {
    date = shiftDate(date, 7);
    render();
  });
  $('#todayBtn').addEventListener('click', () => {
    date = todayStr();
    render();
  });

  rollList.addEventListener('click', (e) => {
    const b = e.target.closest('.seg-btn');
    const cls = currentClass();
    if (!b || !cls) return;
    const sid = b.closest('.roll-item').dataset.id;
    const status = b.dataset.status;
    updateMarks(cls, (marks) => {
      // Clicking the selected status again clears it
      if (marks[sid] === status) delete marks[sid];
      else marks[sid] = status;
    });
    render();
    rollList.querySelector(`.roll-item[data-id="${CSS.escape(sid)}"] .seg-btn[data-status="${status}"]`)?.focus();
  });

  allPresentBtn.addEventListener('click', () => {
    const cls = currentClass();
    if (!cls) return;
    updateMarks(cls, (marks) => {
      for (const s of cls.students) if (!marks[s.id]) marks[s.id] = 'present';
    });
    render();
  });

  clearDayBtn.addEventListener('click', () => {
    const cls = currentClass();
    if (!cls || !confirm(`Clear all attendance marks for ${prettyDate(date)}?`)) return;
    updateMarks(cls, (marks) => {
      for (const k of Object.keys(marks)) delete marks[k];
    });
    render();
  });

  rollEmpty.addEventListener('click', (e) => {
    const b = e.target.closest('[data-goto]');
    if (!b) return;
    tab = b.dataset.goto;
    render();
    studentInput.focus();
  });

  // ---------- Students ----------
  addStudentForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const cls = currentClass();
    if (!cls) return;
    const name = studentInput.value.trim();
    if (!name) {
      studentInput.value = '';
      studentInput.focus();
      return;
    }
    if (cls.students.some((s) => sameName(s.name, name))) {
      toast(`${name} is already in ${cls.name}.`);
      studentInput.select();
      return;
    }
    cls.students.push({ id: uid(), name });
    save();
    render();
    studentInput.value = '';
    studentInput.focus();
  });

  studentList.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-action]');
    const cls = currentClass();
    if (!b || !cls) return;
    const student = cls.students.find((s) => s.id === b.closest('.student-item').dataset.id);
    if (!student) return;

    if (b.dataset.action === 'rename') {
      const name = prompt('Rename student', student.name)?.trim();
      if (!name || name === student.name) return;
      if (cls.students.some((s) => s !== student && sameName(s.name, name))) {
        toast(`${name} is already in ${cls.name}.`);
        return;
      }
      student.name = name;
    } else {
      const ok = confirm(`Remove ${student.name} from ${cls.name}?\n\nTheir attendance history in this class will be deleted too.`);
      if (!ok) return;
      cls.students = cls.students.filter((s) => s !== student);
      const days = data.records[cls.id] || {};
      for (const d of Object.keys(days)) {
        delete days[d][student.id];
        if (!Object.keys(days[d]).length) delete days[d];
      }
      if (!Object.keys(days).length) delete data.records[cls.id];
    }
    save();
    render();
  });

  // ---------- History ----------
  sessionList.addEventListener('click', (e) => {
    const b = e.target.closest('.session');
    if (!b) return;
    date = b.dataset.date;
    tab = 'attendance';
    render();
  });

  // ---------- Backup / reset ----------
  $('#exportBtn').addEventListener('click', () => {
    if (!data.classes.length) {
      toast('Nothing to export yet.');
      return;
    }
    const backup = { app: 'saturday-school-attendance', version: 1, exportedAt: new Date().toISOString(), ...data };
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
    const a = el('a');
    a.href = url;
    a.download = `attendance-backup-${todayStr()}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  $('#importBtn').addEventListener('click', () => importInput.click());

  importInput.addEventListener('change', async () => {
    const file = importInput.files[0];
    importInput.value = '';
    if (!file) return;
    let imported = null;
    try {
      imported = sanitize(JSON.parse(await file.text()));
    } catch {
      /* handled below */
    }
    if (!imported) {
      toast('That file is not a valid attendance backup.');
      return;
    }
    const ok = confirm(
      `Restore this backup (${plural(imported.classes.length, 'class', 'classes')})?\n\nYour current classes, students and attendance will be replaced.`
    );
    if (!ok) return;
    data = imported;
    selectedId = null;
    tab = 'attendance';
    save();
    render();
    toast('Backup restored.');
  });

  $('#resetBtn').addEventListener('click', () => {
    if (!data.classes.length) {
      toast('Nothing to reset. There are no classes yet.');
      return;
    }
    const ok = confirm(
      'Reset the app?\n\nThis permanently deletes ALL classes, students and attendance records. Consider exporting a backup first.'
    );
    if (!ok) return;
    data = emptyData();
    selectedId = null;
    tab = 'attendance';
    save();
    render();
    toast('All data cleared.');
  });

  // Keep multiple open tabs in sync
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY) return;
    data = sanitize(store.get(STORAGE_KEY, null)) || emptyData();
    render();
  });

  // ---------- Init ----------
  render();
})();
