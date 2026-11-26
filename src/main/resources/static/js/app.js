/* =========================================================
   CoVibe Attendance Portal — Server-Backed Client App
   - 100% Shared Server Data via Spring Boot REST API
     (./data-files/accounts.json, employees.json, punches.json)
   - Admin uploads from any device -> All 4 Clients see live data
   - Day Shift (7 AM–7 PM) & Night Shift (7 PM–7 AM) cross-midnight
   - Column 5: 15 = Face Check-In (First = Login)
               1  = Fingerprint Check-Out (Last = Logout)
               4  = RFID Card
   - Client Names masked on server as Na####r
   ========================================================= */

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
      page: 1,
      pageSize: 20
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
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 220); }, 3400);
  }

  // ==================== SERVER API HELPER ====================
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
    state.punches = Array.isArray(punches) ? punches : [];
    state.employees = Array.isArray(employees) ? employees : [];
    if (isAdmin() && Array.isArray(accounts)) state.accounts = accounts;
    renderAll();
  }

  function getClients() {
    return state.accounts.filter(a => a.role === 'CLIENT');
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
    const cid = isAdmin() ? ($('ovClientFilter').value || null) : null;
    const punches = cid ? state.punches.filter(p => p.clientId === cid) : state.punches;
    const daily = cid ? state.daily.filter(r => r.clientId === cid) : state.daily;

    const faceTotal = punches.filter(p => getDirection(p) === 'IN').length;
    const fpTotal = punches.filter(p => getDirection(p) === 'OUT').length;
    const loginDays = daily.filter(r => r.firstLogin).length;
    const completeDays = daily.filter(r => r.firstLogin && r.lastLogout).length;
    const dayShiftCnt = daily.filter(r => r.shift === 'Day').length;
    const nightShiftCnt = daily.filter(r => r.shift === 'Night').length;
    const valid = daily.filter(r => r.minutes > 0);
    const avgM = valid.length ? valid.reduce((s, r) => s + r.minutes, 0) / valid.length : 0;
    const uniqueEmps = new Set(punches.map(p => p.employeeId)).size;

    $('kpiScans').textContent = punches.length.toLocaleString();
    $('kpiScansSub').textContent = `${faceTotal.toLocaleString()} Face IN • ${fpTotal.toLocaleString()} Finger OUT`;
    $('kpiFaceIn').textContent = loginDays.toLocaleString();
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
    const from = $('dFrom').value, to = $('dTo').value, q = $('dSearch').value.trim().toLowerCase();
    const cl = isAdmin() ? $('dClient').value : '', sh = $('dShift').value;
    return state.daily.filter(r => {
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
    $('dailyCount').textContent = `${rows.length.toLocaleString()} daily attendance rows`;
    if (!rows.length) {
      $('dailyBody').innerHTML = `<tr><td colspan="9" class="px-4 py-10 text-center text-slate-400">No attendance records yet. ${isAdmin() ? 'Upload an eSSL .dat file under Upload & Accounts.' : 'No uploaded records found for your company yet.'}</td></tr>`;
      return;
    }
    $('dailyBody').innerHTML = rows.slice(0, 300).map(r => {
      const exp = state.ui.expandedKeys.has(r.key);
      const shiftBadge = r.shift === 'Night'
        ? '<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-covibe-navy text-white">Night</span>'
        : '<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-covibe-orangeSoft text-covibe-orangeDark dark:bg-orange-950 dark:text-orange-300">Day</span>';
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
      if (exp && Array.isArray(r.punches)) {
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
    const q = $('pSearch').value.trim().toLowerCase(), from = $('pFrom').value, to = $('pTo').value, mode = $('pMode').value;
    return state.punches.filter(p => {
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
    const totalPages = Math.max(1, Math.ceil(list.length / state.ui.pageSize));
    if (state.ui.page > totalPages) state.ui.page = totalPages;
    const rows = list.slice((state.ui.page - 1) * state.ui.pageSize, state.ui.page * state.ui.pageSize);
    $('punchCount').textContent = `${list.length.toLocaleString()} matching scans`;
    $('pageInfo').textContent = `Page ${state.ui.page} / ${totalPages}`;
    $('btnPrevPage').disabled = state.ui.page <= 1;
    $('btnNextPage').disabled = state.ui.page >= totalPages;

    $('punchBody').innerHTML = rows.map(p => {
      const d = getDirection(p);
      const badge = d === 'IN' ? '<span class="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-covibe-tealSoft text-covibe-tealDark">Face (15) • Check-In</span>'
        : d === 'OUT' ? '<span class="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-covibe-orangeSoft text-covibe-orangeDark">Fingerprint (1) • Check-Out</span>'
        : '<span class="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-700">RFID Card (4)</span>';
      return `<tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50">
        <td class="px-3.5 py-2.5 font-mono font-semibold text-covibe-navy dark:text-sky-300">${escapeHtml(p.employeeId)}</td>
        <td class="px-3.5 py-2.5 font-medium">${escapeHtml(p.employeeName)}</td>
        <td class="px-3.5 py-2.5 text-slate-500">${escapeHtml(p.clientName || 'Unassigned')}</td>
        <td class="px-3.5 py-2.5 font-mono">${escapeHtml(p.punchTime)}</td>
        <td class="px-3.5 py-2.5">${badge}</td>
        <td class="px-3.5 py-2.5 text-slate-500 truncate max-w-[160px]">${escapeHtml(p.sourceFile || 'uploaded')}</td>
      </tr>`;
    }).join('') || `<tr><td colspan="6" class="px-4 py-10 text-center text-slate-400">No punch logs found.</td></tr>`;
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
        <td class="px-3.5 py-2.5 font-mono font-semibold text-covibe-navy dark:text-sky-300">${escapeHtml(e.employeeId)}</td>
        <td class="px-3.5 py-2.5 font-semibold">${escapeHtml(e.name)}</td>
        <td class="px-3.5 py-2.5 font-mono font-semibold text-covibe-orangeDark">${escapeHtml(e.maskedName || e.name)}</td>
        <td class="px-3.5 py-2.5 text-slate-600 dark:text-slate-300">${escapeHtml(e.clientName || 'Unassigned')}</td>
        <td class="px-3.5 py-2.5 text-right whitespace-nowrap ${admin ? '' : 'hidden'}">
          <button class="btn-ed-emp px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 mr-1" data-id="${escapeHtml(e.employeeId)}">Edit</button>
          <button class="btn-dl-emp px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-rose-50 text-rose-600" data-id="${escapeHtml(e.employeeId)}">Del</button>
        </td>
      </tr>`).join('') || `<tr><td colspan="5" class="px-4 py-10 text-center text-slate-400">No employees found.</td></tr>`;
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

  // ==================== SERVER UPLOADS ====================
  async function uploadAttendanceToServer(file) {
    if (!isAdmin() || !file) return;
    try {
      toast(`Uploading ${file.name} to server...`, 'info');
      const fd = new FormData();
      fd.append('file', file);
      const res = await api('/api/import', { method: 'POST', body: fd });
      await refreshAllFromServer();
      toast(`Server saved ${Number(res.imported || 0).toLocaleString()} punches (${Number(res.duplicates || 0).toLocaleString()} duplicates skipped). Visible on all devices!`);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function uploadUsersToServer(file) {
    if (!isAdmin() || !file) return;
    try {
      toast(`Uploading ${file.name} to server...`, 'info');
      const fd = new FormData();
      fd.append('file', file);
      const res = await api('/api/users/import', { method: 'POST', body: fd });
      await refreshAllFromServer();
      toast(`Server updated users: ${res.imported || 0} added, ${res.updated || 0} updated.`);
    } catch (err) {
      toast(err.message, 'error');
    }
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
    if (typeof XLSX === 'undefined') { toast('Excel library loading...', 'warn'); return; }
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
    const punches = getFilteredPunches().map(p => ({
      EmployeeID: p.employeeId, Employee: p.employeeName, PunchTime: p.punchTime,
      Mode: getDirection(p) === 'IN' ? 'Face (15) Check-In' : getDirection(p) === 'OUT' ? 'Fingerprint (1) Check-Out' : 'RFID Card (4)'
    }));
    const emps = state.employees.map(e => ({ EmployeeID: e.employeeId, Name: e.name, Client: e.clientName || 'Unassigned' }));

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

    // Employees CRUD (Server-backed)
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
        state.ui.editingEmpId = null; $('empForm').reset(); $('empId').disabled = false; $('empFormTitle').textContent = 'Add / Edit Employee';
        await refreshAllFromServer();
        toast('Employee saved to server.');
      } catch (err) { toast(err.message, 'error'); }
    });

    $('btnResetEmp').addEventListener('click', () => { state.ui.editingEmpId = null; $('empForm').reset(); $('empId').disabled = false; });
    ['empSearch', 'empFilterClient'].forEach(id => $(id).addEventListener('input', renderEmployees));

    $('empBody').addEventListener('click', async e => {
      if (!isAdmin()) return;
      const ed = e.target.closest('.btn-ed-emp');
      if (ed) {
        const emp = state.employees.find(x => x.employeeId === ed.dataset.id); if (!emp) return;
        state.ui.editingEmpId = emp.employeeId; $('empId').value = emp.employeeId; $('empId').disabled = true;
        $('empName').value = emp.name; $('empClient').value = emp.clientId || ''; $('empDept').value = emp.department || '';
        $('empFormTitle').textContent = `Edit ${emp.employeeId}`; return;
      }
      const dl = e.target.closest('.btn-dl-emp');
      if (dl) {
        try {
          await api('/api/users/' + encodeURIComponent(dl.dataset.id), { method: 'DELETE' });
          await refreshAllFromServer();
          toast('Employee removed from server.');
        } catch (err) { toast(err.message, 'error'); }
      }
    });

    $('btnGenPlaceholders').addEventListener('click', async () => {
      if (!isAdmin()) return;
      try {
        const res = await api('/api/users/generate-missing', { method: 'POST' });
        await refreshAllFromServer();
        toast(res.created ? `Created ${res.created} placeholders on server.` : 'All IDs already mapped.');
      } catch (err) { toast(err.message, 'error'); }
    });

    // Server File Uploads (Admin Only)
    $('attFileInput').addEventListener('change', e => { if (e.target.files[0]) uploadAttendanceToServer(e.target.files[0]); e.target.value = ''; });
    $('attDropZone').addEventListener('dragover', e => e.preventDefault());
    $('attDropZone').addEventListener('drop', e => { e.preventDefault(); if (e.dataTransfer.files[0]) uploadAttendanceToServer(e.dataTransfer.files[0]); });

    $('userFileInput').addEventListener('change', e => { if (e.target.files[0]) uploadUsersToServer(e.target.files[0]); e.target.value = ''; });
    $('userDropZone').addEventListener('dragover', e => e.preventDefault());
    $('userDropZone').addEventListener('drop', e => { e.preventDefault(); if (e.dataTransfer.files[0]) uploadUsersToServer(e.dataTransfer.files[0]); });

    // Accounts Save (Server-backed)
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
        toast('Account saved on server for all devices.');
      } catch (err) { toast(err.message, 'error'); }
    });

    // Clear Data Modal (Admin Only -> Server)
    $('btnClearDataOpen').addEventListener('click', () => { $('clearModal').classList.remove('hidden'); $('clearModal').classList.add('flex'); });
    $('btnCancelClear').addEventListener('click', () => { $('clearModal').classList.add('hidden'); $('clearModal').classList.remove('flex'); });
    $('btnConfirmClear').addEventListener('click', async () => {
      if (!isAdmin()) return;
      try {
        await api('/api/records/clear', { method: 'DELETE' });
        $('clearModal').classList.add('hidden'); $('clearModal').classList.remove('flex');
        await refreshAllFromServer();
        toast('All punch records cleared on server.');
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
