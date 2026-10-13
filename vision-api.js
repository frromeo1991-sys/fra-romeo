const VisionAPI = (() => {
    const KEY = "rdsProVisionEndpointV1";
    let endpoint = RDS_CONFIG.visionEndpoint;
    let accessCode = "";

    function normalizeEndpoint(value) {
        const url = new URL(value);
        if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("Indica l'indirizzo HTTPS principale del Worker RDS_pro.");
        if (url.origin === new URL(RDS_CONFIG.textAIEndpoint).origin) throw new Error("Il Worker fotografico deve essere separato da quello stabile.");
        return url.origin;
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
            let data;
            try { data = await response.json(); } catch { throw new Error("Risposta del Worker non valida. Verifica la configurazione."); }
            if (!response.ok) throw new Error(data.error || `Servizio non disponibile (${response.status}).`);
            return data;
        } catch (error) {
            if (error.name === "AbortError") throw new Error(signal?.aborted ? "Analisi annullata. Foto e testi sono conservati." : "Tempo di risposta esaurito. I dati sono conservati; riprova.");
            if (error instanceof TypeError) throw new Error("Connessione AI non riuscita. Verifica rete, Worker e origini consentite.");
            throw error;
        } finally { clearTimeout(timeout); signal?.removeEventListener("abort", cancel); }
    }

    function bindConnection() {
        document.getElementById("inspection-date").addEventListener("change", () => els.findingsList.querySelectorAll("[data-finding]").forEach(invalidateVision));
        try { endpoint = localStorage.getItem(KEY) || endpoint; } catch { /* Public preference is optional. */ }
        document.getElementById("vision-endpoint").value = endpoint;
        document.getElementById("vision-disconnect").onclick = () => {
            accessCode = "";
            document.getElementById("vision-access-code").value = "";
            document.getElementById("vision-connection-state").textContent = "Disconnessa";
        };
        document.getElementById("vision-connection-form").onsubmit = async event => {
            event.preventDefault();
            const message = document.getElementById("vision-connection-message");
            message.hidden = false;
            const button = event.submitter;
            button.disabled = true;
            message.textContent = "Verifica connessione...";
            try {
                const candidate = { endpoint: normalizeEndpoint(document.getElementById("vision-endpoint").value.trim()), accessCode: document.getElementById("vision-access-code").value.trim() };
                if (candidate.accessCode.startsWith("sk-")) throw new Error("Usa il codice di accesso RDS_pro, non la chiave OpenAI.");
                const result = await request("/health", null, null, candidate);
                if (result.app !== "RDS_pro" || result.ready !== true) throw new Error("Worker RDS_pro non pronto.");
                endpoint = candidate.endpoint; accessCode = candidate.accessCode;
                try { localStorage.setItem(KEY, endpoint); } catch { /* Connection remains usable for this session. */ }
                document.getElementById("vision-access-code").value = "";
                document.getElementById("vision-connection-state").textContent = "Connessa";
                message.textContent = "Connessione verificata.";
            } catch (error) {
                accessCode = "";
                document.getElementById("vision-access-code").value = "";
                document.getElementById("vision-connection-state").textContent = "Non connessa";
                message.textContent = error.message;
            }
            finally { button.disabled = false; }
        };
    }
    return { bindConnection, analyze: (payload, signal) => request("/analyze", payload, signal) };
})();
