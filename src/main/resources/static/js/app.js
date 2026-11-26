/* =========================================================
   CoVibe Attendance Portal — Application Logic
   - Zero Database (File-Based Storage)
   - Fixed 2 Admins & 4 Client Logins
   - Day Shift (7 AM - 7 PM) & Night Shift (7 PM - 7 AM)
   - Cross-Midnight Night Shift Logout Pairing
   - Column 5: 15 = Face Check-In (First = Login)
               1  = Fingerprint Check-Out (Last = Logout)
   ========================================================= */

(() => {
  'use strict';

  const META_KEY = 'covibe_file_portal_meta_v8';
  const PUNCH_KEY = 'covibe_file_portal_punches_v8';
  const SESS_KEY = 'covibe_file_portal_sess_v8';

  const DEFAULT_ACCOUNTS = [
    { id: 'A1', role: 'ADMIN',  username: 'admin1',  password: 'covibe@2026',  companyCode: 'COVIBE-HQ', companyName: 'CoVibe Admin 1' },
    { id: 'A2', role: 'ADMIN',  username: 'admin2',  password: 'covibe@2027',  companyCode: 'COVIBE-HQ', companyName: 'CoVibe Admin 2' },
    { id: 'C1', role: 'CLIENT', username: 'client1', password: 'client1@2026', companyCode: 'CL-01',     companyName: 'Client Company 1' },
    { id: 'C2', role: 'CLIENT', username: 'client2', password: 'client2@2026', companyCode: 'CL-02',     companyName: 'Client Company 2' },
    { id: 'C3', role: 'CLIENT', username: 'client3', password: 'client3@2026', companyCode: 'CL-03',     companyName: 'Client Company 3' },
    { id: 'C4', role: 'CLIENT', username: 'client4', password: 'client4@2026', companyCode: 'CL-04',     companyName: 'Client Company 4' }
  ];

  const state = {
    currentUser: null,
    accounts: [],
    employees: [],
    punches: [],
    ui: {
      activeTab: 'overview',
      dark: false,
      editingEmpId: null,
      expandedKeys: new Set(),
      page: 1,
      pageSize: 20
    }
  };

  let charts = { daily: null, hourly: null };
  const $ = id => document.getElementById(id);

  function pad(n) { return String(n).padStart(2, '0'); }
  function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
  function formatMins(m) { const x = Math.max(0, Math.round(m)); return `${Math.floor(x / 60)}h ${x % 60}m`; }

  function maskName(name) {
    const c = String(name || '').trim();
    if (!c) return 'Un####n';
    if (c.length <= 2) return c[0] + '####';
    if (c.length === 3) return c.slice(0, 2) + '####';
    return c.slice(0, 2) + '####' + c.slice(-1);
  }

  function isAdmin() { return state.currentUser?.role === 'ADMIN'; }
  function clientScope() { return state.currentUser?.role === 'CLIENT' ? state.currentUser.companyCode : null; }
  function showName(fullName) { return isAdmin() ? fullName : maskName(fullName); }

  function getBioCode(p) {
    const r5 = String(p.rawField5 ?? '').trim();
    if (r5 === '15' || r5 === '1' || r5 === '4') return r5;
    const r3 = String(p.rawField3 ?? '').trim();
    if (r3 === '15' || r3 === '4') return r3;
    return r5 || r3 || '15';
  }
  function getDirection(p) {
    const c = getBioCode(p);
    if (c === '15') return 'IN';
    if (c === '1') return 'OUT';
    if (c === '4') return 'CARD';
    return 'IN';
  }

  function toast(msg, type = 'success') {
    const el = document.createElement('div');
    const cls = type === 'error' ? 'bg-rose-700 text-white' : type === 'warn' ? 'bg-covibe-orange text-white' : type === 'info' ? 'bg-covibe-navy text-white' : 'bg-covibe-teal text-white';
    el.className = `pointer-events-auto px-4 py-2.5 rounded-xl shadow-lg text-xs font-semibold transition ${cls}`;
    el.textContent = msg;
    $('toastContainer').appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 220); }, 3200);
  }

  function saveState() {
    try { localStorage.setItem(META_KEY, JSON.stringify({ accounts: state.accounts, employees: state.employees })); } catch (_) {}
    try { localStorage.setItem(PUNCH_KEY, JSON.stringify(state.punches)); } catch (_) {}
  }

  function saveSession() {
    try {
      if (state.currentUser) localStorage.setItem(SESS_KEY, JSON.stringify({ id: state.currentUser.id }));
      else localStorage.removeItem(SESS_KEY);
    } catch (_) {}
  }

  function loadState() {
    try {
      const m = JSON.parse(localStorage.getItem(META_KEY) || 'null');
      state.accounts = (m && Array.isArray(m.accounts) && m.accounts.length === 6) ? m.accounts : JSON.parse(JSON.stringify(DEFAULT_ACCOUNTS));
      state.employees = (m && Array.isArray(m.employees)) ? m.employees : [];
      const p = JSON.parse(localStorage.getItem(PUNCH_KEY) || 'null');
      state.punches = Array.isArray(p) ? p : [];
      const s = JSON.parse(localStorage.getItem(SESS_KEY) || 'null');
      if (s && s.id) state.currentUser = state.accounts.find(a => a.id === s.id) || null;
    } catch (_) {
      state.accounts = JSON.parse(JSON.stringify(DEFAULT_ACCOUNTS));
      state.employees = [];
      state.punches = [];
    }
  }

  function getClients() { return state.accounts.filter(a => a.role === 'CLIENT'); }
  function getClientMap() { return new Map(state.accounts.map(a => [a.companyCode, a])); }
  function getEmpMap() { return new Map(state.employees.map(e => [e.employeeId, e])); }

  function getScopedPunches(overrideCid = null) {
    const cid = clientScope() || overrideCid;
    if (!cid) return state.punches;
    const em = getEmpMap();
    return state.punches.filter(p => em.get(p.employeeId)?.clientId === cid);
  }

  function prevDateStr(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function computeDaily(overrideCid = null) {
    const em = getEmpMap(), cm = getClientMap();
    const punches = getScopedPunches(overrideCid);
    const byEmp = new Map();
    punches.forEach(p => {
      if (!p.punchTime || p.punchTime.length < 16) return;
      if (!byEmp.has(p.employeeId)) byEmp.set(p.employeeId, []);
      byEmp.get(p.employeeId).push(p);
    });

    const rows = [];
    byEmp.forEach((plist, employeeId) => {
      plist.sort((a, b) => a.punchTime.localeCompare(b.punchTime));
      const sessions = new Map(); // key = shiftDate|shiftType -> { shiftDate, shift, ins:[], outs:[], punches:[] }
      let lastNightKey = null;
      let lastNightInMs = 0;

      const getSession = (sDate, sType) => {
        const k = `${employeeId}|${sDate}|${sType}`;
        if (!sessions.has(k)) sessions.set(k, { key: k, shiftDate: sDate, shift: sType, ins: [], outs: [], punches: [] });
        return sessions.get(k);
      };

      plist.forEach(p => {
        const dir = getDirection(p);
        const dt = new Date(p.punchTime.replace(' ', 'T'));
        if (isNaN(dt)) return;
        const h = dt.getHours();
        const calDate = p.punchTime.slice(0, 10);

        if (dir === 'IN') {
          // Face Check-In (15): 07:00-18:59 -> Day Shift; 19:00-06:59 -> Night Shift
          let sDate, sType;
          if (h >= 7 && h < 19) {
            sDate = calDate; sType = 'Day';
            lastNightKey = null; lastNightInMs = 0;
          } else if (h >= 19) {
            sDate = calDate; sType = 'Night';
            const sess = getSession(sDate, sType);
            lastNightKey = sess.key; lastNightInMs = dt.getTime();
          } else {
            sDate = prevDateStr(calDate); sType = 'Night';
            const sess = getSession(sDate, sType);
            lastNightKey = sess.key; lastNightInMs = dt.getTime();
          }
          const sess = getSession(sDate, sType);
          sess.ins.push(p);
          sess.punches.push(p);
        } else if (dir === 'OUT') {
          // Fingerprint Check-Out (1): pair next-morning checkouts (before 10:00 AM, within 15h) to open Night Shift
          const withinNightWindow = lastNightKey && lastNightInMs && dt.getTime() > lastNightInMs && (dt.getTime() - lastNightInMs) <= 15 * 3600000 && h < 10;
          if (withinNightWindow && sessions.has(lastNightKey)) {
            const sess = sessions.get(lastNightKey);
            sess.outs.push(p); sess.punches.push(p);
          } else if (h < 7) {
            const sess = getSession(prevDateStr(calDate), 'Night');
            sess.outs.push(p); sess.punches.push(p);
          } else {
            const nightKeySameDay = `${employeeId}|${calDate}|Night`;
            const nightSess = sessions.get(nightKeySameDay);
            if (nightSess && nightSess.ins.length && p.punchTime >= nightSess.ins[0].punchTime) {
              nightSess.outs.push(p); nightSess.punches.push(p);
            } else {
              const sess = getSession(calDate, 'Day');
              sess.outs.push(p); sess.punches.push(p);
            }
          }
        } else {
          // RFID Card (4)
          const sDate = h < 7 ? prevDateStr(calDate) : calDate;
          const sType = (h >= 7 && h < 19) ? 'Day' : 'Night';
          getSession(sDate, sType).punches.push(p);
        }
      });

      const emp = em.get(employeeId);
      const dispName = showName(emp ? emp.name : `Employee ${employeeId}`);
      const clId = emp?.clientId || '';
      const clName = emp && cm.get(clId) ? cm.get(clId).companyName : 'Unassigned';

      sessions.forEach(sess => {
        const firstLogin = sess.ins.length ? sess.ins[0].punchTime : null;
        const lastLogout = sess.outs.length ? sess.outs[sess.outs.length - 1].punchTime : null;
        let mins = 0;
        let nextDayLogout = false;
        if (firstLogin && lastLogout) {
          const t1 = new Date(firstLogin.replace(' ', 'T')), t2 = new Date(lastLogout.replace(' ', 'T'));
          if (!isNaN(t1) && !isNaN(t2) && t2 > t1) mins = Math.round((t2 - t1) / 60000);
          nextDayLogout = lastLogout.slice(0, 10) > sess.shiftDate;
        } else if (lastLogout) {
          nextDayLogout = lastLogout.slice(0, 10) > sess.shiftDate;
        }
        rows.push({
          key: sess.key,
          employeeId,
          employeeName: dispName,
          clientId: clId,
          clientName: clName,
          date: sess.shiftDate,
          shift: sess.shift, // 'Day' or 'Night'
          firstLogin,
          lastLogout,
          nextDayLogout,
          inCount: sess.ins.length,
          outCount: sess.outs.length,
          minutes: mins,
          punches: sess.punches
        });
      });
    });

    rows.sort((a, b) => b.date.localeCompare(a.date) || a.shift.localeCompare(b.shift) || a.employeeId.localeCompare(b.employeeId));
    return rows;
  }

  // ==================== RENDER ====================
  function showView() {
    if (!state.currentUser) {
      $('loginScreen').classList.remove('hidden');
      $('appShell').classList.add('hidden');
      if (window.lucide) lucide.createIcons();
      return;
    }
    $('loginScreen').classList.add('hidden');
    $('appShell').classList.remove('hidden');
    renderAll();
  }

  function populateClientSelects() {
    const clients = getClients();
    ['ovClientFilter', 'dClient', 'empFilterClient'].forEach(id => {
      const sel = $(id); if (!sel) return;
      const cur = sel.value;
      sel.innerHTML = `<option value="">${id === 'ovClientFilter' ? 'All 4 Client Companies' : 'All Clients'}</option>` +
        clients.map(c => `<option value="${escapeHtml(c.companyCode)}">${escapeHtml(c.companyName)} (${escapeHtml(c.companyCode)})</option>`).join('');
      sel.value = cur;
    });
    if ($('empClient')) {
      const cur = $('empClient').value;
      $('empClient').innerHTML = `<option value="">Unassigned</option>` +
        clients.map(c => `<option value="${escapeHtml(c.companyCode)}">${escapeHtml(c.companyName)} (${escapeHtml(c.companyCode)})</option>`).join('');
      if (cur) $('empClient').value = cur;
    }
  }

  function syncRoleUI() {
    const admin = isAdmin();
    document.querySelectorAll('.admin-only').forEach(el => el.classList.toggle('hidden', !admin));
    $('empTableWrap').className = `${admin ? 'lg:col-span-2' : 'lg:col-span-3'} bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-4`;
    $('hdrUser').textContent = state.currentUser.username;
    $('hdrCompany').textContent = state.currentUser.companyName;

    if (admin) {
      $('roleBadge').textContent = 'ADMIN';
      $('roleBadge').className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-covibe-teal/25 text-teal-200 border border-covibe-teal/50';
      $('clientBanner').classList.add('hidden');
      $('overviewTitle').textContent = 'CoVibe Attendance Overview';
    } else {
      $('roleBadge').textContent = state.currentUser.companyName.toUpperCase();
      $('roleBadge').className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-covibe-orange text-white';
      $('clientBanner').classList.remove('hidden');
      $('clientBannerText').textContent = `${state.currentUser.companyName} (${state.currentUser.companyCode}) — Read-only portal • Employee names masked as Na####r`;
      $('overviewTitle').textContent = `${state.currentUser.companyName} Attendance`;
      if (state.ui.activeTab === 'upload') switchTab('overview');
    }
  }

  function renderAll() {
    if (!state.currentUser) return;
    populateClientSelects();
    syncRoleUI();
    renderOverview();
    renderDaily();
    renderPunches();
    renderEmployees();
    if (isAdmin()) renderAccounts();
    if (window.lucide) lucide.createIcons();
  }

  function renderOverview() {
    const cid = clientScope() || $('ovClientFilter').value || null;
    const punches = getScopedPunches(cid);
    const daily = computeDaily(cid);
    const faceTotal = punches.filter(p => getDirection(p) === 'IN').length;
    const fpTotal = punches.filter(p => getDirection(p) === 'OUT').length;
    const loginDays = daily.filter(r => r.firstLogin).length;
    const completeDays = daily.filter(r => r.firstLogin && r.lastLogout).length;
    const valid = daily.filter(r => r.minutes > 0);
    const avgM = valid.length ? valid.reduce((s, r) => s + r.minutes, 0) / valid.length : 0;
    const uniqueEmps = new Set(punches.map(p => p.employeeId)).size;

    $('kpiScans').textContent = punches.length.toLocaleString();
    $('kpiScansSub').textContent = `${faceTotal.toLocaleString()} Face IN • ${fpTotal.toLocaleString()} Finger OUT`;
    $('kpiFaceIn').textContent = loginDays.toLocaleString();
    const dayShiftCnt = daily.filter(r => r.shift === 'Day').length;
    const nightShiftCnt = daily.filter(r => r.shift === 'Night').length;
    $('kpiFaceSub').textContent = `${dayShiftCnt.toLocaleString()} Day • ${nightShiftCnt.toLocaleString()} Night shifts`;
    $('kpiFingerOut').textContent = completeDays.toLocaleString();
    $('kpiFingerSub').textContent = `Complete Login + Logout days`;
    $('kpiEmps').textContent = uniqueEmps.toLocaleString();
    $('kpiAvgSpan').textContent = `Avg span: ${formatMins(avgM)}`;

    if (typeof Chart === 'undefined') return;
    const dark = state.ui.dark, txt = dark ? '#cbd5e1' : '#475569', grid = dark ? 'rgba(148,163,184,0.12)' : 'rgba(148,163,184,0.2)';

    const dates = [...new Set(daily.map(r => r.date))].sort().slice(-12);
    if (charts.daily) charts.daily.destroy();
    charts.daily = new Chart($('dailyChart'), {
      type: 'bar',
      data: {
        labels: dates.map(d => d.slice(5)),
        datasets: [
          { label: 'Day Shift (7 AM–7 PM)', data: dates.map(d => daily.filter(r => r.date === d && r.shift === 'Day').length), backgroundColor: '#009098', borderRadius: 5 },
          { label: 'Night Shift (7 PM–7 AM)', data: dates.map(d => daily.filter(r => r.date === d && r.shift === 'Night').length), backgroundColor: '#003058', borderRadius: 5 }
        ]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: txt, boxWidth: 10, font: { size: 11 } } } }, scales: { x: { stacked: true, ticks: { color: txt }, grid: { display: false } }, y: { stacked: true, beginAtZero: true, ticks: { color: txt, precision: 0 }, grid: { color: grid } } } }
    });

    const fBins = new Array(24).fill(0), oBins = new Array(24).fill(0);
    punches.forEach(p => {
      const h = parseInt((p.punchTime || '').slice(11, 13), 10);
      if (!isNaN(h) && h >= 0 && h < 24) { if (getDirection(p) === 'IN') fBins[h]++; else if (getDirection(p) === 'OUT') oBins[h]++; }
    });
    if (charts.hourly) charts.hourly.destroy();
    charts.hourly = new Chart($('hourlyChart'), {
      type: 'line',
      data: {
        labels: fBins.map((_, h) => `${pad(h)}:00`),
        datasets: [
          { label: 'Face Check-In (15)', data: fBins, borderColor: '#009098', backgroundColor: 'rgba(0,144,152,0.16)', fill: true, tension: 0.35, pointRadius: 2 },
          { label: 'Fingerprint Check-Out (1)', data: oBins, borderColor: '#F87800', backgroundColor: 'rgba(248,120,0,0.15)', fill: true, tension: 0.35, pointRadius: 2 }
        ]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: txt, boxWidth: 10, font: { size: 11 } } } }, scales: { x: { ticks: { color: txt, maxTicksLimit: 12, font: { size: 10 } }, grid: { display: false } }, y: { beginAtZero: true, ticks: { color: txt, precision: 0 }, grid: { color: grid } } } }
    });
  }

  function getFilteredDaily() {
    const from = $('dFrom').value, to = $('dTo').value, q = $('dSearch').value.trim().toLowerCase(), cl = clientScope() || $('dClient').value, sh = $('dShift').value;
    return computeDaily(clientScope()).filter(r => {
      if (from && r.date < from) return false;
      if (to && r.date > to) return false;
      if (cl && r.clientId !== cl) return false;
      if (sh && r.shift !== sh) return false;
      if (q && !(r.employeeId.toLowerCase().includes(q) || r.employeeName.toLowerCase().includes(q) || r.clientName.toLowerCase().includes(q))) return false;
      return true;
    });
  }

  function renderDaily() {
    const rows = getFilteredDaily();
    $('dailyCount').textContent = `${rows.length.toLocaleString()} daily attendance rows`;
    if (!rows.length) {
      $('dailyBody').innerHTML = `<tr><td colspan="9" class="px-4 py-10 text-center text-slate-400">No attendance records yet. ${isAdmin() ? 'Upload an eSSL .dat file under Upload & Accounts.' : ''}</td></tr>`;
      return;
    }
    $('dailyBody').innerHTML = rows.slice(0, 300).map(r => {
      const exp = state.ui.expandedKeys.has(r.key);
      const shiftBadge = r.shift === 'Night'
        ? '<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-covibe-navy text-white">Night</span>'
        : '<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-covibe-orangeSoft text-covibe-orangeDark dark:bg-orange-950 dark:text-orange-300">Day</span>';
      const logoutDisp = r.lastLogout
        ? `${escapeHtml(r.lastLogout.slice(11))}${r.nextDayLogout ? ' <span class="text-[10px] px-1 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300">+1d</span>' : ''}`
        : '<span class="text-slate-400">—</span>';
      let html = `<tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer daily-row" data-key="${escapeHtml(r.key)}">
        <td class="px-3.5 py-2.5 font-mono font-semibold text-covibe-navy dark:text-sky-300">${escapeHtml(r.employeeId)}</td>
        <td class="px-3.5 py-2.5 font-semibold">${escapeHtml(r.employeeName)}</td>
        <td class="px-3.5 py-2.5 text-slate-500">${escapeHtml(r.clientName)}</td>
        <td class="px-3.5 py-2.5 font-mono">${escapeHtml(r.date)}</td>
        <td class="px-3.5 py-2.5">${shiftBadge}</td>
        <td class="px-3.5 py-2.5 font-mono font-semibold text-covibe-tealDark dark:text-teal-300">${r.firstLogin ? escapeHtml(r.firstLogin.slice(11)) : '<span class="text-slate-400">—</span>'}</td>
        <td class="px-3.5 py-2.5 font-mono font-semibold text-covibe-orangeDark dark:text-orange-300">${logoutDisp}</td>
        <td class="px-3.5 py-2.5 text-center font-mono"><span class="text-covibe-teal font-bold">${r.inCount}</span> / <span class="text-covibe-orange font-bold">${r.outCount}</span></td>
        <td class="px-3.5 py-2.5 font-bold">${r.minutes > 0 ? formatMins(r.minutes) : '—'}</td>
      </tr>`;
      if (exp) {
        const tl = r.punches.map(p => {
          const d = getDirection(p);
          return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-white dark:bg-slate-900 border ${d==='IN'?'border-covibe-teal/50 text-covibe-tealDark':d==='OUT'?'border-covibe-orange/50 text-covibe-orangeDark':'border-slate-300 text-slate-600'} text-[11px] font-mono"><strong>${d==='IN'?'Face 15':d==='OUT'?'Finger 1':'Card 4'}</strong> ${escapeHtml(p.punchTime)}</span>`;
        }).join('');
        html += `<tr class="bg-slate-50 dark:bg-slate-950/60"><td colspan="9" class="px-4 py-3"><div class="flex flex-wrap gap-1.5 items-center"><span class="text-[11px] font-bold text-slate-500 mr-1">${r.shift} Shift Scans:</span>${tl}</div></td></tr>`;
      }
      return html;
    }).join('');
  }

  function getFilteredPunches() {
    const em = getEmpMap(), q = $('pSearch').value.trim().toLowerCase(), from = $('pFrom').value, to = $('pTo').value, mode = $('pMode').value;
    return getScopedPunches().filter(p => {
      const nm = showName(em.get(p.employeeId)?.name || '').toLowerCase();
      if (q && !(p.employeeId.toLowerCase().includes(q) || nm.includes(q))) return false;
      const d = (p.punchTime || '').slice(0, 10);
      if (from && d < from) return false;
      if (to && d > to) return false;
      if (mode && getBioCode(p) !== mode) return false;
      return true;
    }).sort((a, b) => b.punchTime.localeCompare(a.punchTime));
  }

  function renderPunches() {
    const em = getEmpMap(), cm = getClientMap(), list = getFilteredPunches();
    const totalPages = Math.max(1, Math.ceil(list.length / state.ui.pageSize));
    if (state.ui.page > totalPages) state.ui.page = totalPages;
    const rows = list.slice((state.ui.page - 1) * state.ui.pageSize, state.ui.page * state.ui.pageSize);
    $('punchCount').textContent = `${list.length.toLocaleString()} matching scans`;
    $('pageInfo').textContent = `Page ${state.ui.page} / ${totalPages}`;
    $('btnPrevPage').disabled = state.ui.page <= 1;
    $('btnNextPage').disabled = state.ui.page >= totalPages;

    $('punchBody').innerHTML = rows.map(p => {
      const emp = em.get(p.employeeId), d = getDirection(p);
      const badge = d === 'IN' ? '<span class="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-covibe-tealSoft text-covibe-tealDark">Face (15) • Check-In</span>'
        : d === 'OUT' ? '<span class="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-covibe-orangeSoft text-covibe-orangeDark">Fingerprint (1) • Check-Out</span>'
        : '<span class="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-700">RFID Card (4)</span>';
      return `<tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50">
        <td class="px-3.5 py-2.5 font-mono font-semibold text-covibe-navy dark:text-sky-300">${escapeHtml(p.employeeId)}</td>
        <td class="px-3.5 py-2.5 font-medium">${escapeHtml(showName(emp ? emp.name : 'Employee ' + p.employeeId))}</td>
        <td class="px-3.5 py-2.5 text-slate-500">${escapeHtml(emp && cm.get(emp.clientId) ? cm.get(emp.clientId).companyName : 'Unassigned')}</td>
        <td class="px-3.5 py-2.5 font-mono">${escapeHtml(p.punchTime)}</td>
        <td class="px-3.5 py-2.5">${badge}</td>
        <td class="px-3.5 py-2.5 text-slate-500 truncate max-w-[160px]">${escapeHtml(p.sourceFile || 'uploaded')}</td>
      </tr>`;
    }).join('') || `<tr><td colspan="6" class="px-4 py-10 text-center text-slate-400">No punch logs found.</td></tr>`;
  }

  function renderEmployees() {
    const q = $('empSearch').value.trim().toLowerCase(), cid = clientScope() || $('empFilterClient').value;
    const cm = getClientMap(), admin = isAdmin();
    const list = state.employees.filter(e => {
      if (cid && e.clientId !== cid) return false;
      if (q && !(e.employeeId.toLowerCase().includes(q) || showName(e.name).toLowerCase().includes(q))) return false;
      return true;
    }).sort((a, b) => a.employeeId.localeCompare(b.employeeId));

    $('empCount').textContent = `${list.length} employees`;
    $('empBody').innerHTML = list.map(e => `
      <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50">
        <td class="px-3.5 py-2.5 font-mono font-semibold text-covibe-navy dark:text-sky-300">${escapeHtml(e.employeeId)}</td>
        <td class="px-3.5 py-2.5 font-semibold">${escapeHtml(showName(e.name))}</td>
        <td class="px-3.5 py-2.5 font-mono font-semibold text-covibe-orangeDark">${escapeHtml(maskName(e.name))}</td>
        <td class="px-3.5 py-2.5 text-slate-600 dark:text-slate-300">${escapeHtml(cm.get(e.clientId)?.companyName || 'Unassigned')}</td>
        <td class="px-3.5 py-2.5 text-right whitespace-nowrap ${admin ? '' : 'hidden'}">
          <button class="btn-ed-emp px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 mr-1" data-id="${escapeHtml(e.employeeId)}">Edit</button>
          <button class="btn-dl-emp px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-rose-50 text-rose-600" data-id="${escapeHtml(e.employeeId)}">Del</button>
        </td>
      </tr>`).join('') || `<tr><td colspan="5" class="px-4 py-10 text-center text-slate-400">No employees yet.</td></tr>`;
  }

  function renderAccounts() {
    $('accountsBody').innerHTML = state.accounts.map(a => `
      <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/40">
        <td class="px-3.5 py-2.5"><span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${a.role==='ADMIN'?'bg-covibe-navy text-white':'bg-covibe-orangeSoft text-covibe-orangeDark'}">${a.role}</span></td>
        <td class="px-3.5 py-2.5 font-mono font-bold">${escapeHtml(a.username)}</td>
        <td class="px-3.5 py-2.5"><input type="text" value="${escapeHtml(a.password)}" data-id="${a.id}" data-f="password" class="acc-inp px-2.5 py-1 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 w-36" /></td>
        <td class="px-3.5 py-2.5 font-mono text-slate-500">${escapeHtml(a.companyCode)}</td>
        <td class="px-3.5 py-2.5"><input type="text" value="${escapeHtml(a.companyName)}" data-id="${a.id}" data-f="companyName" class="acc-inp px-2.5 py-1 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 w-48" /></td>
        <td class="px-3.5 py-2.5 text-right"><button class="btn-save-acc px-3 py-1 rounded-lg text-[11px] font-bold bg-covibe-teal text-white" data-id="${a.id}">Save</button></td>
      </tr>`).join('');
  }

  // ==================== FILE PARSERS ====================
  function importAttendanceText(text, filename) {
    const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
    const existing = new Set(state.punches.map(p => `${p.employeeId}|${p.punchTime}|${p.rawField5}`));
    let added = 0, dupes = 0;
    const trimmed = text.trim();

    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      const parsed = JSON.parse(trimmed);
      const arr = Array.isArray(parsed) ? parsed : (parsed.punches || []);
      arr.forEach(r => {
        const eid = String(r.employeeId || r.EmployeeID || '').trim();
        const tm = String(r.punchTime || r.PunchTime || '').trim().replace('T', ' ');
        const r5 = String(r.rawField5 ?? r.RawField5 ?? '15').trim();
        if (!eid || !/\d{4}-\d{2}-\d{2}/.test(tm)) return;
        const k = `${eid}|${tm}|${r5}`;
        if (existing.has(k)) { dupes++; return; }
        existing.add(k);
        state.punches.push({ employeeId: eid, punchTime: tm, rawField3: '1', rawField4: '255', rawField5: r5, rawField6: '0', sourceFile: filename });
        added++;
      });
    } else {
      lines.forEach(line => {
        const cols = line.trim().split(/[\t,;]+/).map(s => s.trim().replace(/^"|"$/g, ''));
        if (cols.length < 2) return;
        const eid = cols[0], tm = cols[1].replace('T', ' ');
        if (!eid || !/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(tm)) return;
        const fullTm = tm.length === 16 ? tm + ':00' : tm;
        const r3 = cols[2] || '1', r4 = cols[3] || '255', r5 = cols[4] || '15', r6 = cols[5] || '0';
        const k = `${eid}|${fullTm}|${r5}`;
        if (existing.has(k)) { dupes++; return; }
        existing.add(k);
        state.punches.push({ employeeId: eid, punchTime: fullTm, rawField3: r3, rawField4: r4, rawField5: r5, rawField6: r6, sourceFile: filename });
        added++;
      });
    }

    // Auto-create placeholder employees for new IDs
    const em = getEmpMap();
    const defCl = getClients()[0]?.companyCode || 'CL-01';
    let placeholders = 0;
    state.punches.forEach(p => {
      if (!em.has(p.employeeId)) {
        const ne = { employeeId: p.employeeId, name: `Employee ${p.employeeId}`, clientId: defCl, department: '' };
        state.employees.push(ne); em.set(p.employeeId, ne); placeholders++;
      }
    });

    saveState();
    renderAll();
    toast(`Imported ${added.toLocaleString()} punches (${dupes.toLocaleString()} duplicates skipped).`);
  }

  function handleAttendanceUpload(file) {
    if (!isAdmin() || !file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'xlsx' || ext === 'xls') {
      const r = new FileReader();
      r.onload = e => {
        try {
          const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
          const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
          importAttendanceText(JSON.stringify(rows), file.name);
        } catch (err) { toast('Excel error: ' + err.message, 'error'); }
      };
      r.readAsArrayBuffer(file);
      return;
    }
    const r = new FileReader();
    r.onload = e => { try { importAttendanceText(e.target.result, file.name); } catch (err) { toast('Import error: ' + err.message, 'error'); } };
    r.readAsText(file);
  }

  function parseBinaryUserDat(buf, filename) {
    const bytes = new Uint8Array(buf);
    let str = '';
    for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
    const re = /[ -~]{2,}/g, tokens = [];
    let m;
    while ((m = re.exec(str)) !== null) tokens.push({ offset: m.index, value: m[0].trim() });
    const looksId = s => /^[A-Z0-9][A-Z0-9_-]{0,39}$/i.test(s) && /\d/.test(s);
    const looksName = s => /^[A-Z][A-Z .'_-]{1,60}$/i.test(s) && !/\d/.test(s);
    const em = getEmpMap(), defCl = getClients()[0]?.companyCode || 'CL-01';
    let added = 0, updated = 0;
    for (let i = 0; i < tokens.length; i++) {
      if (!looksId(tokens[i].value)) continue;
      let nmTok = null;
      for (let j = i - 1; j >= 0; j--) {
        const dist = tokens[i].offset - tokens[j].offset;
        if (dist > 45) break;
        if (dist > 0 && looksName(tokens[j].value)) { nmTok = tokens[j]; break; }
      }
      if (!nmTok) continue;
      const pin = tokens[i].value, nm = nmTok.value;
      if (em.has(pin)) { em.get(pin).name = nm; updated++; }
      else { const ne = { employeeId: pin, name: nm, clientId: defCl, department: '' }; state.employees.push(ne); em.set(pin, ne); added++; }
    }
    saveState(); renderAll();
    toast(added || updated ? `Users imported: ${added} added, ${updated} updated.` : 'No ID/name pairs found in file.', added || updated ? 'success' : 'warn');
  }

  function handleUserUpload(file) {
    if (!isAdmin() || !file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    const mergeRows = rows => {
      if (!rows.length) { toast('Empty user file.', 'warn'); return; }
      const keys = Object.keys(rows[0]);
      const idK = keys.find(k => /id|pin|code/i.test(k)) || keys[0];
      const nmK = keys.find(k => /name/i.test(k)) || keys[1];
      const clK = keys.find(k => /client|company/i.test(k));
      const em = getEmpMap(), defCl = getClients()[0]?.companyCode || 'CL-01';
      let added = 0, updated = 0;
      rows.forEach(r => {
        const eid = String(r[idK] ?? '').trim(), nm = String(r[nmK] ?? '').trim();
        if (!eid || !nm) return;
        const cl = clK ? String(r[clK] ?? '').trim().toUpperCase() : '';
        if (em.has(eid)) { em.get(eid).name = nm; if (cl) em.get(eid).clientId = cl; updated++; }
        else { const ne = { employeeId: eid, name: nm, clientId: cl || defCl, department: '' }; state.employees.push(ne); em.set(eid, ne); added++; }
      });
      saveState(); renderAll();
      toast(`Users imported: ${added} added, ${updated} updated.`);
    };

    if (ext === 'xlsx' || ext === 'xls') {
      const r = new FileReader();
      r.onload = e => { const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' }); mergeRows(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' })); };
      r.readAsArrayBuffer(file); return;
    }
    const r = new FileReader();
    r.onload = e => {
      const bytes = new Uint8Array(e.target.result);
      let hasNull = false;
      for (let i = 0; i < Math.min(bytes.length, 1024); i++) { if (bytes[i] === 0) { hasNull = true; break; } }
      if (hasNull || ext === 'dat') { parseBinaryUserDat(e.target.result, file.name); return; }
      const text = new TextDecoder('utf-8').decode(bytes).trim();
      if (text.startsWith('[')) { mergeRows(JSON.parse(text)); return; }
      const lines = text.split(/\r?\n/).filter(Boolean);
      const sep = lines[0].includes('\t') ? '\t' : ',';
      const hdrs = lines[0].split(sep).map(s => s.trim().replace(/^"|"$/g, ''));
      const rows = lines.slice(1).map(l => { const c = l.split(sep).map(s => s.trim().replace(/^"|"$/g, '')); const o = {}; hdrs.forEach((h, i) => o[h] = c[i] ?? ''); return o; });
      mergeRows(rows);
    };
    r.readAsArrayBuffer(file);
  }

  // ==================== EXPORTERS ====================
  function dlBlob(content, filename, mime) {
    const url = URL.createObjectURL(new Blob([content], { type: mime })), a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function toCsv(rows) {
    const hdrs = Object.keys(rows[0] || { Info: '' });
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    return '\ufeff' + [hdrs.map(esc).join(','), ...rows.map(r => hdrs.map(h => esc(r[h])).join(','))].join('\n');
  }
  function exportXlsx(sheets, fname) {
    const wb = XLSX.utils.book_new();
    Object.entries(sheets).forEach(([k, v]) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(v.length ? v : [{ Info: 'No data' }]), k.slice(0, 31)));
    XLSX.writeFile(wb, fname);
    toast(`Exported ${fname}`);
  }
  function handleExport(type) {
    const daily = getFilteredDaily().map(r => ({
      EmployeeID: r.employeeId, Employee: r.employeeName, Client: r.clientName, Date: r.date, Shift: r.shift,
      Login_FirstFace: r.firstLogin || '', Logout_LastFingerprint: r.lastLogout || '',
      Face_INs: r.inCount, Finger_OUTs: r.outCount, TotalSpan: r.minutes > 0 ? formatMins(r.minutes) : ''
    }));
    const em = getEmpMap();
    const punches = getFilteredPunches().map(p => ({
      EmployeeID: p.employeeId, Employee: showName(em.get(p.employeeId)?.name || 'Employee ' + p.employeeId),
      PunchTime: p.punchTime, Mode: getDirection(p) === 'IN' ? 'Face (15) Check-In' : getDirection(p) === 'OUT' ? 'Fingerprint (1) Check-Out' : 'RFID Card (4)'
    }));
    const emps = state.employees.filter(e => !clientScope() || e.clientId === clientScope()).map(e => ({
      EmployeeID: e.employeeId, Name: showName(e.name), Client: getClientMap().get(e.clientId)?.companyName || 'Unassigned'
    }));

    if (type === 'daily-csv') dlBlob(toCsv(daily), 'covibe-daily-report.csv', 'text/csv;charset=utf-8');
    else if (type === 'daily-xlsx') exportXlsx({ 'Daily Report': daily }, 'covibe-daily-report.xlsx');
    else if (type === 'punches-csv') dlBlob(toCsv(punches), 'covibe-punch-logs.csv', 'text/csv;charset=utf-8');
    else if (type === 'punches-xlsx') exportXlsx({ 'Punch Logs': punches }, 'covibe-punch-logs.xlsx');
    else if (type === 'employees-xlsx') exportXlsx({ 'Employees': emps }, 'covibe-employees.xlsx');
    else if (type === 'full-xlsx') exportXlsx({ 'Daily Report': daily, 'Punch Logs': punches, 'Employees': emps }, 'covibe-attendance-report.xlsx');
  }

  // ==================== EVENTS ====================
  function switchTab(tab) {
    if (!isAdmin() && tab === 'upload') return;
    state.ui.activeTab = tab;
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
    $('tab-' + tab).classList.remove('hidden');
    document.querySelectorAll('.nav-btn').forEach(b => {
      const act = b.dataset.tab === tab, adm = b.classList.contains('admin-only');
      b.className = `nav-btn${adm ? ' admin-only' : ''}${adm && !isAdmin() ? ' hidden' : ''} inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition ${act ? 'bg-covibe-teal text-white shadow-sm' : 'text-slate-200 hover:bg-white/10'}`;
    });
    if (tab === 'overview') renderOverview();
  }

  function wireEvents() {
    $('loginForm').addEventListener('submit', e => {
      e.preventDefault();
      const u = $('loginUsername').value.trim().toLowerCase(), p = $('loginPassword').value;
      const acc = state.accounts.find(a => a.username.toLowerCase() === u && a.password === p);
      if (!acc) { $('loginError').textContent = 'Invalid username or password.'; $('loginError').classList.remove('hidden'); return; }
      $('loginError').classList.add('hidden');
      state.currentUser = acc;
      state.ui.activeTab = 'overview';
      saveSession(); showView();
      toast(`Signed in as ${acc.companyName}`);
    });

    $('btnLogout').addEventListener('click', () => { state.currentUser = null; saveSession(); $('loginForm').reset(); showView(); });
    $('mainNav').addEventListener('click', e => { const b = e.target.closest('.nav-btn'); if (b) switchTab(b.dataset.tab); });
    $('btnTopUpload').addEventListener('click', () => switchTab('upload'));
    $('btnTopExport').addEventListener('click', () => handleExport('full-xlsx'));
    $('btnPrint').addEventListener('click', () => window.print());
    $('ovClientFilter').addEventListener('change', renderOverview);
    $('btnThemeToggle').addEventListener('click', () => { state.ui.dark = !state.ui.dark; document.documentElement.classList.toggle('dark', state.ui.dark); renderOverview(); });
    document.querySelectorAll('[data-export]').forEach(b => b.addEventListener('click', () => handleExport(b.dataset.export)));

    ['dFrom', 'dTo', 'dSearch', 'dClient', 'dShift'].forEach(id => $(id).addEventListener('input', renderDaily));
    $('btnDailyClear').addEventListener('click', () => { ['dFrom', 'dTo', 'dSearch', 'dClient', 'dShift'].forEach(id => $(id).value = ''); renderDaily(); });
    $('dailyBody').addEventListener('click', e => {
      const tr = e.target.closest('.daily-row'); if (!tr) return;
      if (state.ui.expandedKeys.has(tr.dataset.key)) state.ui.expandedKeys.delete(tr.dataset.key); else state.ui.expandedKeys.add(tr.dataset.key);
      renderDaily();
    });

    ['pSearch', 'pFrom', 'pTo', 'pMode'].forEach(id => $(id).addEventListener('input', () => { state.ui.page = 1; renderPunches(); }));
    $('btnPunchClear').addEventListener('click', () => { ['pSearch', 'pFrom', 'pTo', 'pMode'].forEach(id => $(id).value = ''); state.ui.page = 1; renderPunches(); });
    $('btnPrevPage').addEventListener('click', () => { if (state.ui.page > 1) { state.ui.page--; renderPunches(); } });
    $('btnNextPage').addEventListener('click', () => { state.ui.page++; renderPunches(); });

    // Employees
    $('empForm').addEventListener('submit', e => {
      e.preventDefault(); if (!isAdmin()) return;
      const id = $('empId').value.trim(), name = $('empName').value.trim(), clientId = $('empClient').value, department = $('empDept').value.trim();
      if (state.ui.editingEmpId) {
        const ex = state.employees.find(x => x.employeeId === state.ui.editingEmpId);
        if (ex) { ex.name = name; ex.clientId = clientId; ex.department = department; }
      } else {
        if (state.employees.some(x => x.employeeId === id)) { toast('Employee ID already exists.', 'error'); return; }
        state.employees.push({ employeeId: id, name, clientId, department });
      }
      state.ui.editingEmpId = null; $('empForm').reset(); $('empId').disabled = false; $('empFormTitle').textContent = 'Add / Edit Employee';
      saveState(); renderAll(); toast('Employee saved.');
    });
    $('btnResetEmp').addEventListener('click', () => { state.ui.editingEmpId = null; $('empForm').reset(); $('empId').disabled = false; });
    ['empSearch', 'empFilterClient'].forEach(id => $(id).addEventListener('input', renderEmployees));
    $('empBody').addEventListener('click', e => {
      if (!isAdmin()) return;
      const ed = e.target.closest('.btn-ed-emp');
      if (ed) {
        const emp = state.employees.find(x => x.employeeId === ed.dataset.id); if (!emp) return;
        state.ui.editingEmpId = emp.employeeId; $('empId').value = emp.employeeId; $('empId').disabled = true;
        $('empName').value = emp.name; $('empClient').value = emp.clientId || ''; $('empDept').value = emp.department || '';
        $('empFormTitle').textContent = `Edit ${emp.employeeId}`; return;
      }
      const dl = e.target.closest('.btn-dl-emp');
      if (dl) { state.employees = state.employees.filter(x => x.employeeId !== dl.dataset.id); saveState(); renderAll(); toast('Employee removed.'); }
    });
    $('btnGenPlaceholders').addEventListener('click', () => {
      if (!isAdmin()) return;
      const em = getEmpMap(), defCl = getClients()[0]?.companyCode || 'CL-01'; let c = 0;
      [...new Set(state.punches.map(p => p.employeeId))].forEach(id => { if (!em.has(id)) { state.employees.push({ employeeId: id, name: `Employee ${id}`, clientId: defCl, department: '' }); c++; } });
      saveState(); renderAll(); toast(c ? `Created ${c} placeholders.` : 'All IDs already mapped.');
    });

    // File Upload zones (Admin Only)
    $('attFileInput').addEventListener('change', e => { if (e.target.files[0]) handleAttendanceUpload(e.target.files[0]); e.target.value = ''; });
    $('attDropZone').addEventListener('dragover', e => e.preventDefault());
    $('attDropZone').addEventListener('drop', e => { e.preventDefault(); if (e.dataTransfer.files[0]) handleAttendanceUpload(e.dataTransfer.files[0]); });

    $('userFileInput').addEventListener('change', e => { if (e.target.files[0]) handleUserUpload(e.target.files[0]); e.target.value = ''; });
    $('userDropZone').addEventListener('dragover', e => e.preventDefault());
    $('userDropZone').addEventListener('drop', e => { e.preventDefault(); if (e.dataTransfer.files[0]) handleUserUpload(e.dataTransfer.files[0]); });

    // Fixed 2 Admin + 4 Client Account Editor
    $('accountsBody').addEventListener('click', e => {
      const btn = e.target.closest('.btn-save-acc'); if (!btn || !isAdmin()) return;
      const acc = state.accounts.find(a => a.id === btn.dataset.id); if (!acc) return;
      document.querySelectorAll(`.acc-inp[data-id="${acc.id}"]`).forEach(inp => {
        const val = inp.value.trim();
        if (val) acc[inp.dataset.f] = val;
      });
      saveState(); renderAll(); toast(`Updated ${acc.username} (${acc.companyName}).`);
    });

    // Clear Data Modal (Admin Only)
    $('btnClearDataOpen').addEventListener('click', () => { $('clearModal').classList.remove('hidden'); $('clearModal').classList.add('flex'); });
    $('btnCancelClear').addEventListener('click', () => { $('clearModal').classList.add('hidden'); $('clearModal').classList.remove('flex'); });
    $('btnConfirmClear').addEventListener('click', () => {
      if (!isAdmin()) return;
      state.punches = []; saveState();
      $('clearModal').classList.add('hidden'); $('clearModal').classList.remove('flex');
      renderAll(); toast('All punch records cleared.');
    });
  }

  loadState();
  wireEvents();
  showView();
})();
