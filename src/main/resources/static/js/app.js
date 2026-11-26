/* CoVibe Attendance Portal Client Application */

(() => {
  'use strict';

  const TOKEN_KEY = 'covibe_auth_token';

  const state = {
    token: null,
    currentUser: null,
    accounts: [],
    employees: [],
    punches: [],
    daily: [],
    ui: {
      activeTab: 'overview',
      dark: false,
      editingEmpId: null,
      expandedKeys: new Set(),
      period: 'all', // all | last-week | custom
      customFrom: '',
      customTo: '',
      dailyLimit: 'all',
      page: 1,
      pageSize: 100
    }
  };

  let charts = { daily: null, hourly: null };
  const $ = id => document.getElementById(id);

  function pad(n) { return String(n).padStart(2, '0'); }
  function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
  function formatMins(m) { const x = Math.max(0, Math.round(m)); return `${Math.floor(x / 60)}h ${x % 60}m`; }
  function isAdmin() { return state.currentUser?.role === 'ADMIN'; }

  function getBioCode(p) {
    const r5 = String(p.rawField5 ?? '').trim();
    if (r5 === '15' || r5 === '1') return r5;
    return '';
  }
  function getDirection(p) {
    const c = getBioCode(p);
    if (c === '15') return 'IN';
    if (c === '1') return 'OUT';
    return '';
  }

  function toast(msg, type = 'success') {
    const el = document.createElement('div');
    const cls = type === 'error' ? 'bg-rose-700 text-white' : type === 'warn' ? 'bg-covibe-orange text-white' : type === 'info' ? 'bg-covibe-navy text-white' : 'bg-covibe-teal text-white';
    el.className = `pointer-events-auto px-4 py-3 rounded-xl shadow-lg text-sm font-semibold transition ${cls}`;
    el.textContent = msg;
    $('toastContainer').appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 220); }, 3400);
  }

  async function api(url, opts = {}) {
    const headers = Object.assign({}, opts.headers || {});
    if (state.token) headers['X-Auth-Token'] = state.token;
    const res = await fetch(url, { ...opts, headers });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      clearSession();
      showView();
      throw new Error(data.message || data.error || 'Session expired. Please sign in.');
    }
    if (!res.ok) {
      throw new Error(data.message || data.error || `Request failed (${res.status})`);
    }
    return data;
  }

  function saveToken(token) {
    state.token = token;
    try {
      if (token) sessionStorage.setItem(TOKEN_KEY, token);
      else sessionStorage.removeItem(TOKEN_KEY);
    } catch (_) {}
  }

  function clearSession() {
    state.token = null;
    state.currentUser = null;
    state.accounts = [];
    state.employees = [];
    state.punches = [];
    state.daily = [];
    saveToken(null);
  }

  async function refreshAllFromServer() {
    if (!state.token || !state.currentUser) return;
    const reqs = [
      api('/api/daily-summary'),
      api('/api/records'),
      api('/api/users')
    ];
    if (isAdmin()) reqs.push(api('/api/auth/accounts'));

    const [daily, punches, employees, accounts] = await Promise.all(reqs);
    state.daily = Array.isArray(daily) ? daily : [];
    // Keep only Check In (15) and Check Out (1); exclude any RFID
    state.punches = (Array.isArray(punches) ? punches : []).filter(p => getDirection(p) === 'IN' || getDirection(p) === 'OUT');
    state.employees = Array.isArray(employees) ? employees : [];
    if (isAdmin() && Array.isArray(accounts)) state.accounts = accounts;
    renderAll();
  }

  function getClients() {
    return state.accounts.filter(a => a.role === 'CLIENT');
  }

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
      sel.innerHTML = `<option value="">${id === 'ovClientFilter' ? 'All Client Companies' : 'All Clients'}</option>` +
        clients.map(c => `<option value="${escapeHtml(c.companyCode)}">${escapeHtml(c.companyName)}</option>`).join('');
      sel.value = cur;
    });
    if ($('empClient')) {
      const cur = $('empClient').value;
      $('empClient').innerHTML = `<option value="">Unassigned</option>` +
        clients.map(c => `<option value="${escapeHtml(c.companyCode)}">${escapeHtml(c.companyName)}</option>`).join('');
      if (cur) $('empClient').value = cur;
    }
  }

  function syncRoleUI() {
    const admin = isAdmin();
    document.querySelectorAll('.admin-only').forEach(el => el.classList.toggle('hidden', !admin));
    $('empTableWrap').className = `${admin ? 'lg:col-span-2' : 'lg:col-span-3'} bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-6 shadow-sm space-y-4`;
    $('hdrUser').textContent = state.currentUser.username;
    $('hdrCompany').textContent = state.currentUser.companyName;
    if ($('mobUser')) $('mobUser').textContent = state.currentUser.username;
    if ($('mobCompany')) $('mobCompany').textContent = state.currentUser.companyName;

    if (admin) {
      $('roleBadge').textContent = 'ADMIN';
      $('roleBadge').className = 'px-3 py-1 rounded-full text-xs font-bold bg-covibe-teal/25 text-teal-200 border border-covibe-teal/50';
      $('clientBanner').classList.add('hidden');
      $('overviewTitle').textContent = 'CoVibe Attendance Overview';
    } else {
      $('roleBadge').textContent = state.currentUser.companyName.toUpperCase();
      $('roleBadge').className = 'px-3 py-1 rounded-full text-xs font-bold bg-covibe-orange text-white';
      $('clientBanner').classList.remove('hidden');
      $('clientBannerText').textContent = `${state.currentUser.companyName} Read Only Attendance Portal`;
      $('overviewTitle').textContent = `${state.currentUser.companyName} Attendance`;
      if (state.ui.activeTab === 'upload') switchTab('overview');
    }
  }

  function renderAll() {
    if (!state.currentUser) return;
    populateClientSelects();
    syncRoleUI();
    updatePeriodUI();
    renderOverview();
    renderDaily();
    renderPunches();
    renderEmployees();
    if (isAdmin()) renderAccounts();
    if (window.lucide) lucide.createIcons();
  }

  function getLatestDataDate() {
    let maxD = '';
    state.daily.forEach(r => { if (r.date && r.date > maxD) maxD = r.date; });
    state.punches.forEach(p => { const d = (p.punchTime || '').slice(0, 10); if (d > maxD) maxD = d; });
    return maxD || new Date().toISOString().slice(0, 10);
  }

  function shiftDateByDays(dateStr, deltaDays) {
    const d = new Date(dateStr + 'T12:00:00');
    d.setDate(d.getDate() + deltaDays);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function hasLastWeekFileData() {
    return state.punches.some(p => p.sourceFile === 'attendance-last-week.dat');
  }

  function matchesPeriodDate(dateStr, isFromLastWeekFile) {
    const mode = state.ui.period;
    if (mode === 'all') return true;
    if (mode === 'last-week') {
      if (hasLastWeekFileData()) return Boolean(isFromLastWeekFile);
      const latest = getLatestDataDate();
      const start = shiftDateByDays(latest, -6);
      return dateStr >= start && dateStr <= latest;
    }
    if (mode === 'custom') {
      if (state.ui.customFrom && dateStr < state.ui.customFrom) return false;
      if (state.ui.customTo && dateStr > state.ui.customTo) return false;
      return true;
    }
    return true;
  }

  function updatePeriodUI() {
    const mode = state.ui.period;
    document.querySelectorAll('.period-btn').forEach(b => {
      const act = b.dataset.period === mode;
      b.className = `period-btn px-4 py-2 rounded-xl text-sm font-semibold transition ${act ? 'bg-covibe-navy text-white shadow-sm' : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200'}`;
    });
    $('customPeriodInputs').classList.toggle('hidden', mode !== 'custom');
    const badge = $('activePeriodBadge');
    if (mode === 'all') badge.textContent = 'Showing All Data';
    else if (mode === 'last-week') badge.textContent = hasLastWeekFileData() ? 'Showing Last Week File (attendance-last-week.dat)' : 'Showing Last 7 Days Report';
    else badge.textContent = `Custom Period: ${state.ui.customFrom || 'Start'} to ${state.ui.customTo || 'End'}`;
  }

  function renderOverview() {
    const cid = isAdmin() ? ($('ovClientFilter').value || null) : null;
    const punches = state.punches.filter(p => (!cid || p.clientId === cid) && matchesPeriodDate((p.punchTime || '').slice(0, 10), p.sourceFile === 'attendance-last-week.dat'));
    const daily = state.daily.filter(r => (!cid || r.clientId === cid) && matchesPeriodDate(r.date, r.fromLastWeekFile));

    const inTotal = punches.filter(p => getDirection(p) === 'IN').length;
    const outTotal = punches.filter(p => getDirection(p) === 'OUT').length;
    const loginDays = daily.filter(r => r.firstLogin).length;
    const completeDays = daily.filter(r => r.firstLogin && r.lastLogout).length;
    const dayShiftCnt = daily.filter(r => r.shift === 'Day').length;
    const nightShiftCnt = daily.filter(r => r.shift === 'Night').length;
    const valid = daily.filter(r => r.minutes > 0);
    const avgM = valid.length ? valid.reduce((s, r) => s + r.minutes, 0) / valid.length : 0;
    const uniqueEmps = new Set(punches.map(p => p.employeeId)).size;

    $('kpiScans').textContent = punches.length.toLocaleString();
    $('kpiScansSub').textContent = `${inTotal.toLocaleString()} Check In and ${outTotal.toLocaleString()} Check Out`;
    $('kpiFaceIn').textContent = loginDays.toLocaleString();
    $('kpiFaceSub').textContent = `${dayShiftCnt.toLocaleString()} Day and ${nightShiftCnt.toLocaleString()} Night Shifts`;
    $('kpiFingerOut').textContent = completeDays.toLocaleString();
    $('kpiFingerSub').textContent = `Login and Logout paired`;
    $('kpiEmps').textContent = uniqueEmps.toLocaleString();
    $('kpiAvgSpan').textContent = `Avg span: ${formatMins(avgM)}`;

    if (typeof Chart === 'undefined') return;
    const dark = state.ui.dark, txt = dark ? '#cbd5e1' : '#475569', grid = dark ? 'rgba(148,163,184,0.12)' : 'rgba(148,163,184,0.2)';

    const dates = [...new Set(daily.map(r => r.date))].sort().slice(-14);
    if (charts.daily) charts.daily.destroy();
    charts.daily = new Chart($('dailyChart'), {
      type: 'bar',
      data: {
        labels: dates,
        datasets: [
          { label: 'Day Shift', data: dates.map(d => daily.filter(r => r.date === d && r.shift === 'Day').length), backgroundColor: '#009098', borderRadius: 6 },
          { label: 'Night Shift', data: dates.map(d => daily.filter(r => r.date === d && r.shift === 'Night').length), backgroundColor: '#003058', borderRadius: 6 }
        ]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: txt, boxWidth: 12, font: { family: 'Poppins', size: 12 } } } }, scales: { x: { stacked: true, ticks: { color: txt, font: { family: 'Poppins' } }, grid: { display: false } }, y: { stacked: true, beginAtZero: true, ticks: { color: txt, precision: 0, font: { family: 'Poppins' } }, grid: { color: grid } } } }
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
          { label: 'Check In', data: fBins, borderColor: '#009098', backgroundColor: 'rgba(0,144,152,0.16)', fill: true, tension: 0.35, pointRadius: 2.5 },
          { label: 'Check Out', data: oBins, borderColor: '#F87800', backgroundColor: 'rgba(248,120,0,0.15)', fill: true, tension: 0.35, pointRadius: 2.5 }
        ]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: txt, boxWidth: 12, font: { family: 'Poppins', size: 12 } } } }, scales: { x: { ticks: { color: txt, maxTicksLimit: 12, font: { family: 'Poppins', size: 11 } }, grid: { display: false } }, y: { beginAtZero: true, ticks: { color: txt, precision: 0, font: { family: 'Poppins' } }, grid: { color: grid } } } }
    });
  }

  function getFilteredDaily() {
    const from = $('dFrom').value, to = $('dTo').value, q = $('dSearch').value.trim().toLowerCase();
    const cl = isAdmin() ? $('dClient').value : '', sh = $('dShift').value;
    return state.daily.filter(r => {
      if (!matchesPeriodDate(r.date, r.fromLastWeekFile)) return false;
      if (from && r.date < from) return false;
      if (to && r.date > to) return false;
      if (cl && r.clientId !== cl) return false;
      if (sh && r.shift !== sh) return false;
      if (q && !(String(r.employeeId).toLowerCase().includes(q) || String(r.employeeName).toLowerCase().includes(q) || String(r.clientName).toLowerCase().includes(q))) return false;
      return true;
    });
  }

  function renderDaily() {
    const rows = getFilteredDaily();
    const lim = state.ui.dailyLimit === 'all' ? rows.length : Number(state.ui.dailyLimit);
    const visible = rows.slice(0, lim);
    $('dailyCount').textContent = `Showing ${visible.length.toLocaleString()} of ${rows.length.toLocaleString()} daily attendance records`;

    if (!visible.length) {
      $('dailyBody').innerHTML = `<tr><td colspan="9" class="px-4 py-10 text-center text-slate-400">No attendance records found for the selected filters.</td></tr>`;
      return;
    }

    $('dailyBody').innerHTML = visible.map(r => {
      const exp = state.ui.expandedKeys.has(r.key);
      const shiftBadge = r.shift === 'Night'
        ? '<span class="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-covibe-navy text-white">Night</span>'
        : '<span class="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-covibe-orangeSoft text-covibe-orangeDark dark:bg-orange-950 dark:text-orange-300">Day</span>';
      const logoutDisp = r.lastLogout
        ? `${escapeHtml(r.lastLogout.slice(11))}${r.nextDayLogout ? ' <span class="text-xs px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300">Next Day</span>' : ''}`
        : '<span class="text-slate-400">Not Recorded</span>';

      let html = `<tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer daily-row" data-key="${escapeHtml(r.key)}">
        <td class="px-4 py-3 font-semibold text-covibe-navy dark:text-sky-300">${escapeHtml(r.employeeId)}</td>
        <td class="px-4 py-3 font-semibold">${escapeHtml(r.employeeName)}</td>
        <td class="px-4 py-3 text-slate-500">${escapeHtml(r.clientName)}</td>
        <td class="px-4 py-3">${escapeHtml(r.date)}</td>
        <td class="px-4 py-3">${shiftBadge}</td>
        <td class="px-4 py-3 font-semibold text-covibe-tealDark dark:text-teal-300">${r.firstLogin ? escapeHtml(r.firstLogin.slice(11)) : '<span class="text-slate-400">Not Recorded</span>'}</td>
        <td class="px-4 py-3 font-semibold text-covibe-orangeDark dark:text-orange-300">${logoutDisp}</td>
        <td class="px-4 py-3 text-center"><span class="text-covibe-teal font-bold">${r.inCount}</span> / <span class="text-covibe-orange font-bold">${r.outCount}</span></td>
        <td class="px-4 py-3 font-bold">${r.minutes > 0 ? formatMins(r.minutes) : 'N/A'}</td>
      </tr>`;

      if (exp && Array.isArray(r.punches)) {
        const tl = r.punches.filter(p => getDirection(p) === 'IN' || getDirection(p) === 'OUT').map(p => {
          const d = getDirection(p);
          return `<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-white dark:bg-slate-900 border ${d==='IN'?'border-covibe-teal/50 text-covibe-tealDark':'border-covibe-orange/50 text-covibe-orangeDark'} text-xs"><strong>${d==='IN'?'Check In':'Check Out'}</strong> ${escapeHtml(p.punchTime)}</span>`;
        }).join('');
        html += `<tr class="bg-slate-50 dark:bg-slate-950/60"><td colspan="9" class="px-5 py-3.5"><div class="flex flex-wrap gap-2 items-center"><span class="text-xs font-bold text-slate-500 mr-1">${r.shift} Shift Activity:</span>${tl}</div></td></tr>`;
      }
      return html;
    }).join('');
  }

  function getFilteredPunches() {
    const q = $('pSearch').value.trim().toLowerCase(), from = $('pFrom').value, to = $('pTo').value, mode = $('pMode').value;
    return state.punches.filter(p => {
      const pd = (p.punchTime || '').slice(0, 10);
      if (!matchesPeriodDate(pd, p.sourceFile === 'attendance-last-week.dat')) return false;
      if (q && !(String(p.employeeId).toLowerCase().includes(q) || String(p.employeeName || '').toLowerCase().includes(q))) return false;
      const d = (p.punchTime || '').slice(0, 10);
      if (from && d < from) return false;
      if (to && d > to) return false;
      if (mode && getBioCode(p) !== mode) return false;
      return true;
    }).sort((a, b) => String(b.punchTime).localeCompare(String(a.punchTime)));
  }

  function renderPunches() {
    const list = getFilteredPunches();
    const showAll = state.ui.pageSize === 'all';
    const perPage = showAll ? Math.max(1, list.length) : Number(state.ui.pageSize);
    const totalPages = Math.max(1, Math.ceil(list.length / perPage));
    if (state.ui.page > totalPages) state.ui.page = totalPages;
    const rows = showAll ? list : list.slice((state.ui.page - 1) * perPage, state.ui.page * perPage);

    $('punchCount').textContent = `Showing ${rows.length.toLocaleString()} of ${list.length.toLocaleString()} records`;
    $('pageInfo').textContent = `Page ${state.ui.page} of ${totalPages}`;
    $('btnPrevPage').disabled = showAll || state.ui.page <= 1;
    $('btnNextPage').disabled = showAll || state.ui.page >= totalPages;

    $('punchBody').innerHTML = rows.map(p => {
      const d = getDirection(p);
      const badge = d === 'IN'
        ? '<span class="px-3 py-1 rounded-full text-xs font-bold bg-covibe-tealSoft text-covibe-tealDark">Check In</span>'
        : '<span class="px-3 py-1 rounded-full text-xs font-bold bg-covibe-orangeSoft text-covibe-orangeDark">Check Out</span>';
      return `<tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50">
        <td class="px-4 py-3 font-semibold text-covibe-navy dark:text-sky-300">${escapeHtml(p.employeeId)}</td>
        <td class="px-4 py-3 font-medium">${escapeHtml(p.employeeName)}</td>
        <td class="px-4 py-3 text-slate-500">${escapeHtml(p.clientName || 'CoVibe')}</td>
        <td class="px-4 py-3">${escapeHtml(p.punchTime)}</td>
        <td class="px-4 py-3">${badge}</td>
      </tr>`;
    }).join('') || `<tr><td colspan="5" class="px-4 py-10 text-center text-slate-400">No punch records found.</td></tr>`;
  }

  function renderEmployees() {
    const q = $('empSearch').value.trim().toLowerCase(), cid = isAdmin() ? $('empFilterClient').value : '', admin = isAdmin();
    const list = state.employees.filter(e => {
      if (cid && e.clientId !== cid) return false;
      if (q && !(String(e.employeeId).toLowerCase().includes(q) || String(e.name).toLowerCase().includes(q))) return false;
      return true;
    }).sort((a, b) => String(a.employeeId).localeCompare(String(b.employeeId)));

    $('empCount').textContent = `${list.length} employees`;
    $('empBody').innerHTML = list.map(e => `
      <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50">
        <td class="px-4 py-3 font-semibold text-covibe-navy dark:text-sky-300">${escapeHtml(e.employeeId)}</td>
        <td class="px-4 py-3 font-semibold">${escapeHtml(e.name)}</td>
        <td class="px-4 py-3 font-semibold text-covibe-orangeDark">${escapeHtml(e.maskedName || e.name)}</td>
        <td class="px-4 py-3 text-slate-600 dark:text-slate-300">${escapeHtml(e.clientName || 'CoVibe')}</td>
        <td class="px-4 py-3 text-right whitespace-nowrap ${admin ? '' : 'hidden'}">
          <button class="btn-ed-emp px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200" data-id="${escapeHtml(e.employeeId)}">Edit</button>
        </td>
      </tr>`).join('') || `<tr><td colspan="5" class="px-4 py-10 text-center text-slate-400">No employees found.</td></tr>`;
  }

  function renderAccounts() {
    $('accountsBody').innerHTML = state.accounts.map(a => `
      <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/40">
        <td class="px-4 py-3"><span class="px-2.5 py-1 rounded-full text-xs font-bold ${a.role==='ADMIN'?'bg-covibe-navy text-white':'bg-covibe-orangeSoft text-covibe-orangeDark'}">${a.role}</span></td>
        <td class="px-4 py-3 font-bold">${escapeHtml(a.username)}</td>
        <td class="px-4 py-3"><input type="text" value="${escapeHtml(a.password)}" data-id="${a.id}" data-f="password" class="acc-inp px-3 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 w-40" /></td>
        <td class="px-4 py-3 text-slate-500">${escapeHtml(a.companyCode)}</td>
        <td class="px-4 py-3"><input type="text" value="${escapeHtml(a.companyName)}" data-id="${a.id}" data-f="companyName" class="acc-inp px-3 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 w-52" /></td>
        <td class="px-4 py-3 text-right"><button class="btn-save-acc px-4 py-1.5 rounded-lg text-xs font-bold bg-covibe-teal hover:bg-covibe-tealDark text-white" data-id="${a.id}">Save</button></td>
      </tr>`).join('');
  }

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
    if (typeof XLSX === 'undefined') { toast('Excel library loading...', 'warn'); return; }
    const wb = XLSX.utils.book_new();
    Object.entries(sheets).forEach(([k, v]) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(v.length ? v : [{ Info: 'No data' }]), k.slice(0, 31)));
    XLSX.writeFile(wb, fname);
    toast(`Exported ${fname}`);
  }
  function handleExport(type) {
    const daily = getFilteredDaily().map(r => ({
      EmployeeID: r.employeeId, Employee: r.employeeName, Client: r.clientName, Date: r.date, Shift: r.shift,
      LoginTime: r.firstLogin || '', LogoutTime: r.lastLogout || '',
      CheckInCount: r.inCount, CheckOutCount: r.outCount, TotalSpan: r.minutes > 0 ? formatMins(r.minutes) : ''
    }));
    const punches = getFilteredPunches().map(p => ({
      EmployeeID: p.employeeId, Employee: p.employeeName, PunchTime: p.punchTime,
      Event: getDirection(p) === 'IN' ? 'Check In' : 'Check Out'
    }));
    const emps = state.employees.map(e => ({ EmployeeID: e.employeeId, Name: e.name, Client: e.clientName || 'CoVibe' }));

    if (type === 'daily-csv') dlBlob(toCsv(daily), 'covibe_daily_report.csv', 'text/csv;charset=utf-8');
    else if (type === 'daily-xlsx') exportXlsx({ 'Daily Report': daily }, 'covibe_daily_report.xlsx');
    else if (type === 'punches-csv') dlBlob(toCsv(punches), 'covibe_punch_logs.csv', 'text/csv;charset=utf-8');
    else if (type === 'punches-xlsx') exportXlsx({ 'Punch Logs': punches }, 'covibe_punch_logs.xlsx');
    else if (type === 'employees-xlsx') exportXlsx({ 'Employees': emps }, 'covibe_employees.xlsx');
    else if (type === 'full-xlsx') exportXlsx({ 'Daily Report': daily, 'Punch Logs': punches, 'Employees': emps }, 'covibe_attendance_report.xlsx');
  }

  function switchTab(tab) {
    if (!isAdmin() && tab === 'upload') return;
    state.ui.activeTab = tab;
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
    $('tab-' + tab).classList.remove('hidden');
    document.querySelectorAll('.nav-btn').forEach(b => {
      const act = b.dataset.tab === tab, adm = b.classList.contains('admin-only');
      b.className = `nav-btn${adm ? ' admin-only' : ''}${adm && !isAdmin() ? ' hidden' : ''} inline-flex items-center gap-2 px-4 lg:px-5 py-2.5 rounded-xl text-sm font-semibold whitespace-nowrap transition ${act ? 'bg-covibe-teal text-white shadow-sm' : 'text-slate-200 hover:bg-white/10'}`;
    });
    document.querySelectorAll('.mob-nav-btn').forEach(b => {
      const act = b.dataset.tab === tab, adm = b.classList.contains('admin-only');
      const span2 = adm ? ' col-span-2' : '';
      b.className = `mob-nav-btn${adm ? ' admin-only' : ''}${adm && !isAdmin() ? ' hidden' : ''}${span2} flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-semibold ${act ? 'bg-covibe-teal text-white' : 'bg-white/10 text-slate-100'}`;
    });
    if ($('mobileDrawer')) $('mobileDrawer').classList.add('hidden');
    if (tab === 'overview') renderOverview();
  }

  function wireEvents() {
    $('loginForm').addEventListener('submit', async e => {
      e.preventDefault();
      $('loginError').classList.add('hidden');
      try {
        const res = await api('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: $('loginUsername').value.trim(), password: $('loginPassword').value })
        });
        saveToken(res.token);
        state.currentUser = res.user;
        state.ui.activeTab = 'overview';
        showView();
        await refreshAllFromServer();
        toast(`Signed in as ${res.user.companyName}`);
      } catch (err) {
        $('loginError').textContent = err.message;
        $('loginError').classList.remove('hidden');
      }
    });

    $('btnLogout').addEventListener('click', async () => {
      try { await api('/api/auth/logout', { method: 'POST' }); } catch (_) {}
      clearSession();
      $('loginForm').reset();
      showView();
    });

    $('mainNav').addEventListener('click', e => { const b = e.target.closest('.nav-btn'); if (b) switchTab(b.dataset.tab); });
    if ($('mobileNav')) $('mobileNav').addEventListener('click', e => { const b = e.target.closest('.mob-nav-btn'); if (b) switchTab(b.dataset.tab); });
    if ($('btnMobileMenu')) $('btnMobileMenu').addEventListener('click', () => $('mobileDrawer').classList.toggle('hidden'));
    if ($('btnMobLogout')) $('btnMobLogout').addEventListener('click', () => $('btnLogout').click());
    $('periodNav').addEventListener('click', e => {
      const b = e.target.closest('.period-btn');
      if (!b) return;
      state.ui.period = b.dataset.period;
      state.ui.page = 1;
      renderAll();
    });
    $('btnApplyCustomPeriod').addEventListener('click', () => {
      state.ui.customFrom = $('gFrom').value;
      state.ui.customTo = $('gTo').value;
      state.ui.period = 'custom';
      state.ui.page = 1;
      renderAll();
    });
    $('btnTopExport').addEventListener('click', () => handleExport('full-xlsx'));
    $('btnPrint').addEventListener('click', () => window.print());
    $('ovClientFilter').addEventListener('change', renderOverview);
    $('btnThemeToggle').addEventListener('click', () => { state.ui.dark = !state.ui.dark; document.documentElement.classList.toggle('dark', state.ui.dark); renderOverview(); });
    document.querySelectorAll('[data-export]').forEach(b => b.addEventListener('click', () => handleExport(b.dataset.export)));

    ['dFrom', 'dTo', 'dSearch', 'dClient', 'dShift'].forEach(id => $(id).addEventListener('input', renderDaily));
    $('dPageSize').addEventListener('change', e => { state.ui.dailyLimit = e.target.value; renderDaily(); });
    $('btnDailyClear').addEventListener('click', () => { ['dFrom', 'dTo', 'dSearch', 'dClient', 'dShift'].forEach(id => $(id).value = ''); renderDaily(); });
    $('dailyBody').addEventListener('click', e => {
      const tr = e.target.closest('.daily-row'); if (!tr) return;
      if (state.ui.expandedKeys.has(tr.dataset.key)) state.ui.expandedKeys.delete(tr.dataset.key); else state.ui.expandedKeys.add(tr.dataset.key);
      renderDaily();
    });

    ['pSearch', 'pFrom', 'pTo', 'pMode'].forEach(id => $(id).addEventListener('input', () => { state.ui.page = 1; renderPunches(); }));
    $('pPageSize').addEventListener('change', e => { state.ui.pageSize = e.target.value; state.ui.page = 1; renderPunches(); });
    $('btnPunchClear').addEventListener('click', () => { ['pSearch', 'pFrom', 'pTo', 'pMode'].forEach(id => $(id).value = ''); state.ui.page = 1; renderPunches(); });
    $('btnPrevPage').addEventListener('click', () => { if (state.ui.page > 1) { state.ui.page--; renderPunches(); } });
    $('btnNextPage').addEventListener('click', () => { state.ui.page++; renderPunches(); });

    $('empForm').addEventListener('submit', async e => {
      e.preventDefault(); if (!isAdmin()) return;
      try {
        await api('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            employeeId: $('empId').value.trim(),
            name: $('empName').value.trim(),
            clientId: $('empClient').value,
            department: $('empDept').value.trim()
          })
        });
        state.ui.editingEmpId = null; $('empForm').reset(); $('empId').disabled = false; $('empFormTitle').textContent = 'Edit Employee';
        await refreshAllFromServer();
        toast('Employee updated.');
      } catch (err) { toast(err.message, 'error'); }
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
        $('empFormTitle').textContent = `Edit ${emp.employeeId}`;
      }
    });

    $('accountsBody').addEventListener('click', async e => {
      const btn = e.target.closest('.btn-save-acc'); if (!btn || !isAdmin()) return;
      const id = btn.dataset.id;
      const body = {};
      document.querySelectorAll(`.acc-inp[data-id="${id}"]`).forEach(inp => { body[inp.dataset.f] = inp.value.trim(); });
      try {
        await api('/api/auth/accounts/' + encodeURIComponent(id), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        await refreshAllFromServer();
        toast('Account updated.');
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  async function boot() {
    wireEvents();
    try {
      const saved = sessionStorage.getItem(TOKEN_KEY);
      if (saved) {
        state.token = saved;
        state.currentUser = await api('/api/auth/me');
        showView();
        await refreshAllFromServer();
        return;
      }
    } catch (_) {
      clearSession();
    }
    showView();
  }

  boot();
})();
