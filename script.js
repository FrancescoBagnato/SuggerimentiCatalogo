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

    // Invia a Google Form
    const formUrl = 'https://docs.google.com/forms/d/e/1FAIpQLSfOiTpwkWZyeUlVgC4WZkYLdCCLTg6p-I2lW_FxXjCG3UDXMw/formResponse';
    const formData = new FormData();
    formData.append('entry.1656949296', tipo);
    formData.append('entry.383160714', titolo);

    try {
        await fetch(formUrl, { method: 'POST', body: formData, mode: 'no-cors' });
        alert('✅ Suggerimento inviato!');
        this.reset();
        document.getElementById('inputFilm').classList.add('hidden');
        document.getElementById('inputSerie').classList.add('hidden');
        setTimeout(caricaDati, 3000);
    } catch(e) {
        alert('❌ Errore invio. Riprova!');
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
             row.c[0]?.f || row.c[0]?.v || '',
            tipo: row.c[1]?.v || '',
            titolo: row.c[2]?.v || ''
        })).filter(item => item.tipo && item.titolo);

        mostraTabella();
    } catch(e) {
        console.error('Errore:', e);
        document.getElementById('tabella').innerHTML = 
            '<tr><td colspan="3" class="vuoto">Errore caricamento</td></tr>';
    }
}

// Mostra tabella
function mostraTabella() {
    const filtrati = filtro === 'Tutti' ? dati : dati.filter(item => item.tipo === filtro);
    const tbody = document.getElementById('tabella');
    
    if (filtrati.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" class="vuoto">Nessun suggerimento ancora</td></tr>';
        return;
    }

    tbody.innerHTML = filtrati.reverse().map(item => `
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
setInterval(caricaDati, 20000);
