const CSEStorage = (() => {
    const DB_NAME = RDS_CONFIG.databaseName;
    const ALL_STORES = ["sites", "inspections", "media", "meta"];
    let database;

    function requestResult(request) {
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    function transactionDone(transaction) {
        return new Promise((resolve, reject) => {
            transaction.oncomplete = () => resolve();
            transaction.onabort = () => reject(transaction.error || new DOMException("Transazione annullata", "AbortError"));
            transaction.onerror = () => {};
        });
    }

    async function open() {
        if (database) return database;
        database = await new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, 1);
            request.onupgradeneeded = () => {
                for (const name of ALL_STORES) request.result.createObjectStore(name, { keyPath: "id" });
                request.transaction.objectStore("inspections").createIndex("siteId", "siteId");
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
            request.onblocked = () => reject(new Error("Chiudi le altre schede di RDS_pro e ricarica per aggiornare l'archivio."));
        });
        database.onversionchange = () => { database.close(); database = null; };
        return database;
    }

    async function get(store, id) {
        const db = await open();
        return requestResult(db.transaction(store).objectStore(store).get(id));
    }

    async function loadAll() {
        const db = await open();
        const tx = db.transaction(["sites", "inspections", "meta"]);
        const sites = requestResult(tx.objectStore("sites").getAll());
        const inspections = requestResult(tx.objectStore("inspections").getAll());
        const meta = requestResult(tx.objectStore("meta").getAll());
        const values = await Promise.all([sites, inspections, meta]);
        values[0].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
        values[1].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
        return { sites: values[0], inspections: values[1], numberCounters: Object.fromEntries(values[2].filter(row => row.id.startsWith("reportNumber:")).map(row => [row.id.slice(13), row.value])) };
    }

    async function digest(value) {
        const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
        const hash = await crypto.subtle.digest("SHA-256", bytes);
        return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("");
    }

    function dataUrlToBlob(value) {
        const match = /^data:([^;,]+)(;base64)?,([\s\S]*)$/.exec(value);
        if (!match) throw new Error("Immagine storica non leggibile. L'archivio originale non viene cancellato.");
        const binary = match[2] ? atob(match[3].replace(/\s/g, "")) : decodeURIComponent(match[3]);
        const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
        return new Blob([bytes], { type: match[1] });
    }

    async function prepare(records) {
        const media = new Map();
        const dataUrls = new Map();
        async function visit(value) {
            if (typeof value === "string" && value.startsWith("data:image/")) {
                if (!dataUrls.has(value)) dataUrls.set(value, visit(dataUrlToBlob(value)));
                return dataUrls.get(value);
            }
            if (value instanceof Blob) {
                const id = `img_${await digest(await value.arrayBuffer())}`;
                media.set(id, { id, blob: value, size: value.size, type: value.type });
                return `media:${id}`;
            }
            if (Array.isArray(value)) return Promise.all(value.map(visit));
            if (value && typeof value === "object") {
                const result = {};
                for (const [key, item] of Object.entries(value)) result[key] = await visit(item);
                return result;
            }
            return value;
        }
        return { records: await visit(records), media: [...media.values()] };
    }

    function collectReferences(value, result = new Set()) {
        if (typeof value === "string" && value.startsWith("media:")) result.add(value.slice(6));
        else if (value && typeof value === "object") Object.values(value).forEach(item => collectReferences(item, result));
        return result;
    }

    // All image writes and their parent records commit together, including migration markers.
    async function commitPrepared(prepared, marker = null, deleteSiteIds = [], deleteInspectionIds = []) {
        const db = await open();
        const tx = db.transaction(ALL_STORES, "readwrite");
        const done = transactionDone(tx);
        try {
            for (const image of prepared.media) tx.objectStore("media").put(image);
            for (const site of prepared.records.sites || []) tx.objectStore("sites").put(site);
            for (const report of prepared.records.inspections || []) tx.objectStore("inspections").put(report);
            function retainNumber(siteId, number) {
                const id = `reportNumber:${siteId}`;
                const read = tx.objectStore("meta").get(id);
                read.onsuccess = () => tx.objectStore("meta").put({ id, value: Math.max(read.result?.value || 0, Number(number) || 0) });
            }
            const maxima = new Map();
            for (const report of prepared.records.inspections || []) maxima.set(report.siteId, Math.max(maxima.get(report.siteId) || 0, Number(report.reportNumber) || 0));
            for (const [siteId, number] of maxima) retainNumber(siteId, number);
            for (const id of deleteInspectionIds) {
                const read = tx.objectStore("inspections").get(id);
                read.onsuccess = () => { if (read.result) retainNumber(read.result.siteId, read.result.reportNumber); };
                tx.objectStore("inspections").delete(id);
            }
            for (const id of deleteSiteIds) tx.objectStore("sites").delete(id);
            if (marker) tx.objectStore("meta").put(marker);

            // The same transaction prevents deletion of images referenced by another report/snapshot.
            const references = new Set();
            let remaining = 2;
            for (const name of ["sites", "inspections"]) {
                const read = tx.objectStore(name).getAll();
                read.onsuccess = () => {
                    collectReferences(read.result, references);
                    if (--remaining) return;
                    const cursor = tx.objectStore("media").openCursor();
                    cursor.onsuccess = () => {
                        const row = cursor.result;
                        if (!row) return;
                        if (!references.has(row.key)) row.delete();
                        row.continue();
                    };
                };
            }
        } catch (error) {
            tx.abort();
            await done.catch(() => {});
            throw error;
        }
        await done;
        return prepared.records;
    }

    async function saveBatch(records) {
        return commitPrepared(await prepare(records));
    }

    async function saveSite(site) { return (await saveBatch({ sites: [site] })).sites[0]; }
    async function saveInspection(report) { return (await saveBatch({ inspections: [report] })).inspections[0]; }
    async function deleteSite(id) { await commitPrepared({ records: {}, media: [] }, null, [id]); }
    async function deleteInspection(id) { await commitPrepared({ records: {}, media: [] }, null, [], [id]); }

    async function addChoice(key, value) {
        const db = await open();
        const tx = db.transaction("meta", "readwrite");
        const done = transactionDone(tx);
        const id = `choices:${key}`;
        const read = tx.objectStore("meta").get(id);
        read.onsuccess = () => tx.objectStore("meta").put({ id, values: [...new Set([value, ...(read.result?.values || [])])] });
        await done;
    }

    return { open, loadAll, get, saveBatch, saveSite, saveInspection, deleteSite, deleteInspection, addChoice, collectReferences };
})();

