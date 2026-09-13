// ================================================================
// Renewable Energy Monitor - Frontend logic
// Talks to the API server in backend/server.js, which wraps the
// SQL queries and PL/SQL programs from sql/person1-4.sql
// ================================================================

const API_BASE = 'http://localhost:3000/api';

const COLORS = {
  solar: '#E8A33D',
  wind: '#4FB3A9',
  battery: '#6C7BD6',
  muted: '#8FA6A3',
  text: '#EDF3F2',
  grid: 'rgba(255,255,255,0.06)'
};

// ----------------------------------------------------------------
// Navigation between views
// Wired up FIRST and unconditionally, so tab switching still works
// even if Chart.js below fails to load (blocked CDN, offline, etc).
// Previously this ran AFTER the Chart.defaults lines, so when Chart
// was undefined, that line threw and this code never ran at all.
// ----------------------------------------------------------------
document.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', () => {
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    link.classList.add('active');
    document.getElementById(`view-${link.dataset.view}`).classList.add('active');
  });
});

// ----------------------------------------------------------------
// Chart.js setup (guarded)
// ----------------------------------------------------------------
if (typeof Chart !== 'undefined') {
  Chart.defaults.color = COLORS.muted;
  Chart.defaults.font.family = "'Inter', sans-serif";
  Chart.defaults.borderColor = COLORS.grid;
} else {
  console.error(
    'Chart.js did not load (Chart is undefined). Charts will be skipped, ' +
    'but the rest of the dashboard (tables, KPIs, tab switching) will still work. ' +
    'Check the Network tab for the chart.umd.min.js request — if it is blocked, ' +
    'failed, or 404s, either allow cdnjs.cloudflare.com or vendor the file locally.'
  );
}

const charts = {};

// ----------------------------------------------------------------
// Small fetch helper
// ----------------------------------------------------------------
async function get(path) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`Request failed: ${path}`);
  return res.json();
}

function fmt(n) {
  return n === null || n === undefined ? '—' : Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function renderChartFallback(canvasId, config) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const labels = config.data.labels || [];
  const datasets = config.data.datasets || [];
  if (!labels.length) return; // e.g. the efficiency gauge has no labels — skip, it has its own text readout

  const rows = labels.map((label, i) => {
    const vals = datasets.map(ds => `${ds.label ? ds.label + ': ' : ''}${fmt(ds.data[i])}`).join(' · ');
    return `<div class="chart-fallback-row"><span>${label}</span><span>${vals}</span></div>`;
  }).join('');

  let container = canvas.parentElement.querySelector('.chart-fallback');
  if (!container) {
    container = document.createElement('div');
    container.className = 'chart-fallback';
    canvas.insertAdjacentElement('afterend', container);
  }
  container.innerHTML = `<p class="chart-fallback-note">Chart.js isn't loaded — showing raw values instead.</p>${rows}`;
  canvas.style.display = 'none';
}

function clearChartFallback(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  canvas.style.display = '';
  const container = canvas.parentElement.querySelector('.chart-fallback');
  if (container) container.remove();
}

function upsertChart(canvasId, config) {
  if (typeof Chart === 'undefined') {
    renderChartFallback(canvasId, config);
    return null;
  }
  clearChartFallback(canvasId);
  const ctx = document.getElementById(canvasId);
  if (charts[canvasId]) charts[canvasId].destroy();
  charts[canvasId] = new Chart(ctx, config);
  return charts[canvasId];
}

// ----------------------------------------------------------------
// OVERVIEW  (Person 1 region counts, Person 2 solar totals,
//            Person 4 combined summary)
// ----------------------------------------------------------------
async function loadOverview() {
  try {
    const [states, nationalTotals, topSolar, aboveAverage] = await Promise.all([
      get('/states'),
      get('/summary/national-totals'),
      get('/generation/top-solar'),
      get('/summary/above-average')
    ]);

    document.getElementById('kpi-states').textContent = states.length;

    document.getElementById('kpi-solar').textContent = fmt(nationalTotals.TOTAL_SOLAR);
    document.getElementById('kpi-wind').textContent = fmt(nationalTotals.TOTAL_WIND);
    document.getElementById('kpi-storage').textContent = fmt(nationalTotals.TOTAL_BATTERY_STORAGE);

    document.getElementById('insight-above-avg').textContent = aboveAverage.length;

    upsertChart('chart-top-solar', {
      type: 'bar',
      data: {
        labels: topSolar.map(r => r.STATE_NAME),
        datasets: [{
          label: 'Solar generated (MWh)',
          data: topSolar.map(r => r.TOTAL_SOLAR),
          backgroundColor: COLORS.solar,
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false } },
          y: { grid: { color: COLORS.grid } }
        }
      }
    });
  } catch (err) {
    console.error('Overview load failed:', err.message);
  }
}

// "View details →" on the Overview insights panel jumps straight to the
// Insights tab, reusing the same nav-link switching logic wired up above.
document.querySelectorAll('[data-view-link]').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.viewLink;
    document.querySelectorAll('.nav-link').forEach(l => l.classList.toggle('active', l.dataset.view === target));
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${target}`));
  });
});

// ----------------------------------------------------------------
// GENERATION  (Person 2)
// ----------------------------------------------------------------
async function loadGeneration() {
  try {
    const [states, totals] = await Promise.all([
      get('/states'),
      get('/generation/totals')
    ]);

    const selectEl = document.getElementById('generation-state');
    selectEl.innerHTML = states.map(s => `<option value="${s.STATE_ID}">${s.STATE_NAME}</option>`).join('');

    upsertChart('chart-generation-totals', {
      type: 'bar',
      data: {
        labels: totals.map(r => r.STATE_NAME),
        datasets: [
          { label: 'Solar (MWh)', data: totals.map(r => r.TOTAL_SOLAR), backgroundColor: COLORS.solar, borderRadius: 4 },
          { label: 'Wind (MWh)', data: totals.map(r => r.TOTAL_WIND), backgroundColor: COLORS.wind, borderRadius: 4 }
        ]
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 10 } } },
        scales: { x: { grid: { display: false } }, y: { grid: { color: COLORS.grid } } }
      }
    });

    async function loadTrend(stateId) {
      try {
        const monthly = await get(`/generation/monthly?state_id=${stateId}`);
        upsertChart('chart-generation-trend', {
          type: 'line',
          data: {
            labels: monthly.map(r => r.GEN_MONTH),
            datasets: [{
              label: 'Total generation (MWh)',
              data: monthly.map(r => r.MONTHLY_TOTAL),
              borderColor: COLORS.wind,
              backgroundColor: 'rgba(79,179,169,0.15)',
              fill: true,
              tension: 0.3
            }]
          },
          options: {
            responsive: true,
            plugins: { legend: { display: false } },
            scales: { x: { grid: { display: false } }, y: { grid: { color: COLORS.grid } } }
          }
        });
      } catch (err) {
        console.error('Generation trend load failed:', err.message);
      }
    }

    // Attach the listener BEFORE the initial await, so state changes still
    // work even if this first load fails.
    selectEl.addEventListener('change', () => loadTrend(selectEl.value));
    await loadTrend(selectEl.value);
  } catch (err) {
    console.error('Generation load failed:', err.message);
  }
}

// ----------------------------------------------------------------
// BATTERY  (Person 3)
// ----------------------------------------------------------------
async function loadBattery() {
  try {
    const [states, totals] = await Promise.all([
      get('/states'),
      get('/battery/totals')
    ]);

    const selectEl = document.getElementById('battery-state');
    selectEl.innerHTML = states.map(s => `<option value="${s.STATE_ID}">${s.STATE_NAME}</option>`).join('');
    const dateEl = document.getElementById('battery-date');

    upsertChart('chart-battery-totals', {
      type: 'bar',
      data: {
        labels: totals.map(r => r.STATE_NAME),
        datasets: [
          { label: 'Charged (MWh)', data: totals.map(r => r.TOTAL_CHARGED), backgroundColor: COLORS.battery, borderRadius: 4 },
          { label: 'Discharged (MWh)', data: totals.map(r => r.TOTAL_DISCHARGED), backgroundColor: COLORS.solar, borderRadius: 4 }
        ]
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 10 } } },
        scales: { x: { grid: { display: false } }, y: { grid: { color: COLORS.grid } } }
      }
    });

    async function loadEfficiency() {
      const stateId = selectEl.value;
      try {
        const date = dateEl.value;
        const result = await get(`/battery/efficiency?state_id=${stateId}&date=${date}`);
        const pct = result.EFFICIENCY_PERCENT ?? 0;

        document.getElementById('efficiency-value').textContent = `${fmt(pct)}%`;

        upsertChart('chart-efficiency-gauge', {
          type: 'doughnut',
          data: {
            datasets: [{
              data: [pct, Math.max(0, 100 - pct)],
              backgroundColor: [COLORS.battery, 'rgba(255,255,255,0.06)'],
              borderWidth: 0
            }]
          },
          options: {
            responsive: true,
            circumference: 180,
            rotation: 270,
            cutout: '75%',
            plugins: { legend: { display: false }, tooltip: { enabled: false } }
          }
        });
      } catch (err) {
        console.error('Battery efficiency load failed:', err.message);
        document.getElementById('efficiency-value').textContent = '—';
      }
    }

    // Attach listeners BEFORE the initial await, so changing state/date still
    // triggers a reload even if this first load fails (e.g. a 500 from the API).
    selectEl.addEventListener('change', loadEfficiency);
    dateEl.addEventListener('change', loadEfficiency);
    await loadEfficiency();
  } catch (err) {
    console.error('Battery load failed:', err.message);
  }
}

// ----------------------------------------------------------------
// RANKINGS  (Person 4)
// ----------------------------------------------------------------
async function loadRankings() {
  try {
    const rankings = await get('/summary/rankings');

    const scores = await Promise.all(
      rankings.map(async r => {
        try {
          const scoreResult = await get(`/summary/performance-score/${r.STATE_ID ?? ''}`);
          return scoreResult.performance_score;
        } catch {
          return null;
        }
      })
    );

    const tbody = document.querySelector('#rankings-table tbody');
    tbody.innerHTML = rankings.map((r, i) =>
      `<tr>
        <td>#${r.GENERATION_RANK}</td>
        <td>${r.STATE_NAME}</td>
        <td>${fmt(r.TOTAL_GENERATION)}</td>
        <td>${scores[i] !== null ? fmt(scores[i]) : '—'}</td>
      </tr>`
    ).join('');
  } catch (err) {
    console.error('Rankings load failed:', err.message);
  }
}

// ----------------------------------------------------------------
// INSIGHTS  (Person 4 cross-table analytics, previously-unused routes)
// ----------------------------------------------------------------
async function loadInsights() {
  try {
    const [states, aboveAverage] = await Promise.all([
      get('/states'),
      get('/summary/above-average')
    ]);

    document.querySelector('#above-average-table tbody').innerHTML = aboveAverage.length
      ? aboveAverage.map(r => `<tr><td>${r.STATE_NAME}</td><td>${fmt(r.TOTAL_GENERATION)}</td></tr>`).join('')
      : '<tr><td colspan="2">No states currently exceed the national average.</td></tr>';

    const stateSelect = document.getElementById('running-total-state');
    stateSelect.innerHTML = states.map(s => `<option value="${s.STATE_ID}">${s.STATE_NAME}</option>`).join('');

    const loadBtn = document.getElementById('running-total-load');
    const runningTbody = document.querySelector('#running-total-table tbody');

    async function loadRunningTotal() {
      runningTbody.innerHTML = '<tr><td colspan="3">Loading…</td></tr>';
      try {
        const { lines } = await get(`/generation/running-total/${stateSelect.value}`);
        // Each line looks like: "2025-02-01 | Daily: 120 | Running total: 340"
        const parsed = lines
          .map(line => line.match(/^(.+?)\s*\|\s*Daily:\s*([\d.]+)\s*\|\s*Running total:\s*([\d.]+)/))
          .filter(Boolean);

        runningTbody.innerHTML = parsed.length
          ? parsed.map(m => `<tr><td>${m[1]}</td><td>${fmt(Number(m[2]))}</td><td>${fmt(Number(m[3]))}</td></tr>`).join('')
          : '<tr><td colspan="3">No generation readings found for this state.</td></tr>';
      } catch (err) {
        console.error('Running total load failed:', err.message);
        runningTbody.innerHTML = '<tr><td colspan="3">Couldn\'t load running total — check the server logs.</td></tr>';
      }
    }

    loadBtn.addEventListener('click', loadRunningTotal);
    await loadRunningTotal();
  } catch (err) {
    console.error('Insights load failed:', err.message);
  }
}

// ----------------------------------------------------------------
// DATA ENTRY  (demonstrates trg_calc_total_renewable and
//              trg_battery_valid_storage / chk_discharge_limit live)
// ----------------------------------------------------------------
async function wireDataEntryForms() {
  try {
    const states = await get('/states');
    const genStateSelect = document.getElementById('entry-gen-state');
    const battStateSelect = document.getElementById('entry-batt-state');
    const optionsHtml = states.map(s => `<option value="${s.STATE_ID}">${s.STATE_NAME}</option>`).join('');
    genStateSelect.innerHTML = optionsHtml;
    battStateSelect.innerHTML = optionsHtml;
  } catch (err) {
    console.error('Data entry form setup failed:', err.message);
  }

  const genForm = document.getElementById('generation-entry-form');
  const genResult = document.getElementById('entry-gen-result');
  genForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    genResult.className = 'entry-result';
    genResult.textContent = 'Saving…';
    try {
      const res = await fetch(`${API_BASE}/generation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          state_id: document.getElementById('entry-gen-state').value,
          reading_date: document.getElementById('entry-gen-date').value,
          wind_energy_mwh: document.getElementById('entry-gen-wind').value,
          solar_energy_mwh: document.getElementById('entry-gen-solar').value,
          other_renewable_mwh: document.getElementById('entry-gen-other').value
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Insert failed');

      genResult.className = 'entry-result success';
      genResult.innerHTML = `Inserted successfully. <code>trg_calc_total_renewable</code> computed total_renewable_mwh = <strong>${fmt(data.total_renewable_mwh)}</strong> MWh, and <code>chk_generation_nonnegative</code> confirmed no negative values.`;

      // Refresh views that this new reading affects.
      loadOverview();
      loadGeneration();
      loadInsights();
    } catch (err) {
      genResult.className = 'entry-result error';
      genResult.textContent = `Insert rejected: ${err.message}`;
    }
  });

  const battForm = document.getElementById('battery-entry-form');
  const battResult = document.getElementById('entry-batt-result');
  battForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    battResult.className = 'entry-result';
    battResult.textContent = 'Saving…';
    try {
      const res = await fetch(`${API_BASE}/battery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          state_id: document.getElementById('entry-batt-state').value,
          reading_date: document.getElementById('entry-batt-date').value,
          battery_charged_mwh: document.getElementById('entry-batt-charged').value,
          battery_discharged_mwh: document.getElementById('entry-batt-discharged').value,
          battery_storage_mwh: document.getElementById('entry-batt-storage').value
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Insert failed');

      battResult.className = 'entry-result success';
      battResult.innerHTML = `Inserted successfully. <code>trg_battery_valid_storage</code> and <code>chk_discharge_limit</code> both passed.`;

      loadOverview();
      loadBattery();
      loadInsights();
    } catch (err) {
      // A trigger or check-constraint rejection lands here with Oracle's
      // own error text (e.g. ORA-20001 from trg_battery_valid_storage).
      battResult.className = 'entry-result error';
      battResult.textContent = `Insert rejected: ${err.message}`;
    }
  });
}

// ----------------------------------------------------------------
// Initial load - fetch every view once so switching tabs is instant
// ----------------------------------------------------------------
loadOverview();
loadGeneration();
loadBattery();
loadRankings();
loadInsights();
wireDataEntryForms();