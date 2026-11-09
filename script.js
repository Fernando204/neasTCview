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

const ROOM_COLORS = { A: '#2e9e44', B: '#34495e' };

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

const cards = {
    A: {
        card: document.getElementById('cardA'),
        temp: document.getElementById('tempA'),
        hum: document.getElementById('humidityA'),
        pressure: document.getElementById('pressureA'),
        date: document.getElementById('dateA'),
        status: document.getElementById('statusA'),
        indicator: document.getElementById('statusIndicatorA')
    },
    B: {
        card: document.getElementById('cardB'),
        temp: document.getElementById('tempB'),
        hum: document.getElementById('humidityB'),
        pressure: document.getElementById('pressureB'),
        date: document.getElementById('dateB'),
        status: document.getElementById('statusB'),
        indicator: document.getElementById('statusIndicatorB')
    }
};

/* =========================
   ESTADO
========================= */

const state = {
    status: 'loading',            // 'loading' | 'ready' | 'error'
    meditions: [],                // sempre ordenadas do mais novo para o mais antigo
    last: { A: null, B: null },
    room: 'A',
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

        state.last.A = data.lastMeditionA
            ? normalize(data.lastMeditionA)
            : state.meditions.find(m => m.room === 'A') || null;
        state.last.B = data.lastMeditionB
            ? normalize(data.lastMeditionB)
            : state.meditions.find(m => m.room === 'B') || null;

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
        m.time >= since && (state.room === 'All' || m.room === state.room)
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
        state.visible = PAGE_SIZE;

        roomButtons.forEach(b => {
            const active = b === button;
            b.classList.toggle('active', active);
            b.setAttribute('aria-pressed', String(active));
        });

        render();
    });
});

/* =========================
   CARDS (ÚLTIMAS MEDIÇÕES)
========================= */

function setCardPlaceholder(room, text, pulsing) {
    const c = cards[room];

    c.card.classList.toggle('loading', pulsing);
    c.temp.textContent = `Temperatura: ${text}`;
    c.hum.textContent = `Umidade: ${text}`;
    c.pressure.textContent = `Pressão: ${text}`;
    c.date.textContent = `Data: ${text}`;
    c.status.textContent = `Status: ${text}`;
    c.indicator.style.backgroundColor = 'transparent';
}

function renderCard(room) {
    const c = cards[room];
    const m = state.last[room];

    if (state.status === 'loading') {
        setCardPlaceholder(room, 'carregando...', true);
        return;
    }

    if (!m) {
        setCardPlaceholder(room, state.status === 'error' ? 'indisponível' : '----', false);
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
    const roomInfo = state.room === 'All' ? ` · Sala ${m.room}` : '';

    return `
        <div class="list-item">
            <span>${formatDate(m.time)}${roomInfo}</span>
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

function buildSeries(rows) {
    const rooms = state.room === 'All' ? ['A', 'B'] : [state.room];

    return rooms
        .map(room => {
            const points = rows
                .filter(m => m.room === room)
                .map(m => ({ t: m.time, v: Number(m.temperature) }))
                .filter(p => Number.isFinite(p.v))
                .sort((a, b) => a.t - b.t);

            return { room, points: downsample(points, CHART_MAX_POINTS) };
        })
        .filter(s => s.points.length > 0);
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

function formatTick(t, span) {
    const d = new Date(t);

    return span <= 36 * 60 * 60 * 1000
        ? `${pad(d.getHours())}:${pad(d.getMinutes())}`
        : `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
}

function renderChart(rows) {
    const periodText = periodSelect.options[periodSelect.selectedIndex].text;
    const roomText = state.room === 'All' ? 'Todas as salas' : `Sala ${state.room}`;

    chartTitle.textContent = `Temperatura · ${roomText} · ${periodText}`;
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

    if (series.length > 1) {
        chartLegend.innerHTML = series
            .map(s => `<span style="--c:${ROOM_COLORS[s.room]}">Sala ${s.room}</span>`)
            .join('');
    }

    const all = series.flatMap(s => s.points);
    const temps = all.map(p => p.v);
    const ticksY = niceTicks(Math.min(...temps), Math.max(...temps));
    const y0 = ticksY[0];
    const y1 = ticksY[ticksY.length - 1];

    let t0 = Math.min(...all.map(p => p.t));
    let t1 = Math.max(...all.map(p => p.t));
    if (t0 === t1) {
        t0 -= 30 * 60 * 1000;
        t1 += 30 * 60 * 1000;
    }
    const span = t1 - t0;

    const W = Math.max(chartEl.clientWidth, 280);
    const H = 260;
    const m = { l: 44, r: 16, t: 12, b: 28 };
    const plotW = W - m.l - m.r;

    const x = (t) => m.l + ((t - t0) / span) * plotW;
    const y = (v) => H - m.b - ((v - y0) / (y1 - y0)) * (H - m.t - m.b);

    let svg = `<svg id="chart-svg" width="${W}" height="${H}" role="img" aria-label="Gráfico de temperatura">`;

    // linhas horizontais e valores do eixo Y
    ticksY.forEach(v => {
        svg += `<line x1="${m.l}" y1="${y(v)}" x2="${W - m.r}" y2="${y(v)}" class="grid"/>`;
        svg += `<text x="${m.l - 8}" y="${y(v) + 4}" text-anchor="end" class="tick">${v}°</text>`;
    });

    // valores do eixo X
    for (let i = 0; i < 5; i++) {
        const t = t0 + (span * i) / 4;
        const anchor = i === 0 ? 'start' : i === 4 ? 'end' : 'middle';
        svg += `<text x="${x(t)}" y="${H - 8}" text-anchor="${anchor}" class="tick">${formatTick(t, span)}</text>`;
    }

    // linhas retas, sem suavização
    series.forEach(s => {
        const pts = s.points.map(p => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
        svg += `<polyline points="${pts}" fill="none" stroke="${ROOM_COLORS[s.room]}" stroke-width="1.5" stroke-linejoin="round"/>`;

        // poucos pontos: mostra cada medição
        if (s.points.length <= 60) {
            s.points.forEach(p => {
                svg += `<circle cx="${x(p.t).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="2.5" fill="${ROOM_COLORS[s.room]}"/>`;
            });
        }
    });

    // elementos usados ao passar o mouse
    svg += `<line id="chart-guide" y1="${m.t}" y2="${H - m.b}" class="guide" visibility="hidden"/>`;
    series.forEach(s => {
        svg += `<circle id="chart-dot-${s.room}" r="4" fill="#fff" stroke="${ROOM_COLORS[s.room]}" stroke-width="1.5" visibility="hidden"/>`;
    });
    svg += '</svg><div class="chart-tooltip" id="chart-tooltip"></div>';

    chartEl.innerHTML = svg;

    // interação: valor mais próximo do cursor
    const svgEl = document.getElementById('chart-svg');
    const tooltip = document.getElementById('chart-tooltip');
    const guide = document.getElementById('chart-guide');

    const nearest = (points, t) =>
        points.reduce((best, p) => (Math.abs(p.t - t) < Math.abs(best.t - t) ? p : best), points[0]);

    const hide = () => {
        tooltip.style.display = 'none';
        guide.setAttribute('visibility', 'hidden');
        series.forEach(s => document.getElementById(`chart-dot-${s.room}`).setAttribute('visibility', 'hidden'));
    };

    svgEl.addEventListener('pointermove', (e) => {
        const px = e.clientX - svgEl.getBoundingClientRect().left;

        if (px < m.l || px > W - m.r) {
            hide();
            return;
        }

        const t = t0 + ((px - m.l) / plotW) * span;
        const found = series.map(s => ({ room: s.room, p: nearest(s.points, t) }));
        const best = found.reduce((a, b) => (Math.abs(a.p.t - t) < Math.abs(b.p.t - t) ? a : b));

        guide.setAttribute('x1', x(best.p.t));
        guide.setAttribute('x2', x(best.p.t));
        guide.setAttribute('visibility', 'visible');

        found.forEach(f => {
            const dot = document.getElementById(`chart-dot-${f.room}`);
            dot.setAttribute('cx', x(f.p.t));
            dot.setAttribute('cy', y(f.p.v));
            dot.setAttribute('visibility', 'visible');
        });

        tooltip.innerHTML =
            `<strong>${formatDate(best.p.t)}</strong>` +
            found.map(f => `<br>Sala ${f.room}: ${f.p.v.toFixed(1)}°C`).join('');
        tooltip.style.display = 'block';

        const left = x(best.p.t) + 10;
        tooltip.style.left = `${left + tooltip.offsetWidth > W ? x(best.p.t) - tooltip.offsetWidth - 10 : left}px`;
        tooltip.style.top = `${m.t}px`;
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

    renderCard('A');
    renderCard('B');
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