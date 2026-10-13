function invalidateVision(card) {
    card.findingData.visionRevision = (card.findingData.visionRevision || 0) + 1;
    state.inspectionDirty = true;
    card.querySelector("[data-vision-consent]").checked = false;
    card.querySelector("[data-vision-approval]").checked = false;
    if (card.querySelector("[data-vision]")) renderVisionCard(card);
    syncGenerationState();
}

function bindVisionCard(card) {
    card.querySelector("[data-field='observation']").required = false;
    const review = card.findingData.visionReview;
    card.querySelector("[data-vision-question]").value = card.findingData.visionQuestion || "";
    card.querySelector("[data-vision-body]").hidden = !review;
    card.querySelector("[data-vision-open]").onclick = () => {
        const body = card.querySelector("[data-vision-body]");
        body.hidden = !body.hidden;
        renderVisionCard(card);
    };
    card.addEventListener("input", event => {
        if (event.target.matches("[data-field='observation']")) invalidateVision(card);
        if (event.target.matches("[data-vision-question]")) {
            card.findingData.visionQuestion = event.target.value;
            invalidateVision(card);
        }
        if (event.target.matches("[data-proposal]")) {
            card.findingData.visionReview.editedProposal = readVisionProposal(card);
            card.findingData.visionReview.proposalDirty = true;
            card.querySelector("[data-vision-approval]").checked = false;
            state.inspectionDirty = true;
            syncGenerationState();
        }
    });
    card.addEventListener("change", event => {
        if (event.target.matches("[data-suspended], [data-field='company'], [data-field='priority'], [data-field='timing']")) invalidateVision(card);
    });
    card.querySelector("[data-vision-analyze]").onclick = () => analyzeFindingPhotos(card);
    card.querySelector("[data-vision-create]").onclick = () => {
        card.findingData.visionReview.proposalOpened = true;
        card.querySelectorAll("[data-proposal]").forEach(input => input.value = (card.findingData.visionReview.editedProposal || card.findingData.visionReview.result.proposal)[input.dataset.proposal]);
        state.inspectionDirty = true;
        renderVisionCard(card);
    };
    card.querySelector("[data-vision-accept]").onclick = () => approveVisionProposal(card);
    if (review?.proposalOpened) card.querySelectorAll("[data-proposal]").forEach(input => input.value = (review.editedProposal || review.result.proposal)[input.dataset.proposal]);
    renderVisionCard(card);
}

function renderVisionCard(card) {
    const photos = card.findingData.photos || [];
    let selected = card.findingData.visionSelected;
    if (!selected) selected = photos.map((_, i) => i).slice(0, RDS_CONFIG.maxAnalysisPhotos);
    selected = selected.filter(i => photos[i]);
    if (photos.length) card.findingData.visionSelected = selected;
    card.querySelector("[data-vision-photo-count]").textContent = `(${selected.length}/${RDS_CONFIG.maxAnalysisPhotos})`;
    const options = card.querySelector("[data-vision-photo-options]");
    options.innerHTML = photos.map((_, i) => `<label><input type="checkbox" data-vision-photo="${i}" ${selected.includes(i) ? "checked" : ""}> Foto ${i + 1}</label>`).join("");
    options.querySelectorAll("input").forEach(input => input.onchange = () => {
        const list = [...options.querySelectorAll("input:checked")].map(item => Number(item.dataset.visionPhoto));
        if (list.length > RDS_CONFIG.maxAnalysisPhotos) {
            input.checked = false;
            visionStatus(card, `Seleziona al massimo ${RDS_CONFIG.maxAnalysisPhotos} foto per analisi.`, true);
            return;
        }
        card.findingData.visionSelected = list;
        invalidateVision(card);
    });
    const review = card.findingData.visionReview;
    const stale = !!review && review.revision !== (card.findingData.visionRevision || 0);
    card.querySelector("[data-vision-stale]").hidden = !stale;
    card.querySelector("[data-vision-create]").hidden = !review;
    card.querySelector("[data-vision-create]").disabled = stale || state.busy;
    card.querySelector("[data-vision-proposal]").hidden = !review?.proposalOpened;
    card.querySelector("[data-vision-accept]").disabled = stale || state.busy;
    const assessment = card.querySelector("[data-vision-assessment]");
    assessment.hidden = !review;
    if (!review) return;
    const analysis = review.result.analysis;
    const lines = entries => `<ul>${entries.map(text => `<li>${escapeHtml(text)}</li>`).join("")}</ul>`;
    const evidence = items => lines(items.map(item => `${item.text} (${item.photoIds.map(id => id.replace("foto-", "Foto ")).join(", ")})`));
    assessment.innerHTML = `<h4>Valutazione di supporto</h4><p class="report-text">${escapeHtml(analysis.summary)}</p>
        <h4>Elementi visibili</h4>${evidence(analysis.visible)}
        <h4>Informazioni del CSE</h4>${lines(analysis.reported)}
        <h4>Possibili criticità</h4>${evidence(analysis.possibleIssues)}
        <h4>Non verificabile dalle foto</h4>${lines(analysis.notVerifiable)}
        <h4>Chiarimenti richiesti</h4>${lines(analysis.questions)}
        <p class="vision-audit">${escapeHtml(review.approvedAt ? "Proposta confermata dal CSE" : "Proposta non ancora confermata")} · ${escapeHtml(review.result.meta.model)} · ${Number(review.result.meta.inputTokens) || 0} token input · ${Number(review.result.meta.outputTokens) || 0} token output${typeof review.result.meta.estimatedCostUSD === "number" ? ` · Stima USD ${review.result.meta.estimatedCostUSD.toFixed(5)}` : ""}</p>`;
}

function visionStatus(card, message, error = false) {
    const status = card.querySelector("[data-vision-status]");
    status.hidden = !message;
    status.textContent = message;
    status.dataset.kind = error ? "error" : "success";
}

function validateVisionResult(result, ids) {
    const text = value => typeof value === "string" && value.length <= 12000;
    const list = values => Array.isArray(values) && values.length <= 30 && values.every(text);
    const evidence = values => Array.isArray(values) && values.length <= 30 && values.every(item => text(item.text) && Array.isArray(item.photoIds) && item.photoIds.length > 0 && item.photoIds.every(id => ids.includes(id)));
    if (!result?.analysis || !result?.proposal || !result?.meta || !text(result.analysis.summary) || !evidence(result.analysis.visible) || !evidence(result.analysis.possibleIssues) || !list(result.analysis.reported) || !list(result.analysis.notVerifiable) || !list(result.analysis.questions) || !["descrizione", "misure", "correttive"].every(key => text(result.proposal[key]) && result.proposal[key].trim())) throw new Error("Analisi incompleta o riferimenti alle foto non validi. I testi precedenti sono conservati.");
}

async function analyzeFindingPhotos(card) {
    if (state.busy) return;
    const indices = card.findingData.visionSelected || [];
    if (!indices.length) return visionStatus(card, "Seleziona almeno una fotografia del rilievo.", true);
    if (!card.querySelector("[data-vision-consent]").checked) return visionStatus(card, "Conferma l'invio delle fotografie prima di procedere.", true);
    const controller = new AbortController();
    setInspectionBusy(true);
    const cancel = card.querySelector("[data-vision-cancel]");
    cancel.hidden = false; cancel.disabled = false; cancel.onclick = () => controller.abort();
    visionStatus(card, "Preparazione fotografie e analisi in corso...");
    try {
        const photos = [];
        for (const index of indices) {
            if (controller.signal.aborted) throw new Error("Analisi annullata. Foto e testi sono conservati.");
            const source = card.findingData.photos[index];
            const blob = source instanceof Blob ? await CSEMedia.compress(source, 1600, 0.82) : (await CSEStorage.get("media", source.slice(6)))?.blob;
            if (!(blob instanceof Blob)) throw new Error("Fotografia non disponibile.");
            // Selected new images become the exact optimized bytes used for both AI and persistence.
            if (source instanceof Blob) { card.findingData.photos[index] = blob; releaseUnusedFindingPhoto(source); }
            const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); });
            photos.push({ id: `foto-${index + 1}`, dataUrl });
        }
        renderFindingPhotos(card);
        const finding = readFindingCard(card);
        const site = inspectionSite() || {};
        const payload = { requestId: crypto.randomUUID(), question: card.findingData.visionQuestion || "", observation: finding.observation,
            context: { site: site.name || "", siteCode: site.code || "", date: value("inspection-date"), executingCompany: finding.executingCompany, building: finding.building, floor: finding.floor, activitySuspended: finding.activitySuspended }, photos };
        const revision = card.findingData.visionRevision || 0;
        const result = await VisionAPI.analyze(payload, controller.signal);
        if (controller.signal.aborted) throw new Error("Analisi annullata. Foto e testi sono conservati.");
        validateVisionResult(result, photos.map(photo => photo.id));
        if (revision !== (card.findingData.visionRevision || 0)) throw new Error("Contesto modificato durante l'analisi. Riprova.");
        const previous = card.findingData.visionReview;
        const previousApprovals = previous?.history || [];
        if (previous?.approvedAt) previousApprovals.push({ approvedAt: previous.approvedAt, approvedBy: previous.approvedBy, approvedProposal: previous.approvedProposal, requestId: previous.result.meta.requestId });
        card.findingData.visionReview = { revision, result, history: previousApprovals.slice(-10), proposalOpened: false };
        card.querySelector("[data-vision-approval]").checked = false;
        state.inspectionDirty = true;
        visionStatus(card, "Analisi pronta. Nessun testo del report è stato sostituito.");
    } catch (error) { visionStatus(card, error.message, true); }
    finally { setInspectionBusy(false); cancel.hidden = true; renderVisionCard(card); syncGenerationState(); }
}

function readVisionProposal(card) {
    return Object.fromEntries([...card.querySelectorAll("[data-proposal]")].map(input => [input.dataset.proposal, input.value.trim()]));
}

function approveVisionProposal(card) {
    const review = card.findingData.visionReview;
    if (!review || review.revision !== (card.findingData.visionRevision || 0)) return visionStatus(card, "Aggiorna l'analisi prima di confermare.", true);
    if (!value("inspection-technician")) return visionStatus(card, "Indica il tecnico del sopralluogo prima di confermare la proposta.", true);
    if (!card.querySelector("[data-vision-approval]").checked) return visionStatus(card, "Conferma di aver revisionato i contenuti.", true);
    const proposal = readVisionProposal(card);
    if (Object.values(proposal).some(text => !text)) return visionStatus(card, "Completa tutte e tre le sezioni della proposta.", true);
    for (const [key, field] of Object.entries({ descrizione: "activityDescription", misure: "safetyMeasures", correttive: "correctiveMeasures" })) card.querySelector(`[data-field='${field}']`).value = proposal[key];
    card.dataset.generatedFrom = readFindingCard(card).observation;
    review.editedProposal = proposal; review.approvedProposal = structuredClone(proposal); review.proposalDirty = false; review.approvedAt = new Date().toISOString(); review.approvedBy = value("inspection-technician");
    state.inspectionDirty = true;
    renderVisionCard(card); syncGenerationState();
    visionStatus(card, "Testi confermati nel rilievo. Salva il sopralluogo per archiviarli.");
}
