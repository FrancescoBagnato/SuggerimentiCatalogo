const SHEET_ID = '1zyH-Fg4tUfMQlde9H7tZeVslP6le4P0zKN9uX-O5NEk';
let dati = [];
let filtro = 'Tutti';

// Toggle input
document.getElementById('tipo').addEventListener('change', function() {
    const tipo = this.value;
    document.getElementById('inputFilm').classList.toggle('hidden', tipo !== 'Film');
    document.getElementById('inputSerie').classList.toggle('hidden', tipo !== 'Serie TV');
});

// Submit form
document.getElementById('form').addEventListener('submit', async function(e) {
    e.preventDefault();
    const tipo = document.getElementById('tipo').value;
    const titolo = tipo === 'Film' ? 
        document.getElementById('titoloFilm').value : 
        document.getElementById('titoloSerie').value;
    
    if (!tipo || !titolo) return alert('Compila tutti i campi!');

    // Invia a Google Form (inserisci URL form)
    const formUrl = 'https://docs.google.com/forms/d/e/1FAIpQLSc.../formResponse';
    const formData = new FormData();
    formData.append('entry.XXXXX', tipo);  // Sostituisci XXXXX
    formData.append('entry.YYYYY', titolo); // Sostituisci YYYYY

    try {
        await fetch(formUrl, { method: 'POST', body: formData, mode: 'no-cors' });
        alert('✅ Inviato!');
        this.reset();
        document.getElementById('inputFilm').classList.add('hidden');
        document.getElementById('inputSerie').classList.add('hidden');
        setTimeout(caricaDati, 2000);
    } catch(e) {
        alert('Errore. Riprova!');
    }
});

// Carica dati Sheet
async function caricaDati() {
    try {
        const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json`;
        const res = await fetch(url);
        const testo = await res.text();
        const json = JSON.parse(testo.substr(47).slice(0, -2));
        
        dati = json.table.rows.map(row => ({
             row.c[0]?.f || '',
            tipo: row.c[1]?.v || '',
            titolo: row.c[2]?.v || ''
        })).filter(item => item.tipo);

        mostraTabella();
    } catch(e) {
        document.getElementById('tabella').innerHTML = 
            '<tr><td colspan="3" class="vuoto">Errore caricamento</td></tr>';
    }
}

// Mostra tabella
function mostraTabella() {
    const filtrati = filtro === 'Tutti' ? dati : dati.filter(item => item.tipo === filtro);
    const tbody = document.getElementById('tabella');
    
    if (filtrati.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" class="vuoto">Nessun suggerimento</td></tr>';
        return;
    }

    tbody.innerHTML = filtrati.map(item => `
        <tr>
            <td><span class="badge badge-${item.tipo === 'Film' ? 'film' : 'serie'}">${item.tipo}</span></td>
            <td><strong>${item.titolo}</strong></td>
            <td>${item.data}</td>
        </tr>
    `).join('');
}

// Filtra
function filtra(nuovoFiltro) {
    filtro = nuovoFiltro;
    document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
    event.target.classList.add('active');
    mostraTabella();
}

// Avvio
caricaDati();
setInterval(caricaDati, 30000);
