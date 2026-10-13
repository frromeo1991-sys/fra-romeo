# RDS_pro

Progetto parallelo a CSE PRO / app-cse-test. Fase 2: flusso di analisi multi-foto, proposta revisionabile e conferma CSE implementati; Worker separato pronto come sorgente, non ancora pubblicato o collegato a OpenAI reale.

## Avvio

Aprire `index.html`. Non sono necessari build, installazioni o server locali per questa fase. Tutte le librerie e le immagini del PDF sono incluse.

## Versione stabile protetta

I sorgenti di `cse-pro-evolved` e `test-cse` non vengono modificati. RDS_pro ha una propria cartella e un repository Git locale indipendente. Il repository GitHub remoto non e' ancora creato ne' collegato e l'app non e' stata pubblicata.

Non sostituire i file della versione stabile con quelli di RDS_pro. Per la pubblicazione usare un nuovo repository e preferibilmente un'origine web distinta.

## Archivio indipendente

- IndexedDB: `RDSProArchive`, store `sites`, `inspections`, `media`, `meta`.
- Preferenza localStorage: `rdsProActiveSiteV1`.
- Nessun accesso a `CSEProArchive` o alle chiavi localStorage della versione stabile.
- Nessuna migrazione automatica dell'archivio CSE PRO.
- Foto come Blob compressi e riferimenti SHA-256; salvataggi e cancellazioni atomici.
- L'archivio iniziale vuoto e' intenzionale. Cantieri e report originali restano nell'app stabile.

Un futuro trasferimento tra app richiedera' un'esportazione/importazione esplicita con controllo delle immagini. Non e' implementato in questa fase.

## Funzioni riutilizzate

Cantieri, snapshot, tecnico/CSE distinti, rilievi indipendenti, selettori touch, foto per rilievo, bozze, modifica e archivio filtrato per cantiere, eliminazione confermata, generatore PDF.

Il renderer PDF e' invariato: ogni rilievo comincia su una nuova pagina; fotografie proporzionate e associate al rilievo; firma CSE dello snapshot soltanto nell'ultima pagina, in basso a destra. Nessun nominativo personale predefinito.

## OpenAI e scelta delle credenziali

E' stata scelta la stessa chiave OpenAI usata dall'app stabile. La chiave non e' presente in questi file e non e' stata letta, copiata o modificata.

In questa fase la generazione **testuale** continua a usare il Worker gia' esistente, solo quando l'utente preme Genera con AI. L'URL pubblico e' centralizzato in `config.js`. Nessuna chiamata parte automaticamente all'avvio.

Il percorso fotografico e' implementato in `vision-api.js` e `vision-ui.js`. Per usarlo davvero occorre pubblicare e configurare il nuovo Worker in `backend/`, poi inserire il suo URL e il codice di accesso RDS_pro in "Connessione AI fotografica". Il codice di accesso non e' la chiave OpenAI ed e' tenuto solo in memoria; l'URL e' una preferenza leggera in localStorage. Dopo il ricaricamento serve riconnettersi.

Il Worker RDS_pro usera' la stessa chiave OpenAI come secret server-side, configurata direttamente nell'ambiente Cloudflare. Per configurarla serve disporre dell'originale in un luogo sicuro, oppure verificare un eventuale binding condiviso tramite Secrets Store: un normale secret Worker gia' salvato non e' rileggibile dal pannello. Non servono chiavi nel frontend, in GitHub o nella chat. La chiave condivisa comporta anche consumi/limiti OpenAI condivisi; una ricarica riguarda il saldo dell'account/progetto di fatturazione, non la stringa della chiave.

Non modificare il Worker stabile. Il nuovo backend include autenticazione con codice casuale lungo, origini consentite, rate limiting, contatore giornaliero atomico e rifiuto di richieste duplicate. Invio limitato a sei immagini compresse, domanda/appunto e contesto minimo. Non aggiunge automaticamente nominativi del CSE, tecnico, Responsabile dei Lavori o indirizzi del cantiere; evitare di inserire dati personali non necessari nei campi liberi. Non archivia fotografie sul Worker e non le scrive nei log applicativi.

## Flusso fotografico

1. Caricare foto nel singolo rilievo, aprire Analizza foto con AI e selezionare fino a sei immagini.
2. Aggiungere facoltativamente una domanda o un appunto; confermare l'invio al servizio AI.
3. Leggere elementi visibili con ID foto, informazioni del CSE, criticita' possibili, aspetti non verificabili e chiarimenti.
4. Aprire Crea proposta report, modificare le tre sezioni, confermare la revisione e usare Conferma nel rilievo. L'analisi non sovrascrive da sola i testi. Nessuna sospensione automatica delle attivita'.
5. Salvare il sopralluogo: foto, analisi, proposta, approvazione e metadata persistono insieme. Una bozza puo' conservare una revisione incompleta.
6. Modifiche a foto, selezione, domanda, appunto, metadata, data o snapshot invalidano la revisione precedente senza cancellare i testi. Serve una nuova analisi/conferma prima del completamento. La generazione dai soli appunti non sovrascrive i rilievi gia' analizzati fotograficamente.

Il Worker iniziale usa `gpt-4o-mini` con immagini e JSON Schema rigoroso. Analisi e proposta sono preparate nella stessa richiesta; Crea proposta non effettua una seconda chiamata. Sono registrati modello, versione prompt, richiesta, token, durata, hash delle foto e stima indicativa del costo. La stima usa i prezzi listino verificati il 13 ottobre 2026 e puo' differire dall'addebito effettivo. Non e' un tetto di spesa monetario: il limite giornaliero e' sul numero di richieste. Non viene garantita l'assenza di conservazione presso i fornitori: vedere `backend/DEPLOY.md`.

La validazione tecnica del modello su fotografie reali e il collaudo sul telefono restano necessari prima dell'uso professionale. Non vengono certificati idoneita' o conformita' dalla sola foto.

## Collegamento reale

Istruzioni in `backend/DEPLOY.md`. Occorrono un nuovo Worker Cloudflare, la chiave OpenAI esistente come secret, un codice di accesso RDS_pro distinto e le origini corrette. Nessun account, secret o deployment e' stato modificato automaticamente.

## Verifiche della fase 1

Le prove vengono eseguite con profili Chrome dedicati, mai sul browser dell'utente. Il collaudo controlla separazione dei database anche sulla stessa origine locale, conservazione delle chiavi precedenti, foto/bozze dopo riavvio, filtri e PDF, identita' dei file stabili e assenza di nuove chiamate API automatiche. Il servizio AI viene simulato nei test.

Risultati: vedere `VERIFICA-FASE1.md`. Riferimento per i secret: https://developers.cloudflare.com/workers/configuration/secrets/.

Non cancellare i dati del browser. IndexedDB non e' un backup cloud e non sincronizza telefono e PC.
