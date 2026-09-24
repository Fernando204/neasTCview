const meditionList = document.getElementById('medition-list');

const tempA = document.getElementById('tempA');
const humA = document.getElementById('humidityA');
const statusA = document.getElementById('statusA');
const dateA = document.getElementById('dateA');
const pressureA = document.getElementById('pressureA');
const statusIndicatorA = document.getElementById('statusIndicatorA');

const tempB = document.getElementById('tempB');
const humB = document.getElementById('humidityB');
const statusB = document.getElementById('statusB');
const dateB = document.getElementById('dateB');
const pressureB = document.getElementById('pressureB');
const statusIndicatorB = document.getElementById('statusIndicatorB');

const btA = document.getElementById('btA');
const btB = document.getElementById('btB');
const btAll = document.getElementById('btAll');

const period = document.getElementById("period");

let meditions = [];
let actualRoom = 'A';

let selectedFilter = "all";

period.addEventListener("change",()=>{
    filter = period.value;
})

btA.addEventListener('click', () => {
    actualRoom = 'A';
    btA.classList.add('active');
    btB.classList.remove('active');
    btAll.classList.remove('active');
    updateUI();
});

btB.addEventListener('click', () => {
    actualRoom = 'B';
    btB.classList.add('active');
    btA.classList.remove('active');
    btAll.classList.remove('active');
    updateUI();
});
btAll.addEventListener('click', () => {
    actualRoom = 'All';
    btAll.classList.add('active');
    btA.classList.remove('active');
    btB.classList.remove('active');
    updateUI();
});

function formatDateUTC(dateString) {
  const date = new Date(dateString);

  const pad = (value) => String(value).padStart(2, '0');

  return `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}/${date.getUTCFullYear()} - ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

function createListItem(medition) {

    const status = medition.status.toLowerCase();

    const statusText =
        status === 'normal'
            ? 'Normal'
            : status === 'hot'
                ? 'Quente'
                : 'Frio';

    return `
        <div class="list-item">
            <span>${formatDateUTC(medition.createdAt)}</span>
            <span>${medition.temperature}°C</span>
            <span>${medition.humidity}%</span>
            <span style="color: var(--status-${status});">
                ${statusText}
            </span>
        </div>
    `;
}


async function fetchMeditions() {
    try {
        const response = await fetch('https://neastcapi.onrender.com/medition');

        if (!response.ok) {
            throw new Error(`Erro HTTP: ${response.status}`);
        }

        const data = await response.json();
        meditions.length = 0;
        meditions.push(...data.allMeditions);

        tempA.textContent = `temperatura: ${data.lastMeditionA.temperature}°C`;
        humA.textContent = `umidade: ${data.lastMeditionA.humidity}%`;
        statusA.textContent = 'status: ' + data.lastMeditionA.status;
        dateA.textContent = `data: ${formatDateUTC(data.lastMeditionA.createdAt)}`;
        pressureA.textContent = `pressão: ${data.lastMeditionA.pressure} hPa`;
        statusIndicatorA.style.backgroundColor = `var(--status-${data.lastMeditionA.status.toLowerCase()})`;

        tempB.textContent = `temperatura: ${data.lastMeditionB.temperature}°C`;
        humB.textContent = `umidade: ${data.lastMeditionB.humidity}%`;
        statusB.textContent = 'status: ' + data.lastMeditionB.status;
        dateB.textContent = `data: ${formatDateUTC(data.lastMeditionB.createdAt)}`;
        pressureB.textContent = `pressão: ${data.lastMeditionB.pressure} hPa`;
        statusIndicatorB.style.backgroundColor = `var(--status-${data.lastMeditionB.status.toLowerCase()})`;

    } catch (error) {
        console.error('Erro ao buscar medições:', error);
    }
}

function filter(meditions) {
    const now = new Date();

    return meditions.filter(m => {
        const date = new Date(m.timestamp);

        switch (selectedFilter) {
            case "all":
                return true;

            case "last-24-hours": {
                const limit = new Date(now);
                limit.setHours(limit.getHours() - 24);

                return date >= limit;
            }

            case "last-7-days": {
                const limit = new Date(now);
                limit.setDate(limit.getDate() - 7);

                return date >= limit;
            }

            case "last-30-days": {
                const limit = new Date(now);
                limit.setDate(limit.getDate() - 30);

                return date >= limit;
            }

            default:
                return false;
        }
    });
}


async function updateUI() {
    await fetchMeditions();
    meditionList.innerHTML = '';

    filter(meditions).forEach(medition => {

        if (medition.room === actualRoom || actualRoom === 'All') {
            const item = createListItem(medition);
            meditionList.innerHTML += item;
        }

    });

}

updateUI();