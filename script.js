let dati = [];
let filtro = 'Tutti';

// Carica dati da localStorage
function caricaDati() {
    const salvati = localStorage.getItem('suggerimenti');
    dati = salvati ? JSON.parse(salvati) : [];
    mostraTabella();
}

// Salva dati in localStorage
function salvaDati() {
    localStorage.setItem('suggerimenti', JSON.stringify(dati));
}

// Aggiungi suggerimento
document.getElementById('form').addEventListener('submit', function(e) {
    e.preventDefault();
    
    const tipo = document.getElementById('tipo').value;
    const titolo = document.getElementById('titolo').value;
    
    const nuovoSuggerimento = {
        id: Date.now(),
        tipo: tipo,
        titolo: titolo,
         new Date().toLocaleString('it-IT', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        })
    };
    
    dati.unshift(nuovoSuggerimento);
    salvaDati();
    mostraTabella();
    this.reset();
    alert('✅ Aggiunto!');
});

// Elimina suggerimento
function elimina(id) {
    if (confirm('Sicuro di eliminare?')) {
        dati = dati.filter(item => item.id !== id);
        salvaDati();
        mostraTabella();
    }
}

// Mostra tabella
function mostraTabella() {
    const filtrati = filtro === 'Tutti' ? dati : dati.filter(item => item.tipo === filtro);
    const tbody = document.getElementById('tabella');
    
    if (filtrati.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#666;">Nessun suggerimento</td></tr>';
        return;
    }

    tbody.innerHTML = filtrati.map(item => `
        <tr>
            <td><span class="badge badge-${item.tipo === 'Film' ? 'film' : 'serie'}">${item.tipo}</span></td>
            <td><strong>${item.titolo}</strong></td>
            <td>${item.data}</td>
            <td><button onclick="elimina(${item.id})" style="background:#e53e3e;color:white;border:none;padding:5px 10px;border-radius:4px;cursor:pointer;">🗑️</button></td>
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

// Avvia
caricaDati();
