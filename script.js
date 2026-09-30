/* ========================================================
   Study Desk — script.js
   Shared utilities: auth (localStorage-based), storage,
   and small helpers used across login.html, register.html
   and index.html.

   NOTE: There is no real backend here. "Login/Register" works
   fully client-side using the browser's localStorage, so ANY
   visitor can register their own account and log in with it.
   Passwords are only lightly obfuscated (not real encryption) —
   do not reuse this for a production app without a real backend.
   ======================================================== */

const LS_USERS   = 'studydesk_users';
const LS_SESSION = 'studydesk_session';
const LS_DATA_PREFIX = 'studydesk_data_';

/* ---------- basic helpers ---------- */

function validateEmail(email){
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Lightweight, non-cryptographic obfuscation — fine for a demo/local app only.
function hashPass(str){
  let hash = 0;
  for (let i = 0; i < str.length; i++){
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return 'h' + hash.toString(36) + '_' + str.length;
}

function uid(prefix){
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2,7);
}

/* ---------- users & session (backend) ---------- */

const API_URL = '';

async function registerUser(name, email, password) {
  const response = await fetch(`${API_URL}/api/register`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ name, email, password })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Registration failed');
  localStorage.setItem(LS_SESSION, JSON.stringify({ userId: data.id, ts: Date.now() }));
  return data;
}

async function loginUser(email, password) {
  const response = await fetch(`${API_URL}/api/login`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ email, password })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Login failed');
  localStorage.setItem(LS_SESSION, JSON.stringify({ userId: data.id, ts: Date.now() }));
  return data;
}

function getSession(){
  try{
    const s = JSON.parse(localStorage.getItem(LS_SESSION));
    return (s && s.userId) ? s : null;
  }catch(e){ return null; }
}

function clearSession(){
  localStorage.removeItem(LS_SESSION);
}

async function getCurrentUser(){
  const s = getSession();
  if (!s) return null;
  try{
    const response = await fetch(`${API_URL}/api/users/${s.userId}`);
    if (!response.ok) return null;
    return await response.json();
  }catch(e){ return null; }
}

/* ---------- per-user app data ---------- */
/* ---------- per-user app data ---------- */

function seedDataForUser(userId){
  const data = {
    studyReminders: [],
    examReminders: [],
    breakReminders: [],
    timetable: []
  };
  localStorage.setItem(LS_DATA_PREFIX + userId, JSON.stringify(data));
}

function getData(userId){
  try{
    const raw = localStorage.getItem(LS_DATA_PREFIX + userId);
    if (!raw){ seedDataForUser(userId); return getData(userId); }
    const parsed = JSON.parse(raw);
    parsed.studyReminders = parsed.studyReminders || [];
    parsed.examReminders  = parsed.examReminders  || [];
    parsed.breakReminders = parsed.breakReminders || [];
    parsed.timetable      = parsed.timetable      || [];
    return parsed;
  }catch(e){
    seedDataForUser(userId);
    return getData(userId);
  }
}

function saveData(userId, data){
  localStorage.setItem(LS_DATA_PREFIX + userId, JSON.stringify(data));
}

/* ---------- formatting ---------- */

function pad2(n){ return String(n).padStart(2,'0'); }

function formatDateNice(dateStr){
  // dateStr = 'YYYY-MM-DD'
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d)) return dateStr;
  const opts = { day:'numeric', month:'short', year:'numeric' };
  return d.toLocaleDateString('en-IN', opts);
}

function formatTimeNice(timeStr){
  if (!timeStr) return '';
  const [h,m] = timeStr.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = ((h % 12) || 12);
  return `${h12}:${pad2(m)} ${ampm}`;
}

function daysUntil(dateStr){
  const today = new Date(); today.setHours(0,0,0,0);
  const d = new Date(dateStr + 'T00:00:00');
  return Math.round((d - today) / 86400000);
}
/* ---------- NOTIFICATION ---------- */

function showNotification(title, message) {

  console.log("Notification called:", title, message);

  if (!("Notification" in window)) {
    alert(title + "\n" + message);
    return;
  }

  if (Notification.permission === "granted") {

    new Notification(title, {
      body: message,
      icon: "icon.png"
    });

    console.log("✅ Notification sent");
    return;
  }

  if (Notification.permission === "default") {

    Notification.requestPermission().then(function(permission) {

      console.log("Permission:", permission);

      if (permission === "granted") {

        new Notification(title, {
          body: message,
          icon: "icon.png"
        });

      }

    });

    return;
  }

  if (Notification.permission === "denied") {
    console.log("❌ Notification blocked");
  }
}

/* ---------- REMINDER CHECKER (prevents repeat notifications) ---------- */

/**
 * Pratyek reminder array (studyReminders / examReminders / breakReminders)
 * madhle items check karto. Jya reminder chi due date+time nighun geli
 * AANI to ajun "notified" mhanun mark zala nahiye, tyachach notification
 * dakhavto — ekdaach. Notification dakhavल्यavar reminder.notified = true
 * kartो ani data save kartो, jenekarun to punha kadhihi trigger hoणar nahi.
 *
 * Pratyek reminder object madhe he fields asave lagतात:
 *   { id, title, date: 'YYYY-MM-DD', time: 'HH:MM', notified: false, ... }
 *
 * index.html madhun asa call kara (ekda page load zाल्यavar):
 *   setInterval(() => checkAndNotifyReminders(getCurrentUser().id), 30000);
 */
function checkAndNotifyReminders(userId){
  if (!userId) return;

  const data = getData(userId);
  const now = new Date();
  let changed = false;

  const lists = ['studyReminders', 'examReminders', 'breakReminders'];

  lists.forEach(function(listName){
    const list = data[listName] || [];

    list.forEach(function(reminder){
      if (reminder.notified) return;          // aadhich notify zala aahe
      if (!reminder.date) return;

      const dueDateTime = new Date(
        reminder.date + 'T' + (reminder.time || '00:00') + ':00'
      );

      if (isNaN(dueDateTime)) return;

      if (dueDateTime <= now){
        showNotification(
          reminder.title || 'Study Reminder',
          (reminder.subject ? reminder.subject + ' — ' : '') +
          formatDateNice(reminder.date) +
          (reminder.time ? ' ' + formatTimeNice(reminder.time) : '')
        );

        reminder.notified = true;             // ata flag lava
        changed = true;
      }
    });
  });

  if (changed){
    saveData(userId, data);                   // permanently save kara
  }
}