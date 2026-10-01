/* ========================================================
   Study Desk — app.js
   Dashboard logic: reminders CRUD, timetable, notifications.
   All data now comes from / is saved to the BACKEND (Flask API) —
   localStorage is not used (except for the login session).
   Depends on script.js being loaded first (API_URL, getSession,
   getCurrentUser, clearSession, pad2, formatDateNice,
   formatTimeNice, daysUntil).
   ======================================================== */

(async function(){

  /* ---------- guard: must be logged in ---------- */
  const session = getSession();
  if (!session){
    window.location.href = 'login.html';
    return;
  }
  const user = await getCurrentUser();
  if (!user){
    clearSession();
    window.location.href = 'login.html';
    return;
  }

  /* ---------- small API helpers ---------- */
  async function apiGet(path){
    const res = await fetch(API_URL + path);
    if (!res.ok) throw new Error('GET failed: ' + path);
    return res.json();
  }
  async function apiPost(path, body){
    const res = await fetch(API_URL + path, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error('POST failed: ' + path);
    return res.json();
  }
  async function apiPut(path, body){
    const res = await fetch(API_URL + path, {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error('PUT failed: ' + path);
    return res.json();
  }
  async function apiDelete(path){
    const res = await fetch(API_URL + path, { method: 'DELETE' });
    if (!res.ok) throw new Error('DELETE failed: ' + path);
    return res.json();
  }

  function toDateStr(dt){
    return dt.getFullYear() + '-' + pad2(dt.getMonth()+1) + '-' + pad2(dt.getDate());
  }
  function toTimeStr(dt){
    return pad2(dt.getHours()) + ':' + pad2(dt.getMinutes());
  }

  /* ---------- in-memory data (loaded from backend) ---------- */
  let data = {
    studyReminders: [],
    examReminders: [],
    breakReminders: [],
    timetable: []
  };

  async function loadData(){
    const [reminders, timetable, breaks] = await Promise.all([
      apiGet(`/api/reminders?user_id=${user.id}`),
      apiGet(`/api/timetable?user_id=${user.id}`),
      apiGet(`/api/breaks?user_id=${user.id}`)
    ]);

    data.studyReminders = reminders
      .filter(r => r.reminder_type === 'study')
      .map(r => {
        const dt = new Date(r.date_time);
        return {
          id: r.id,
          subject: r.subject,
          date: toDateStr(dt),
          time: toTimeStr(dt),
          repeat: r.repeat_type === 'none' ? 'once' : r.repeat_type,
          notified: !!r.notified,
          lastFired: null
        };
      });

    data.examReminders = reminders
      .filter(r => r.reminder_type === 'exam')
      .map(r => {
        const dt = new Date(r.date_time);
        return {
          id: r.id,
          name: r.title,
          date: toDateStr(dt),
          time: toTimeStr(dt),
          notes: r.notes || '',
          notified: !!r.notified
        };
      });

    data.timetable = timetable.map(t => ({
      id: t.id,
      day: String(t.day),
      start: t.start,
      end: t.end,
      subject: t.subject,
      lastNotifiedDate: t.last_notified_date || ''
    }));

    data.breakReminders = breaks.map(b => ({
      id: b.id,
      label: b.label,
      studyMin: b.studyMin,
      breakMin: b.breakMin,
      phase: b.phase,
      phaseEndAt: new Date(b.phaseEndAt).getTime()
    }));
  }

  const SUBJECT_PALETTE = [
    { bg: 'rgba(255,184,76,0.16)',  fg: '#ffb84c', dot: '#ffb84c' },
    { bg: 'rgba(124,158,255,0.16)', fg: '#7c9eff', dot: '#7c9eff' },
    { bg: 'rgba(110,231,183,0.16)', fg: '#6ee7b7', dot: '#6ee7b7' },
    { bg: 'rgba(255,107,107,0.16)', fg: '#ff6b6b', dot: '#ff6b6b' },
    { bg: 'rgba(200,162,255,0.16)', fg: '#c8a2ff', dot: '#c8a2ff' },
    { bg: 'rgba(255,159,124,0.16)', fg: '#ff9f7c', dot: '#ff9f7c' },
    { bg: 'rgba(124,220,255,0.16)', fg: '#7cdcff', dot: '#7cdcff' },
  ];
  function colorFor(name){
    let h = 0;
    for (let i=0;i<name.length;i++){ h = (h*31 + name.charCodeAt(i)) >>> 0; }
    return SUBJECT_PALETTE[h % SUBJECT_PALETTE.length];
  }

  /* ---------- sidebar identity ---------- */
  document.getElementById('userAvatar').textContent = (user.name || '?').trim().charAt(0).toUpperCase();
  document.getElementById('userName').textContent = user.name;
  document.getElementById('userEmail').textContent = user.email;
  document.getElementById('greetName').textContent = user.name.split(' ')[0];
  document.getElementById('todayLine').textContent = new Date().toLocaleDateString('en-IN', { weekday:'long', day:'numeric', month:'long', year:'numeric' });

  document.getElementById('logoutBtn').addEventListener('click', function(){
    clearSession();
    window.location.href = 'login.html';
  });

  /* ---------- nav / views ---------- */
  const navLinks = document.querySelectorAll('.nav-link');
  const views = document.querySelectorAll('.view');
  navLinks.forEach(link => {
    link.addEventListener('click', function(){
      navLinks.forEach(l => l.classList.remove('active'));
      this.classList.add('active');
      const target = this.dataset.view;
      views.forEach(v => v.classList.toggle('active', v.id === 'view-' + target));
      document.getElementById('appShell').classList.remove('nav-open');
    });
  });

  document.getElementById('hamburgerBtn').addEventListener('click', function(){
    document.getElementById('appShell').classList.toggle('nav-open');
  });
  document.getElementById('navScrim').addEventListener('click', function(){
    document.getElementById('appShell').classList.remove('nav-open');
  });

  /* ---------- browser notification permission ---------- */
  if ('Notification' in window && Notification.permission === 'default'){
    setTimeout(() => { try { Notification.requestPermission(); } catch(e){} }, 800);
  }

  /* ---------- sound alert (needs one user click to unlock audio) ---------- */
  let sharedAudioCtx = null;
  document.addEventListener('click', function initAudio(){
    if (!sharedAudioCtx){
      try{ sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)(); }catch(e){}
    }
  });

  function playAlertSound(){
    try{
      if (!sharedAudioCtx){
        sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (sharedAudioCtx.state === 'suspended'){
        sharedAudioCtx.resume();
      }
      const ctx = sharedAudioCtx;
      const now = ctx.currentTime;
      [0, 0.25].forEach(delay => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.001, now + delay);
        gain.gain.exponentialRampToValueAtTime(0.3, now + delay + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.2);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now + delay);
        osc.stop(now + delay + 0.25);
      });
    }catch(e){ console.log('Sound play failed', e); }
  }

  function showNotification(title, message) {
    console.log("Notification:", title, message);
    playAlertSound();

    if (!('Notification' in window)) {
      alert(title + '\n' + message);
      return;
    }
    if (Notification.permission === 'granted') {
      try { new Notification(title, { body: message, icon: 'icon.png' }); } catch(e){}
      return;
    }
    if (Notification.permission === 'default') {
      Notification.requestPermission().then(function(permission) {
        if (permission === 'granted') {
          new Notification(title, { body: message, icon: 'icon.png' });
        }
      });
    }
  }

  function toast(title, body, kind){
    const stack = document.getElementById('toastStack');
    const el = document.createElement('div');
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.innerHTML = `<strong>${escapeHtml(title)}</strong>${escapeHtml(body)}`;
    stack.appendChild(el);
    setTimeout(() => { el.remove(); }, 7000);
  }

  function escapeHtml(str){
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  /* ---------- generic delete confirm modal ---------- */
  let pendingDelete = null;
  const modal = document.getElementById('confirmModal');
  document.getElementById('cancelDelete').addEventListener('click', () => { modal.classList.remove('show'); pendingDelete = null; });
  document.getElementById('confirmDelete').addEventListener('click', () => {
    if (pendingDelete) pendingDelete();
    modal.classList.remove('show');
    pendingDelete = null;
  });
  function askDelete(fn){
    pendingDelete = fn;
    modal.classList.add('show');
  }

  async function refreshAndRender(){
    await loadData();
    renderAll();
  }

  /* ============================================================
     STUDY REMINDERS
     ============================================================ */
  document.getElementById('studyForm').addEventListener('submit', async function(e){
    e.preventDefault();
    const subject = document.getElementById('studySubject').value.trim();
    const date = document.getElementById('studyDate').value;
    const time = document.getElementById('studyTime').value;
    const repeat = document.getElementById('studyRepeat').value;
    if (!subject || !date || !time) return;

    const repeatType = repeat === 'once' ? 'none' : repeat;

    try{
      await apiPost('/api/reminders', {
        user_id: user.id,
        title: subject,
        subject: subject,
        date_time: `${date}T${time}:00`,
        repeat_type: repeatType,
        reminder_type: 'study'
      });
      this.reset();
      document.getElementById('studyRepeat').value = 'once';
      await refreshAndRender();
    }catch(err){
      toast('Error', "Couldn't add the reminder.", 'warn');
    }
  });

  function renderStudyList(){
    const list = document.getElementById('studyList');
    const items = [...data.studyReminders].sort((a,b) => (a.date+a.time).localeCompare(b.date+b.time));
    document.getElementById('studyCount').textContent = items.length;
    if (!items.length){
      list.innerHTML = `<div class="empty">No study reminders yet. Add one using the form above.</div>`;
      return;
    }
    list.innerHTML = items.map(it => {
      const c = colorFor(it.subject);
      const repLabel = it.repeat === 'daily' ? 'Daily' : it.repeat === 'weekly' ? 'Weekly' : 'Once';
      return `
        <div class="item">
          <div class="item-swatch" style="background:${c.dot}"></div>
          <div class="item-body">
            <div class="item-title">${escapeHtml(it.subject)}</div>
            <div class="item-meta">
              <span>📅 ${formatDateNice(it.date)}</span>
              <span>🕐 ${formatTimeNice(it.time)}</span>
              <span>🔁 ${repLabel}</span>
            </div>
          </div>
          <div class="item-actions">
            <button class="btn-icon" data-del-study="${it.id}" title="Delete">✕</button>
          </div>
        </div>`;
    }).join('');
    list.querySelectorAll('[data-del-study]').forEach(btn => {
      btn.addEventListener('click', function(){
        const id = this.dataset.delStudy;
        askDelete(async () => {
          try{
            await apiDelete(`/api/reminders/${id}`);
            await refreshAndRender();
          }catch(err){ toast('Error', "Couldn't delete.", 'warn'); }
        });
      });
    });
  }

  /* ============================================================
     EXAM REMINDERS
     ============================================================ */
  document.getElementById('examForm').addEventListener('submit', async function(e){
    e.preventDefault();
    const name = document.getElementById('examName').value.trim();
    const date = document.getElementById('examDate').value;
    const time = document.getElementById('examTime').value || '09:00';
    const notes = document.getElementById('examNotes').value.trim();
    if (!name || !date) return;

    try{
      await apiPost('/api/reminders', {
        user_id: user.id,
        title: name,
        subject: name,
        date_time: `${date}T${time}:00`,
        repeat_type: 'none',
        reminder_type: 'exam',
        notes: notes
      });
      this.reset();
      document.getElementById('examTime').value = '09:00';
      await refreshAndRender();
    }catch(err){
      toast('Error', "Couldn't add the exam reminder.", 'warn');
    }
  });

  function examBadge(it){
    const d = daysUntil(it.date);
    if (d < 0) return { text: 'Past', cls: '' };
    if (d === 0) return { text: 'Today!', cls: 'badge-urgent' };
    if (d <= 3) return { text: d + ' days left', cls: 'badge-urgent' };
    if (d <= 7) return { text: d + ' days left', cls: 'badge-soon' };
    return { text: d + ' days left', cls: 'badge-ok' };
  }

  function renderExamList(){
    const list = document.getElementById('examList');
    const items = [...data.examReminders]
      .sort((a,b) => (a.date+a.time).localeCompare(b.date+b.time));

    document.getElementById('examCount').textContent = items.length;

    if (!items.length){
      list.innerHTML = `<div class="empty">No exam reminders yet. Add one using the form above.</div>`;
      return;
    }

    list.innerHTML = items.map(it => {
      const badge = examBadge(it);
      return `
        <div class="item">
          <div class="item-swatch" style="background:#ff6b6b"></div>
          <div class="item-body">
            <div class="item-title">${escapeHtml(it.name)}</div>
            <div class="item-meta">
              <span>📅 ${formatDateNice(it.date)}</span>
              <span>🕐 ${formatTimeNice(it.time)}</span>
              ${it.notes ? `<span>📝 ${escapeHtml(it.notes)}</span>` : ''}
            </div>
          </div>
          <div class="item-actions">
            <span class="badge ${badge.cls}">${badge.text}</span>
            <button class="btn-icon" data-del-exam="${it.id}" title="Delete">✕</button>
          </div>
        </div>
      `;
    }).join('');

    list.querySelectorAll('[data-del-exam]').forEach(btn => {
      btn.addEventListener('click', function(){
        const id = this.dataset.delExam;
        askDelete(async () => {
          try{
            await apiDelete(`/api/reminders/${id}`);
            await refreshAndRender();
          }catch(err){ toast('Error', "Couldn't delete.", 'warn'); }
        });
      });
    });
  }

  /* ============================================================
     BREAK REMINDERS  (study/break cycle)
     ============================================================ */
  document.getElementById('breakForm').addEventListener('submit', async function(e){
    e.preventDefault();
    const label = document.getElementById('breakLabel').value.trim() || 'Break';
    const studyMin = Math.max(5, Number(document.getElementById('breakStudyMin').value) || 50);
    const breakMin = Math.max(1, Number(document.getElementById('breakLenMin').value) || 10);
    const phaseEndAt = new Date(Date.now() + studyMin * 60000).toISOString();

    try{
      await apiPost('/api/breaks', {
        user_id: user.id, label, studyMin, breakMin, phaseEndAt
      });
      this.reset();
      await refreshAndRender();
    }catch(err){
      toast('Error', "Couldn't add the break.", 'warn');
    }
  });

  function renderBreakList(){
    const list = document.getElementById('breakList');
    const items = data.breakReminders;
    document.getElementById('breakCount').textContent = items.length;

    if (!items.length){
      list.innerHTML = `<div class="empty">No break reminders yet. Add one using the form above.</div>`;
      return;
    }

    list.innerHTML = items.map(it => {
      const remainingMin = Math.max(0, Math.ceil((it.phaseEndAt - Date.now()) / 60000));
      const isStudy = it.phase === 'study';
      return `
        <div class="item">
          <div class="item-swatch" style="background:${isStudy ? '#7c9eff' : '#6ee7b7'}"></div>
          <div class="item-body">
            <div class="item-title">${escapeHtml(it.label)}</div>
            <div class="item-meta">
              <span>${isStudy ? '📖 Studying now' : '☕ On a break'}</span>
              <span>⏳ ${remainingMin} min left</span>
              <span>🔁 ${it.studyMin}min study / ${it.breakMin}min break</span>
            </div>
          </div>
          <div class="item-actions">
            <button class="btn-icon" data-del-break="${it.id}" title="Delete">✕</button>
          </div>
        </div>`;
    }).join('');

    list.querySelectorAll('[data-del-break]').forEach(btn => {
      btn.addEventListener('click', function(){
        const id = this.dataset.delBreak;
        askDelete(async () => {
          try{
            await apiDelete(`/api/breaks/${id}`);
            await refreshAndRender();
          }catch(err){ toast('Error', "Couldn't delete.", 'warn'); }
        });
      });
    });
  }

  /* ============================================================
     TIMETABLE
     ============================================================ */
  document.getElementById('timetableForm').addEventListener('submit', async function(e){
    e.preventDefault();
    const day = document.getElementById('ttDay').value;
    const start = document.getElementById('ttStart').value;
    const end = document.getElementById('ttEnd').value;
    const subject = document.getElementById('ttSubject').value.trim();
    if (!subject || !start || !end) return;
    if (end <= start){
      toast('Error', 'End time must be after start time.', 'warn');
      return;
    }

    try{
      await apiPost('/api/timetable', {
        user_id: user.id, day: Number(day), start, end, subject
      });
      this.reset();
      await refreshAndRender();
    }catch(err){
      toast('Error', "Couldn't add the timetable slot.", 'warn');
    }
  });

  const TT_DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];

  function renderTimetable(){
    const grid = document.getElementById('timetableGrid');

    let html = `<thead><tr>
      <th style="text-align:left;padding:8px 10px;border-bottom:1px solid rgba(255,255,255,0.08);">Day</th>
      <th style="text-align:left;padding:8px 10px;border-bottom:1px solid rgba(255,255,255,0.08);">Classes</th>
    </tr></thead><tbody>`;

    for (let d = 0; d < 7; d++){
      const daySlots = data.timetable
        .filter(s => Number(s.day) === d)
        .sort((a,b) => a.start.localeCompare(b.start));

      html += `<tr>
        <td style="padding:10px;vertical-align:top;white-space:nowrap;border-bottom:1px solid rgba(255,255,255,0.06);">${TT_DAYS[d]}</td>
        <td style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,0.06);">`;

      if (!daySlots.length){
        html += `<span style="opacity:.5;">—</span>`;
      } else {
        html += daySlots.map(s => {
          const c = colorFor(s.subject);
          return `<span style="display:inline-flex;align-items:center;gap:6px;background:${c.bg};color:${c.fg};padding:4px 10px;border-radius:8px;margin:3px 6px 3px 0;font-size:12.5px;">
            ${formatTimeNice(s.start)}–${formatTimeNice(s.end)} · ${escapeHtml(s.subject)}
            <button data-del-tt="${s.id}" title="Delete" style="background:none;border:none;color:inherit;cursor:pointer;font-size:11px;opacity:.7;">✕</button>
          </span>`;
        }).join('');
      }

      html += `</td></tr>`;
    }

    html += '</tbody>';
    grid.innerHTML = html;

    grid.querySelectorAll('[data-del-tt]').forEach(btn => {
      btn.addEventListener('click', function(){
        const id = this.dataset.delTt;
        askDelete(async () => {
          try{
            await apiDelete(`/api/timetable/${id}`);
            await refreshAndRender();
          }catch(err){ toast('Error', "Couldn't delete.", 'warn'); }
        });
      });
    });

    const legend = document.getElementById('subjectLegend');
    const subjects = [...new Set(data.timetable.map(s => s.subject))];
    if (!subjects.length){
      legend.innerHTML = '';
    } else {
      legend.innerHTML = subjects.map(sub => {
        const c = colorFor(sub);
        return `<span style="display:inline-flex;align-items:center;gap:6px;background:${c.bg};color:${c.fg};padding:4px 10px;border-radius:999px;margin:3px 6px 3px 0;font-size:12.5px;">
          <span style="width:8px;height:8px;border-radius:50%;background:${c.dot};display:inline-block;"></span>${escapeHtml(sub)}
        </span>`;
      }).join('');
    }
  }

  /* ============================================================
     OVERVIEW
     ============================================================ */
  function renderOverview(){
    document.getElementById('statStudy').textContent = data.studyReminders.length;
    document.getElementById('statExam').textContent = data.examReminders.length;
    document.getElementById('statBreak').textContent = data.breakReminders.length;
    document.getElementById('statSlots').textContent = data.timetable.length;

    const todayList = document.getElementById('todayList');
    const todayCount = document.getElementById('todayCount');

    const today = toDateStr(new Date());

    const todayStudies = data.studyReminders.filter(it => {
      if (it.repeat === 'daily') return it.date <= today;
      if (it.repeat === 'weekly') return it.date <= today;
      return it.date === today;
    });

    if (!todayStudies.length){
      todayCount.textContent = '0';
      todayList.innerHTML = `<div class="empty">No study reminders today.</div>`;
    } else {
      todayCount.textContent = todayStudies.length;
      todayList.innerHTML = todayStudies.map(it => {
        const c = colorFor(it.subject);
        return `
          <div class="item">
            <div class="item-swatch" style="background:${c.dot}"></div>
            <div class="item-body">
              <div class="item-title">${escapeHtml(it.subject)}</div>
              <div class="item-meta">
                <span>📅 ${formatDateNice(it.date)}</span>
                <span>🕐 ${formatTimeNice(it.time)}</span>
              </div>
            </div>
          </div>
        `;
      }).join('');
    }

    const overviewExamList = document.getElementById('overviewExamList');
    const upcomingExams =
      [...data.examReminders]
      .filter(it => daysUntil(it.date) >= 0)
      .sort((a,b) => (a.date+a.time).localeCompare(b.date+b.time))
      .slice(0,5);

    if (!upcomingExams.length){
      overviewExamList.innerHTML = `<div class="empty">No upcoming exams.</div>`;
    } else {
      overviewExamList.innerHTML = upcomingExams.map(it => {
        const badge = examBadge(it);
        return `
          <div class="item">
            <div class="item-swatch" style="background:#ff6b6b"></div>
            <div class="item-body">
              <div class="item-title">${escapeHtml(it.name)}</div>
              <div class="item-meta">
                <span>📅 ${formatDateNice(it.date)}</span>
                <span>🕐 ${formatTimeNice(it.time)}</span>
              </div>
            </div>
            <div class="item-actions">
              <span class="badge ${badge.cls}">${badge.text}</span>
            </div>
          </div>
        `;
      }).join('');
    }
  }

  /* ============================================================
     RENDER ALL
     ============================================================ */
  function renderAll(){
    renderStudyList();
    renderExamList();
    renderOverview();
    renderBreakList();
    renderTimetable();
  }

  /* ========================================================
     AUTOMATIC REMINDER NOTIFICATIONS
     ======================================================== */
  async function checkNotifications() {
    const now = new Date();
    const today = toDateStr(now);
    const currentTime = toTimeStr(now);

    for (const reminder of data.studyReminders) {
      let shouldNotify = false;

      if (reminder.repeat === 'once') {
        shouldNotify = reminder.date === today && reminder.time === currentTime && !reminder.notified;
      } else if (reminder.repeat === 'daily') {
        shouldNotify = reminder.date <= today && reminder.time === currentTime && reminder.lastFired !== today;
      } else if (reminder.repeat === 'weekly') {
        const reminderDate = new Date(reminder.date + 'T00:00:00');
        const currentDate = new Date(today + 'T00:00:00');
        const diffDays = Math.floor((currentDate - reminderDate) / (1000 * 60 * 60 * 24));
        shouldNotify = diffDays >= 0 && diffDays % 7 === 0 && reminder.time === currentTime && reminder.lastFired !== today;
      }

      if (shouldNotify) {
        showNotification('📚 Study Reminder', 'Study time: ' + reminder.subject);
        reminder.lastFired = today;
        if (reminder.repeat === 'once') {
          reminder.notified = true;
          try{ await apiPut(`/api/reminders/${reminder.id}`, { notified: true }); }catch(e){}
        }
      }
    }

    for (const exam of data.examReminders) {
      const shouldNotify = exam.date === today && exam.time === currentTime && !exam.notified;
      if (shouldNotify) {
        showNotification('📝 Exam Reminder', 'Exam: ' + exam.name);
        exam.notified = true;
        try{ await apiPut(`/api/reminders/${exam.id}`, { notified: true }); }catch(e){}
      }
    }

    for (const br of data.breakReminders) {
      if (Date.now() >= br.phaseEndAt) {
        let newPhase, newEndAt;
        if (br.phase === 'study') {
          showNotification('☕ Break Time', br.label + ' — time for a break!');
          newPhase = 'break';
          newEndAt = Date.now() + br.breakMin * 60000;
        } else {
          showNotification('📖 Study Time', br.label + ' — back to studying!');
          newPhase = 'study';
          newEndAt = Date.now() + br.studyMin * 60000;
        }
        br.phase = newPhase;
        br.phaseEndAt = newEndAt;
        try{
          await apiPut(`/api/breaks/${br.id}`, { phase: newPhase, phaseEndAt: new Date(newEndAt).toISOString() });
        }catch(e){}
      }
    }

    // ---- Automatic class reminder based on the timetable ----
    const ttDayIndex = (now.getDay() + 6) % 7; // Monday=0 ... Sunday=6
    for (const slot of data.timetable) {
      if (Number(slot.day) === ttDayIndex && slot.start === currentTime) {
        if (slot.lastNotifiedDate !== today) {
          showNotification('📘 Class Time', slot.subject + ' is starting (' + formatTimeNice(slot.start) + ')');
          slot.lastNotifiedDate = today;
          try{ await apiPut(`/api/timetable/${slot.id}`, { last_notified_date: today }); }catch(e){}
        }
      }
    }

    renderBreakList();
  }

  /* ---------- initial load ---------- */
  await loadData();
  renderAll();

  checkNotifications();
  setInterval(checkNotifications, 15000);

})();