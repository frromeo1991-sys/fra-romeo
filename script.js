const STORAGE = {
    activeSite: RDS_CONFIG.activeSiteKey
};

const ATTIVITA_BASE = [
    "Carpenteria metallica, in acciaio e opere complementari",
    "Opere murarie e opere complementari",
    "Impianti meccanici e opere complementari",
    "Impianti elettrici e opere complementari",
    "Impianti idraulici e opere complementari"
];

const state = {
    sites: [],
    inspections: [],
    activeSiteId: "",
    findingCounter: 0,
    busy: false,
    retainedPhotos: [],
    numberCounters: {},
    editingInspectionId: "",
    inspectionSnapshot: null,
    inspectionDirty: false,
    viewedInspectionId: "",
    storageReady: false
};

const els = {
    activeSiteName: document.getElementById("active-site-name"),
    activeSiteMeta: document.getElementById("active-site-meta"),
    siteSwitcher: document.getElementById("site-switcher"),
    btnManageSites: document.getElementById("btn-manage-sites"),
    btnNewInspection: document.getElementById("btn-new-inspection"),
    sitesPanel: document.getElementById("sites-panel"),
    btnNewSite: document.getElementById("btn-new-site"),
    siteForm: document.getElementById("site-form"),
    siteId: document.getElementById("site-id"),
    sitesList: document.getElementById("sites-list"),
    btnCancelSite: document.getElementById("btn-cancel-site"),
    inspectionPanel: document.getElementById("inspection-panel"),
    inspectionForm: document.getElementById("inspection-form"),
    btnCloseInspection: document.getElementById("btn-close-inspection"),
    btnResetInspection: document.getElementById("btn-reset-inspection"),
    btnGenerateInspection: document.getElementById("btn-generate-inspection"),
    btnSaveInspection: document.getElementById("btn-save-inspection"),
    btnSaveDraft: document.getElementById("btn-save-draft"),
    btnRefreshSite: document.getElementById("btn-refresh-site-data"),
    inspectionStatus: document.getElementById("inspection-status"),
    btnAddFinding: document.getElementById("btn-add-finding"),
    findingsList: document.getElementById("findings-list"),
    findingTemplate: document.getElementById("finding-template"),
    archiveSiteFilter: document.getElementById("archive-site-filter"),
    archiveStatusFilter: document.getElementById("archive-status-filter"),
    archiveList: document.getElementById("archive-list")
};

window.cseReady = bootstrap();

async function bootstrap() {
    bindEvents();
    document.querySelectorAll("button, input, textarea, select").forEach(element => element.disabled = true);
    const status = document.getElementById("storage-status");
    try {
        await CSEStorage.open();
        const stored = await CSEStorage.loadAll();
        state.sites = stored.sites;
        state.inspections = stored.inspections;
        state.numberCounters = stored.numberCounters;
        try { state.activeSiteId = localStorage.getItem(STORAGE.activeSite) || ""; } catch { /* A preference must not block the archive. */ }
        await upgradeSiteDefaults();
        ensureDefaultSite();
        state.storageReady = true;
        document.querySelectorAll("button, input, textarea, select").forEach(element => element.disabled = false);
        status.hidden = true;
        setToday();
        renderAll();
    } catch (error) {
        console.error(error);
        status.hidden = false;
        status.dataset.kind = "error";
        status.textContent = `Impossibile aprire l'archivio: ${error.message}. Riprova senza cancellare i dati del browser.`;
        const retry = document.getElementById("btn-retry-storage");
        retry.hidden = false;
        retry.disabled = false;
    }
}

function bindEvents() {
    VisionAPI.bindConnection();
    document.getElementById("btn-retry-storage").addEventListener("click", () => location.reload());
    els.btnManageSites.addEventListener("click", () => {
        els.sitesPanel.hidden = !els.sitesPanel.hidden;
    });

    els.btnNewSite.addEventListener("click", () => openSiteForm());
    els.btnCancelSite.addEventListener("click", closeSiteForm);
    els.siteForm.addEventListener("submit", saveSite);

    els.siteSwitcher.addEventListener("change", () => setActiveSite(els.siteSwitcher.value));
    els.btnNewInspection.addEventListener("click", () => openInspection());
    els.btnCloseInspection.addEventListener("click", () => {
        els.inspectionPanel.hidden = true;
        els.siteSwitcher.disabled = false;
    });
    els.btnResetInspection.addEventListener("click", resetInspectionForm);
    els.btnAddFinding.addEventListener("click", () => {
        addFindingCard();
        state.inspectionDirty = true;
    });
    els.inspectionForm.addEventListener("submit", saveInspection);
    els.btnSaveDraft.addEventListener("click", event => saveInspection(event, "BOZZA"));
    els.btnRefreshSite.addEventListener("click", refreshInspectionSite);
    els.btnGenerateInspection.addEventListener("click", generateInspection);
    ["input", "change"].forEach(eventName => {
        els.inspectionForm.addEventListener(eventName, () => state.inspectionDirty = true);
    });
    document.getElementById("btn-close-report-view").addEventListener("click", () => document.getElementById("report-view-panel").hidden = true);
    document.getElementById("btn-edit-viewed-report").addEventListener("click", () => handleReportAction("edit", state.viewedInspectionId));
    document.getElementById("btn-pdf-viewed-report").addEventListener("click", () => handleReportAction("pdf", state.viewedInspectionId));
    window.addEventListener("resize", () => {
        els.findingsList.querySelectorAll("textarea").forEach(resizeTextarea);
    });

    els.archiveSiteFilter.addEventListener("change", renderArchive);
    els.archiveStatusFilter.addEventListener("change", renderArchive);
}

function saveActivePreference() {
    try { localStorage.setItem(STORAGE.activeSite, state.activeSiteId || ""); }
    catch { /* IndexedDB remains usable even if UI preferences cannot be written. */ }
}

function uid(prefix) {
    const random = Math.random().toString(36).slice(2, 8);
    return `${prefix}_${Date.now()}_${random}`;
}

function setToday() {
    const dateInput = document.getElementById("inspection-date");
    if (dateInput && !dateInput.value) {
        dateInput.value = new Date().toISOString().slice(0, 10);
    }
}

function ensureDefaultSite() {
    if (state.sites.length) {
        if (!state.sites.some(site => site.id === state.activeSiteId)) {
            state.activeSiteId = state.sites[0].id;
        }
    } else {
        state.activeSiteId = "";
    }
    saveActivePreference();
}

async function upgradeSiteDefaults() {
    const previous = JSON.stringify(state.sites);
    state.sites = state.sites.map(site => {
        const latest = [...state.inspections]
            .filter(report => report.siteId === site.id && report.general?.respLavori)
            .sort((a, b) => String(b.updatedAt || b.createdAt || b.date).localeCompare(String(a.updatedAt || a.createdAt || a.date)))[0];
        return {
            ...site,
            cseName: site.cseName ?? (typeof site.cse === "string" ? site.cse : ""),
            responsibleForWorks: site.responsibleForWorks ?? site.responsabileLavori ?? latest?.general.respLavori ?? ""
        };
    });
    if (JSON.stringify(state.sites) !== previous) {
        state.sites = (await CSEStorage.saveBatch({ sites: state.sites })).sites;
    }
}

function renderAll() {
    renderActiveSite();
    renderSiteSwitcher();
    renderSites();
    renderArchiveFilters();
    renderArchive();
    renderRecentTechnicians();
}

function activeSite() {
    return state.sites.find(site => site.id === state.activeSiteId) || null;
}

function renderActiveSite() {
    const site = activeSite();
    if (!site) {
        els.activeSiteName.textContent = "Nessun cantiere selezionato";
        els.activeSiteMeta.textContent = "Crea o seleziona un cantiere prima di generare un sopralluogo.";
        return;
    }

    els.activeSiteName.textContent = site.name;
    els.activeSiteMeta.textContent = [
        site.code ? `Codice ${site.code}` : "",
        site.client || "",
        site.address || ""
    ].filter(Boolean).join(" · ") || "Dati cantiere incompleti";
}

function renderSiteSwitcher() {
    els.siteSwitcher.innerHTML = state.sites.map(site => (
        `<option value="${site.id}" ${site.id === state.activeSiteId ? "selected" : ""}>${escapeHtml(site.name)}</option>`
    )).join("");
}

function renderArchiveFilters() {
    const current = els.archiveSiteFilter.value || "ACTIVE";
    els.archiveSiteFilter.innerHTML = [
        `<option value="ACTIVE">Cantiere attivo</option>`,
        `<option value="ALL">Tutti i cantieri</option>`,
        ...state.sites.map(site => `<option value="${site.id}">${escapeHtml(site.name)}</option>`)
    ].join("");

    if ([...els.archiveSiteFilter.options].some(option => option.value === current)) {
        els.archiveSiteFilter.value = current;
    }
}

function renderSites() {
    if (!state.sites.length) {
        els.sitesList.innerHTML = `<div class="empty-state">Nessun cantiere salvato.</div>`;
        return;
    }

    els.sitesList.innerHTML = state.sites.map(site => {
        const active = site.id === state.activeSiteId ? " · ATTIVO" : "";
        return `
            <article class="site-card">
                ${site.coverImage ? `<img class="site-thumb" data-media-source="${escapeHtml(site.coverImage)}" alt="Foto cantiere">` : `<div class="site-thumb placeholder">Foto cantiere</div>`}
                <div>
                    <h3>${escapeHtml(site.name)}${active}</h3>
                    <p>${escapeHtml([site.code, site.client, site.address].filter(Boolean).join(" · ") || "Dati cantiere incompleti")}</p>
                    <p>CSE: ${escapeHtml(site.cseName || "Non indicato")} · Responsabile dei Lavori: ${escapeHtml(site.responsibleForWorks || "Non indicato")}</p>
                </div>
                <div class="card-actions">
                    <button class="btn-secondary" type="button" data-site-action="active" data-id="${site.id}">Seleziona</button>
                    <button class="btn-secondary" type="button" data-site-action="edit" data-id="${site.id}">Modifica</button>
                    <button class="btn-danger" type="button" data-site-action="delete" data-id="${site.id}">Elimina</button>
                </div>
            </article>
        `;
    }).join("");
    CSEMedia.bindImages(els.sitesList);

    els.sitesList.querySelectorAll("[data-site-action]").forEach(button => {
        button.addEventListener("click", () => handleSiteAction(button.dataset.siteAction, button.dataset.id));
    });
}

function handleSiteAction(action, id) {
    if (action === "active") setActiveSite(id);
    if (action === "edit") openSiteForm(state.sites.find(site => site.id === id));
    if (action === "delete") deleteSite(id);
}

function setActiveSite(id) {
    if (state.busy) return;
    if (state.editingInspectionId && !els.inspectionPanel.hidden) {
        renderSiteSwitcher();
        return;
    }
    if (!state.sites.some(site => site.id === id)) return;
    const previousContractor = activeSite()?.contractor || "";
    state.activeSiteId = id;
    if (!els.inspectionPanel.hidden && value("inspection-affidataria") === previousContractor) {
        setValue("inspection-affidataria", activeSite()?.contractor || "");
    }
    saveActivePreference();
    renderAll();
    if (!els.inspectionPanel.hidden) renderInspectionSite();
}

function openSiteForm(site) {
    if (state.busy) return;
    els.siteForm.hidden = false;
    els.siteId.value = site?.id || "";
    setValue("site-name", site?.name || "");
    setValue("site-code", site?.code || "");
    setValue("site-client", site?.client || "");
    setValue("site-address", site?.address || "");
    setValue("site-contractor", site?.contractor || "");
    setValue("site-cse", site?.cseName || "");
    setValue("site-responsible", site?.responsibleForWorks || "");
    setValue("site-job-code", site?.jobCode || "");
    setValue("site-notes", site?.notes || "");
    document.getElementById("site-cover").value = "";
    document.getElementById("site-client-logo").value = "";
    els.siteForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeSiteForm() {
    els.siteForm.reset();
    els.siteId.value = "";
    els.siteForm.hidden = true;
}

async function saveSite(event) {
    event.preventDefault();
    if (state.busy) return;
    setInspectionBusy(true);
    try {
    const existing = state.sites.find(site => site.id === els.siteId.value);
    const coverImage = await readSingleImage("site-cover", 1200, 0.78);
    const clientLogo = await readSingleImage("site-client-logo", 900, 0.82);

    const site = {
        ...existing,
        id: existing?.id || uid("site"),
        name: value("site-name") || "Cantiere senza nome",
        code: value("site-code"),
        client: value("site-client"),
        address: value("site-address"),
        contractor: value("site-contractor"),
        cseName: value("site-cse"),
        responsibleForWorks: value("site-responsible"),
        jobCode: value("site-job-code"),
        notes: value("site-notes"),
        coverImage: coverImage || existing?.coverImage || "",
        clientLogo: clientLogo || existing?.clientLogo || "",
        createdAt: existing?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    const saved = await CSEStorage.saveSite(site);
    state.sites = existing ? state.sites.map(item => item.id === existing.id ? saved : item) : [saved, ...state.sites];
    if (!existing) state.activeSiteId = site.id;
    saveActivePreference();
    closeSiteForm();
    renderAll();
    if (!els.inspectionPanel.hidden && !state.editingInspectionId) renderInspectionSite();
    } catch (error) {
        alert(error.name === "QuotaExceededError" ? "Spazio di archiviazione esaurito. Il cantiere non è stato salvato." : `Salvataggio cantiere non riuscito: ${error.message}`);
    } finally { setInspectionBusy(false); }
}

async function deleteSite(id) {
    if (state.busy) return;
    const used = state.inspections.some(report => report.siteId === id);
    if (used) {
        alert("Questo cantiere ha report salvati. Archivia o mantieni il cantiere per preservare lo storico.");
        return;
    }

    setInspectionBusy(true);
    try { await CSEStorage.deleteSite(id); }
    catch (error) { alert(`Eliminazione non riuscita: ${error.message}`); return; }
    finally { setInspectionBusy(false); }
    state.sites = state.sites.filter(site => site.id !== id);
    if (state.activeSiteId === id) state.activeSiteId = state.sites[0]?.id || "";
    saveActivePreference();
    renderAll();
}

function canLeaveInspection() {
    return !state.inspectionDirty || confirm("Sono presenti modifiche non salvate. Vuoi abbandonarle?");
}

function openInspection(report = null, skipConfirm = false) {
    if (!skipConfirm && !canLeaveInspection()) return;
    if (!report && !activeSite()) {
        alert("Crea o seleziona prima un cantiere.");
        return;
    }

    clearInspectionForm();
    state.editingInspectionId = report?.id || "";
    state.inspectionSnapshot = report ? createReportModel(report).siteSnapshot : null;
    if (report && state.sites.some(site => site.id === report.siteId)) {
        state.activeSiteId = report.siteId;
        saveActivePreference();
        renderAll();
    }
    els.inspectionPanel.hidden = false;
    els.sitesPanel.hidden = true;
    document.getElementById("report-view-panel").hidden = true;
    const general = report?.general || {};
    const fields = {
        "inspection-date": report?.date,
        "inspection-technician": general.tecnico,
        "inspection-affidataria": general.affidataria ?? inspectionSite()?.contractor,
        "inspection-referente": general.referenteAffidataria,
        "inspection-notes": report?.notes ?? general.notes
    };
    Object.entries(fields).forEach(([id, text]) => setValue(id, text));
    const model = report ? createReportModel(report) : null;
    const findings = model?.findings?.length ? model.findings : [{}];
    findings.forEach(addFindingCard);
    state.retainedPhotos = [...(model?.unassignedPhotos || [])];
    renderUnassignedPhotos();
    setToday();
    renderInspectionSite();
    renderRecentTechnicians();
    syncGenerationState();
    state.inspectionDirty = false;
    els.inspectionPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function clearInspectionForm() {
    state.retainedPhotos.forEach(CSEMedia.releaseTemporary);
    [...els.findingsList.children].forEach(card => (card.findingData.photos || []).forEach(CSEMedia.releaseTemporary));
    els.inspectionForm.querySelectorAll("input[type='file']").forEach(input => [...input.files].forEach(CSEMedia.releaseTemporary));
    els.inspectionForm.reset();
    els.findingsList.innerHTML = "";
    state.findingCounter = 0;
    state.editingInspectionId = "";
    state.inspectionSnapshot = null;
    state.retainedPhotos = [];
    state.inspectionDirty = false;
    renderUnassignedPhotos();
    setInspectionStatus("");
}

function resetInspectionForm() {
    if (!canLeaveInspection()) return;
    const report = state.inspections.find(item => item.id === state.editingInspectionId);
    openInspection(report || null, true);
}

function inspectionSite() {
    return state.editingInspectionId ? state.inspectionSnapshot : activeSite();
}

function renderInspectionSite() {
    const site = inspectionSite() || {};
    document.getElementById("inspection-site-roles").innerHTML = [
        ["Cantiere", site.name || "Non indicato"],
        ["CSE del cantiere", site.cseName || "Non indicato"],
        ["Responsabile dei Lavori", site.responsibleForWorks || "Non indicato"]
    ].map(([label, text]) => `<div><dt>${label}</dt><dd>${escapeHtml(text)}</dd></div>`).join("");
    const report = state.inspections.find(item => item.id === state.editingInspectionId);
    document.getElementById("inspection-title").textContent = report
        ? `Modifica report ${String(report.reportNumber).padStart(3, "0")}` : "Nuovo verbale";
    els.btnResetInspection.textContent = report ? "Annulla modifiche" : "Pulisci";
    els.btnRefreshSite.hidden = !report || !state.sites.some(site => site.id === report.siteId);
    els.siteSwitcher.disabled = state.busy || !!report;
}

function refreshInspectionSite() {
    const report = state.inspections.find(item => item.id === state.editingInspectionId);
    const site = state.sites.find(item => item.id === report?.siteId);
    if (!site) return;
    state.inspectionSnapshot = snapshotSite(site);
    state.inspectionDirty = true;
    els.findingsList.querySelectorAll("[data-finding]").forEach(invalidateVision);
    renderInspectionSite();
    setInspectionStatus("Dati del cantiere aggiornati nel modulo. Salva per applicarli a questo sopralluogo.");
}

function renderRecentTechnicians() {
    const names = [...new Set([...state.inspections]
        .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)))
        .map(report => report.general?.tecnico).filter(Boolean))].slice(0, 12);
    document.getElementById("recent-technicians").innerHTML = names.map(name => `<option value="${escapeHtml(name)}"></option>`).join("");
}

function addFindingCard(data = {}) {
    const fragment = els.findingTemplate.content.cloneNode(true);
    const card = fragment.querySelector("[data-finding]");
    card.dataset.id = data.id || uid("finding");
    card.findingData = structuredClone(data);
    els.findingsList.appendChild(card);
    fillFindingCard(card, data);
    bindFindingCard(card);
    renumberFindings();
    syncGenerationState();
    bindFindingMetadata(card);
    bindVisionCard(card);
}

function bindFindingCard(card) {
    card.querySelectorAll("[data-action]").forEach(button => {
        button.addEventListener("click", () => handleFindingAction(card, button.dataset.action));
    });

    card.querySelectorAll("textarea").forEach(field => {
        field.addEventListener("input", () => {
            if (["activityDescription", "safetyMeasures", "correctiveMeasures"].includes(field.dataset.field)) {
                card.dataset.generatedFrom = readFindingCard(card).observation;
            }
            resizeTextarea(field);
            syncGenerationState();
        });
    });
}

function handleFindingAction(card, action) {
    state.inspectionDirty = true;
    if (action === "delete") {
        if (els.findingsList.children.length === 1) {
            alert("Il sopralluogo deve contenere almeno un rilievo.");
            return;
        }
        const photos = card.findingData.photos || [];
        card.remove();
        photos.forEach(releaseUnusedFindingPhoto);
    }

    if (action === "duplicate") {
        const data = readFindingCard(card);
        data.id = uid("finding");
        addFindingCard(data);
    }

    if (action === "up" && card.previousElementSibling) {
        els.findingsList.insertBefore(card, card.previousElementSibling);
    }

    if (action === "down" && card.nextElementSibling) {
        els.findingsList.insertBefore(card.nextElementSibling, card);
    }

    renumberFindings();
    syncGenerationState();
}

function fillFindingCard(card, data) {
    card.querySelectorAll("[data-field]").forEach(field => {
        if (field.tagName === "SELECT" && data[field.dataset.field] &&
            ![...field.options].some(option => option.value === data[field.dataset.field])) {
            field.add(new Option(data[field.dataset.field], data[field.dataset.field]));
        }
        if (data[field.dataset.field] !== undefined) field.value = data[field.dataset.field];
        const fieldId = `${card.dataset.id}-${field.dataset.field}`;
        field.id = fieldId;
        if (field.closest("label")) field.closest("label").htmlFor = fieldId;
    });
    if (data.activityDescription && data.safetyMeasures && data.correctiveMeasures) {
        card.dataset.generatedFrom = data.aiSourceObservation ?? data.observation ?? "";
        card.querySelector("[data-field='observation']").required = !!data.observation;
    }
}

function renumberFindings() {
    [...els.findingsList.children].forEach((card, index) => {
        card.querySelector("[data-finding-title]").textContent = `Rilievo ${String(index + 1).padStart(2, "0")}`;
        card.querySelector(".finding-head").hidden = false;
    });
}

function resizeTextarea(field) {
    if (!field.getClientRects().length) return;
    field.style.height = "auto";
    field.style.height = `${field.scrollHeight + 2}px`;
}

function findingIsReady(card) {
    const finding = readFindingCard(card);
    const review = card.findingData.visionReview;
    return (!review || (!!review.approvedAt && !review.proposalDirty && review.revision === (card.findingData.visionRevision || 0))) && card.dataset.generatedFrom === finding.observation &&
        !!finding.activityDescription && !!finding.safetyMeasures && !!finding.correctiveMeasures;
}

function syncGenerationState() {
    const cards = [...els.findingsList.children];
    const ready = cards.length > 0 && cards.every(findingIsReady);
    cards.forEach(card => {
        const finding = readFindingCard(card);
        const hasText = !!(finding.activityDescription || finding.safetyMeasures || finding.correctiveMeasures);
        card.querySelector("[data-ai-result]").hidden = !hasText;
        card.querySelector("[data-ai-stale]").hidden = !hasText || findingIsReady(card);
        card.querySelectorAll("textarea").forEach(resizeTextarea);
    });
    els.btnSaveInspection.hidden = !ready;
    els.btnGenerateInspection.hidden = cards.length > 0 && cards.every(card => card.findingData.visionReview);
    els.btnSaveInspection.textContent = state.editingInspectionId ? "Salva modifiche" : "Completa e salva";
    els.btnGenerateInspection.textContent = ready ? "Rigenera da appunti" : "Genera da appunti";
}

function setInspectionStatus(message, isError = false) {
    els.inspectionStatus.textContent = message;
    els.inspectionStatus.hidden = !message;
    els.inspectionStatus.dataset.kind = isError ? "error" : "success";
}

function setInspectionBusy(busy) {
    state.busy = busy;
    els.inspectionForm.setAttribute("aria-busy", String(busy));
    els.inspectionForm.querySelectorAll("button, input, textarea, select").forEach(field => field.disabled = busy);
    els.siteForm.querySelectorAll("button, input, textarea, select").forEach(field => field.disabled = busy);
    document.querySelectorAll("#sites-list button, #archive-list button").forEach(button => button.disabled = busy);
    els.siteSwitcher.disabled = busy || (!!state.editingInspectionId && !els.inspectionPanel.hidden);
    els.btnManageSites.disabled = busy;
    els.btnNewSite.disabled = busy;
    els.btnNewInspection.disabled = busy;
    els.btnCloseInspection.disabled = busy;
}

async function generateInspection() {
    if (state.busy || !els.inspectionForm.reportValidity()) return;
    if (!inspectionSite()) {
        setInspectionStatus("Seleziona prima un cantiere.", true);
        return;
    }
    const allCards = [...els.findingsList.children].filter(card => !card.findingData.visionReview);
    if (!allCards.length) return;
    const pending = allCards.filter(card => !findingIsReady(card));
    const cards = pending.length ? pending : allCards;
    if (cards.some(card => !readFindingCard(card).observation)) {
        setInspectionStatus("Inserisci un appunto per ogni rilievo da generare.", true);
        return;
    }
    setInspectionBusy(true);
    setInspectionStatus("Generazione delle tre sezioni in corso...");
    els.btnGenerateInspection.textContent = "Generazione in corso...";
    try {
        const results = [];
        for (const card of cards) {
            results.push(await chiediAIA(readFindingCard(card).observation));
        }
        cards.forEach((card, index) => {
            const result = results[index];
            card.querySelector("[data-field='activityDescription']").value = result.descrizione;
            card.querySelector("[data-field='safetyMeasures']").value = result.misure;
            card.querySelector("[data-field='correctiveMeasures']").value = result.correttive;
            card.dataset.generatedFrom = readFindingCard(card).observation;
        });
        state.inspectionDirty = true;
        setInspectionStatus("Le tre sezioni sono pronte. Puoi rivederle e salvare il verbale.");
    } catch (error) {
        setInspectionStatus(error.message, true);
    } finally {
        setInspectionBusy(false);
        syncGenerationState();
    }
}

async function saveInspection(event, completionStatus = "COMPLETATO") {
    event.preventDefault();
    if (state.busy) return;

    const site = inspectionSite();
    if (!site) {
        alert("Nessun cantiere attivo.");
        return;
    }

    const cards = [...els.findingsList.children];
    if (completionStatus === "COMPLETATO" && (!els.inspectionForm.reportValidity() || !cards.length || !cards.every(findingIsReady))) {
        setInspectionStatus("Completa le tre sezioni e conferma le eventuali proposte fotografiche prima di salvare.", true);
        return;
    }
    setInspectionBusy(true);
    els.btnSaveInspection.textContent = "Salvataggio...";

    try {
        const findings = [];
        for (let i = 0; i < cards.length; i += 1) {
            const finding = readFindingCard(cards[i]);
            finding.number = i + 1;
            const optimizedPhotos = [];
            for (const photo of finding.photos) optimizedPhotos.push(photo instanceof Blob ? await compressFile(photo, 1600, 0.82) : photo);
            finding.photos = optimizedPhotos;
            findings.push(finding);
        }

        const photos = [...state.retainedPhotos];

        const existing = state.inspections.find(item => item.id === state.editingInspectionId);
        const now = new Date().toISOString();
        const inspection = {
            ...existing,
            id: existing?.id || uid("insp"),
            siteId: existing?.siteId || site.id,
            date: value("inspection-date") || new Date().toISOString().slice(0, 10),
            reportNumber: existing?.reportNumber ?? nextReportNumber(site.id),
            siteSnapshot: snapshotSite(site),
            status: existing?.status || "ATTIVO",
            completionStatus,
            findingSchemaVersion: 2,
            createdAt: existing?.createdAt || now,
            updatedAt: now,
            legacyFindingLayout: existing ? (existing.legacyFindingLayout ?? !Array.isArray(existing.photos)) : false,
            general: {
                ...existing?.general,
                affidataria: value("inspection-affidataria"),
                referenteAffidataria: value("inspection-referente"),
                respLavori: site.responsibleForWorks || "",
                tecnico: value("inspection-technician"),
                esecutrice: [...new Set(findings.map(f => f.executingCompany).filter(Boolean))].join(", "),
                sospensioneLavori: findings.some(f => f.activitySuspended === "SI") ? "SI" : "NO"
            },
            notes: value("inspection-notes"),
            findings,
            photos
        };

        const saved = await CSEStorage.saveInspection(inspection);
        state.numberCounters[saved.siteId] = Math.max(state.numberCounters[saved.siteId] || 0, Number(saved.reportNumber) || 0);
        state.inspections = existing
            ? state.inspections.map(item => item.id === existing.id ? saved : item)
            : [saved, ...state.inspections];
        clearInspectionForm();
        els.inspectionPanel.hidden = true;
        els.siteSwitcher.disabled = false;
        document.getElementById("report-view-panel").hidden = true;
        renderRecentTechnicians();
        renderArchiveFilters();
        renderArchive();
    } catch (error) {
        console.error(error);
        setInspectionStatus(error.name === "QuotaExceededError"
            ? "Lo spazio del dispositivo riservato al browser è esaurito. Il verbale precedente è intatto e le modifiche, comprese le foto, restano nel modulo. Libera spazio e riprova senza chiudere questa pagina."
            : error.message || "Salvataggio non riuscito. I dati inseriti sono ancora disponibili.", true);
    } finally {
        setInspectionBusy(false);
        els.btnSaveInspection.textContent = "Salva verbale";
        syncGenerationState();
    }
}

function readFindingCard(card) {
    const finding = {
        id: card.dataset.id || uid("finding"),
        number: 0,
        activityDescription: "",
        observation: "",
        safetyMeasures: "",
        correctiveMeasures: "",
        company: "",
        priority: "Ordinaria",
        timing: "Messa in sicurezza immediata",
        photos: [],
        ...card.findingData,
        aiSourceObservation: card.dataset.generatedFrom
    };

    card.querySelectorAll("[data-field]").forEach(field => {
        if (field.dataset.field === "photos") return;
        finding[field.dataset.field] = field.value.trim();
    });

    finding.activitySuspended = card.querySelector("[data-suspended]:checked")?.value || "NO";
    delete finding.pdfDescription;
    delete finding.pdfPhotoGroups;
    delete finding.showPhotoFrame;
    return finding;
}

function snapshotSite(site) {
    return JSON.parse(JSON.stringify(site));
}

function nextReportNumber(siteId) {
    return Math.max(state.numberCounters[siteId] || 0, ...state.inspections.filter(report => report.siteId === siteId).map(report => Number(report.reportNumber) || 0)) + 1;
}

function renderArchive() {
    const status = els.archiveStatusFilter.value || "ATTIVO";
    const siteFilter = els.archiveSiteFilter.value || "ACTIVE";
    const siteId = siteFilter === "ACTIVE" ? state.activeSiteId : siteFilter;

    let reports = state.inspections.filter(report => status === "ARCHIVIATO"
        ? report.status === "ARCHIVIATO"
        : report.status !== "ARCHIVIATO" && (status === "ATTIVO" || (report.completionStatus || "COMPLETATO") === status));
    if (siteId !== "ALL") {
        reports = reports.filter(report => report.siteId === siteId);
    }
    reports.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || Number(b.reportNumber) - Number(a.reportNumber));

    if (!reports.length) {
        els.archiveList.innerHTML = `<div class="empty-state">Nessun verbale da mostrare per il filtro selezionato.</div>`;
        return;
    }

    const groups = reports.reduce((acc, report) => {
        const key = report.siteId;
        acc[key] ||= [];
        acc[key].push(report);
        return acc;
    }, {});

    els.archiveList.innerHTML = Object.entries(groups).map(([siteId, siteReports]) => `
        <section class="archive-group">
            <h3>${escapeHtml(state.sites.find(site => site.id === siteId)?.name || siteReports[0].siteSnapshot?.name || "Cantiere")}</h3>
            ${siteReports.map(reportCardHtml).join("")}
        </section>
    `).join("");

    els.archiveList.querySelectorAll("[data-report-action]").forEach(button => {
        button.addEventListener("click", () => handleReportAction(button.dataset.reportAction, button.dataset.id));
    });
}

function reportCardHtml(report) {
    const date = formatDate(report.date);
    const findings = report.findings?.length || 0;
    const completion = report.completionStatus || "COMPLETATO";
    return `
        <article class="report-card">
            <div>
                <h3>${date} - Report ${String(report.reportNumber).padStart(3, "0")}</h3>
                <p>${findings} ${findings === 1 ? "rilievo" : "rilievi"}</p>
                <p>Tecnico: ${escapeHtml(report.general?.tecnico || "Non indicato")}</p>
                <span class="report-state ${completion === "BOZZA" ? "draft" : ""}">${escapeHtml(completion)}</span>
            </div>
            <div class="card-actions">
                <button class="btn-secondary" type="button" data-report-action="view" data-id="${report.id}">Apri</button>
                <button class="btn-secondary" type="button" data-report-action="edit" data-id="${report.id}">Modifica</button>
                <button class="btn-pdf" type="button" data-report-action="pdf" data-id="${report.id}">PDF</button>
                <button class="btn-danger" type="button" data-report-action="delete" data-id="${report.id}">Elimina</button>
                <button class="btn-secondary" type="button" data-report-action="toggle" data-id="${report.id}">${report.status === "ARCHIVIATO" ? "Ripristina" : "Archivia"}</button>
                <button class="btn-secondary" type="button" data-report-action="share" data-id="${report.id}">Condividi</button>
            </div>
        </article>
    `;
}

async function handleReportAction(action, id) {
    if (state.busy) return;
    const report = state.inspections.find(item => item.id === id);
    if (!report) return;
    const writing = action === "toggle" || action === "duplicate" || action === "delete";
    if (writing) setInspectionBusy(true);
    try {
    if (action === "delete") {
        if (!await confirmReportDeletion(report)) return;
        try { await CSEStorage.deleteInspection(id); }
        catch (error) { alert(`Eliminazione non riuscita. Il report è conservato: ${error.message}`); return; }
        state.numberCounters[report.siteId] = Math.max(state.numberCounters[report.siteId] || 0, Number(report.reportNumber) || 0);
        state.inspections = state.inspections.filter(item => item.id !== id);
        if (state.viewedInspectionId === id) document.getElementById("report-view-panel").hidden = true;
        if (state.editingInspectionId === id) {
            clearInspectionForm();
            els.inspectionPanel.hidden = true;
        }
        renderRecentTechnicians();
        renderArchive();
    }
    if (action === "view") viewInspection(report);
    if (action === "edit") openInspection(report);
    if (action === "pdf") {
        try { await scaricaPDF(report); }
        catch (error) { alert(`Generazione PDF non riuscita: ${error.message}`); }
    }
    if (action === "toggle") {
        const inspections = state.inspections.map(item => item.id === id
            ? { ...item, status: item.status === "ARCHIVIATO" ? "ATTIVO" : "ARCHIVIATO" } : item);
        try { await CSEStorage.saveInspection(inspections.find(item => item.id === id)); }
        catch { alert("Stato non salvato. Verifica lo spazio disponibile nel browser."); return; }
        state.inspections = inspections;
        renderArchive();
    }
    if (action === "duplicate") {
        const copy = JSON.parse(JSON.stringify(report));
        copy.id = uid("insp");
        copy.createdAt = new Date().toISOString();
        copy.updatedAt = copy.createdAt;
        copy.reportNumber = nextReportNumber(copy.siteId);
        copy.status = "ATTIVO";
        const inspections = [copy, ...state.inspections];
        try { await CSEStorage.saveInspection(copy); }
        catch { alert("Duplicazione non riuscita. Verifica lo spazio disponibile nel browser."); return; }
        state.inspections = inspections;
        renderArchive();
    }
    if (action === "share") condividiReport(report);
    } finally {
        if (writing) setInspectionBusy(false);
    }
}

function viewInspection(report) {
    const model = createReportModel(report);
    state.viewedInspectionId = report.id;
    const panel = document.getElementById("report-view-panel");
    panel.hidden = false;
    document.getElementById("report-view-title").textContent = `Report ${String(report.reportNumber).padStart(3, "0")} - ${model.siteSnapshot.name || "Cantiere"}`;
    const details = [
        ["Data", formatDate(model.date)], ["Stato", model.completionStatus],
        ["Tecnico che effettua il sopralluogo", model.general.tecnico], ["CSE del cantiere", model.siteSnapshot.cseName],
        ["Responsabile dei Lavori", model.siteSnapshot.responsibleForWorks], ["Impresa affidataria", model.general.affidataria],
        ["Referente affidataria", model.general.referenteAffidataria], ["Note", model.notes || model.general.notes]
    ];
    const gallery = photos => `<div class="report-photo-gallery">${photos.filter(Boolean).map((src, i) => `<img data-media-source="${escapeHtml(src)}" alt="Foto ${i + 1}">`).join("")}</div>`;
    document.getElementById("report-view-content").innerHTML = `
        <dl class="report-details">${details.map(([label, text]) => `<div><dt>${label}</dt><dd class="report-text">${escapeHtml(text || "Non indicato")}</dd></div>`).join("")}</dl>
        ${model.findings.map(finding => `<section class="view-finding"><h3>Rilievo ${finding.number}</h3>
            <dl class="report-details">${[["Impresa esecutrice", finding.executingCompany], ["Fabbricato", finding.building], ["Piano", finding.floor], ["Attività sospesa", finding.activitySuspended]].map(([label, text]) => `<div><dt>${label}</dt><dd>${escapeHtml(text || "Non indicato")}</dd></div>`).join("")}</dl>
            ${[["Appunto", finding.observation], ["Descrizione attività", finding.activityDescription], ["Misure di sicurezza attuate", finding.safetyMeasures], ["Misure correttive", finding.correctiveMeasures], ["Impresa interessata", finding.company], ["Priorità", finding.priority], ["Disposizione operativa", finding.timing]].map(([label, text]) => `<h4>${label}</h4><p class="report-text">${escapeHtml(text || "-")}</p>`).join("")}
            ${gallery(finding.photos || [])}</section>`).join("")}
        ${model.unassignedPhotos.length ? `<section class="view-finding"><h3>Foto precedenti da assegnare</h3>${gallery(model.unassignedPhotos)}</section>` : ""}
    `;
    CSEMedia.bindImages(document.getElementById("report-view-content"));
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function condividiReport(report) {
    const text = [
        `REPORT CSE: ${report.siteSnapshot?.name || ""}`,
        `Data: ${formatDate(report.date)}`,
        `Rilievi: ${report.findings?.length || 0}`,
        `Tecnico: ${report.general?.tecnico || ""}`,
        "",
        ...(report.findings || []).map(f => `Rilievo ${f.number}: ${f.observation || f.activityDescription || "-"}`)
    ].join("\n");

    if (navigator.share) {
        navigator.share({ title: `Report CSE - ${report.siteSnapshot?.name || ""}`, text }).catch(console.error);
    } else {
        window.open(`mailto:?subject=${encodeURIComponent("Report CSE")}&body=${encodeURIComponent(text)}`);
    }
}

async function chiediAIA(appuntoUtente) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    const appunto = [
        "Elabora l'appunto del tecnico nelle tre voci descrizione, misure, correttive.",
        "Descrizione: riporta soltanto le attivita e i fatti annotati.",
        "Misure di sicurezza attuate: riporta solo quelle effettivamente osservate. Se non sono indicate, dichiaralo; non presentare proposte come misure gia attuate.",
        "Misure correttive: proponi gli interventi pertinenti alle sole criticita annotate, distinguendoli dai fatti osservati.",
        "Non inventare non conformita, verifiche svolte, sospensioni, scadenze o riferimenti normativi non presenti nell'appunto.",
        "Restituisci le tre voci come testi in italiano.",
        "APPUNTO DEL TECNICO:",
        appuntoUtente
    ].join("\n");
    try {
        const risposta = await fetch(RDS_CONFIG.textAIEndpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ appunto }),
            signal: controller.signal
        });
        if (!risposta.ok) throw new Error("Il servizio AI non è disponibile. Riprova tra poco; il tuo appunto è conservato.");
        const dati = await risposta.json();
        const result = {};
        for (const field of ["descrizione", "misure", "correttive"]) {
            const text = formatAISection(dati[field]);
            if (!text || text === "-") {
                throw new Error("L'AI ha restituito una risposta incompleta. Riprova la generazione.");
            }
            result[field] = text;
        }
        return result;
    } catch (errore) {
        if (errore.name === "AbortError") throw new Error("L'AI sta impiegando troppo tempo. Riprova; il tuo appunto è conservato.");
        if (errore instanceof TypeError || errore instanceof SyntaxError) {
            throw new Error("Collegamento AI non riuscito. Verifica la connessione e riprova; il tuo appunto è conservato.");
        }
        throw errore;
    } finally {
        clearTimeout(timeout);
    }
}

function formatAISection(value, depth = 0) {
    if (depth > 5 || value == null) return "";
    if (typeof value === "string") return value.trim();
    if (Array.isArray(value)) {
        return value.map((item, index) => {
            const text = formatAISection(item, depth + 1);
            return text ? `${index + 1}. ${text}` : "";
        }).filter(Boolean).join("\n");
    }
    if (typeof value === "object") {
        return Object.entries(value).map(([key, item]) => {
            const text = formatAISection(item, depth + 1);
            const label = /^\d+$/.test(key) ? `${key}.` : `${key}:`;
            return text ? `${label} ${text}` : "";
        }).filter(Boolean).join("\n");
    }
    return "";
}

async function scaricaPDF(report) {
    return renderCseProPdf(createReportModel(report));
}

async function renderCseProPdf(report) {
    if (!window.jspdf?.jsPDF) {
        alert("Modulo PDF non caricato. Verifica la connessione alla libreria jsPDF.");
        return;
    }

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF("p", "mm", "a4");
    const logo = await loadImage("logo-romeo.png");
    const certificazioni = await loadImage("certificazioni.png");
    const site = report.siteSnapshot || {};
    const general = report.general || {};

    function header() {
        if (logo) addImageContain(pdf, logo, 20, 12, 170, 18);
        pdf.setTextColor(0, 0, 0);
    }

    function footer() {
        if (certificazioni) addImageContain(pdf, certificazioni, 18, 262, 55, 18);
        pdf.setFontSize(7);
        pdf.setTextColor(80, 80, 80);
        pdf.text("Romeo Safety Italia S.r.l.", 185, 264, { align: "right" });
        pdf.text("Sede: Via Imperia, 25 - 20142 MILANO", 185, 268, { align: "right" });
        pdf.text("Tel. 02/84.800.210 - C.F. e P.IVA 12689530157", 185, 272, { align: "right" });
        pdf.setTextColor(0, 0, 0);
    }

    function greenBar(x, y, w, h) {
        pdf.setFillColor(146, 208, 80);
        pdf.setDrawColor(0, 0, 0);
        pdf.rect(x, y, w, h, "FD");
    }

    header();
    pdf.setFontSize(8);
    fitPdfText(pdf, `${(site.code || site.name || "").toUpperCase()}_${compactDate(report.date)}_R${String(report.reportNumber).padStart(3, "0")}`, 18, 43, 82, 9, 8);
    pdf.setFont(undefined, "bold");
    fitPdfText(pdf, `Spett.le Affidataria: ${general.affidataria || site.contractor || "-"}`, 105, 43, 80, 6, 8, "right");
    pdf.setFont(undefined, "normal");
    fitPdfText(pdf, `c.a. ${general.referenteAffidataria || "-"}`, 105, 50, 80, 5, 8, "right");
    pdf.setFont(undefined, "bold");
    fitPdfText(pdf, "p.c. Spett.le Responsabile dei Lavori", 105, 55, 80, 3.5, 8, "right");
    pdf.setFont(undefined, "normal");
    fitPdfText(pdf, site.responsibleForWorks || "-", 105, 58.5, 80, 3.5, 8, "right");

    greenBar(15, 63, 180, 7);
    pdf.setFont(undefined, "bold");
    fitPdfText(pdf, `Report di Sopralluogo CSE - Cantiere "${site.name || "-"}" ${site.client || ""} ${site.address || ""}`, 18, 64, 174, 5, 8);

    pdf.rect(15, 70, 180, 58);
    pdf.line(125, 70, 125, 128);
    pdf.setFontSize(8);
    pdf.text("Attivita svolta durante il sopralluogo:", 18, 77);
    pdf.setFont(undefined, "normal");

    const selectedActivities = new Set((report.findings || []).map(f => f.activityDescription).filter(Boolean));
    let y = 83;
    ATTIVITA_BASE.forEach(activity => {
        const used = [...selectedActivities].some(value => value.includes(activity) || activity.includes(value));
        pdf.text(`${used ? "[X]" : "[ ]"} ${activity}`, 18, y);
        y += 4.5;
    });

    y += 4;
    pdf.setFont(undefined, "bold");
    pdf.text("Impresa Affidataria coinvolta:", 18, y);
    pdf.setFont(undefined, "normal");
    fitPdfText(pdf, general.affidataria || site.contractor || "-", 22, y + 2, 99, 6, 8);
    y += 11;
    pdf.setFont(undefined, "bold");
    pdf.text("Impresa Esecutrice coinvolta:", 18, y);
    pdf.setFont(undefined, "normal");
    fitPdfText(pdf, general.esecutrice || "-", 22, y + 2, 99, 6, 8);

    const cover = await loadImage(site.coverImage || "planimetria.png");
    if (cover) addImageContain(pdf, cover, 130, 75, 58, 48);

    greenBar(15, 128, 180, 8);
    pdf.setFont(undefined, "bold");
    pdf.setFontSize(7.3);
    const checkSI = general.sospensioneLavori === "SI" ? "[X] SI" : "[ ] SI";
    const checkNO = general.sospensioneLavori === "NO" || !general.sospensioneLavori ? "[X] NO" : "[ ] NO";
    pdf.text(`Attivita lavorative sospese, art. 92 c. 2 lett. f) D.Lgs. 81/2008 durante il sopralluogo    ${checkSI}    ${checkNO}`, 105, 133, { align: "center" });

    greenBar(15, 155, 115, 8);
    pdf.setFontSize(9);
    fitPdfText(pdf, `Sopralluogo effettuato da: ${general.tecnico || "-"}`, 18, 156, 109, 6, 9);
    pdf.setFont(undefined, "normal");
    pdf.setFontSize(8);
    pdf.text("ASPETTI - IMPATTI E RELATIVE MISURE DI PREVENZIONE E PROTEZIONE", 15, 212);
    footer();

    for (const finding of report.findings || []) {
        await addFindingPdfPage(pdf, finding, report, header, footer, greenBar);
    }
    // Keep ambiguous historical attachments visible without assigning them to the wrong finding.
    for (let i = 0; i < report.unassignedPhotos.length; i += 2) {
        pdf.addPage();
        header();
        greenBar(15, 42, 180, 8);
        pdf.setFont(undefined, "bold");
        pdf.setFontSize(8);
        pdf.text("Allegati precedenti - rilievo di appartenenza non indicato", 18, 47);
        pdf.setFont(undefined, "normal");
        await drawPhotos(pdf, report.unassignedPhotos.slice(i, i + 2), 60);
        footer();
    }
    pdf.setPage(pdf.getNumberOfPages());
    pdf.setFont(undefined, "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(0, 0, 0);
    fitPdfText(pdf, `Il CSE p.i.e. ${site.cseName || "-"}`, 115, 251, 70, 6, 8, "right");

    const fileName = `Verbale_CSE_${(site.code || site.name || "report").toUpperCase()}_${String(report.reportNumber).padStart(3, "0")}.pdf`;
    pdf.save(fileName.replace(/[^a-z0-9_.-]/gi, "_"));
}

async function addFindingPdfPage(pdf, finding, report, header, footer, greenBar) {
    const description = finding.pdfDescription;
    const sections = [
        ["Descrizione attivita:", description || "-"],
        ["Misure di sicurezza attuate:", finding.safetyMeasures || "-"],
        ["Misure correttive:", finding.correctiveMeasures || "-"]
    ];
    let y = 74;

    function startFindingPage(continuation = false) {
        pdf.addPage();
        header();
        greenBar(15, 42, 180, 8);
        pdf.setFont(undefined, "bold");
        const title = `Rilievo ${String(finding.number).padStart(2, "0")}${continuation ? " - segue" : ""}`;
        fitPdfText(pdf, title, 18, 43, 174, 5, 8);
        pdf.setFont(undefined, "normal");
        fitPdfText(pdf, `Impresa esecutrice: ${finding.executingCompany || "-"}`, 18, 52, 174, 6, 8);
        fitPdfText(pdf, `Fabbricato: ${finding.building || "-"}`, 18, 59, 85, 6, 8);
        fitPdfText(pdf, `Piano: ${finding.floor || "-"}`, 106, 59, 85, 6, 8);
        fitPdfText(pdf, `Attivita sospesa: ${finding.activitySuspended === "SI" ? "SI" : "NO"}`, 18, 65, 174, 5, 8);
        pdf.setFontSize(8);
        y = 76;
    }

    function continueFindingPage() {
        pdf.rect(15, 50, 180, Math.max(55, y - 48));
        footer();
        startFindingPage(true);
    }

    startFindingPage();
    // Reserve the lower half for the original dispositions, photos and signature.
    for (const [label, text] of sections) {
        pdf.setFont(undefined, "normal");
        pdf.setFontSize(8);
        const lines = pdf.splitTextToSize(text, 170);
        if (y + 12 > 120) continueFindingPage();
        pdf.setFont(undefined, "bold");
        pdf.text(label, 18, y);
        y += 5;
        pdf.setFont(undefined, "normal");
        for (const line of lines) {
            if (y > 120) {
                continueFindingPage();
                pdf.setFont(undefined, "bold");
                pdf.text(`${label} (segue)`, 18, y);
                y += 5;
                pdf.setFont(undefined, "normal");
            }
            pdf.text(line, 18, y);
            y += 3.3;
        }
        pdf.line(18, y + 1, 188, y + 1);
        y += 6;
    }
    pdf.rect(15, 50, 180, Math.max(55, y - 48));

    const yDisp = Math.max(110, y + 5);
    pdf.rect(15, yDisp, 180, 20);
    pdf.setFontSize(6.5);
    pdf.setFont(undefined, "bold");
    pdf.text("Disposizioni operative e scadenze:", 18, yDisp + 5);
    pdf.setFont(undefined, "normal");
    [
        "Attivita sospesa fino ad adempimento",
        "Messa in sicurezza immediata",
        "Messa in sicurezza entro 2 giorni",
        "Messa in sicurezza entro 3 giorni",
        "Messa in sicurezza giornata"
    ].forEach((timing, index) => {
        const positions = [[18, 10], [103, 10], [18, 15], [103, 15], [18, 19]];
        const check = finding.timing === timing ? "[X]" : "[ ]";
        pdf.text(`${check} ${timing}`, positions[index][0], yDisp + positions[index][1]);
    });

    if (finding.showPhotoFrame) {
        await drawPhotos(pdf, finding.pdfPhotoGroups[0] || [], yDisp + 27);
    }

    const yTab = 230;
    pdf.setFontSize(8);
    pdf.text(`sospese: ${finding.activitySuspended === "SI" ? "[ ] NON APPLICABILE - [X] APPLICABILE" : "[X] NON APPLICABILE - [ ] APPLICABILE"}`, 15, yTab);
    greenBar(15, yTab + 4, 180, 7);
    pdf.setFontSize(7);
    pdf.text("Attivita", 18, yTab + 9);
    pdf.text("Data Sospensione attivita", 40, yTab + 9);
    pdf.text("Attivita sospesa", 85, yTab + 9);
    pdf.text("Data ripresa attivita", 125, yTab + 9);
    fitPdfText(pdf, "Descrizione dell'adempimento", 152, yTab + 5, 41, 5, 7);
    pdf.rect(15, yTab + 4, 180, 14);
    pdf.line(35, yTab + 4, 35, yTab + 18);
    pdf.line(80, yTab + 4, 80, yTab + 18);
    pdf.line(120, yTab + 4, 120, yTab + 18);
    pdf.line(150, yTab + 4, 150, yTab + 18);
    pdf.line(15, yTab + 11, 195, yTab + 11);
    pdf.text(String(finding.number), 18, yTab + 16);
    pdf.text("-", 40, yTab + 16);
    fitPdfText(pdf, finding.activityDescription || "-", 82, yTab + 12, 36, 5, 7);
    pdf.text("-", 125, yTab + 16);
    pdf.text(finding.correctiveMeasures ? "Vedi prescrizioni" : "-", 155, yTab + 16, { maxWidth: 37 });

    pdf.setFontSize(8);
    footer();

    for (const photos of finding.pdfPhotoGroups.slice(1)) {
        pdf.addPage();
        header();
        greenBar(15, 42, 180, 8);
        pdf.setFont(undefined, "bold");
        pdf.setFontSize(8);
        pdf.text(`Foto rilievo ${String(finding.number).padStart(2, "0")} - segue`, 18, 47);
        pdf.setFont(undefined, "normal");
        await drawPhotos(pdf, photos, 60);
        footer();
    }
}

async function drawPhotos(pdf, photos, yStart) {
    const yFoto = Math.min(yStart, 155);
    pdf.rect(15, yFoto, 180, 66);
    pdf.setFillColor(146, 208, 80);
    pdf.rect(15, yFoto, 10, 66, "FD");
    pdf.setFontSize(8);
    pdf.text("foto NC", 20, yFoto + 39, { angle: 90 });
    pdf.line(105, yFoto, 105, yFoto + 66);

    const slots = [
        { x: 32, y: yFoto + 6, w: 68, h: 48, label: "Foto 1" },
        { x: 112, y: yFoto + 6, w: 68, h: 48, label: "Foto 2" }
    ];

    for (let i = 0; i < slots.length; i += 1) {
        const slot = slots[i];
        const img = photos[i] ? await loadImage(photos[i]) : null;
        if (img) {
            addImageContain(pdf, img, slot.x, slot.y, slot.w, slot.h);
        } else {
            pdf.setFontSize(24);
            pdf.text("foto", slot.x + slot.w / 2, slot.y + 30, { align: "center" });
        }
        pdf.setFontSize(8);
        pdf.text(slot.label, slot.x + slot.w / 2, yFoto + 61, { align: "center" });
    }

    if (photos.length > 2) {
        pdf.setFontSize(7);
        pdf.text(`Altre foto allegate al rilievo: ${photos.length - 2}`, 105, yFoto + 65, { align: "center" });
    }
}

function fitPdfText(pdf, text, x, y, width, height, initialSize = 8, align = "left") {
    let size = initialSize;
    let lines;
    do {
        pdf.setFontSize(size);
        lines = pdf.splitTextToSize(text || "-", width);
        if (lines.length * size * 0.405 <= height) break;
        size -= 0.5;
    } while (size > 5);
    const maxLines = Math.max(1, Math.floor(height / (size * 0.405)));
    if (lines.length > maxLines) {
        lines = lines.slice(0, maxLines);
        let last = lines[maxLines - 1];
        while (last && pdf.getTextWidth(`${last}...`) > width) last = last.slice(0, -1);
        lines[maxLines - 1] = `${last}...`;
    }
    pdf.text(lines, align === "right" ? x + width : x, y + size * 0.353, { lineHeightFactor: 1.15, align });
    pdf.setFontSize(initialSize);
}

function addImageContain(pdf, img, x, y, boxW, boxH) {
    if (!img) return;
    const ratio = img.naturalWidth / img.naturalHeight;
    let w = boxW;
    let h = w / ratio;
    if (h > boxH) {
        h = boxH;
        w = h * ratio;
    }
    const dx = x + (boxW - w) / 2;
    const dy = y + (boxH - h) / 2;
    pdf.addImage(img, imageType(img.src), dx, dy, w, h);
}

async function loadImage(src) {
    src = await CSEMedia.pdfSource(src);
    return new Promise(resolve => {
        if (!src) {
            resolve(null);
            return;
        }
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = () => {
            const fallback = assetFallback(src);
            if (fallback && fallback !== src) {
                img.onerror = () => resolve(null);
                img.src = fallback;
                return;
            }
            resolve(null);
        };
        img.src = window.CSE_ASSETS?.[src] || src;
    });
}

function assetFallback(src) {
    const name = String(src).split("/").pop();
    const base = "https://fra1991xy-ui.github.io/francescoromeo/";
    if (["logo-romeo.png", "certificazioni.png", "planimetria.png"].includes(name)) {
        return base + name;
    }
    return "";
}

function imageType(src) {
    return String(src).startsWith("data:image/png") || String(src).toLowerCase().endsWith(".png") ? "PNG" : "JPEG";
}

function createCoverImage(src, boxW, boxH) {
    return new Promise(resolve => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement("canvas");
            const scale = 4;
            canvas.width = Math.round(boxW * scale);
            canvas.height = Math.round(boxH * scale);
            const ctx = canvas.getContext("2d");
            const sourceRatio = img.width / img.height;
            const targetRatio = canvas.width / canvas.height;
            let sx = 0;
            let sy = 0;
            let sw = img.width;
            let sh = img.height;

            if (sourceRatio > targetRatio) {
                sw = img.height * targetRatio;
                sx = (img.width - sw) / 2;
            } else {
                sh = img.width / targetRatio;
                sy = (img.height - sh) / 2;
            }

            ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL("image/jpeg", 0.82));
        };
        img.onerror = () => resolve(src);
        img.src = src;
    });
}

function readSingleImage(inputId, maxDim, quality) {
    const input = document.getElementById(inputId);
    if (!input?.files?.[0]) return Promise.resolve("");
    return compressFile(input.files[0], maxDim, quality);
}

async function readMultipleImages(input, maxDim, quality) {
    if (!input?.files?.length) return [];
    const files = [...input.files].slice(0, 8);
    const images = [];
    for (const file of files) {
        images.push(await compressFile(file, maxDim, quality));
    }
    return images.filter(Boolean);
}

function compressFile(file, maxDim = 1600, quality = 0.82) {
    return CSEMedia.compress(file, maxDim, quality);
}

function value(id) {
    return document.getElementById(id)?.value.trim() || "";
}

function setValue(id, text) {
    const element = document.getElementById(id);
    if (element) element.value = text || "";
}

function formatDate(date) {
    if (!date) return "";
    return new Intl.DateTimeFormat("it-IT").format(new Date(`${date}T12:00:00`));
}

function compactDate(date) {
    return String(date || "").replaceAll("-", "");
}

function escapeHtml(text) {
    return String(text || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}
