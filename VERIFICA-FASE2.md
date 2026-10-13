# RDS_pro - fase 2 fotografica

13 ottobre 2026. Modifiche esclusive a RDS_pro; app stabile e Worker stabile non modificati.

## Implementazione

Nuovi moduli `vision-api.js`, `vision-ui.js`, `backend/worker.mjs` e `backend/wrangler.toml`. Integrazione mirata in `index.html`, `script.js`, `finding-ui.js`, `media.js`, `config.js` e `style2.css`. Database e renderer PDF restano quelli validati della copia indipendente.

Ogni rilievo conserva fotografie, domanda, selezione immagini, revisione, analisi e proposta separate dai tre testi finali. Conferma esplicita e tecnico indicato sono necessari per inserire la proposta. Si conservano data/autore, versione prompt, ID richiesta, token, stima costo, hash foto e ultime dieci approvazioni precedenti. I testi finali restano liberamente modificabili dal CSE.

Non sono presenti risposte dimostrative nell'app o bypass del backend. Senza collegamento reale il pulsante mostra un errore di connessione/configurazione, senza fingere un'analisi.

## Test eseguiti

- Worker eseguito in Node con servizio OpenAI e binding Cloudflare simulati, senza chiavi reali.
- Richiesta unica con due immagini, domanda, contesto e JSON Schema rigoroso; proposta preparata nella stessa chiamata.
- Autenticazione mancante/errata, origine non autorizzata, configurazione incompleta, limite al minuto, richiesta duplicata e quota giornaliera concorrente verificati.
- Nessuna fotografia, oltre sei foto, URL remoti, MIME/firma errati e richiesta oltre limite rifiutati prima di OpenAI.
- Risposta incompleta/troncata, rifiuto del modello, riferimenti a fotografie inesistenti, provider indisponibile, credito/limite e chiave provider non valida gestiti senza esporre segreti.
- Chrome con profili isolati: consenso obbligatorio; dati non sovrascritti dalla semplice analisi; revisione modificabile e conferma obbligatoria; nuova modifica alla proposta richiede nuova conferma.
- Generazione da appunti non sovrascrive una revisione fotografica.
- Aggiunta foto invalida la revisione, mantiene testi; errori e annullamento non perdono foto/testi o vecchia approvazione.
- Due rilievi indipendenti, con tre foto nel primo e una nel secondo; nessun mescolamento di immagini. Sospensione NO/SI resta quella scelta dal tecnico.
- Byte delle immagini analizzate identici ai Blob persistiti, verificati tramite hash SHA-256. Nessun Base64 fotografico nel record salvato.
- Chiusura effettiva e riapertura: fotografie, proposta modificata, approvazione e analisi persistenti. Codice di accesso non presente in localStorage e non ripristinato dopo riavvio.
- Stato da aggiornare salvato in bozza e mantenuto dopo riapertura; impossibile completare automaticamente una proposta non confermata.
- Viewport 320, 390, 768 e 1440 pixel senza overflow orizzontale o pulsanti troncati; screenshot mobile controllato.
- PDF di prova: quattro pagine, quattro foto dei rispettivi rilievi, solo testi approvati, tecnico distinto in copertina e CSE dello snapshot una sola volta nell'ultima pagina. Rendering controllato visivamente.
- Protezione input credenziali: stringhe con prefisso tipico delle chiavi OpenAI rifiutate nel campo del codice RDS_pro, cancellate e non inviate.
- Sintassi JavaScript controllata. 30 file stabili verificati con SHA-256: invariati.

## Limiti del collaudo

Nessuna richiesta OpenAI reale, nessun costo API per questi test. Nessun deploy Cloudflare e nessuna pubblicazione GitHub. I test non certificano qualita' delle valutazioni del modello, funzionamento edge dei binding o correttezza tecnica di una fotografia reale.

Prima dell'uso in cantiere occorrono configurazione del nuovo Worker, prova controllata con la chiave dell'utente, valutazione di casi reali da parte del CSE, verifica privacy dell'organizzazione e prova sul telefono. Istruzioni in `backend/DEPLOY.md`.
