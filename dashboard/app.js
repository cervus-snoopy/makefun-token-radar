// Token Radar dashboard (radar-3): renders the board, detail drawer, live
// view and method view from window.RADAR (data.js). No network.
//
// Screenshot hooks (?shot=board | detail&slug=X | filtered), for the capture run only.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var MODEL = DATA.model;
  var FIT = DATA.fit || {};
  var VAL = DATA.validation || {};
  var WATCH = {};
  DATA.watchlist.forEach(function (s) { WATCH[s] = true; });

  function el(tag, attrs, text) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) { if (k === 'class') n.className = attrs[k]; else n.setAttribute(k, attrs[k]); }
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function money(n) {
    return '$' + Math.round(n).toLocaleString('en-US');
  }
  function money2(n) {
    var sign = n < 0 ? '-' : '';
    return sign + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function compact(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function pct(n) {
    if (n === null || n === undefined) return '—';
    return (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function ageText(days) {
    if (days === null || days === undefined) return '—';
    if (days < 365) return days + 'd';
    return (days / 365).toFixed(1) + 'y';
  }
  function esc(s) { return String(s); }

  /* ---- header stats + hero OOS panel ---- */
  function renderStats() {
    var stats = document.getElementById('stats');
    var items = [
      ['Board', DATA.board_size + ' ranked'],
      ['Watchlist', DATA.watchlist_size + '/40'],
      ['FARM', String(DATA.verdict_counts.FARM)],
      ['THIN', String(DATA.verdict_counts.THIN)],
      ['SKIP', String(DATA.verdict_counts.SKIP)],
      ['Snapshot', DATA.as_of],
    ];
    items.forEach(function (it) {
      var d = el('div');
      d.appendChild(el('dt', null, it[0]));
      d.appendChild(el('dd', null, it[1]));
      stats.appendChild(d);
    });
    var set = function (id, text) { var n = document.getElementById(id); if (n) n.textContent = text; };
    set('oos-loo', VAL.loo_geo ? 'x' + VAL.loo_geo.toFixed(2) : '—');
    set('oos-ts', VAL.time_split_geo ? 'x' + VAL.time_split_geo.toFixed(2) : '—');
    set('oos-boot', VAL.bootstrap_top10_keeps !== undefined ? VAL.bootstrap_top10_keeps.toFixed(2) + '/10' : '—');
    set('oos-base', VAL.baseline_median_geo ? 'x' + VAL.baseline_median_geo.toFixed(2) : '—');
    set('oos-band', VAL.band ? 'x' + VAL.band.toFixed(2) : '—');
    document.getElementById('foot-asof').textContent = DATA.as_of;
    document.getElementById('foot-source').textContent = DATA.source;
    document.getElementById('foot-model').textContent = DATA.model_version + ' fitted log-log';
  }

  /* ---- board ---- */
  var rowsEl = document.getElementById('rows');
  var countEl = document.getElementById('count');

  function currentFilter() {
    return {
      q: (document.getElementById('q').value || '').trim().toLowerCase(),
      category: document.getElementById('category').value,
      chain: document.getElementById('chain').value,
      verdict: document.getElementById('verdict').value,
      watchlist: document.getElementById('watchlist').checked,
      sort: document.getElementById('sort').value,
    };
  }

  function filteredRows() {
    var f = currentFilter();
    var rows = DATA.rows.filter(function (r) {
      if (f.watchlist && !WATCH[r.slug]) return false;
      if (f.category !== 'all' && r.category !== f.category) return false;
      if (f.chain !== 'all' && r.chains.indexOf(f.chain) === -1) return false;
      if (f.verdict !== 'all' && r.verdict !== f.verdict) return false;
      if (f.q && (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(f.q) === -1) return false;
      return true;
    });
    var key = f.sort;
    rows = rows.slice();
    if (key === 'tvl') rows.sort(function (a, b) { return b.tvl_usd - a.tvl_usd; });
    else if (key === 'growth') rows.sort(function (a, b) { return (b.change_7d || 0) - (a.change_7d || 0); });
    else if (key === 'age') rows.sort(function (a, b) { return (b.age_days || 0) - (a.age_days || 0); });
    else if (key === 'net') rows.sort(function (a, b) { return b.net_usd - a.net_usd; });
    else if (key === 'readiness') rows.sort(function (a, b) { return b.readiness - a.readiness; });
    else rows.sort(function (a, b) { return b.implied_value_usd - a.implied_value_usd; });
    return rows;
  }

  function renderBoard() {
    var rows = filteredRows();
    rowsEl.innerHTML = '';
    rows.forEach(function (r) {
      var tr = el('tr');
      tr.setAttribute('data-slug', r.slug);
      tr.appendChild(el('td', { class: 'num' }, String(r.rank)));
      var nameTd = el('td');
      nameTd.appendChild(el('span', null, esc(r.name)));
      if (WATCH[r.slug]) nameTd.appendChild(el('span', { class: 'watch' }, ' ● watchlist'));
      tr.appendChild(nameTd);
      tr.appendChild(el('td', null, esc(r.category || '—')));
      tr.appendChild(el('td', null, esc(r.chains[0] || '—')));
      tr.appendChild(el('td', { class: 'num' }, compact(r.tvl_usd)));
      var g = el('td', { class: 'num ' + ((r.change_7d || 0) >= 0 ? 'pos' : 'neg') }, pct(r.change_7d));
      tr.appendChild(g);
      tr.appendChild(el('td', { class: 'num' }, ageText(r.age_days)));
      tr.appendChild(el('td', { class: 'num' }, r.fitted_multiple.toFixed(2) + 'x'));
      tr.appendChild(el('td', { class: 'num' }, money(r.implied_value_usd)));
      var vTd = el('td');
      vTd.appendChild(el('span', { class: 'badge ' + r.verdict }, r.verdict));
      tr.appendChild(vTd);
      tr.appendChild(el('td', { class: 'num ' + (r.net_usd >= 0 ? 'pos' : 'neg') }, money2(r.net_usd)));
      tr.addEventListener('click', function () { openDetail(r.slug); });
      rowsEl.appendChild(tr);
    });
    countEl.textContent = rows.length + ' of ' + DATA.rows.length + ' protocols shown — ranks by implied value; the verdict column is the netted farm call.';
  }

  function fillSelect(id, values) {
    var s = document.getElementById(id);
    values.forEach(function (v) {
      var o = el('option', { value: v }, v);
      s.appendChild(o);
    });
  }

  /* ---- live view ---- */
  function renderLive() {
    var body = document.getElementById('live-rows');
    DATA.live.forEach(function (p) {
      var tr = el('tr');
      tr.appendChild(el('td', null, esc(p.name)));
      tr.appendChild(el('td', null, esc(p.category || '—')));
      tr.appendChild(el('td', null, esc(p.chains.slice(0, 2).join(', ') || '—')));
      tr.appendChild(el('td', { class: 'num' }, compact(p.tvl_usd)));
      tr.appendChild(el('td', { class: 'num' }, p.mcap_usd === null ? '—' : compact(p.mcap_usd)));
      tr.appendChild(el('td', { class: 'num ' + ((p.change_7d || 0) >= 0 ? 'pos' : 'neg') }, pct(p.change_7d)));
      body.appendChild(tr);
    });
  }

  /* ---- detail drawer ---- */
  var drawer = document.getElementById('drawer');
  var detailEl = document.getElementById('detail');

  function findRow(slug) {
    for (var i = 0; i < DATA.rows.length; i++) if (DATA.rows[i].slug === slug) return DATA.rows[i];
    return null;
  }

  function openDetail(slug) {
    var r = findRow(slug);
    if (!r) return;
    // Dock below the header: keep the hero strip visible.
    var top = document.querySelector('.top');
    if (top) drawer.style.top = (top.offsetHeight - 12) + 'px';
    detailEl.innerHTML = '';
    detailEl.appendChild(el('h2', null, esc(r.name)));
    var sub = 'Rank #' + r.rank + ' · ' + esc(r.category || 'uncategorised') + ' · ' + esc(r.chains.join(', ') || 'no chain listed') +
      ' · TVL ' + compact(r.tvl_usd) + ' · ' + ageText(r.age_days) + ' old' + (WATCH[r.slug] ? ' · watchlist' : '');
    detailEl.appendChild(el('p', { class: 'sub' }, sub));

    detailEl.appendChild(el('h3', null, 'Model breakdown — how the implied value is derived'));
    var arith = 'TVL ' + money(r.tvl_usd) + '\n' +
      'x fitted multiple ' + r.fitted_multiple.toFixed(4) + '   (curve: ln(mcap) = ' + FIT.intercept.toFixed(3) +
      ' + ' + FIT.slope_tvl.toFixed(3) + ' ln(TVL) ' + FIT.slope_age.toFixed(3) + ' ln(age), category offset applied)\n' +
      'x growth ' + r.growth_multiplier.toFixed(4) + '   (7d ' + pct(r.change_7d) + ', weight 0.6)\n' +
      'x 0.85 pre-token discount\n' +
      '= implied value ' + money(r.implied_value_usd);
    detailEl.appendChild(el('div', { class: 'arith' }, arith));

    detailEl.appendChild(el('h3', null, 'Farm plan — netted to the dollar'));
    var econ = document.createElement('div');
    econ.className = 'econ';
    var verdict = r.farm;
    var cells = [
      ['Verdict', r.verdict],
      ['Net', money2(r.net_usd)],
      ['Expected slice (low end)', verdict ? money2(verdict.slice_low_usd) : '—'],
      ['Fees', verdict ? money2(verdict.fees_usd) : '—'],
      ['T-bill cost (4%)', verdict ? money2(verdict.tbill_usd) : '—'],
      ['Capital / hold', verdict ? money(verdict.capital_usd) + ' / ' + verdict.hold_days + ' days' : '—'],
      ['Active hours', verdict ? verdict.hours.toFixed(1) + ' h (' + money2(verdict.per_hour_usd) + '/hour)' : '—'],
    ];
    cells.forEach(function (c, i) {
      var d = el('div');
      if (i === 6) d.className = 'wide';
      var b = el('b', null, c[1]);
      if (i === 1) b.className = r.net_usd >= 0 ? 'net-good' : 'net-bad';
      d.appendChild(b);
      d.appendChild(el('span', null, c[0]));
      econ.appendChild(d);
    });
    detailEl.appendChild(econ);
    var steps = el('ol');
    r.farm_steps.forEach(function (s) { steps.appendChild(el('li', null, s)); });
    detailEl.appendChild(steps);
    drawer.hidden = false;
  }

  document.getElementById('drawer-close').addEventListener('click', function () { drawer.hidden = true; });

  /* ---- method view ---- */
  function renderMethod() {
    var m = document.getElementById('method');
    var h = function (t) { m.appendChild(el('h2', null, t)); };
    var p = function (t) { m.appendChild(el('p', null, t)); };
    h('The model');
    p('ln(mcap) = ' + FIT.intercept.toFixed(3) + ' + ' + FIT.slope_tvl.toFixed(3) + ' x ln(TVL) ' +
      FIT.slope_age.toFixed(3) + ' x ln(age_days) + category offset, fitted by ordinary least squares on ' +
      FIT.n_comps + ' traded tokens in this snapshot (mcap/TVL in [0.02, 20], one greatest-TVL protocol per token id). ' +
      'Category offsets are mean residuals shrunk by 8 pseudo-observations; the fitted multiple is clamped to [0.08, 1.20]. ' +
      'Plain OLS R2 ' + FIT.r2_plain.toFixed(3) + '; with offsets R2 ' + FIT.r2.toFixed(3) + '.');
    p('Implied value = TVL x fitted multiple x growth multiplier x 0.85. The growth multiplier is ' +
      '1 + 0.6 x clamp(change_7d, -60, 120) / 100. The 0.85 is a stated assumption: a token that does not ' +
      'trade yet is worth less than the curve\'s traded-token prediction. Age enters the curve itself, so ' +
      'there is no separate maturity multiplier on top of it. Chains were tested as a regressor and dropped: ' +
      'the fitted coefficient was near zero and it moved LOO by nothing.');
    h('Out-of-sample validation');
    var kv = el('div', { class: 'kv' });
    var cells = [
      ['x' + (VAL.loo_geo || 0).toFixed(2), 'LOO geo factor, n=' + (VAL.n_comps || 0)],
      ['x' + (VAL.time_split_geo || 0).toFixed(2), 'Time-split geo factor, cut ' + (VAL.time_split_cut || '') + ' (' + (VAL.time_split_n_train || 0) + ' train / ' + (VAL.time_split_n_test || 0) + ' test)'],
      [(VAL.bootstrap_top10_keeps || 0).toFixed(2) + '/10', 'Bootstrap top-10 keeps (200 draws)'],
      ['x' + (VAL.baseline_median_geo || 0).toFixed(2), 'Median-model LOO (the old estimator)'],
      ['x' + (VAL.baseline_tvl_geo || 0).toFixed(2), 'TVL-only LOO (predicted mcap = TVL)'],
      ['x' + (VAL.band || 0).toFixed(2), 'Farm band: plans net at implied / band'],
    ];
    cells.forEach(function (c) {
      var d = el('div');
      d.appendChild(el('b', null, c[0]));
      d.appendChild(el('span', null, c[1]));
      kv.appendChild(d);
    });
    m.appendChild(kv);
    p('Leave-one-out refits the curve ' + (VAL.n_comps || 0) + ' times, each time predicting a protocol the fit never saw — ' +
      'and never saw any other protocol of the same token. The full pipeline (growth multiplier and 0.85 discount applied) ' +
      'scores LOO x' + (VAL.loo_pipeline_geo || 0).toFixed(2) + '. Median absolute percentage error on the curve LOO is ' +
      ((VAL.loo_mdape || 0) * 100).toFixed(1) + '%, Spearman ' + (VAL.loo_spearman || 0).toFixed(3) + ', ' +
      ((VAL.loo_within_2x || 0) * 100).toFixed(1) + '% within 2x; the pipeline row of the calibration table below carries the ' +
      'pipeline\'s own three numbers. Rank 1 stays rank 1 in ' +
      ((VAL.bootstrap_rank1_stays || 0) * 100).toFixed(0) + '% of bootstrap draws.');
    h('Farm economics');
    p('slice = implied value x 0.0025% (one active farmer\'s assumed share), netted to the low end of the model band ' +
      '(slice / band), less gas fees and less the T-bill cost of the capital (4% x hold / 365). ' +
      'FARM when the net clears $60; THIN when it covers its costs but not the hurdle (the 4%-of-capital leg never binds: 4% of $50-$250 is $2-$10); ' +
      'SKIP when it does not cover its costs. A SKIP plan says so in its first step.');
    renderCalibration();
    renderFitScatter(document.getElementById('fit-scatter-method'));
  }

  function renderCalibration() {
    var body = document.getElementById('cal-rows');
    if (!body) return;
    var rows = [
      ['LOO (fitted curve)', VAL.n_comps, VAL.loo_geo, VAL.loo_mdape, VAL.loo_spearman, VAL.loo_within_2x],
      ['LOO (full pipeline)', VAL.n_comps, VAL.loo_pipeline_geo, VAL.loo_pipeline_mdape, VAL.loo_pipeline_spearman, VAL.loo_pipeline_within_2x],
      ['Time split (cut ' + (VAL.time_split_cut || '') + ')', VAL.time_split_n_test, VAL.time_split_geo, null, null, null],
      ['Median-multiple baseline (LOO)', VAL.n_comps, VAL.baseline_median_geo, null, null, null],
      ['TVL-only baseline', VAL.n_comps, VAL.baseline_tvl_geo, null, null, null],
    ];
    rows.forEach(function (r) {
      var tr = el('tr');
      tr.appendChild(el('td', null, r[0]));
      tr.appendChild(el('td', { class: 'num' }, String(r[1] === undefined || r[1] === null ? '—' : r[1])));
      tr.appendChild(el('td', { class: 'num' }, r[2] ? 'x' + r[2].toFixed(2) : '—'));
      tr.appendChild(el('td', { class: 'num' }, r[3] === null || r[3] === undefined ? '—' : (r[3] * 100).toFixed(1) + '%'));
      tr.appendChild(el('td', { class: 'num' }, r[4] === null || r[4] === undefined ? '—' : r[4].toFixed(3)));
      tr.appendChild(el('td', { class: 'num' }, r[5] === null || r[5] === undefined ? '—' : (r[5] * 100).toFixed(1) + '%'));
      body.appendChild(tr);
    });
  }

  /* ---- fit scatter (SVG, no network) ---- */
  function renderFitScatter(host, height) {
    if (!host || !DATA.fit_view) return;
    var fv = DATA.fit_view;
    var W = 1060, H = height || 460, pad = { l: 56, r: 20, t: 14, b: 44 };
    var xs = fv.kept.map(function (p) { return p.x; }).concat(fv.dropped.map(function (p) { return p.x; })).concat(fv.candidates.map(function (p) { return p.x; }));
    var ys = fv.kept.map(function (p) { return p.y; }).concat(fv.dropped.map(function (p) { return p.y; })).concat(fv.candidates.map(function (p) { return p.y; }));
    var x0 = Math.floor(Math.min.apply(null, xs) - 0.2), x1 = Math.ceil(Math.max.apply(null, xs) + 0.2);
    var y0 = Math.floor(Math.min.apply(null, ys) - 0.2), y1 = Math.ceil(Math.max.apply(null, ys) + 0.2);
    var X = function (v) { return pad.l + (v - x0) / (x1 - x0) * (W - pad.l - pad.r); };
    var Y = function (v) { return H - pad.b - (v - y0) / (y1 - y0) * (H - pad.t - pad.b); };
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('width', '100%');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Fit scatter: log10 TVL against log10 market cap');
    var line = function (x1v, y1v, x2v, y2v, cls) {
      var l = document.createElementNS(ns, 'line');
      l.setAttribute('x1', x1v); l.setAttribute('y1', y1v); l.setAttribute('x2', x2v); l.setAttribute('y2', y2v);
      l.setAttribute('class', cls || 'axis');
      svg.appendChild(l);
    };
    var text = function (x, y, s, anchor) {
      var t = document.createElementNS(ns, 'text');
      t.setAttribute('x', x); t.setAttribute('y', y);
      if (anchor) t.setAttribute('text-anchor', anchor);
      t.textContent = s;
      svg.appendChild(t);
    };
    // Grid + axes.
    for (var gx = Math.ceil(x0); gx <= x1; gx++) { line(X(gx), Y(y0), X(gx), Y(y1)); text(X(gx), H - pad.b + 18, '10^' + gx, 'middle'); }
    for (var gy = Math.ceil(y0); gy <= y1; gy++) { line(X(x0), Y(gy), X(x1), Y(gy)); text(pad.l - 8, Y(gy) + 4, '10^' + gy, 'end'); }
    text((W - pad.r + pad.l) / 2, H - 6, 'TVL (log10 USD)', 'middle');
    var ylab = document.createElementNS(ns, 'text');
    ylab.setAttribute('x', 0); ylab.setAttribute('y', 0);
    ylab.setAttribute('transform', 'translate(14 ' + ((H - pad.b + pad.t) / 2) + ') rotate(-90)');
    ylab.setAttribute('text-anchor', 'middle');
    ylab.textContent = 'log10 USD';
    svg.appendChild(ylab);
    // Fitted curve: the global log-log line at one year of age (offset 0).
    // Straight in log-log space; the points' scatter around it is the
    // category offsets and the residual spread the LOO number measures.
    var ln10 = Math.LN10;
    var lineY = function (x) { return (FIT.intercept + FIT.slope_tvl * x * ln10 + FIT.slope_age * Math.log(365)) / ln10; };
    var pl = document.createElementNS(ns, 'path');
    pl.setAttribute('d', 'M' + X(x0).toFixed(1) + ' ' + Y(lineY(x0)).toFixed(1) + ' L' + X(x1).toFixed(1) + ' ' + Y(lineY(x1)).toFixed(1));
    pl.setAttribute('fill', 'none');
    pl.setAttribute('stroke', '#0e7c6b');
    pl.setAttribute('stroke-width', '2.5');
    svg.appendChild(pl);
    var dot = function (cx, cy, r, fill, stroke, sw) {
      var c = document.createElementNS(ns, 'circle');
      c.setAttribute('cx', cx); c.setAttribute('cy', cy); c.setAttribute('r', r);
      c.setAttribute('fill', fill); c.setAttribute('stroke', stroke); c.setAttribute('stroke-width', sw || 1);
      svg.appendChild(c);
    };
    fv.dropped.forEach(function (p) { dot(X(p.x), Y(p.y), 4, '#fffdf7', '#8a97a5', 1.5); });
    fv.kept.forEach(function (p) {
      if (p.flagged) dot(X(p.x), Y(p.y), 6, 'none', '#a33a2a', 2);
      dot(X(p.x), Y(p.y), 3.5, p.flagged ? '#a33a2a' : '#16283e', 'none', 0);
    });
    fv.candidates.forEach(function (p) { dot(X(p.x), Y(p.y), 5, '#e8a13a', '#7a5200', 1.5); });
    host.innerHTML = '';
    host.appendChild(svg);
    var legend = document.getElementById('fit-legend');
    if (legend) {
      legend.innerHTML = '';
      [['#16283e', 'kept comp'], ['#a33a2a', 'flagged (>0.5 dex off curve)'], ['#fffdf7', 'dropped live point (ratio outside [0.02, 20])'], ['#e8a13a', 'top-25 candidate (implied value)']].forEach(function (it) {
        var s = el('span');
        s.appendChild(el('span', { class: 'dot', style: 'background:' + it[0] + ';border:1px solid #8a97a5;' }));
        s.appendChild(document.createTextNode(it[1]));
        legend.appendChild(s);
      });
    }
  }

  /* ---- tabs ---- */
  document.querySelectorAll('.tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('is-active'); });
      tab.classList.add('is-active');
      var name = tab.getAttribute('data-tab');
      document.getElementById('view-board').hidden = name !== 'board';
      document.getElementById('view-live').hidden = name !== 'live';
      document.getElementById('view-method').hidden = name !== 'method';
      if (name === 'method') renderFitScatter(document.getElementById('fit-scatter-method'));
    });
  });

  /* ---- wire up ---- */
  var cats = [];
  var chains = [];
  DATA.rows.forEach(function (r) {
    if (r.category && cats.indexOf(r.category) === -1) cats.push(r.category);
    r.chains.forEach(function (c) { if (chains.indexOf(c) === -1) chains.push(c); });
  });
  cats.sort(); chains.sort();
  fillSelect('category', cats);
  fillSelect('chain', chains);
  ['q', 'category', 'chain', 'verdict', 'watchlist', 'sort'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', renderBoard);
    document.getElementById(id).addEventListener('change', renderBoard);
  });
  renderStats();
  renderBoard();
  renderLive();
  renderMethod();
  renderFitScatter(document.getElementById('fit-scatter'));

  /* ---- screenshot hooks ---- */
  var params = new URLSearchParams(window.location.search || '');
  var shot = params.get('shot');
  if (shot === 'detail') {
    var slug = params.get('slug') || (DATA.rows[0] && DATA.rows[0].slug);
    if (slug) openDetail(slug);
  } else if (shot === 'filtered') {
    document.getElementById('verdict').value = 'FARM';
    renderBoard();
    // The filtered view carries the fit: cap the table so the scatter below
    // it fits in the same viewport, and draw the scatter shorter — the
    // legend under the scatter must stay inside the 1440x1320 capture.
    var tablewrap = document.querySelector('#view-board .tablewrap');
    if (tablewrap) {
      tablewrap.style.maxHeight = '250px';
      tablewrap.style.overflow = 'hidden';
    }
    renderFitScatter(document.getElementById('fit-scatter'), 300);
  }
})();
