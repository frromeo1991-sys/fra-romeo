const VisionAPI = (() => {
    const KEY = "rdsProVisionConnectionV1";
    const LEGACY_ENDPOINT_KEY = "rdsProVisionEndpointV1";
    let endpoint = RDS_CONFIG.visionEndpoint;
    let accessCode = "";
    let saved = false;
    let revision = 0;
    let healthController;

    function normalizeEndpoint(value) {
        let url;
        try { url = new URL(value); } catch { throw new Error("Indica l'indirizzo HTTPS principale del Worker RDS_pro."); }
        if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("Indica l'indirizzo HTTPS principale del Worker RDS_pro.");
        if (url.origin === new URL(RDS_CONFIG.textAIEndpoint).origin) throw new Error("Il Worker fotografico deve essere separato da quello stabile.");
        return url.origin;
    }

    function validateAccessCode(value) {
        if (value.startsWith("sk-")) throw new Error("Usa il codice di accesso RDS_pro, non la chiave OpenAI.");
        if (!value || value.length > 1000 || !/^[\x21-\x7e]+$/.test(value)) throw new Error("Inserisci un codice di accesso RDS_pro valido.");
        return value;
    }

    function serviceError(status) {
        const messages = {
            401: "Codice di accesso RDS_pro non valido. Modifica la configurazione AI.",
            403: "Accesso AI non autorizzato. Verifica codice e origine consentita del Worker.",
            409: "Richiesta gia inviata. Avvia una nuova analisi se necessario.",
            429: "Limite o credito del servizio AI raggiunto. Attendi e riprova.",
            502: "Analisi AI incompleta o servizio temporaneamente non disponibile. I testi precedenti sono conservati."
        };
        return Object.assign(new Error(messages[status] || "Servizio AI temporaneamente non disponibile. Riprova."), { status });
    }

    async function request(path, payload, signal, temporary = null) {
        const connection = temporary || { endpoint, accessCode };
        if (!connection.endpoint || !connection.accessCode) throw new Error("Configura la connessione AI fotografica prima di analizzare.");
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 65000);
        const cancel = () => controller.abort();
        signal?.addEventListener("abort", cancel, { once: true });
        try {
            if (signal?.aborted) throw new DOMException("Annullato", "AbortError");
            const response = await fetch(`${connection.endpoint}${path}`, {
                method: payload ? "POST" : "GET", headers: { "Authorization": `Bearer ${connection.accessCode}`, ...(payload ? { "Content-Type": "application/json" } : {}) },
                body: payload ? JSON.stringify(payload) : undefined, signal: controller.signal, credentials: "omit", cache: "no-store"
            });
            // Never display a response body that could echo an access credential.
            if (!response.ok) throw serviceError(response.status);
            let data;
            try { data = await response.json(); } catch { throw new Error("Risposta del Worker non valida. Verifica la configurazione."); }
            return data;
        } catch (error) {
            if (error.name === "AbortError") throw Object.assign(new Error(signal?.aborted ? "Analisi annullata. Foto e testi sono conservati." : "Tempo di risposta esaurito. I dati sono conservati; riprova."), { temporary: true });
            if (error instanceof TypeError) throw Object.assign(new Error("Connessione AI non riuscita. Verifica rete, Worker e origini consentite."), { temporary: true });
            throw error;
        } finally { clearTimeout(timeout); signal?.removeEventListener("abort", cancel); }
    }

    function bindConnection() {
        document.getElementById("inspection-date").addEventListener("change", () => els.findingsList.querySelectorAll("[data-finding]").forEach(invalidateVision));
        const panel = document.querySelector(".ai-connection");
        const form = document.getElementById("vision-connection-form");
        const urlInput = document.getElementById("vision-endpoint");
        const codeInput = document.getElementById("vision-access-code");
        const status = document.getElementById("vision-connection-state");
        const message = document.getElementById("vision-connection-message");
        const edit = document.getElementById("vision-connection-edit");
        const forget = document.getElementById("vision-disconnect");
        const retry = document.getElementById("vision-connection-retry");
        const submit = form.querySelector("button[type=submit]");

        function showMessage(text) {
            message.textContent = text;
            message.hidden = !text;
        }

        function showState(text, kind) {
            status.textContent = text;
            panel.dataset.connection = kind;
            retry.hidden = kind !== "offline" || !endpoint || !accessCode;
        }

        function syncFields() {
            urlInput.value = endpoint;
            codeInput.value = "";
            codeInput.required = !accessCode;
            codeInput.placeholder = accessCode ? "Codice gia configurato" : "Codice di accesso RDS_pro";
            forget.hidden = !saved && !accessCode;
            edit.textContent = saved || accessCode ? "Modifica" : "Configura";
        }

        panel.addEventListener("toggle", () => {
            edit.setAttribute("aria-expanded", String(panel.open));
            if (!panel.open) codeInput.value = "";
        });
        edit.onclick = event => {
            event.preventDefault();
            panel.open = !panel.open;
            if (panel.open) { syncFields(); urlInput.focus(); }
        };
        document.getElementById("vision-connection-close").onclick = () => { panel.open = false; };

        async function verify(candidate, automatic = false) {
            const current = ++revision;
            healthController?.abort();
            healthController = new AbortController();
            submit.disabled = true;
            retry.disabled = true;
            showState("Verifica AI in corso...", "checking");
            showMessage(automatic ? "" : "Verifica connessione...");
            try {
                const result = await request("/health", null, healthController.signal, candidate);
                if (current !== revision) return;
                if (result.app !== "RDS_pro" || result.ready !== true) throw new Error("Worker RDS_pro non pronto.");
                endpoint = candidate.endpoint; accessCode = candidate.accessCode;
                let persistent = true;
                if (!automatic) {
                    try {
                        // One atomic record keeps the endpoint paired with its verified code.
                        localStorage.setItem(KEY, JSON.stringify({ endpoint, accessCode }));
                        saved = true;
                    } catch { persistent = false; }
                }
                syncFields();
                showState(persistent ? "AI connessa" : "AI connessa (solo sessione)", "connected");
                showMessage(persistent ? "" : "Connessione verificata, ma il browser non consente il salvataggio sul dispositivo. Alla riapertura potrebbe essere necessario riconfigurarla.");
                panel.open = !persistent;
            } catch (error) {
                if (current !== revision) return;
                const temporary = error.temporary || error.status === 429 || error.status >= 500;
                showState(temporary ? "AI temporaneamente non raggiungibile" : "Connessione AI da riconfigurare", temporary ? "offline" : "invalid");
                showMessage(automatic ? "" : error.message);
                if (!automatic) panel.open = true;
            } finally {
                if (current === revision) { submit.disabled = false; retry.disabled = false; }
            }
        };

        form.onsubmit = event => {
            event.preventDefault();
            const enteredCode = codeInput.value.trim();
            codeInput.value = "";
            try {
                const candidate = { endpoint: normalizeEndpoint(urlInput.value.trim()), accessCode: validateAccessCode(enteredCode || accessCode) };
                void verify(candidate);
            } catch (error) {
                showState("Connessione AI da riconfigurare", "invalid");
                showMessage(error.message);
                panel.open = true;
            }
        };
        retry.onclick = () => { if (endpoint && accessCode) void verify({ endpoint, accessCode }, true); };
        forget.onclick = () => {
            if (!window.confirm("Dimenticare la configurazione AI su questo dispositivo? Cantieri, report e fotografie resteranno invariati.")) return;
            try { localStorage.removeItem(KEY); localStorage.removeItem(LEGACY_ENDPOINT_KEY); }
            catch { showMessage("Il browser non consente di eliminare la configurazione AI. Riprova."); return; }
            revision++;
            healthController?.abort();
            endpoint = ""; accessCode = ""; saved = false;
            submit.disabled = false; retry.disabled = false;
            syncFields();
            showState("AI non configurata", "empty");
            showMessage("");
            panel.open = true;
        };

        try {
            const stored = localStorage.getItem(KEY);
            if (stored) {
                saved = true;
                const config = JSON.parse(stored);
                endpoint = normalizeEndpoint(config.endpoint);
                accessCode = validateAccessCode(config.accessCode);
            } else {
                endpoint = normalizeEndpoint(localStorage.getItem(LEGACY_ENDPOINT_KEY) || endpoint);
            }
        } catch { /* Keep invalid or inaccessible saved data until an explicit user action. */ }
        syncFields();
        panel.open = !saved;
        if (saved && endpoint && accessCode) void verify({ endpoint, accessCode }, true);
        else showState(saved ? "Connessione AI da riconfigurare" : "AI non configurata", saved ? "invalid" : "empty");
    }
    return { bindConnection, analyze: (payload, signal) => request("/analyze", payload, signal) };
})();
