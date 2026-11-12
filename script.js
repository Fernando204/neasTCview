const API_URL = 'https://neastcapi.onrender.com/medition';
const PAGE_SIZE = 50;            // itens exibidos por vez na lista
const REFRESH_MS = 60 * 1000;    // atualização automática (sensores enviam a cada 1 min)
const FETCH_TIMEOUT_MS = 90 * 1000; // o Render pode demorar para "acordar"
const CHART_MAX_POINTS = 240;

const PERIODS_MS = {
    'last-24-hours': 24 * 60 * 60 * 1000,
    'last-7-days': 7 * 24 * 60 * 60 * 1000,
    'last-30-days': 30 * 24 * 60 * 60 * 1000,
    'all': Infinity
};

// Salas e sensores (Sala A: sensores 1 e 2; Sala B: sensor 1)
const ROOMS = {
    A: { name: 'Sala A', sensors: [1, 2] },
    B: { name: 'Sala B', sensors: [1] }
};

const SERIES_COLORS = { 'A-1': '#2e9e44', 'A-2': '#34495e', 'B-1': '#b5651d' };
const UNKNOWN_COLOR = '#888888';

const STATUS_LABELS = { normal: 'Normal', hot: 'Quente', cold: 'Frio' };

/* =========================
   ELEMENTOS
========================= */

const meditionList = document.getElementById('medition-list');
const listInfo = document.getElementById('list-info');
const periodSelect = document.getElementById('period');
const roomButtons = document.querySelectorAll('.select-room button');

const chartEl = document.getElementById('chart');
const chartTitle = document.getElementById('chart-title');
const chartLegend = document.getElementById('chart-legend');

const selectSensor = document.getElementById('select-sensor');
const cardsContainer = document.querySelector('.cards');

// Um card por sensor: chaves "A-1", "A-2", "B-1"
const cards = {};

Object.entries(ROOMS).forEach(([room, info]) => {
    info.sensors.forEach(sensor => {
        const el = document.createElement('div');
        el.className = `room-${room.toLowerCase()} card loading`;
        el.innerHTML = `
            <h3>${info.name} · Sensor ${sensor}</h3>
            <p data-field="temp"></p>
            <p data-field="hum"></p>
            <p data-field="pressure"></p>
            <p data-field="date"></p>
            <p data-field="status"></p>
            <div class="status-indicator" data-field="indicator"></div>
        `;
        cardsContainer.appendChild(el);

        const field = (name) => el.querySelector(`[data-field="${name}"]`);
        cards[`${room}-${sensor}`] = {
            card: el,
            temp: field('temp'),
            hum: field('hum'),
            pressure: field('pressure'),
            date: field('date'),
            status: field('status'),
            indicator: field('indicator')
        };
    });
});

/* =========================
   ESTADO
========================= */

const state = {
    status: 'loading',            // 'loading' | 'ready' | 'error'
    meditions: [],                // sempre ordenadas do mais novo para o mais antigo
    last: {},                     // última medição de cada sensor ("A-1", "A-2", "B-1")
    room: 'A',
    sensor: 'all',                // 'all' ou número do sensor
    period: periodSelect.value,   // começa igual ao que o select mostra
    visible: PAGE_SIZE
};

let isFetching = false;
let loadingText = 'Carregando medições...';
let loadingTimers = [];

/* =========================
   UTILITÁRIOS
========================= */

const pad = (value) => String(value).padStart(2, '0');

function formatDate(value) {
    const date = new Date(value);

    return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} - ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function statusLabel(status) {
    return STATUS_LABELS[status] || 'Desconhecido';
}

// A API devolve "createdAt"; o model.json antigo usa "timestamp". Aceita os dois.
function normalize(m) {
    return {
        ...m,
        time: new Date(m.createdAt ?? m.timestamp).getTime(),
        sensor: m.sensor == null ? null : Number(m.sensor),
        status: String(m.status || '').toLowerCase()
    };
}

/* =========================
   ANIMAÇÃO / TEXTOS DE CARREGAMENTO
========================= */

function startLoadingTexts() {
    stopLoadingTexts();
    setLoadingText('Carregando medições...');

    loadingTimers = [
        setTimeout(() => setLoadingText('O servidor está iniciando, isso pode levar até 1 minuto...'), 4000),
        setTimeout(() => setLoadingText('Ainda aguardando o servidor responder...'), 20000),
        setTimeout(() => setLoadingText('Quase lá, só mais um instante...'), 45000)
    ];
}

function stopLoadingTexts() {
    loadingTimers.forEach(clearTimeout);
    loadingTimers = [];
}

function setLoadingText(text) {
    loadingText = text;
    document.querySelectorAll('.loader-text').forEach(el => {
        el.textContent = text;
    });
}

function loaderHTML() {
    return `
        <div class="loader" role="status" aria-live="polite">
            <span class="spinner"></span>
            <p class="loader-text">${loadingText}</p>
        </div>
    `;
}

function errorHTML() {
    return `
        <div class="load-error" role="alert">
            <p>Não foi possível carregar as medições.</p>
            <button type="button" data-action="retry">Tentar novamente</button>
        </div>
    `;
}

/* =========================
   BUSCA DOS DADOS
========================= */

async function loadData({ silent = false } = {}) {
    if (isFetching) return;
    isFetching = true;

    if (!silent) {
        state.status = 'loading';
        startLoadingTexts();
        render();
    }

    try {
        const response = await fetch(API_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });

        if (!response.ok) {
            throw new Error(`Erro HTTP: ${response.status}`);
        }

        const data = await response.json();

        // Normaliza e ordena UMA vez: do mais novo para o mais antigo
        state.meditions = (data.allMeditions || [])
            .map(normalize)
            .filter(m => Number.isFinite(m.time))
            .sort((a, b) => b.time - a.time);

        // Como a lista está do mais novo para o mais antigo, a primeira de cada sensor é a última
        state.last = {};
        state.meditions.forEach(m => {
            const key = `${m.room}-${m.sensor}`;
            if (!state.last[key]) state.last[key] = m;
        });

        state.status = 'ready';
    } catch (error) {
        console.error('Erro ao buscar medições:', error);

        // Numa atualização automática, mantém na tela os dados que já existem
        if (!(silent && state.status === 'ready')) {
            state.status = 'error';
        }
    } finally {
        isFetching = false;
        stopLoadingTexts();
        render();
    }
}

/* =========================
   FILTROS
========================= */

function getFiltered() {
    const span = PERIODS_MS[state.period];
    const since = Number.isFinite(span) ? Date.now() - span : -Infinity;

    return state.meditions.filter(m =>
        m.time >= since &&
        (state.room === 'All' || m.room === state.room) &&
        (state.sensor === 'all' || m.sensor === state.sensor)
    );
}

periodSelect.addEventListener('change', () => {
    state.period = periodSelect.value;
    state.visible = PAGE_SIZE;
    render();
});

roomButtons.forEach(button => {
    button.addEventListener('click', () => {
        state.room = button.dataset.room;
        state.sensor = 'all';
        state.visible = PAGE_SIZE;

        roomButtons.forEach(b => {
            const active = b === button;
            b.classList.toggle('active', active);
            b.setAttribute('aria-pressed', String(active));
        });

        render();
    });
});

function renderSensorFilter() {
    const sensors = ROOMS[state.room]?.sensors || [];

    // Só aparece quando a sala tem mais de um sensor (Sala A)
    if (sensors.length < 2) {
        selectSensor.innerHTML = '';
        return;
    }

    const options = [['all', 'Todos os sensores'], ...sensors.map(s => [s, `Sensor ${s}`])];

    selectSensor.innerHTML = options.map(([value, label]) => {
        const active = String(state.sensor) === String(value);
        return `<button type="button" data-sensor="${value}" class="${active ? 'active' : ''}" aria-pressed="${active}">${label}</button>`;
    }).join('');
}

selectSensor.addEventListener('click', (e) => {
    const button = e.target.closest('button[data-sensor]');
    if (!button) return;

    state.sensor = button.dataset.sensor === 'all' ? 'all' : Number(button.dataset.sensor);
    state.visible = PAGE_SIZE;
    render();
});

/* =========================
   CARDS (ÚLTIMAS MEDIÇÕES)
========================= */

function setCardPlaceholder(key, text, pulsing) {
    const c = cards[key];

    c.card.classList.toggle('loading', pulsing);
    c.temp.textContent = `Temperatura: ${text}`;
    c.hum.textContent = `Umidade: ${text}`;
    c.pressure.textContent = `Pressão: ${text}`;
    c.date.textContent = `Data: ${text}`;
    c.status.textContent = `Status: ${text}`;
    c.indicator.style.backgroundColor = 'transparent';
}

function renderCard(key) {
    const c = cards[key];
    const m = state.last[key];

    if (state.status === 'loading') {
        setCardPlaceholder(key, 'carregando...', true);
        return;
    }

    if (!m) {
        setCardPlaceholder(key, state.status === 'error' ? 'indisponível' : '----', false);
        return;
    }

    c.card.classList.remove('loading');
    c.temp.textContent = `Temperatura: ${m.temperature}°C`;
    c.hum.textContent = `Umidade: ${m.humidity}%`;
    c.pressure.textContent = `Pressão: ${m.pressure} hPa`;
    c.date.textContent = `Data: ${formatDate(m.time)}`;
    c.status.textContent = `Status: ${statusLabel(m.status)}`;
    c.indicator.style.backgroundColor = `var(--status-${m.status})`;
}

/* =========================
   LISTA
========================= */

function createListItem(m) {
    const sensorText = m.sensor == null ? '—' : `Sensor ${m.sensor}`;
    const where = state.room === 'All' ? `Sala ${m.room} · ${sensorText}` : sensorText;

    return `
        <div class="list-item">
            <span>${formatDate(m.time)}</span>
            <span>${where}</span>
            <span>${m.temperature}°C</span>
            <span>${m.humidity}%</span>
            <span style="color: var(--status-${m.status});">${statusLabel(m.status)}</span>
        </div>
    `;
}

function renderList(rows) {
    if (state.status === 'loading') {
        listInfo.textContent = '';
        meditionList.innerHTML = loaderHTML();
        return;
    }

    if (state.status === 'error') {
        listInfo.textContent = '';
        meditionList.innerHTML = errorHTML();
        return;
    }

    if (rows.length === 0) {
        listInfo.textContent = '';
        meditionList.innerHTML = '<div class="empty"><p>Não há medições para exibir neste período</p></div>';
        return;
    }

    const shown = rows.slice(0, state.visible);
    const remaining = rows.length - shown.length;

    listInfo.textContent = `Exibindo ${shown.length} de ${rows.length} medições, da mais recente para a mais antiga`;

    meditionList.innerHTML =
        shown.map(createListItem).join('') +
        (remaining > 0
            ? `<button type="button" class="load-more" data-action="more">Mostrar mais ${Math.min(PAGE_SIZE, remaining)}</button>`
            : '');
}

/* =========================
   GRÁFICO DE TEMPERATURA
========================= */

function downsample(points, max) {
    if (points.length <= max) return points;

    const size = points.length / max;
    const out = [];

    for (let i = 0; i < max; i++) {
        const start = Math.floor(i * size);
        const end = Math.max(Math.floor((i + 1) * size), start + 1);
        const slice = points.slice(start, end);

        out.push({
            t: slice.reduce((s, p) => s + p.t, 0) / slice.length,
            v: slice.reduce((s, p) => s + p.v, 0) / slice.length
        });
    }

    return out;
}

function seriesLabel(room, sensor) {
    return `Sala ${room}` + (sensor == null ? '' : ` · Sensor ${sensor}`);
}

// Agrupa por sensor (a redução de pontos é feita depois, por trecho)
function buildSeries(rows) {
    const groups = new Map();

    rows.forEach(m => {
        const v = Number(m.temperature);
        if (!Number.isFinite(v)) return;

        const key = `${m.room}-${m.sensor ?? '?'}`;
        if (!groups.has(key)) {
            groups.set(key, { key, room: m.room, sensor: m.sensor, points: [] });
        }
        groups.get(key).points.push({ t: m.time, v });
    });

    return [...groups.values()]
        .sort((x, y) => x.key.localeCompare(y.key))
        .map(s => ({
            ...s,
            label: seriesLabel(s.room, s.sensor),
            color: SERIES_COLORS[s.key] || UNKNOWN_COLOR,
            points: s.points.sort((p, q) => p.t - q.t)
        }));
}

/* ---------- buracos nos dados ---------- */

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const GAP_WIDTH = 22;       // largura (px) de um intervalo sem dados compactado
const MIN_INTERVAL_W = 12;  // largura mínima (px) de um trecho com poucos dados

// passos "redondos" para os rótulos do eixo X
const TICK_STEPS = [1, 2, 5, 10, 15, 30].map(n => n * MIN)
    .concat([1, 2, 3, 6, 12].map(n => n * HOUR))
    .concat([1, 2, 7, 14].map(n => n * DAY));

function median(values) {
    if (values.length === 0) return 0;

    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);

    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Divide a série em trechos contínuos: um buraco maior que breakMs começa um novo trecho
function splitSegments(points, breakMs) {
    const segments = [];
    let current = [];

    points.forEach((p, i) => {
        if (i > 0 && p.t - points[i - 1].t > breakMs) {
            segments.push(current);
            current = [];
        }
        current.push(p);
    });

    if (current.length) segments.push(current);

    return segments;
}

function formatDuration(ms) {
    const min = Math.max(1, Math.round(ms / MIN));

    if (min < 60) return `${min} min`;

    const h = Math.floor(min / 60);
    if (h < 24) return min % 60 ? `${h} h ${min % 60} min` : `${h} h`;

    const d = Math.floor(h / 24);
    return h % 24 ? `${d} d ${h % 24} h` : `${d} d`;
}

// Monta o eixo X: os períodos com dados ocupam o espaço proporcional ao tempo
// e os buracos grandes são compactados em uma faixa estreita.
function buildTimeline(spans, breakMs, left, plotW) {
    // une os trechos de todos os sensores
    const sorted = [...spans].sort((a, b) => a.start - b.start);
    const union = [];

    sorted.forEach(s => {
        const last = union[union.length - 1];
        if (last && s.start - last.end <= breakMs) {
            last.end = Math.max(last.end, s.end);
        } else {
            union.push({ start: s.start, end: s.end });
        }
    });

    const totalSpan = union[union.length - 1].end - union[0].start;
    const collapseMs = Math.max(breakMs * 3, totalSpan * 0.08);
    const maxGaps = Math.max(0, Math.floor((plotW * 0.3) / GAP_WIDTH));

    // só os maiores buracos são compactados (e no máximo maxGaps deles)
    const collapsed = new Set(
        union.slice(1)
            .map((u, i) => ({ index: i + 1, size: u.start - union[i].end }))
            .filter(g => g.size >= collapseMs)
            .sort((a, b) => b.size - a.size)
            .slice(0, maxGaps)
            .map(g => g.index)
    );

    const intervals = [];
    union.forEach((u, i) => {
        if (i === 0 || collapsed.has(i)) {
            intervals.push({ start: u.start, end: u.end });
        } else {
            intervals[intervals.length - 1].end = u.end;
        }
    });

    // larguras: proporcional ao tempo, com um mínimo para trechos curtos
    const avail = plotW - (intervals.length - 1) * GAP_WIDTH;
    const totalDur = intervals.reduce((s, iv) => s + Math.max(iv.end - iv.start, 1), 0);

    intervals.forEach(iv => {
        iv.w = Math.max(MIN_INTERVAL_W, (avail * Math.max(iv.end - iv.start, 1)) / totalDur);
    });

    const widthSum = intervals.reduce((s, iv) => s + iv.w, 0);
    if (widthSum > avail) {
        const fixed = intervals.filter(iv => iv.w === MIN_INTERVAL_W);
        const flexible = intervals.filter(iv => iv.w !== MIN_INTERVAL_W);
        const flexSum = flexible.reduce((s, iv) => s + iv.w, 0);
        const factor = flexSum > 0 ? Math.max(0, avail - fixed.length * MIN_INTERVAL_W) / flexSum : 1;

        flexible.forEach(iv => { iv.w *= factor; });
    }

    let cursor = left;
    const gaps = [];

    intervals.forEach((iv, i) => {
        iv.x0 = cursor;
        iv.x1 = cursor + iv.w;
        cursor = iv.x1;

        if (i < intervals.length - 1) {
            gaps.push({ x0: iv.x1, x1: iv.x1 + GAP_WIDTH, ms: intervals[i + 1].start - iv.end });
            cursor += GAP_WIDTH;
        }
    });

    const x = (t) => {
        const iv = intervals.find(i => t <= i.end) || intervals[intervals.length - 1];

        if (iv.end === iv.start) return (iv.x0 + iv.x1) / 2;

        const tt = Math.min(Math.max(t, iv.start), iv.end);
        return iv.x0 + ((tt - iv.start) / (iv.end - iv.start)) * iv.w;
    };

    return { intervals, gaps, x };
}

// Rótulos do eixo X, distribuídos dentro de cada período com dados
function buildTicks(timeline, minSpacing) {
    const ticks = [];

    timeline.intervals.forEach(iv => {
        const dur = iv.end - iv.start;
        const want = Math.max(1, Math.floor(iv.w / 90));
        const step = TICK_STEPS.find(s => s >= dur / want) || TICK_STEPS[TICK_STEPS.length - 1];

        // alinha no horário local (ex.: 10:00, 10:30)
        const offset = new Date(iv.start).getTimezoneOffset() * MIN;
        const found = [];

        for (let t = Math.ceil((iv.start - offset) / step) * step + offset; t <= iv.end; t += step) {
            found.push(t);
        }

        if (found.length === 0) found.push(iv.start + dur / 2);

        found.forEach(t => ticks.push({ t, step, x: timeline.x(t) }));
    });

    const kept = [];
    ticks.sort((a, b) => a.x - b.x).forEach(tick => {
        if (kept.length === 0 || tick.x - kept[kept.length - 1].x >= minSpacing) kept.push(tick);
    });

    return kept;
}

function niceTicks(min, max, count = 5) {
    if (min === max) {
        min -= 1;
        max += 1;
    }

    const raw = (max - min) / count;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;

    const start = Math.floor(min / step) * step;
    const end = Math.ceil(max / step) * step;
    const ticks = [];

    for (let v = start; v <= end + step / 2; v += step) {
        ticks.push(Math.round(v * 100) / 100);
    }

    return ticks;
}

function renderChart(rows) {
    const periodText = periodSelect.options[periodSelect.selectedIndex].text;
    const roomText = state.room === 'All' ? 'Todas as salas' : `Sala ${state.room}`;

    const sensorText = state.sensor === 'all' ? '' : ` · Sensor ${state.sensor}`;

    chartTitle.textContent = `Temperatura · ${roomText}${sensorText} · ${periodText}`;
    chartLegend.innerHTML = '';

    if (state.status === 'loading') {
        chartEl.innerHTML = loaderHTML();
        return;
    }

    if (state.status === 'error') {
        chartEl.innerHTML = '<div class="empty"><p>Gráfico indisponível</p></div>';
        return;
    }

    const series = buildSeries(rows);

    if (series.length === 0) {
        chartEl.innerHTML = '<div class="empty"><p>Não há dados para o gráfico neste período</p></div>';
        return;
    }

    // --- 1. o que é um "buraco": depende do intervalo normal entre medições ---
    const deltas = [];
    series.forEach(s => {
        for (let i = 1; i < s.points.length; i++) deltas.push(s.points[i].t - s.points[i - 1].t);
    });

    const typical = median(deltas) || MIN;
    const breakMs = Math.max(typical * 5, 5 * MIN);

    // --- 2. trechos contínuos de cada sensor ---
    const spans = [];

    series.forEach(s => {
        s.segments = splitSegments(s.points, breakMs);
        s.segments.forEach(seg => spans.push({ start: seg[0].t, end: seg[seg.length - 1].t }));
    });

    // --- 3. reduz a quantidade de pontos dentro de cada trecho ---
    series.forEach(s => {
        const total = s.points.length;

        s.segments = s.segments.map(seg =>
            downsample(seg, Math.max(2, Math.round((CHART_MAX_POINTS * seg.length) / total)))
        );
        s.flat = s.segments.flat();
    });

    if (series.length > 1) {
        chartLegend.innerHTML = series
            .map(s => `<span style="--c:${s.color}">${s.label}</span>`)
            .join('');
    }

    // --- 4. escalas ---
    const temps = series.flatMap(s => s.flat.map(p => p.v));
    const ticksY = niceTicks(Math.min(...temps), Math.max(...temps));
    const y0 = ticksY[0];
    const y1 = ticksY[ticksY.length - 1];

    const firstT = Math.min(...spans.map(s => s.start));
    const lastT = Math.max(...spans.map(s => s.end));
    const multiDay = new Date(firstT).toDateString() !== new Date(lastT).toDateString();

    const W = Math.max(chartEl.clientWidth, 280);
    const H = 260;
    const m = { l: 44, r: 20, t: 12, b: multiDay ? 42 : 28 };
    const plotW = W - m.l - m.r;
    const yBase = H - m.b;

    const timeline = buildTimeline(spans, breakMs, m.l, plotW);
    const x = timeline.x;
    const y = (v) => yBase - ((v - y0) / (y1 - y0)) * (H - m.t - m.b);

    if (timeline.gaps.length > 0) {
        chartLegend.innerHTML += '<span class="gap-note">intervalo sem dados</span>';
    }

    series.forEach(s => {
        s.flat.forEach(p => { p.x = x(p.t); p.y = y(p.v); });
    });

    // --- 5. desenho ---
    let svg = `<svg id="chart-svg" width="${W}" height="${H}" role="img" aria-label="Gráfico de temperatura">`;

    svg += '<defs><pattern id="gap-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">'
        + '<line x1="0" y1="0" x2="0" y2="6" class="gap-hatch-line"/></pattern></defs>';

    // faixas dos intervalos sem dados
    timeline.gaps.forEach(g => {
        svg += `<rect x="${g.x0}" y="${m.t}" width="${g.x1 - g.x0}" height="${yBase - m.t}" fill="url(#gap-hatch)"/>`;
    });

    // linhas horizontais e valores do eixo Y
    ticksY.forEach(v => {
        svg += `<line x1="${m.l}" y1="${y(v)}" x2="${W - m.r}" y2="${y(v)}" class="grid"/>`;
        svg += `<text x="${m.l - 8}" y="${y(v) + 4}" text-anchor="end" class="tick">${v}°</text>`;
    });

    // marcas "//" no eixo X, onde o tempo foi compactado
    timeline.gaps.forEach(g => {
        const cx = (g.x0 + g.x1) / 2;
        [-3, 3].forEach(dx => {
            svg += `<line x1="${cx + dx - 2}" y1="${yBase + 4}" x2="${cx + dx + 2}" y2="${yBase - 4}" class="gap-mark"/>`;
        });
    });

    // valores do eixo X
    buildTicks(timeline, multiDay ? 54 : 46).forEach(tick => {
        const d = new Date(tick.t);
        const date = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
        const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;

        if (tick.step >= DAY) {
            svg += `<text x="${tick.x}" y="${H - 8}" text-anchor="middle" class="tick">${date}</text>`;
        } else {
            svg += `<text x="${tick.x}" y="${yBase + 15}" text-anchor="middle" class="tick">${time}</text>`;
            if (multiDay) {
                svg += `<text x="${tick.x}" y="${yBase + 28}" text-anchor="middle" class="tick tick-date">${date}</text>`;
            }
        }
    });

    // linhas retas: uma por trecho contínuo (sem ligar os buracos)
    series.forEach(s => {
        const showDots = s.flat.length <= 60;

        s.segments.forEach(seg => {
            if (seg.length === 1) {
                // trecho com uma única medição: só o ponto
                svg += `<circle cx="${seg[0].x.toFixed(1)}" cy="${seg[0].y.toFixed(1)}" r="3" fill="${s.color}"/>`;
                return;
            }

            const pts = seg.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
            const first = seg[0];
            const last = seg[seg.length - 1];

            svg += `<polygon points="${first.x.toFixed(1)},${yBase} ${pts} ${last.x.toFixed(1)},${yBase}" fill="${s.color}" fill-opacity="0.08"/>`;
            svg += `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="1.5" stroke-linejoin="round"/>`;

            if (showDots) {
                seg.forEach(p => {
                    svg += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2.5" fill="${s.color}"/>`;
                });
            }
        });
    });

    // elementos usados ao passar o mouse
    svg += `<line id="chart-guide" y1="${m.t}" y2="${yBase}" class="guide" visibility="hidden"/>`;
    series.forEach((s, i) => {
        svg += `<circle id="chart-dot-${i}" r="4" fill="#fff" stroke="${s.color}" stroke-width="1.5" visibility="hidden"/>`;
    });
    svg += '</svg><div class="chart-tooltip" id="chart-tooltip"></div>';

    chartEl.innerHTML = svg;

    // --- 6. interação ---
    const svgEl = document.getElementById('chart-svg');
    const tooltip = document.getElementById('chart-tooltip');
    const guide = document.getElementById('chart-guide');

    const nearest = (points, px) =>
        points.reduce((best, p) => (Math.abs(p.x - px) < Math.abs(best.x - px) ? p : best), points[0]);

    const hideDots = () => {
        guide.setAttribute('visibility', 'hidden');
        series.forEach((s, i) => document.getElementById(`chart-dot-${i}`).setAttribute('visibility', 'hidden'));
    };

    const hide = () => {
        tooltip.style.display = 'none';
        hideDots();
    };

    const placeTooltip = (px) => {
        const left = px + 10;
        tooltip.style.left = `${left + tooltip.offsetWidth > W ? px - tooltip.offsetWidth - 10 : left}px`;
        tooltip.style.top = `${m.t}px`;
    };

    svgEl.addEventListener('pointermove', (e) => {
        const px = e.clientX - svgEl.getBoundingClientRect().left;

        if (px < m.l || px > W - m.r) {
            hide();
            return;
        }

        // cursor sobre um intervalo compactado
        const gap = timeline.gaps.find(g => px >= g.x0 && px <= g.x1);
        if (gap) {
            hideDots();
            tooltip.innerHTML = `<strong>Sem dados</strong><br>por ${formatDuration(gap.ms)}`;
            tooltip.style.display = 'block';
            placeTooltip((gap.x0 + gap.x1) / 2);
            return;
        }

        const found = series.map((s, i) => ({ s, i, p: nearest(s.flat, px) }));
        const best = found.reduce((a, b) => (Math.abs(a.p.x - px) < Math.abs(b.p.x - px) ? a : b));

        // só mostra os sensores que mediram perto desse mesmo momento
        const shown = found.filter(f => Math.abs(f.p.t - best.p.t) <= breakMs);

        hideDots();
        guide.setAttribute('x1', best.p.x);
        guide.setAttribute('x2', best.p.x);
        guide.setAttribute('visibility', 'visible');

        shown.forEach(f => {
            const dot = document.getElementById(`chart-dot-${f.i}`);
            dot.setAttribute('cx', f.p.x);
            dot.setAttribute('cy', f.p.y);
            dot.setAttribute('visibility', 'visible');
        });

        tooltip.innerHTML =
            `<strong>${formatDate(best.p.t)}</strong>` +
            shown.map(f => `<br>${f.s.label}: ${f.p.v.toFixed(1)}°C`).join('');
        tooltip.style.display = 'block';

        placeTooltip(best.p.x);
    });

    svgEl.addEventListener('pointerleave', hide);
}

let resizeTimer;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
        if (state.status === 'ready') renderChart(getFiltered());
    }, 150);
});

/* =========================
   RENDER
========================= */

function render() {
    const rows = state.status === 'ready' ? getFiltered() : [];

    renderSensorFilter();
    Object.keys(cards).forEach(renderCard);
    renderChart(rows);
    renderList(rows);
}

// Botões "Tentar novamente" e "Mostrar mais"
document.addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;

    if (action === 'retry') {
        loadData();
    } else if (action === 'more') {
        state.visible += PAGE_SIZE;
        renderList(getFiltered());
    }
});

/* =========================
   INÍCIO
========================= */

loadData();
setInterval(() => loadData({ silent: true }), REFRESH_MS);