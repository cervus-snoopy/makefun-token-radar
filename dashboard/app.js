// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, a filterable table, a per-protocol detail
// drawer with the model's own arithmetic and the protocol's farm plan, the live
// tokens the market already prices, and the method itself. No network: every
// byte it shows is in data.js, and every implied value is recomputed here from
// the row's own figures, so the page and the board visibly agree.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var MODEL = DATA.model;
  var WATCH = {};
  DATA.watchlist.forEach(function (s) { WATCH[s] = true; });

  var state = { q: '', category: 'all', chain: 'all', watchlist: false, tab: 'board', sort: 'implied', selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // The model, as main.ts runs it: the page recomputes a row from the snapshot
  // figures and checks the number board.json carries, so the two can never drift apart.
  function impliedOf(row) {
    var growth = Math.min(MODEL.growth_cap, Math.max(MODEL.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * MODEL.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? MODEL.unknown_age_days : row.age_days;
    var maturity = MODEL.maturity_floor + (Math.min(Math.max(age, 0), MODEL.maturity_days) / MODEL.maturity_days) * MODEL.maturity_range;
    var chainMult = 1 + MODEL.chain_step * Math.min(Math.max(row.chains.length - 1, 0), MODEL.chain_max_extra);
    return Math.max(1, Math.round(row.tvl_usd * row.comp_multiple * growthMult * maturity * chainMult));
  }

  function $(id) { return document.getElementById(id); }
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    var rows = DATA.rows.filter(function (r) {
      if (state.watchlist && !WATCH[r.slug]) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (q && (r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0 && String(r.category || '').toLowerCase().indexOf(q) < 0)) return false;
      return true;
    });
    var by = {
      implied: function (a, b) { return a.rank - b.rank; },
      tvl: function (a, b) { return b.tvl_usd - a.tvl_usd || a.rank - b.rank; },
      growth: function (a, b) { return (b.change_7d || 0) - (a.change_7d || 0) || a.rank - b.rank; },
      age: function (a, b) { return (b.age_days || 0) - (a.age_days || 0) || a.rank - b.rank; },
      readiness: function (a, b) { return b.readiness - a.readiness || a.rank - b.rank; },
    }[state.sort] || function (a, b) { return a.rank - b.rank; };
    return rows.sort(by);
  }

  function renderStats() {
    var top = DATA.rows[0];
    $('stats').innerHTML = [
      ['Board', DATA.board_size + ' rows'],
      ['Watchlist', DATA.watchlist_size + ' covered'],
      ['Early radar', DATA.early_size + ' more'],
      ['Top implied', top ? fmtUsd(top.implied_value_usd) : 'n/a'],
      ['Snapshot', esc(DATA.as_of)],
    ].map(function (kv) {
      return '<div><dt>' + esc(kv[0]) + '</dt><dd>' + kv[1] + '</dd></div>';
    }).join('');
    $('foot-asof').textContent = DATA.as_of;
    $('foot-source').textContent = DATA.source;
    $('foot-model').textContent = DATA.model_version;
  }

  function renderRows() {
    var rows = filteredRows();
    var tbody = $('rows');
    tbody.innerHTML = '';
    $('count').textContent = rows.length + ' of ' + DATA.board_size + ' protocols' +
      (state.watchlist ? ' · watchlist only' : '') +
      (state.category !== 'all' ? ' · ' + state.category : '') +
      (state.chain !== 'all' ? ' · ' + state.chain : '') +
      (state.q.trim() ? ' · matching "' + state.q.trim() + '"' : '');
    var frag = document.createDocumentFragment();
    rows.forEach(function (r) {
      var tr = el('tr', { class: state.selected === r.slug ? 'is-selected' : '', onclick: function () { openDetail(r.slug); } });
      tr.appendChild(el('td', { class: 'num', text: String(r.rank) }));
      var nameCell = el('td');
      var strong = el('span', { class: 'proto', text: r.name });
      nameCell.appendChild(strong);
      if (WATCH[r.slug]) nameCell.appendChild(el('span', { class: 'badge', text: 'watchlist' }));
      nameCell.appendChild(el('span', { class: 'slug', text: r.slug }));
      tr.appendChild(nameCell);
      tr.appendChild(el('td', { text: r.category || '—' }));
      tr.appendChild(el('td', { text: r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') }));
      tr.appendChild(el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }));
      var g = r.change_7d;
      tr.appendChild(el('td', { class: 'num ' + (g === null ? '' : g >= 0 ? 'up' : 'down'), text: fmtPct(g) }));
      tr.appendChild(el('td', { class: 'num', text: fmtAge(r.age_days) }));
      var ready = el('td', { class: 'num' });
      ready.appendChild(el('span', { class: 'meter' }, el('i', { style: 'width:' + r.readiness + '%' })));
      ready.appendChild(document.createTextNode(String(r.readiness)));
      tr.appendChild(ready);
      tr.appendChild(el('td', { class: 'num', text: fmtUsd(r.implied_value_usd) }));
      frag.appendChild(tr);
    });
    tbody.appendChild(frag);
  }

  function renderLive() {
    var tbody = $('live-rows');
    tbody.innerHTML = '';
    var frag = document.createDocumentFragment();
    DATA.live.forEach(function (r) {
      var tr = el('tr');
      tr.appendChild(el('td', { class: 'proto', text: r.name }));
      tr.appendChild(el('td', { text: r.category || '—' }));
      tr.appendChild(el('td', { text: r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') }));
      tr.appendChild(el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }));
      tr.appendChild(el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }));
      var g = r.change_7d;
      tr.appendChild(el('td', { class: 'num ' + (g === null ? '' : g >= 0 ? 'up' : 'down'), text: fmtPct(g) }));
      frag.appendChild(tr);
    });
    tbody.appendChild(frag);
  }

  function openDetail(slug) {
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) return;
    state.selected = slug;
    var growth = Math.min(MODEL.growth_cap, Math.max(MODEL.growth_floor, row.change_7d === null ? 0 : row.change_7d));
    var base = row.tvl_usd * row.comp_multiple;
    var recomputed = impliedOf(row);
    var detail = $('detail');
    detail.innerHTML = '';
    var wrap = el('div', { class: 'detail' });
    wrap.appendChild(el('h2', { text: row.name }));
    wrap.appendChild(el('p', { class: 'sub', text: 'Rank #' + row.rank + ' · ' + (row.category || 'uncategorised') + ' · records no token' + (WATCH[row.slug] ? ' · on the watchlist' : '') }));
    var facts = el('dl', { class: 'facts' });
    [
      ['TVL', fmtUsd(row.tvl_usd)],
      ['Implied value', fmtUsd(row.implied_value_usd)],
      ['7-day change', fmtPct(row.change_7d)],
      ['Age', fmtAge(row.age_days)],
      ['Chains', String(row.chains.length)],
      ['Readiness', row.readiness + ' / 100'],
    ].forEach(function (kv) {
      var d = el('div');
      d.appendChild(el('dt', { text: kv[0] }));
      d.appendChild(el('dd', { text: kv[1] }));
      facts.appendChild(d);
    });
    wrap.appendChild(facts);
    wrap.appendChild(el('h3', { text: 'How the value is derived' }));
    var bd = el('div', { class: 'breakdown' });
    [
      ['TVL × category comps (' + row.comp_multiple.toFixed(2) + '×)', fmtUsd(base)],
      ['Growth ' + fmtPct(growth) + ' → ×' + row.growth_multiplier.toFixed(2), ''],
      ['Maturity ' + fmtAge(row.age_days) + ' → ×' + row.maturity_multiplier.toFixed(2), ''],
      ['Chains (' + row.chains.length + ') → ×' + row.chain_multiplier.toFixed(2), ''],
      ['Recomputed here', fmtUsd(recomputed)],
      ['Implied value', fmtUsd(row.implied_value_usd)],
    ].forEach(function (kv, i) {
      bd.appendChild(el('div', { class: 'rowline' + (i === 5 ? ' total' : '') },
        el('span', { text: kv[0] }),
        el('span', { text: kv[1] })));
    });
    wrap.appendChild(bd);
    if (recomputed !== row.implied_value_usd) {
      wrap.appendChild(el('p', { class: 'hint', text: 'The page recomputes ' + fmtUsd(recomputed) + ' from the same figures; the board carries ' + fmtUsd(row.implied_value_usd) + '.' }));
    }
    wrap.appendChild(el('h3', { text: 'Farm plan — six steps' }));
    var steps = el('ol', { class: 'steps' });
    row.farm_steps.forEach(function (s) { steps.appendChild(el('li', { text: s })); });
    wrap.appendChild(steps);
    wrap.appendChild(el('p', { class: 'hint', text: 'Chains: ' + row.chains.join(', ') + '.' }));
    detail.appendChild(wrap);
    $('drawer').hidden = false;
    renderRows();
  }

  function closeDetail() {
    state.selected = null;
    $('drawer').hidden = true;
    renderRows();
  }

  function setTab(tab) {
    state.tab = tab;
    ['board', 'live', 'method'].forEach(function (t) {
      $('tab-' + t).classList.toggle('is-active', t === tab);
      $('view-' + t).classList.toggle('is-active', t === tab);
      $('view-' + t).hidden = t !== tab;
    });
  }

  function fillSelects() {
    var cats = {};
    var chains = {};
    DATA.rows.forEach(function (r) {
      if (r.category) cats[r.category] = true;
      r.chains.forEach(function (c) { chains[c] = true; });
    });
    Object.keys(cats).sort().forEach(function (c) {
      $('category').appendChild(el('option', { value: c, text: c }));
    });
    Object.keys(chains).sort().forEach(function (c) {
      $('chain').appendChild(el('option', { value: c, text: c }));
    });
  }

  function readHash() {
    var h = location.hash.replace(/^#\/?/, '');
    if (!h) return;
    var parts = h.split('/');
    if (parts[0] === 'protocol' && parts[1]) openDetail(decodeURIComponent(parts[1]));
    else if (parts[0] === 'category' && parts[1]) {
      state.category = decodeURIComponent(parts[1]);
      $('category').value = state.category;
      renderRows();
    }
  }

  $('q').addEventListener('input', function (e) { state.q = e.target.value; renderRows(); });
  $('category').addEventListener('change', function (e) { state.category = e.target.value; renderRows(); });
  $('chain').addEventListener('change', function (e) { state.chain = e.target.value; renderRows(); });
  $('watchlist').addEventListener('change', function (e) { state.watchlist = e.target.checked; renderRows(); });
  $('sort').addEventListener('change', function (e) { state.sort = e.target.value; renderRows(); });
  $('drawer-close').addEventListener('click', closeDetail);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDetail(); });
  ['board', 'live', 'method'].forEach(function (t) {
    $('tab-' + t).addEventListener('click', function () { setTab(t); });
  });

  function renderMethod() {
    var m = $('method');
    m.innerHTML = '';
    var formula = 'implied = TVL x comps x growth x maturity x chains\n\n' +
      'comps    = median(market cap / TVL) of the live protocols\n' +
      '           in the same category, clamped to [0.05, 1.00]\n' +
      'growth   = 1 + clamp(7d change, -60%, +120%) x 0.6\n' +
      'maturity = 0.6 + min(age, 1460 days) / 1460 x 0.4\n' +
      'chains   = 1 + 0.03 x min(chains - 1, 5)';
    var card1 = el('div', { class: 'card' });
    card1.appendChild(el('h2', { text: 'The model: radar-2' }));
    card1.appendChild(el('p', { text: 'One sealed snapshot in, one ranked board out. The implied value follows only from the snapshot\'s own figures — TVL, 7-day growth, age, chain count and the live comps of the protocol\'s own category. No name is ever hardcoded: the same function scores every row, and this page recomputes each row from the same figures to check the board.' }));
    card1.appendChild(el('pre', { class: 'formula', text: formula }));
    card1.appendChild(el('h3', { text: 'What the board leaves out' }));
    card1.appendChild(el('p', { text: 'Exchanges (CEX) are never ranked — a launch is not their business. Versioned pools (a name ending in V2, 2.0 and the like) are pools of a protocol that already trades, not a protocol of their own. Wrapped, staked and bridged products are left out the same way. A protocol is called pre-token only when it records no market cap, no Gecko id and no symbol.' }));
    m.appendChild(card1);
    var card2 = el('div', { class: 'card' });
    card2.appendChild(el('h2', { text: 'Category comps, from the snapshot' }));
    card2.appendChild(el('p', { text: 'Each multiple below is the median market cap / TVL of the live protocols in that category, as the snapshot records them. A category with fewer than 3 live peers uses the whole market\'s median instead.' }));
    var table = el('table', { class: 'comps' });
    var thead = el('thead');
    var thr = el('tr');
    thr.appendChild(el('th', { text: 'Category' }));
    thr.appendChild(el('th', { class: 'num', text: 'Multiple' }));
    thr.appendChild(el('th', { class: 'num', text: 'Live peers' }));
    thead.appendChild(thr);
    table.appendChild(thead);
    var tbody = el('tbody');
    DATA.comps.forEach(function (c) {
      var tr = el('tr');
      tr.appendChild(el('td', { text: c.category }));
      tr.appendChild(el('td', { class: 'num', text: c.multiple.toFixed(2) + 'x' }));
      tr.appendChild(el('td', { class: 'num', text: String(c.peers) }));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    card2.appendChild(table);
    card2.appendChild(el('h3', { text: 'Readiness, 0–100' }));
    card2.appendChild(el('p', { text: 'Display only, never the rank key: 40% age, 30% growth, 30% size. It says how close a launch looks, not what it is worth — the rank always follows the implied value.' }));
    m.appendChild(card2);
  }

  fillSelects();
  renderStats();
  renderRows();
  renderLive();
  renderMethod();
  readHash();
})();
