/* TV Media Planner - standalone (no backend). Data lives in the browser's localStorage. */
(function () {
  'use strict';

  // ===================== config & helpers =====================
  const CUR = '₹';          // symbol shown on screen / Excel
  const CUR_PDF = 'INR';    // PDF base fonts cannot draw the rupee sign
  const KEY = 'mediaplanner.v1';
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const TYPES = ['Spot','Programme Break','Sponsorship','Billboard','L-Band','Live Read','Promo','Ticker','Other'];
  const DOWS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const DEFAULT_SLOTS = [['Morning','07:00','09:30'],['Afternoon','12:00','14:00'],['Evening','19:00','23:00']];

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const daysIn = (y, m) => new Date(y, m, 0).getDate();
  const dowOf = (y, m, d) => (new Date(y, m - 1, d).getDay() + 6) % 7;      // 0 = Mon
  const isWeekend = (y, m, d) => dowOf(y, m, d) >= 5;
  const fmtInt = (n) => Number(n).toLocaleString('en-US');
  // gross is held in 1/10-cent units (FCT x rate in cents) so sums are exact
  const money = (tenths) => (Math.round(tenths / 10) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const time12 = (t) => { const [h, m] = t.split(':').map(Number); return String(h % 12 || 12).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ' ' + (h < 12 ? 'AM' : 'PM'); };
  const slotTime = (s) => time12(s.start) + ' - ' + time12(s.end);
  const period = (p) => MONTHS[p.month - 1] + ' ' + p.year;
  const cleanText = (v) => String(v || '').replace(/\s+/g, ' ').trim();

  // ===================== storage =====================
  let state = load();
  function load() {
    try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && Array.isArray(s.plans)) return s; } catch (e) { /* ignore */ }
    return { plans: [] };
  }
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); return true; }
    catch (e) { toast('Could not save: browser storage is full or disabled.', 'danger'); return false; }
  }
  const getPlan = (id) => state.plans.find((p) => p.id === id);
  const sortSlots = (p) => p.slots.sort((a, b) => a.start.localeCompare(b.start));

  // ===================== calculations =====================
  // Total Spots = sum of daily spots; Total FCT = Spots x Duration; Gross = FCT / 10 x Rate per 10 sec
  function compute(p) {
    const days = daysIn(p.year, p.month), rateCents = Math.round(p.rate * 100);
    const daily = new Array(days).fill(0);
    const rows = p.slots.map((s) => {
      const m = p.spots[s.id] || {};
      let spots = 0;
      for (let d = 1; d <= days; d++) { const n = m[d] || 0; spots += n; daily[d - 1] += n; }
      const fct = spots * p.duration;
      return { slot: s, spots, fct, tenths: fct * rateCents };
    });
    const totalSpots = daily.reduce((a, b) => a + b, 0);
    const totalFct = totalSpots * p.duration;
    return { days, rateCents, rows, daily, totalSpots, totalFct, tenths: totalFct * rateCents };
  }
  const planTotals = (p) => compute(p);

  // ===================== UI helpers =====================
  function toast(msg, type) {
    const el = document.createElement('div');
    el.className = 'toast align-items-center text-bg-' + (type || 'success') + ' border-0';
    el.setAttribute('role', 'alert');
    el.innerHTML = '<div class="d-flex"><div class="toast-body"></div><button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button></div>';
    el.firstChild.firstChild.textContent = msg;
    $('#toastHolder').appendChild(el);
    el.addEventListener('hidden.bs.toast', () => el.remove());
    new bootstrap.Toast(el, { delay: type === 'danger' ? 6000 : 3000 }).show();
  }
  function confirmDialog(title, text, okLabel) {
    return new Promise((resolve) => {
      const modalEl = $('#confirmModal'), modal = bootstrap.Modal.getOrCreateInstance(modalEl);
      $('#confirmTitle').textContent = title; $('#confirmText').textContent = text; $('#confirmOk').textContent = okLabel || 'Delete';
      let result = false;
      const ok = () => { result = true; modal.hide(); };
      $('#confirmOk').addEventListener('click', ok, { once: true });
      modalEl.addEventListener('hidden.bs.modal', () => { $('#confirmOk').removeEventListener('click', ok); resolve(result); }, { once: true });
      modal.show();
    });
  }
  function download(blob, name) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  const fileName = (p, ext) => 'media-plan-' + [p.client, p.campaign, p.channel, period(p)].join(' ').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.' + ext;
  const uniq = (arr) => Array.from(new Set(arr)).sort((a, b) => a.localeCompare(b));
  const datalist = (id, values) => '<datalist id="' + id + '">' + values.map((v) => '<option value="' + esc(v) + '">').join('') + '</datalist>';

  // ===================== router =====================
  const view = $('#view');
  function route() {
    const hash = location.hash || '#/dashboard';
    const [, name, id] = hash.split('/');
    $$('[data-nav]').forEach((a) => a.classList.toggle('active',
      a.dataset.nav === name || (a.dataset.nav === 'plans' && (name === 'plan' || name === 'edit'))));
    $('#appShell').classList.remove('open');
    window.scrollTo(0, 0);
    if (name === 'plans') return viewList();
    if (name === 'new') return viewForm(null);
    if (name === 'edit' && getPlan(id)) return viewForm(getPlan(id));
    if (name === 'plan' && getPlan(id)) return viewEditor(getPlan(id));
    if (name === 'dashboard' || !name) return viewDashboard();
    toast('That media plan no longer exists.', 'warning'); location.hash = '#/plans';
  }
  window.addEventListener('hashchange', route);

  // ===================== dashboard =====================
  function viewDashboard() {
    $('#topTitle').textContent = 'Dashboard';
    const rows = state.plans.map((p) => ({ p, t: planTotals(p) }));
    const sum = (f) => rows.reduce((a, r) => a + f(r.t), 0);
    const byChannel = {};
    rows.forEach((r) => { byChannel[r.p.channel] = (byChannel[r.p.channel] || 0) + r.t.tenths; });
    const ranked = Object.entries(byChannel).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const top = ranked.length ? ranked[0][1] : 0;
    const recent = rows.slice().sort((a, b) => b.p.updated - a.p.updated).slice(0, 6);
    view.innerHTML = `
      <div class="page-head"><div><h1>Dashboard</h1><p class="sub">Everything booked across all clients, channels and months.</p></div>
        <a class="btn btn-primary" href="#/new"><i class="bi bi-plus-lg"></i> Create media plan</a></div>
      <div class="row g-3 mb-4">
        <div class="col-lg-4"><div class="card-x kpi kpi-hero"><div><div class="label"><i class="bi bi-cash-stack"></i> Total gross budget</div>
          <div class="value">${CUR} ${money(sum((t) => t.tenths))}</div></div><div class="foot">Across ${rows.length} media plan${rows.length === 1 ? '' : 's'}</div></div></div>
        <div class="col-lg-8"><div class="row g-3 h-100">
          ${[['journal-text','Total media plans',rows.length],['tv','Total channels',uniq(state.plans.map((p) => p.channel)).length],
             ['megaphone','Total advertisement spots',fmtInt(sum((t) => t.totalSpots))],['stopwatch','Total FCT (seconds)',fmtInt(sum((t) => t.totalFct))]]
            .map((k) => `<div class="col-sm-6"><div class="card-x kpi"><div class="label"><i class="bi bi-${k[0]}"></i> ${k[1]}</div><div class="value">${k[2]}</div></div></div>`).join('')}
        </div></div>
      </div>
      <div class="row g-3">
        <div class="col-xl-8"><section class="card-x"><div class="card-head"><h2>Recent media plans</h2><a class="btn btn-sm btn-outline-primary" href="#/plans">View all</a></div>
          ${recent.length ? `<div class="table-responsive"><table class="table table-modern"><thead><tr><th>Client / campaign</th><th>Channel</th><th>Period</th><th class="text-end">Spots</th><th class="text-end">FCT</th><th class="text-end">Gross budget</th><th></th></tr></thead><tbody>
            ${recent.map(({ p, t }) => `<tr><td><div class="fw-semibold">${esc(p.campaign)}</div><div class="text-muted small">${esc(p.client)}</div></td><td>${esc(p.channel)}</td>
              <td class="text-nowrap">${period(p)}</td><td class="text-end tnum">${fmtInt(t.totalSpots)}</td><td class="text-end tnum">${fmtInt(t.totalFct)}</td>
              <td class="text-end fw-semibold tnum text-nowrap">${CUR} ${money(t.tenths)}</td><td class="text-end"><a class="btn btn-sm btn-outline-primary" href="#/plan/${p.id}">Open</a></td></tr>`).join('')}
            </tbody></table></div>`
          : '<div class="empty-state"><i class="bi bi-journal-plus"></i><p class="mb-2">No media plans yet.</p><a class="btn btn-primary" href="#/new">Create your first media plan</a></div>'}
        </section></div>
        <div class="col-xl-4"><section class="card-x"><div class="card-head"><h2>Gross budget by channel</h2></div><div class="card-body-x">
          ${ranked.length ? ranked.map(([n, v]) => `<div class="bar-row"><div class="top"><span class="fw-medium">${esc(n)}</span><span class="tnum">${CUR} ${money(v)}</span></div>
            <div class="track"><div class="fill" style="width:${top ? Math.round(v / top * 100) : 0}%"></div></div></div>`).join('')
          : '<p class="text-muted mb-0">Budget by channel appears once you have saved plans.</p>'}
        </div></section></div>
      </div>`;
  }

  // ===================== plan list =====================
  const filters = { q: '', client: '', channel: '', month: '', year: '' };
  function viewList() {
    $('#topTitle').textContent = 'Media plans';
    const opt = (vals, sel, all) => '<option value="">' + all + '</option>' + vals.map((v) => '<option' + (String(v[0]) === String(sel) ? ' selected' : '') + ' value="' + esc(v[0]) + '">' + esc(v[1]) + '</option>').join('');
    view.innerHTML = `
      <div class="page-head"><div><h1>Media plans</h1><p class="sub" id="listCount"></p></div><a class="btn btn-primary" href="#/new"><i class="bi bi-plus-lg"></i> Create media plan</a></div>
      <div class="card-x card-body-x mb-3"><div class="row g-2 align-items-end">
        <div class="col-xl-3 col-md-6"><label class="form-label" for="fq">Search</label><input class="form-control" id="fq" type="search" value="${esc(filters.q)}" placeholder="Client, campaign, channel or programme"></div>
        <div class="col-xl-2 col-md-6"><label class="form-label" for="fclient">Client</label><select class="form-select" id="fclient">${opt(uniq(state.plans.map((p) => p.client)).map((v) => [v, v]), filters.client, 'All clients')}</select></div>
        <div class="col-xl-2 col-md-4"><label class="form-label" for="fchannel">Channel</label><select class="form-select" id="fchannel">${opt(uniq(state.plans.map((p) => p.channel)).map((v) => [v, v]), filters.channel, 'All channels')}</select></div>
        <div class="col-xl-2 col-md-4"><label class="form-label" for="fmonth">Month</label><select class="form-select" id="fmonth">${opt(MONTHS.map((m, i) => [i + 1, m]), filters.month, 'All months')}</select></div>
        <div class="col-xl-1 col-md-4"><label class="form-label" for="fyear">Year</label><select class="form-select" id="fyear">${opt(uniq(state.plans.map((p) => String(p.year))).reverse().map((v) => [v, v]), filters.year, 'All')}</select></div>
        <div class="col-xl-2"><button class="btn btn-light border w-100" id="fReset" type="button">Reset filters</button></div>
      </div></div>
      <section class="card-x" id="listBody"></section>`;
    ['q:fq', 'client:fclient', 'channel:fchannel', 'month:fmonth', 'year:fyear'].forEach((pair) => {
      const [k, id] = pair.split(':');
      $('#' + id).addEventListener('input', (e) => { filters[k] = e.target.value; drawList(); });
    });
    $('#fReset').addEventListener('click', () => { Object.keys(filters).forEach((k) => (filters[k] = '')); viewList(); });
    drawList();
  }
  function drawList() {
    const q = filters.q.toLowerCase();
    const list = state.plans.filter((p) =>
      (!q || [p.client, p.campaign, p.channel, p.programme].some((v) => v.toLowerCase().includes(q))) &&
      (!filters.client || p.client === filters.client) && (!filters.channel || p.channel === filters.channel) &&
      (!filters.month || String(p.month) === filters.month) && (!filters.year || String(p.year) === filters.year))
      .sort((a, b) => b.year - a.year || b.month - a.month || b.updated - a.updated);
    const active = Object.values(filters).some(Boolean);
    $('#listCount').textContent = list.length + ' plan' + (list.length === 1 ? '' : 's') + (active ? ' match your filters.' : '.');
    $('#listBody').innerHTML = list.length ? `<div class="table-responsive"><table class="table table-modern"><thead><tr>
      <th>Client</th><th>Campaign</th><th>Channel</th><th>Programme</th><th>Period</th><th class="text-end">Spots</th><th class="text-end">FCT</th><th class="text-end">Gross budget</th><th>Updated</th><th class="text-end">Actions</th></tr></thead><tbody>
      ${list.map((p) => { const t = planTotals(p); return `<tr><td class="fw-medium">${esc(p.client)}</td><td>${esc(p.campaign)}</td><td>${esc(p.channel)}</td>
        <td>${esc(p.programme)}<div class="text-muted small">${esc(p.type)}</div></td><td class="text-nowrap">${period(p)}</td>
        <td class="text-end tnum">${fmtInt(t.totalSpots)}</td><td class="text-end tnum">${fmtInt(t.totalFct)}</td><td class="text-end fw-semibold tnum text-nowrap">${CUR} ${money(t.tenths)}</td>
        <td class="text-nowrap text-muted small">${new Date(p.updated).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
        <td class="text-end text-nowrap"><a class="btn btn-sm btn-primary" href="#/plan/${p.id}">Open</a>
          <div class="dropdown d-inline-block"><button class="btn btn-sm btn-outline-primary" data-bs-toggle="dropdown" aria-label="More actions"><i class="bi bi-three-dots"></i></button>
            <ul class="dropdown-menu dropdown-menu-end">
              <li><a class="dropdown-item" href="#/edit/${p.id}"><i class="bi bi-pencil"></i> Edit details</a></li>
              <li><button class="dropdown-item" data-act="dup" data-id="${p.id}"><i class="bi bi-copy"></i> Duplicate</button></li><li><hr class="dropdown-divider"></li>
              <li><button class="dropdown-item" data-act="xlsx" data-id="${p.id}"><i class="bi bi-file-earmark-excel"></i> Export Excel</button></li>
              <li><button class="dropdown-item" data-act="pdf" data-id="${p.id}"><i class="bi bi-file-earmark-pdf"></i> Export PDF</button></li>
              <li><button class="dropdown-item" data-act="print" data-id="${p.id}"><i class="bi bi-printer"></i> Print client report</button></li><li><hr class="dropdown-divider"></li>
              <li><button class="dropdown-item text-danger" data-act="del" data-id="${p.id}"><i class="bi bi-trash text-danger"></i> Delete</button></li>
            </ul></div></td></tr>`; }).join('')}
      </tbody></table></div>`
      : `<div class="empty-state"><i class="bi bi-search"></i>${active ? '<p class="mb-0">No media plans match these filters.</p>' : '<p class="mb-2">You have not created any media plans yet.</p><a class="btn btn-primary" href="#/new">Create a media plan</a>'}</div>`;
  }

  // shared row actions (list + editor)
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const p = getPlan(b.dataset.id); if (!p) return;
    const act = b.dataset.act;
    if (act === 'xlsx') exportExcel(p);
    else if (act === 'pdf') exportPDF(p);
    else if (act === 'print') printReport(p);
    else if (act === 'dup') openDuplicate(p);
    else if (act === 'del') {
      if (await confirmDialog('Delete media plan?', 'Delete "' + p.campaign + ' (' + period(p) + ')" with all its time slots and spots? This cannot be undone.', 'Delete plan')) {
        state.plans = state.plans.filter((x) => x.id !== p.id); persist(); toast('Media plan deleted.');
        if (location.hash.startsWith('#/plan/')) location.hash = '#/plans'; else route();
      }
    }
  });

  // ===================== duplicate =====================
  let dupSource = null;
  function openDuplicate(p) {
    dupSource = p;
    $('#dupName').textContent = p.campaign + ' (' + period(p) + ')';
    $('#dupMonth').innerHTML = MONTHS.map((m, i) => '<option value="' + (i + 1) + '">' + m + '</option>').join('');
    $('#dupMonth').value = p.month === 12 ? 1 : p.month + 1;
    $('#dupYear').value = p.month === 12 ? p.year + 1 : p.year;
    $('#dupError').textContent = '';
    bootstrap.Modal.getOrCreateInstance($('#dupModal')).show();
  }
  $('#dupOk').addEventListener('click', () => {
    const m = parseInt($('#dupMonth').value, 10), y = parseInt($('#dupYear').value, 10);
    if (!(m >= 1 && m <= 12) || !(y >= 2000 && y <= 2100)) { $('#dupError').textContent = 'Choose a valid month and a year between 2000 and 2100.'; return; }
    const src = dupSource, copy = JSON.parse(JSON.stringify(src)), dim = daysIn(y, m), spots = {};
    copy.id = uid(); copy.month = m; copy.year = y; copy.created = copy.updated = Date.now(); copy.slots = [];
    src.slots.forEach((s) => {
      const ns = Object.assign({}, s, { id: uid() }); copy.slots.push(ns);
      if ($('#dupSpots').checked) {
        spots[ns.id] = {};
        Object.entries(src.spots[s.id] || {}).forEach(([d, n]) => { if (+d <= dim) spots[ns.id][d] = n; });
      }
    });
    copy.spots = spots; state.plans.push(copy); persist();
    bootstrap.Modal.getInstance($('#dupModal')).hide();
    toast('Plan duplicated into ' + period(copy) + '. You are now editing the copy.');
    location.hash = '#/plan/' + copy.id;
  });

  // ===================== create / edit form =====================
  function viewForm(plan) {
    const edit = !!plan, now = new Date();
    $('#topTitle').textContent = edit ? 'Edit media plan' : 'New media plan';
    const v = plan || { client: '', campaign: '', channel: '', programme: '', type: 'Spot', month: now.getMonth() + 1, year: now.getFullYear(), duration: 30, rate: '', notes: '' };
    const fb = (t) => '<div class="invalid-feedback">' + t + '</div>';
    view.innerHTML = `
      <div class="page-head"><div><h1>${edit ? 'Edit plan details' : 'Create media plan'}</h1>
        <p class="sub">${edit ? esc(plan.campaign) + ' - ' + period(plan) : 'Enter the booking details. You will add the daily spots on the next screen.'}</p></div></div>
      <form id="planForm" novalidate><div class="row g-3">
        <div class="col-lg-7"><section class="card-x card-body-x"><h2 class="form-section-title"><i class="bi bi-building"></i> Client and placement</h2><div class="row g-3">
          <div class="col-md-6"><label class="form-label" for="fClient">Client name <span class="text-danger">*</span></label><input class="form-control" id="fClient" list="dlClients" maxlength="150" required autocomplete="off" value="${esc(v.client)}" placeholder="e.g. Sunrise Foods Ltd">${fb('Enter the client name.')}</div>
          <div class="col-md-6"><label class="form-label" for="fCampaign">Campaign name <span class="text-danger">*</span></label><input class="form-control" id="fCampaign" list="dlCampaigns" maxlength="150" required autocomplete="off" value="${esc(v.campaign)}" placeholder="e.g. Festive Season Launch">${fb('Enter the campaign name.')}</div>
          <div class="col-md-6"><label class="form-label" for="fChannel">Channel name <span class="text-danger">*</span></label><input class="form-control" id="fChannel" list="dlChannels" maxlength="120" required autocomplete="off" value="${esc(v.channel)}" placeholder="e.g. Sun TV">${fb('Enter the channel name.')}</div>
          <div class="col-md-6"><label class="form-label" for="fProgramme">Programme <span class="text-danger">*</span></label><input class="form-control" id="fProgramme" list="dlProgrammes" maxlength="150" required autocomplete="off" value="${esc(v.programme)}" placeholder="e.g. Prime Time Serials">${fb('Enter the programme.')}</div>
          <div class="col-md-6"><label class="form-label" for="fType">Commercial type</label><select class="form-select" id="fType">${TYPES.map((t) => '<option' + (t === v.type ? ' selected' : '') + '>' + t + '</option>').join('')}</select></div>
          <div class="col-12"><label class="form-label" for="fNotes">Notes (optional)</label><textarea class="form-control" id="fNotes" rows="3" maxlength="2000" placeholder="Terms, remarks or special instructions for the client">${esc(v.notes)}</textarea></div>
        </div></section></div>
        <div class="col-lg-5"><section class="card-x card-body-x"><h2 class="form-section-title"><i class="bi bi-calendar3"></i> Month and rate</h2><div class="row g-3">
          <div class="col-7"><label class="form-label" for="fMonth">Month</label><select class="form-select" id="fMonth">${MONTHS.map((m, i) => '<option value="' + (i + 1) + '"' + (i + 1 === v.month ? ' selected' : '') + '>' + m + '</option>').join('')}</select></div>
          <div class="col-5"><label class="form-label" for="fYear">Year</label><input class="form-control" id="fYear" type="number" min="2000" max="2100" step="1" required value="${v.year}">${fb('2000 - 2100.')}</div>
          <div class="col-md-6"><label class="form-label" for="fDuration">Advertisement duration (seconds) <span class="text-danger">*</span></label><input class="form-control" id="fDuration" type="number" min="1" max="600" step="1" required value="${v.duration}">${fb('Whole seconds, 1 - 600.')}</div>
          <div class="col-md-6"><label class="form-label" for="fRate">Gross rate per 10 seconds <span class="text-danger">*</span></label><input class="form-control" id="fRate" type="number" min="0" step="0.01" required value="${v.rate}">${fb('Enter 0 or more (max 2 decimals).')}</div>
        </div>
        <div class="preview-box mt-4" aria-live="polite"><div class="small">Cost of one spot</div><div class="big">${CUR} <span id="spotCost">0.00</span></div><div class="small mt-1">(duration ÷ 10) × rate per 10 seconds</div></div>
        <p class="text-muted small mt-3 mb-0"><i class="bi bi-info-circle"></i> ${edit ? 'If you change the month or year, spots stay on the same day numbers (days that do not exist in the new month are dropped).' : 'Default slots will be added: Morning 07:00 AM - 09:30 AM, Afternoon 12:00 PM - 02:00 PM, Evening 07:00 PM - 11:00 PM. You can edit them in the plan.'}</p>
        </section></div></div>
        <div class="d-flex gap-2 mt-3"><button class="btn btn-primary" type="submit"><i class="bi bi-check2-circle"></i> ${edit ? 'Save changes' : 'Create and schedule spots'}</button>
          <a class="btn btn-light border" href="${edit ? '#/plan/' + plan.id : '#/plans'}">Cancel</a></div>
      </form>
      ${datalist('dlClients', uniq(state.plans.map((p) => p.client)))}${datalist('dlCampaigns', uniq(state.plans.map((p) => p.campaign)))}
      ${datalist('dlChannels', uniq(state.plans.map((p) => p.channel)))}${datalist('dlProgrammes', uniq(state.plans.map((p) => p.programme)))}`;

    const preview = () => {
      const d = parseFloat($('#fDuration').value), r = parseFloat($('#fRate').value);
      $('#spotCost').textContent = d > 0 && r >= 0 ? (Math.round(d * r * 10) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00';
    };
    $('#fDuration').addEventListener('input', preview); $('#fRate').addEventListener('input', preview); preview();

    $('#planForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      ['fClient', 'fCampaign', 'fChannel', 'fProgramme'].forEach((id) => { const el = $('#' + id); el.value = cleanText(el.value); });
      const rate = $('#fRate'), dur = $('#fDuration');
      rate.setCustomValidity(/^\d+(\.\d{1,2})?$/.test(rate.value) ? '' : 'invalid');
      dur.setCustomValidity(/^\d+$/.test(dur.value) ? '' : 'invalid');
      f.classList.add('was-validated');
      if (!f.checkValidity()) { const first = f.querySelector(':invalid'); if (first) first.focus(); return; }
      const data = { client: $('#fClient').value, campaign: $('#fCampaign').value, channel: $('#fChannel').value, programme: $('#fProgramme').value,
        type: $('#fType').value, month: +$('#fMonth').value, year: +$('#fYear').value, duration: +dur.value, rate: Math.round(parseFloat(rate.value) * 100) / 100, notes: $('#fNotes').value.trim() };
      // reuse existing spelling/case for names that already exist
      ['client', 'campaign', 'channel'].forEach((k) => {
        const m = state.plans.find((p) => p[k].toLowerCase() === data[k].toLowerCase()); if (m) data[k] = m[k];
      });
      if (edit) {
        Object.assign(plan, data); plan.updated = Date.now();
        const dim = daysIn(plan.year, plan.month);
        Object.values(plan.spots).forEach((m) => Object.keys(m).forEach((d) => { if (+d > dim) delete m[d]; }));
        persist(); toast('Media plan details updated.'); location.hash = '#/plan/' + plan.id;
      } else {
        const np = Object.assign({ id: uid(), created: Date.now(), updated: Date.now(), slots: [], spots: {} }, data);
        DEFAULT_SLOTS.forEach(([label, start, end]) => np.slots.push({ id: uid(), label, start, end, programme: '' }));
        state.plans.push(np); persist(); toast('Media plan created. Enter the daily spots below.'); location.hash = '#/plan/' + np.id;
      }
    });
  }

  // ===================== editor =====================
  function viewEditor(p) {
    $('#topTitle').textContent = p.client + ' / ' + p.campaign;
    sortSlots(p);
    const c = compute(p), n = p.slots.length, dim = c.days;
    const dayHeads = (fn) => Array.from({ length: dim }, (_, i) => fn(i + 1, isWeekend(p.year, p.month, i + 1) ? 'wk' : '')).join('');
    view.innerHTML = `
      <div class="page-head"><div>
        <nav aria-label="breadcrumb"><ol class="breadcrumb mb-1 small"><li class="breadcrumb-item"><a href="#/plans">Media plans</a></li><li class="breadcrumb-item active">${period(p)}</li></ol></nav>
        <h1>${esc(p.campaign)}</h1>
        <div class="d-flex flex-wrap gap-2 mt-2"><span class="chip"><i class="bi bi-building"></i> ${esc(p.client)}</span><span class="chip"><i class="bi bi-tv"></i> ${esc(p.channel)}</span>
          <span class="chip"><i class="bi bi-collection-play"></i> ${esc(p.programme)}</span><span class="chip"><i class="bi bi-tag"></i> ${esc(p.type)}</span><span class="chip"><i class="bi bi-calendar3"></i> ${period(p)}</span></div></div>
        <div class="d-flex flex-wrap gap-2 align-items-center justify-content-end">
          <span class="save-status" id="saveStatus"><i class="bi bi-check-circle"></i> <span>All changes saved</span></span>
          <button class="btn btn-primary" id="saveBtn"><i class="bi bi-save2"></i> Save plan</button>
          <button class="btn btn-outline-primary" id="qfBtn"><i class="bi bi-magic"></i> Quick fill</button>
          <button class="btn btn-outline-primary" id="slotsBtn"><i class="bi bi-clock-history"></i> Time slots</button>
          <div class="dropdown"><button class="btn btn-outline-primary dropdown-toggle" data-bs-toggle="dropdown"><i class="bi bi-download"></i> Export</button>
            <ul class="dropdown-menu dropdown-menu-end">
              <li><button class="dropdown-item" data-act="xlsx" data-id="${p.id}"><i class="bi bi-file-earmark-excel"></i> Excel (.xlsx)</button></li>
              <li><button class="dropdown-item" data-act="pdf" data-id="${p.id}"><i class="bi bi-file-earmark-pdf"></i> PDF - full plan table (A3)</button></li>
              <li><button class="dropdown-item" data-act="print" data-id="${p.id}"><i class="bi bi-printer"></i> Print / client report</button></li></ul></div>
          <div class="dropdown"><button class="btn btn-light border" data-bs-toggle="dropdown" aria-label="More actions"><i class="bi bi-three-dots"></i></button>
            <ul class="dropdown-menu dropdown-menu-end">
              <li><a class="dropdown-item" href="#/edit/${p.id}"><i class="bi bi-pencil"></i> Edit plan details</a></li>
              <li><button class="dropdown-item" data-act="dup" data-id="${p.id}"><i class="bi bi-copy"></i> Duplicate plan</button></li>
              <li><button class="dropdown-item" id="clearAll"><i class="bi bi-eraser"></i> Clear all spots</button></li><li><hr class="dropdown-divider"></li>
              <li><button class="dropdown-item text-danger" data-act="del" data-id="${p.id}"><i class="bi bi-trash text-danger"></i> Delete plan</button></li></ul></div>
        </div></div>
      <div class="summary-strip">
        <div class="card-x kpi"><div class="label"><i class="bi bi-megaphone"></i> Total spots</div><div class="value" id="sumSpots">${fmtInt(c.totalSpots)}</div></div>
        <div class="card-x kpi"><div class="label"><i class="bi bi-stopwatch"></i> Total FCT (sec)</div><div class="value" id="sumFct">${fmtInt(c.totalFct)}</div></div>
        <div class="card-x kpi"><div class="label"><i class="bi bi-hourglass-split"></i> Ad duration</div><div class="value">${p.duration} sec</div></div>
        <div class="card-x kpi"><div class="label"><i class="bi bi-tag"></i> Rate per 10 sec</div><div class="value">${CUR} ${money(c.rateCents * 10)}</div></div>
        <div class="card-x kpi kpi-hero"><div class="label"><i class="bi bi-cash-stack"></i> Overall gross budget</div><div class="value">${CUR} <span id="sumGross">${money(c.tenths)}</span></div></div></div>
      <div class="grid-wrap"><table class="plan-table" id="grid"><thead>
        <tr><th rowspan="3" class="s1">Channel</th><th rowspan="3" class="s2">Programme</th><th rowspan="3" class="s3">Commercial Type</th><th rowspan="3" class="s4">Time</th>
          <th rowspan="3">Total Spots</th><th rowspan="3">Ad Duration (sec)</th><th rowspan="3">Total FCT (sec)</th><th rowspan="3">Gross Rate per 10 Sec</th><th rowspan="3">Total Gross Amount</th>
          <th colspan="${dim}" class="month-head">${period(p)} - spots per day</th></tr>
        <tr>${dayHeads((d, w) => '<th class="' + w + '">' + d + '</th>')}</tr>
        <tr>${dayHeads((d, w) => '<th class="' + w + '">' + DOWS[dowOf(p.year, p.month, d)].slice(0, 2) + '</th>')}</tr></thead>
        <tbody>${n ? c.rows.map((r, i) => `<tr data-slot="${r.slot.id}">
          ${i === 0 ? '<td rowspan="' + n + '" class="s1 merged">' + esc(p.channel) + '</td>' : ''}<td class="s2">${esc(r.slot.programme || p.programme)}</td>
          ${i === 0 ? '<td rowspan="' + n + '" class="s3 merged">' + esc(p.type) + '</td>' : ''}
          <td class="s4"><div class="slot-label">${esc(r.slot.label)}</div><div class="slot-time">${slotTime(r.slot)}</div></td>
          <td class="num" data-r="spots">${fmtInt(r.spots)}</td><td class="num">${p.duration}</td><td class="num" data-r="fct">${fmtInt(r.fct)}</td>
          <td class="num">${money(c.rateCents * 10)}</td><td class="num strong" data-r="gross">${money(r.tenths)}</td>
          ${Array.from({ length: dim }, (_, k) => { const d = k + 1, val = (p.spots[r.slot.id] || {})[d] || '';
            return '<td class="cell' + (isWeekend(p.year, p.month, d) ? ' wk' : '') + (val ? ' filled' : '') + '"><input class="spot" type="text" inputmode="numeric" maxlength="3" autocomplete="off" data-day="' + d + '" value="' + val + '" aria-label="' + esc(r.slot.label) + ', day ' + d + '"></td>'; }).join('')}
          </tr>`).join('') : '<tr><td colspan="' + (9 + dim) + '" class="text-center text-muted py-5">No time slots yet. Use <strong>Time slots</strong> to add one.</td></tr>'}</tbody>
        <tfoot>
          <tr><td colspan="4" class="s-all">Time slot total / daily total (spots)</td><td class="num" id="totSpots">${fmtInt(c.totalSpots)}</td><td></td><td class="num" id="totFct">${fmtInt(c.totalFct)}</td><td></td><td class="num" id="totGross">${money(c.tenths)}</td>
            ${c.daily.map((v, i) => '<td class="dtot' + (isWeekend(p.year, p.month, i + 1) ? ' wk' : '') + '" data-ds="' + i + '">' + (v ? v : '-') + '</td>').join('')}</tr>
          <tr class="fct"><td colspan="4" class="s-all">Daily FCT (sec)</td><td></td><td></td><td></td><td></td><td></td>
            ${c.daily.map((v, i) => '<td class="dtot' + (isWeekend(p.year, p.month, i + 1) ? ' wk' : '') + '" data-df="' + i + '">' + (v ? v * p.duration : '-') + '</td>').join('')}</tr>
          <tr class="grand"><td colspan="4" class="s-all">Monthly total - overall gross budget</td><td colspan="4" class="text-end">${CUR}</td><td class="num" id="overallGross">${money(c.tenths)}</td><td colspan="${dim}"></td></tr>
        </tfoot></table></div>
      <p class="grid-help"><i class="bi bi-keyboard"></i> Type spots into any day (whole numbers 0-999). Arrow keys and Enter move between cells, and you can paste a block copied from Excel. Changes are saved automatically in this browser.</p>
      ${p.notes ? '<section class="card-x card-body-x mt-3"><h2 class="h6">Notes</h2><p class="mb-0" style="white-space:pre-line">' + esc(p.notes) + '</p></section>' : ''}`;
    bindEditor(p);
  }

  function bindEditor(p) {
    const grid = $('#grid'), set = (id, t) => { const el = $('#' + id); if (el) el.textContent = t; };
    const rowsEls = () => $$('tbody tr[data-slot]', grid);
    let timer = null;

    function refresh() {
      const c = compute(p);
      c.rows.forEach((r) => {
        const tr = $('tbody tr[data-slot="' + r.slot.id + '"]', grid); if (!tr) return;
        $('[data-r=spots]', tr).textContent = fmtInt(r.spots); $('[data-r=fct]', tr).textContent = fmtInt(r.fct); $('[data-r=gross]', tr).textContent = money(r.tenths);
      });
      c.daily.forEach((v, i) => { $('[data-ds="' + i + '"]', grid).textContent = v || '-'; $('[data-df="' + i + '"]', grid).textContent = v ? fmtInt(v * p.duration) : '-'; });
      ['totSpots', 'sumSpots'].forEach((id) => set(id, fmtInt(c.totalSpots)));
      ['totFct', 'sumFct'].forEach((id) => set(id, fmtInt(c.totalFct)));
      ['totGross', 'overallGross', 'sumGross'].forEach((id) => set(id, money(c.tenths)));
      $$('input.spot', grid).forEach((i) => i.closest('td').classList.toggle('filled', (parseInt(i.value, 10) || 0) > 0));
    }
    function store(inp) {
      const slot = inp.closest('tr').dataset.slot, n = parseInt(inp.value, 10) || 0;
      p.spots[slot] = p.spots[slot] || {};
      if (n > 0) p.spots[slot][inp.dataset.day] = Math.min(n, 999); else delete p.spots[slot][inp.dataset.day];
    }
    function touched() {
      refresh(); p.updated = Date.now();
      const st = $('#saveStatus'); st.querySelector('span').textContent = 'Saving...';
      clearTimeout(timer);
      timer = setTimeout(() => { if (persist()) st.querySelector('span').textContent = 'All changes saved'; }, 250);
    }
    grid.addEventListener('input', (e) => {
      if (!e.target.classList.contains('spot')) return;
      const clean = e.target.value.replace(/\D/g, '').slice(0, 3); if (clean !== e.target.value) e.target.value = clean;
      store(e.target); touched();
    });
    grid.addEventListener('focusin', (e) => { if (e.target.classList.contains('spot')) setTimeout(() => e.target.select(), 0); });
    grid.addEventListener('focusout', (e) => {
      if (!e.target.classList.contains('spot')) return;
      const n = parseInt(e.target.value, 10); e.target.value = isNaN(n) || n <= 0 ? '' : String(Math.min(n, 999));
    });
    grid.addEventListener('keydown', (e) => {
      const t = e.target; if (!t.classList.contains('spot')) return;
      const rows = rowsEls(), r = rows.indexOf(t.closest('tr')), d = +t.dataset.day; let tr = r, td = d;
      switch (e.key) {
        case 'ArrowDown': tr = r + 1; break;
        case 'Enter': tr = r + 1; if (tr >= rows.length) { tr = 0; td = d + 1; } break;
        case 'ArrowUp': tr = r - 1; break;
        case 'ArrowRight': if (t.selectionEnd !== t.value.length) return; td = d + 1; break;
        case 'ArrowLeft': if (t.selectionStart !== 0) return; td = d - 1; break;
        default: return;
      }
      const next = rows[tr] && $('input.spot[data-day="' + td + '"]', rows[tr]);
      if (next) { e.preventDefault(); next.focus(); }
    });
    grid.addEventListener('paste', (e) => {
      const t = e.target; if (!t.classList.contains('spot')) return;
      const text = (e.clipboardData || window.clipboardData).getData('text');
      if (!/[\t\n]/.test(text.trim())) return;
      e.preventDefault();
      const block = text.replace(/\r/g, '').split('\n').filter(Boolean).map((l) => l.split('\t'));
      const rows = rowsEls(), r0 = rows.indexOf(t.closest('tr')), d0 = +t.dataset.day;
      block.forEach((cols, r) => cols.forEach((val, k) => {
        const inp = rows[r0 + r] && $('input.spot[data-day="' + (d0 + k) + '"]', rows[r0 + r]); if (!inp) return;
        const n = parseInt(val.trim(), 10); inp.value = isNaN(n) || n <= 0 ? '' : String(Math.min(n, 999)); store(inp);
      }));
      touched();
    });
    $('#saveBtn').addEventListener('click', () => { if (persist()) { $('#saveStatus span').textContent = 'All changes saved'; toast('Media plan saved.'); } });
    document.onkeydown = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && $('#saveBtn')) { e.preventDefault(); $('#saveBtn').click(); } };
    $('#clearAll').addEventListener('click', async () => {
      if (await confirmDialog('Clear all spots?', 'Remove every scheduled spot from this plan?', 'Clear spots')) { p.spots = {}; persist(); viewEditor(p); toast('All spots cleared.'); }
    });

    // ---- quick fill
    $('#qfBtn').addEventListener('click', () => {
      $('#qfSlot').innerHTML = '<option value="all">All time slots</option>' + p.slots.map((s) => '<option value="' + s.id + '">' + esc(s.label) + ' (' + slotTime(s) + ')</option>').join('');
      $('#qfFrom').value = 1; $('#qfTo').value = daysIn(p.year, p.month); $('#qfTo').max = $('#qfFrom').max = daysIn(p.year, p.month);
      $('#qfDows').innerHTML = DOWS.map((d, i) => '<div class="form-check"><input class="form-check-input qf-dow" type="checkbox" value="' + i + '" id="qd' + i + '" checked><label class="form-check-label" for="qd' + i + '">' + d + '</label></div>').join('');
      $('#qfError').textContent = ''; bootstrap.Modal.getOrCreateInstance($('#qfModal')).show();
    });
    $('#qfApply').onclick = () => {
      const spots = parseInt($('#qfSpots').value, 10), from = parseInt($('#qfFrom').value, 10), to = parseInt($('#qfTo').value, 10), slot = $('#qfSlot').value, dim = daysIn(p.year, p.month);
      const dows = new Set($$('.qf-dow:checked').map((x) => +x.value)), err = $('#qfError');
      if (isNaN(spots) || spots < 0 || spots > 999) { err.textContent = 'Spots per day must be a whole number from 0 to 999.'; return; }
      if (isNaN(from) || isNaN(to) || from < 1 || to > dim || from > to) { err.textContent = 'Choose a valid range of days (1 to ' + dim + ').'; return; }
      if (!dows.size) { err.textContent = 'Select at least one day of the week.'; return; }
      let changed = 0;
      p.slots.forEach((s) => {
        if (slot !== 'all' && s.id !== slot) return;
        p.spots[s.id] = p.spots[s.id] || {};
        for (let d = from; d <= to; d++) { if (!dows.has(dowOf(p.year, p.month, d))) continue; if (spots > 0) p.spots[s.id][d] = spots; else delete p.spots[s.id][d]; changed++; }
      });
      p.updated = Date.now(); persist(); bootstrap.Modal.getInstance($('#qfModal')).hide(); viewEditor(p);
      toast(changed + ' cell' + (changed === 1 ? '' : 's') + ' updated.', 'primary');
    };
    $('#slotsBtn').addEventListener('click', () => { drawSlots(p); bootstrap.Modal.getOrCreateInstance($('#slotModal')).show(); });
  }

  // ===================== time slot manager =====================
  function drawSlots(p, editId) {
    sortSlots(p);
    const e = p.slots.find((s) => s.id === editId) || { label: '', start: '', end: '', programme: '' };
    $('#slotBody').innerHTML = `
      ${p.slots.length ? `<div class="table-responsive"><table class="table table-modern table-sm align-middle"><thead><tr><th>Name</th><th>Time</th><th>Programme</th><th class="text-end">Spots</th><th class="text-end">Actions</th></tr></thead><tbody>
        ${p.slots.map((s) => { const spots = Object.values(p.spots[s.id] || {}).reduce((a, b) => a + b, 0);
          return `<tr><td class="fw-medium">${esc(s.label)}</td><td class="text-nowrap">${slotTime(s)}</td><td>${s.programme ? esc(s.programme) : '<span class="text-muted">Plan programme</span>'}</td><td class="text-end">${fmtInt(spots)}</td>
          <td class="text-end text-nowrap"><button class="btn btn-sm btn-outline-primary" data-edit="${s.id}"><i class="bi bi-pencil"></i> Edit</button>
          <button class="btn btn-sm btn-outline-danger" data-del="${s.id}"><i class="bi bi-trash"></i> Delete</button></td></tr>`; }).join('')}</tbody></table></div>` : '<p class="text-muted">No time slots yet. Add one below.</p>'}
      <hr><form id="slotForm" novalidate><h6 class="mb-3">${editId ? 'Edit time slot: ' + esc(e.label) : 'Add a time slot'}</h6><div class="row g-3">
        <div class="col-md-4"><label class="form-label" for="sLabel">Name <span class="text-danger">*</span></label><input class="form-control" id="sLabel" maxlength="60" required value="${esc(e.label)}" placeholder="e.g. Late night"><div class="invalid-feedback">Enter a name.</div></div>
        <div class="col-6 col-md-4"><label class="form-label" for="sStart">Start time <span class="text-danger">*</span></label><input class="form-control" type="time" id="sStart" required value="${e.start}"><div class="invalid-feedback">Choose a start time.</div></div>
        <div class="col-6 col-md-4"><label class="form-label" for="sEnd">End time <span class="text-danger">*</span></label><input class="form-control" type="time" id="sEnd" required value="${e.end}"><div class="invalid-feedback" id="sEndMsg">Choose an end time after the start.</div></div>
        <div class="col-12"><label class="form-label" for="sProg">Programme (optional)</label><input class="form-control" id="sProg" maxlength="150" value="${esc(e.programme)}" placeholder="Leave empty to use “${esc(p.programme)}”"></div></div>
        <div class="d-flex gap-2 mt-3"><button class="btn btn-primary" type="submit">${editId ? '<i class="bi bi-check2"></i> Save time slot' : '<i class="bi bi-plus-lg"></i> Add time slot'}</button>
          ${editId ? '<button class="btn btn-light border" type="button" id="sCancel">Cancel edit</button>' : ''}</div></form>`;
    const body = $('#slotBody'), end = $('#sEnd', body), start = $('#sStart', body);
    const check = () => { const bad = start.value && end.value && end.value <= start.value; end.setCustomValidity(bad ? 'bad' : ''); $('#sEndMsg').textContent = bad ? 'End time must be later than the start time.' : 'Choose an end time after the start.'; };
    start.addEventListener('input', check); end.addEventListener('input', check); check();
    $$('[data-edit]', body).forEach((b) => b.addEventListener('click', () => drawSlots(p, b.dataset.edit)));
    $$('[data-del]', body).forEach((b) => b.addEventListener('click', async () => {
      const s = p.slots.find((x) => x.id === b.dataset.del);
      if (!(await confirmDialog('Delete time slot?', 'Delete "' + s.label + '" and all of its scheduled spots?', 'Delete slot'))) return;
      p.slots = p.slots.filter((x) => x.id !== s.id); delete p.spots[s.id]; p.updated = Date.now(); persist(); viewEditor(p);
      bootstrap.Modal.getOrCreateInstance($('#slotModal')).show(); drawSlots(p); toast('Time slot deleted.');
    }));
    const cancel = $('#sCancel', body); if (cancel) cancel.addEventListener('click', () => drawSlots(p));
    $('#slotForm', body).addEventListener('submit', (ev) => {
      ev.preventDefault(); const f = ev.target; $('#sLabel', body).value = cleanText($('#sLabel', body).value); f.classList.add('was-validated');
      if (!f.checkValidity()) return;
      const data = { label: $('#sLabel', body).value, start: start.value, end: end.value, programme: cleanText($('#sProg', body).value) };
      if (editId) Object.assign(p.slots.find((s) => s.id === editId), data); else p.slots.push(Object.assign({ id: uid() }, data));
      p.updated = Date.now(); persist(); viewEditor(p); drawSlots(p); toast('Time slot ' + (editId ? 'updated' : 'added') + '.');
    });
  }

  // ===================== exports =====================
  async function exportExcel(p) {
    if (typeof ExcelJS === 'undefined') return toast('Excel library did not load. Check your internet connection.', 'danger');
    sortSlots(p);
    const c = compute(p), nd = c.days, rows = p.slots, nr = Math.max(rows.length, 1);
    const FIXED = 9, FD = 10, LAST = FIXED + nd, HEAD = 7, D0 = 10, DL = D0 + nr - 1, TR = DL + 1, FR = TR + 1, GR = TR + 2;
    const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('Media Plan', {
      views: [{ state: 'frozen', xSplit: 4, ySplit: 9, showGridLines: false }],
      pageSetup: { orientation: 'landscape', paperSize: 8, fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
    const L = (i) => ws.getColumn(i).letter;
    const NAVY = 'FF0B2A5B', BLUE = 'FF1F5FBF', DEEP = 'FF17428A', SKY = 'FFE8F0FC', WK = 'FFEEF3FB', WHITE = 'FFFFFFFF';
    const thin = { style: 'thin', color: { argb: 'FF9DB2D6' } }, B = { top: thin, left: thin, bottom: thin, right: thin };
    const fill = (a) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: a } });
    const cell = (r, cc) => ws.getCell(r, cc);
    const put = (r, cc, v, o) => { const x = cell(r, cc); x.value = v; if (o) { if (o.font) x.font = o.font; if (o.fill) x.fill = fill(o.fill); if (o.al) x.alignment = o.al; if (o.fmt) x.numFmt = o.fmt; } return x; };
    const box = (r1, c1, r2, c2) => { for (let r = r1; r <= r2; r++) for (let k = c1; k <= c2; k++) cell(r, k).border = B; };
    const merge = (r1, c1, r2, c2) => { if (r1 !== r2 || c1 !== c2) ws.mergeCells(r1, c1, r2, c2); };
    const cen = { horizontal: 'center', vertical: 'middle', wrapText: true }, lef = { horizontal: 'left', vertical: 'middle', wrapText: true, indent: 1 }, rig = { horizontal: 'right', vertical: 'middle', indent: 1 };
    const fw = { name: 'Calibri', bold: true, color: { argb: WHITE }, size: 10 }, fb = { name: 'Calibri', bold: true, color: { argb: NAVY }, size: 10 }, fn = { name: 'Calibri', size: 10 };
    const mfmt = '"' + CUR + '" #,##0.00';

    merge(1, 1, 1, LAST); put(1, 1, 'TV ADVERTISEMENT MEDIA PLAN', { font: { name: 'Calibri', bold: true, size: 16, color: { argb: WHITE } }, fill: NAVY, al: { vertical: 'middle', indent: 1 } }); ws.getRow(1).height = 32;
    merge(2, 1, 2, LAST); put(2, 1, p.client + '   |   ' + p.campaign + '   |   ' + period(p), { font: { name: 'Calibri', bold: true, size: 11, color: { argb: NAVY } }, fill: SKY, al: { vertical: 'middle', indent: 1 } }); ws.getRow(2).height = 22;
    const pair = (r, lc, vs, ve, label, value, o) => { put(r, lc, label, { font: fb, fill: SKY, al: lef }); merge(r, vs, r, ve); put(r, vs, value, Object.assign({ font: fn, al: lef }, o)); box(r, lc, r, ve); };
    pair(3, 1, 2, 3, 'Client', p.client); pair(3, 4, 5, 7, 'Campaign', p.campaign); pair(3, 8, 9, 9, 'Month', period(p));
    pair(4, 1, 2, 3, 'Channel', p.channel); pair(4, 4, 5, 7, 'Programme', p.programme); pair(4, 8, 9, 9, 'Commercial type', p.type);
    pair(5, 1, 2, 3, 'Ad duration (sec)', p.duration, { fmt: '0' }); pair(5, 4, 5, 7, 'Gross rate / 10 sec', p.rate, { fmt: mfmt });
    pair(5, 8, 9, 9, 'Gross budget', { formula: 'I' + GR, result: c.tenths / 1000 }, { fmt: mfmt, font: { name: 'Calibri', bold: true, size: 11, color: { argb: NAVY } } });
    [3, 4, 5].forEach((r) => (ws.getRow(r).height = 20)); ws.getRow(6).height = 8;
    const DUR = '$B$5', RATE = '$E$5';

    ['Channel', 'Programme', 'Commercial Type', 'Time', 'Total Spots', 'Ad Duration (sec)', 'Total FCT (sec)', 'Gross Rate per 10 Sec', 'Total Gross Amount'].forEach((h, i) => { merge(HEAD, i + 1, HEAD + 2, i + 1); put(HEAD, i + 1, h, { font: fw, fill: NAVY, al: cen }); });
    box(HEAD, 1, HEAD + 2, FIXED);
    merge(HEAD, FD, HEAD, LAST); put(HEAD, FD, period(p).toUpperCase() + '  -  DATE-WISE SCHEDULE (SPOTS PER DAY)', { font: fw, fill: NAVY, al: cen });
    for (let d = 1; d <= nd; d++) {
      const fl = isWeekend(p.year, p.month, d) ? DEEP : BLUE;
      put(HEAD + 1, FIXED + d, d, { font: fw, fill: fl, al: cen }); put(HEAD + 2, FIXED + d, DOWS[dowOf(p.year, p.month, d)].slice(0, 2), { font: fw, fill: fl, al: cen });
    }
    box(HEAD, FD, HEAD + 2, LAST); ws.getRow(HEAD).height = 24; ws.getRow(HEAD + 1).height = 18; ws.getRow(HEAD + 2).height = 18;

    for (let i = 0; i < nr; i++) {
      const r = D0 + i, s = rows[i], cr = c.rows[i];
      put(r, 2, s ? (s.programme || p.programme) : '', { font: fn, al: lef });
      put(r, 4, s ? s.label + '\n' + slotTime(s) : 'No time slots defined', { font: fn, al: lef });
      put(r, 5, { formula: 'SUM(' + L(FD) + r + ':' + L(LAST) + r + ')', result: cr ? cr.spots : 0 }, { font: fn, al: rig, fmt: '#,##0' });
      put(r, 6, { formula: DUR, result: p.duration }, { font: fn, al: rig, fmt: '#,##0' });
      put(r, 7, { formula: 'E' + r + '*F' + r, result: cr ? cr.fct : 0 }, { font: fn, al: rig, fmt: '#,##0' });
      put(r, 8, { formula: RATE, result: p.rate }, { font: fn, al: rig, fmt: mfmt });
      put(r, 9, { formula: 'G' + r + '/10*H' + r, result: cr ? cr.tenths / 1000 : 0 }, { font: { name: 'Calibri', bold: true, size: 10 }, al: rig, fmt: mfmt });
      for (let d = 1; d <= nd; d++) { const v = s ? (p.spots[s.id] || {})[d] : null; put(r, FIXED + d, v || null, { font: fn, al: cen, fmt: '0', fill: isWeekend(p.year, p.month, d) ? WK : undefined }); }
      ws.getRow(r).height = 32;
    }
    [[1, p.channel], [3, p.type]].forEach(([col, v]) => { merge(D0, col, DL, col); put(D0, col, v, { font: fb, al: cen }); });
    box(D0, 1, DL, LAST);
    ws.dataValidations.add(L(FD) + D0 + ':' + L(LAST) + DL, { type: 'whole', operator: 'between', allowBlank: true, showErrorMessage: true, errorTitle: 'Invalid spots', error: 'Enter a whole number between 0 and 999.', formulae: [0, 999] });

    merge(TR, 1, TR, 4); put(TR, 1, 'TOTAL (all time slots)');
    put(TR, 5, { formula: 'SUM(E' + D0 + ':E' + DL + ')', result: c.totalSpots }); put(TR, 7, { formula: 'SUM(G' + D0 + ':G' + DL + ')', result: c.totalFct }); put(TR, 9, { formula: 'SUM(I' + D0 + ':I' + DL + ')', result: c.tenths / 1000 });
    merge(FR, 1, FR, 4); put(FR, 1, 'Daily FCT (sec)'); put(FR, 7, { formula: 'G' + TR, result: c.totalFct });
    for (let d = 1; d <= nd; d++) {
      put(TR, FIXED + d, { formula: 'SUM(' + L(FIXED + d) + D0 + ':' + L(FIXED + d) + DL + ')', result: c.daily[d - 1] });
      put(FR, FIXED + d, { formula: L(FIXED + d) + TR + '*' + DUR, result: c.daily[d - 1] * p.duration });
    }
    [TR, FR].forEach((r) => { for (let k = 1; k <= LAST; k++) { const x = cell(r, k); x.font = fb; x.fill = fill(SKY); x.alignment = k >= FD ? cen : (k === 1 ? lef : rig); x.numFmt = '#,##0'; } ws.getRow(r).height = 22; });
    cell(TR, 9).numFmt = mfmt; box(TR, 1, FR, LAST);
    merge(GR, 1, GR, 8); put(GR, 1, 'OVERALL GROSS BUDGET'); put(GR, 9, { formula: 'I' + TR, result: c.tenths / 1000 });
    for (let k = 1; k <= FIXED; k++) { const x = cell(GR, k); x.font = { name: 'Calibri', bold: true, size: 12, color: { argb: WHITE } }; x.fill = fill(NAVY); x.alignment = k === 1 ? lef : rig; }
    cell(GR, 9).numFmt = mfmt; ws.getRow(GR).height = 26; box(GR, 1, GR, FIXED);

    let nr2 = GR + 2; merge(nr2, 1, nr2, 9);
    put(nr2, 1, 'Formulas: Total FCT = Total Spots x Ad Duration;  Gross Amount = (Total FCT / 10) x Gross Rate per 10 Sec.', { font: { name: 'Calibri', italic: true, size: 9, color: { argb: 'FF4A5B7C' } } });
    if (p.notes) { nr2++; merge(nr2, 1, nr2, 9); put(nr2, 1, 'Notes: ' + p.notes, { font: fn, al: { wrapText: true, vertical: 'top' } }); ws.getRow(nr2).height = 45; }
    [18, 24, 16, 22, 10, 11, 12, 16, 18].forEach((w, i) => (ws.getColumn(i + 1).width = w));
    for (let k = FD; k <= LAST; k++) ws.getColumn(k).width = 4.6;
    ws.pageSetup.printTitlesRow = HEAD + ':' + (HEAD + 2);
    download(new Blob([await wb.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), fileName(p, 'xlsx'));
    toast('Excel file downloaded.');
  }

  function exportPDF(p) {
    if (!window.jspdf || !window.jspdf.jsPDF) return toast('PDF library did not load. Check your internet connection.', 'danger');
    sortSlots(p);
    const { jsPDF } = window.jspdf, doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a3' });
    const c = compute(p), nd = c.days, n = p.slots.length, W = doc.internal.pageSize.getWidth(), M = 36;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.setTextColor(11, 42, 91); doc.text('TV Advertisement Media Plan', M, 42);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(74, 91, 124);
    doc.text(p.campaign + ' for ' + p.client + ' - ' + period(p), M, 58);
    doc.autoTable({ startY: 70, margin: { left: M, right: M }, theme: 'grid', styles: { fontSize: 8.5, cellPadding: 5, lineColor: [185, 201, 228], lineWidth: .4, fillColor: [232, 240, 252], textColor: [20, 33, 61] },
      body: [['Client: ' + p.client, 'Campaign: ' + p.campaign, 'Channel: ' + p.channel, 'Month: ' + period(p)],
             ['Programme: ' + p.programme, 'Commercial type: ' + p.type, 'Ad duration: ' + p.duration + ' sec', 'Gross rate per 10 sec: ' + CUR_PDF + ' ' + money(c.rateCents * 10)]] });
    const fixedW = [64, 92, 62, 90, 40, 44, 50, 62, 82], dw = Math.max((W - 2 * M - fixedW.reduce((a, b) => a + b, 0)) / nd, 12);
    const head = [
      ['Channel', 'Programme', 'Commercial Type', 'Time', 'Total Spots', 'Ad Duration (sec)', 'Total FCT (sec)', 'Gross Rate per 10 Sec', 'Total Gross Amount'].map((t) => ({ content: t, rowSpan: 3 }))
        .concat([{ content: period(p) + ' - spots per day', colSpan: nd }]),
      Array.from({ length: nd }, (_, i) => String(i + 1)), Array.from({ length: nd }, (_, i) => DOWS[dowOf(p.year, p.month, i + 1)].slice(0, 2))];
    const body = n ? c.rows.map((r, i) => {
      const row = [];
      if (i === 0) row.push({ content: p.channel, rowSpan: n, styles: { fontStyle: 'bold', halign: 'left' } });
      row.push({ content: r.slot.programme || p.programme, styles: { halign: 'left' } });
      if (i === 0) row.push({ content: p.type, rowSpan: n, styles: { halign: 'left' } });
      row.push({ content: r.slot.label + '\n' + slotTime(r.slot), styles: { halign: 'left' } }, fmtInt(r.spots), String(p.duration), fmtInt(r.fct), money(c.rateCents * 10), { content: money(r.tenths), styles: { fontStyle: 'bold', halign: 'right' } });
      for (let d = 1; d <= nd; d++) row.push((p.spots[r.slot.id] || {})[d] || '');
      return row;
    }) : [[{ content: 'No time slots defined', colSpan: 9 + nd }]];
    const foot = [
      [{ content: 'TOTAL (all time slots)', colSpan: 4, styles: { halign: 'left' } }, fmtInt(c.totalSpots), '', fmtInt(c.totalFct), '', money(c.tenths)].concat(c.daily.map((v) => v || '')),
      [{ content: 'Daily FCT (sec)', colSpan: 4, styles: { halign: 'left' } }, '', '', fmtInt(c.totalFct), '', ''].concat(c.daily.map((v) => (v ? v * p.duration : ''))),
      [{ content: 'OVERALL GROSS BUDGET', colSpan: 8, styles: { halign: 'right' } }, { content: CUR_PDF + ' ' + money(c.tenths), styles: { halign: 'right' } }, { content: '', colSpan: nd }]];
    const colStyles = {}; fixedW.forEach((w, i) => (colStyles[i] = { cellWidth: w })); for (let i = 0; i < nd; i++) colStyles[9 + i] = { cellWidth: dw };
    doc.autoTable({ head, body, foot, showFoot: 'lastPage', startY: doc.lastAutoTable.finalY + 12, margin: { left: M, right: M }, theme: 'grid', columnStyles: colStyles,
      styles: { fontSize: 6.8, cellPadding: 2.5, halign: 'center', valign: 'middle', lineColor: [185, 201, 228], lineWidth: .4, textColor: [20, 33, 61] },
      headStyles: { fillColor: [11, 42, 91], textColor: 255, fontStyle: 'bold' }, footStyles: { fillColor: [232, 240, 252], textColor: [11, 42, 91], fontStyle: 'bold' },
      didParseCell: (h) => {
        const col = h.column.index - 9, wk = col >= 0 && isWeekend(p.year, p.month, col + 1);
        if (h.section === 'head' && h.row.index > 0) { h.cell.styles.fillColor = wk ? [23, 66, 138] : [31, 95, 191]; }
        if (h.section === 'body' && wk) h.cell.styles.fillColor = [238, 243, 251];
        if (h.section === 'foot' && h.row.index === 2) { h.cell.styles.fillColor = [11, 42, 91]; h.cell.styles.textColor = 255; }
      } });
    let y = doc.lastAutoTable.finalY + 18;
    if (p.notes) { doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(11, 42, 91); doc.text('Notes', M, y); doc.setFont('helvetica', 'normal'); doc.setTextColor(36, 51, 82); doc.text(doc.splitTextToSize(p.notes, W - 2 * M), M, y + 14); }
    doc.save(fileName(p, 'pdf')); toast('PDF downloaded.');
  }

  function printReport(p) {
    sortSlots(p);
    const c = compute(p), half = Math.ceil(c.days / 2), blocks = [];
    for (let s = 1; s <= c.days; s += half) blocks.push([s, Math.min(s + half - 1, c.days)]);
    const wk = (d) => (isWeekend(p.year, p.month, d) ? ' wk' : '');
    $('#printArea').innerHTML = `<div class="rp">
      <div class="rp-band"><strong>TV Advertisement Media Plan</strong><span>${period(p)}</span></div>
      <h1>${esc(p.campaign)}</h1><p class="subtitle">Prepared for ${esc(p.client)} - ${period(p)}</p>
      <div class="rp-details"><div><span>Client</span><b>${esc(p.client)}</b></div><div><span>Channel</span><b>${esc(p.channel)}</b></div><div><span>Programme</span><b>${esc(p.programme)}</b></div><div><span>Commercial type</span><b>${esc(p.type)}</b></div></div>
      <div class="rp-kpis"><div><span>Total spots</span><b>${fmtInt(c.totalSpots)}</b></div><div><span>Total FCT (sec)</span><b>${fmtInt(c.totalFct)}</b></div>
        <div><span>Ad duration / rate per 10 sec</span><b>${p.duration} sec / ${money(c.rateCents * 10)}</b></div><div><span>Gross budget</span><b>${CUR} ${money(c.tenths)}</b></div></div>
      <h2>Plan summary by time slot</h2><table><thead><tr><th>Time slot</th><th>Programme</th><th>Time</th><th>Spots</th><th>Ad duration (sec)</th><th>Total FCT (sec)</th><th>Rate per 10 sec</th><th>Gross amount</th></tr></thead><tbody>
        ${c.rows.map((r) => `<tr><td><b>${esc(r.slot.label)}</b></td><td>${esc(r.slot.programme || p.programme)}</td><td>${slotTime(r.slot)}</td><td class="n">${fmtInt(r.spots)}</td><td class="n">${p.duration}</td><td class="n">${fmtInt(r.fct)}</td><td class="n">${money(c.rateCents * 10)}</td><td class="n">${money(r.tenths)}</td></tr>`).join('') || '<tr><td colspan="8" class="c">No time slots defined.</td></tr>'}
        <tr class="total"><td colspan="3">Total</td><td class="n">${fmtInt(c.totalSpots)}</td><td></td><td class="n">${fmtInt(c.totalFct)}</td><td></td><td class="n">${CUR} ${money(c.tenths)}</td></tr></tbody></table>
      <h2>Date-wise schedule (spots per day)</h2>
      ${blocks.map(([a, b]) => { const days = Array.from({ length: b - a + 1 }, (_, i) => a + i); return `<table class="sched"><thead>
        <tr><th class="lbl" rowspan="2">Time slot</th>${days.map((d) => '<th class="' + wk(d).trim() + '">' + d + '</th>').join('')}<th class="tot" rowspan="2">Total</th></tr>
        <tr>${days.map((d) => '<th class="' + wk(d).trim() + '">' + DOWS[dowOf(p.year, p.month, d)].slice(0, 2) + '</th>').join('')}</tr></thead><tbody>
        ${p.slots.map((s) => { const m = p.spots[s.id] || {}; return '<tr><td class="lbl"><b>' + esc(s.label) + '</b><br>' + slotTime(s) + '</td>' + days.map((d) => '<td class="c' + wk(d) + '">' + (m[d] || '') + '</td>').join('') + '<td class="c"><b>' + days.reduce((t, d) => t + (m[d] || 0), 0) + '</b></td></tr>'; }).join('')}
        <tr class="total"><td class="lbl">Daily total</td>${days.map((d) => '<td class="c">' + (c.daily[d - 1] || '') + '</td>').join('')}<td class="c">${days.reduce((t, d) => t + c.daily[d - 1], 0)}</td></tr></tbody></table>`; }).join('')}
      ${p.notes ? '<h2>Notes</h2><p class="notes">' + esc(p.notes) + '</p>' : ''}
      <div class="sign"><div>Prepared by (agency)</div><div>Approved by (client)</div></div></div>`;
    setTimeout(() => window.print(), 100);
  }

  // ===================== backup / restore, sidebar =====================
  $('#backupBtn').addEventListener('click', (e) => { e.preventDefault(); download(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }), 'media-planner-backup.json'); toast('Backup downloaded.'); });
  $('#restoreBtn').addEventListener('click', (e) => { e.preventDefault(); $('#restoreFile').click(); });
  $('#restoreFile').addEventListener('change', async (e) => {
    const file = e.target.files[0]; e.target.value = ''; if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data || !Array.isArray(data.plans) || data.plans.some((p) => !p.id || !p.slots || !p.spots || !p.month || !p.year)) throw new Error('bad');
      if (!(await confirmDialog('Restore backup?', 'This replaces all ' + state.plans.length + ' current plan(s) with the ' + data.plans.length + ' plan(s) in the file.', 'Restore'))) return;
      state = data; persist(); toast('Backup restored.'); route();
    } catch (err) { toast('That file is not a valid Media Planner backup.', 'danger'); }
  });
  const shell = $('#appShell'), narrow = () => window.matchMedia('(max-width: 991.98px)').matches;
  try { if (!narrow() && localStorage.getItem(KEY + '.sb') === '1') shell.classList.add('collapsed'); } catch (e) { /* ignore */ }
  $('#sidebarToggle').addEventListener('click', () => {
    if (narrow()) return shell.classList.toggle('open');
    shell.classList.toggle('collapsed'); try { localStorage.setItem(KEY + '.sb', shell.classList.contains('collapsed') ? '1' : '0'); } catch (e) { /* ignore */ }
  });
  window.addEventListener('afterprint', () => { $('#printArea').innerHTML = ''; });

  route();
})();
