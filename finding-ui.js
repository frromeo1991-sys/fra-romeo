const FINDING_LABELS = { executingCompany: "Impresa esecutrice", building: "Fabbricato", floor: "Piano" };

function bindFindingMetadata(card) {
    card.querySelectorAll("[data-picker]").forEach(button => {
        const field = card.querySelector(`[data-field='${button.dataset.picker}']`);
        if (field.value) button.textContent = field.value;
        button.addEventListener("click", () => openValuePicker(card, button.dataset.picker));
    });
    card.querySelectorAll("[data-suspended]").forEach(input => {
        input.name = `${card.dataset.id}-suspended`;
        input.checked = input.value === (card.findingData.activitySuspended || "NO");
    });
    card.querySelector("[data-photo-upload]").addEventListener("change", event => {
        card.findingData.photos ||= [];
        for (const file of event.target.files) {
            if (file.type.startsWith("image/")) card.findingData.photos.push(file);
            else setInspectionStatus("Seleziona soltanto file immagine.", true);
        }
        event.target.value = "";
        delete card.findingData.visionSelected;
        state.inspectionDirty = true;
        invalidateVision(card);
        renderFindingPhotos(card);
    });
    renderFindingPhotos(card);
}

function renderFindingPhotos(card) {
    const gallery = card.querySelector("[data-finding-photos]");
    const photos = card.findingData.photos || [];
    gallery.innerHTML = photos.map((_, index) => `<div class="legacy-photo"><img data-media-pending alt="Foto ${index + 1} del rilievo"><button type="button" class="btn-secondary" data-remove-finding-photo="${index}">Rimuovi foto ${index + 1}</button></div>`).join("");
    gallery.querySelectorAll("img").forEach((image, index) => image.mediaValue = photos[index]);
    CSEMedia.bindImages(gallery);
    gallery.querySelectorAll("[data-remove-finding-photo]").forEach(button => button.addEventListener("click", () => {
        const [removed] = photos.splice(Number(button.dataset.removeFindingPhoto), 1);
        delete card.findingData.visionSelected;
        releaseUnusedFindingPhoto(removed);
        state.inspectionDirty = true;
        invalidateVision(card);
        renderFindingPhotos(card);
    }));
}

function releaseUnusedFindingPhoto(photo) {
    if (![...els.findingsList.children].some(card => card.findingData.photos?.includes(photo))) CSEMedia.releaseTemporary(photo);
}

function renderUnassignedPhotos() {
    const section = document.getElementById("unassigned-photos");
    section.hidden = !state.retainedPhotos.length;
    const gallery = document.getElementById("unassigned-photo-list");
    gallery.innerHTML = state.retainedPhotos.map((src, index) => `<div class="legacy-photo"><img data-media-source="${escapeHtml(src)}" alt="Foto precedente ${index + 1}"><button type="button" class="btn-secondary" data-assign-photo="${index}">Assegna a rilievo</button></div>`).join("");
    CSEMedia.bindImages(gallery);
    gallery.querySelectorAll("[data-assign-photo]").forEach(button => button.addEventListener("click", () => {
        const dialog = document.getElementById("value-dialog");
        prepareValueDialog("Assegna foto a rilievo");
        document.getElementById("btn-add-value").hidden = true;
        [...els.findingsList.children].forEach((card, index) => {
            appendValueOption(`Rilievo ${String(index + 1).padStart(2, "0")} - ${card.querySelector("[data-field='building']").value || "Fabbricato non indicato"}`, () => {
                card.findingData.photos ||= [];
                card.findingData.photos.push(state.retainedPhotos.splice(Number(button.dataset.assignPhoto), 1)[0]);
                state.inspectionDirty = true;
                invalidateVision(card);
                renderFindingPhotos(card);
                renderUnassignedPhotos();
                dialog.close();
            });
        });
        dialog.showModal();
    }));
}

function prepareValueDialog(title) {
    const dialog = document.getElementById("value-dialog");
    document.getElementById("value-dialog-title").textContent = title;
    document.getElementById("value-options").replaceChildren();
    document.getElementById("new-value-form").hidden = true;
    document.getElementById("value-error").hidden = true;
    document.getElementById("new-value").value = "";
    document.getElementById("btn-add-value").hidden = false;
    dialog.querySelectorAll("[data-close-dialog]").forEach(button => button.onclick = () => dialog.close());
}

function appendValueOption(value, select) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn-secondary value-option";
    button.textContent = value;
    button.onclick = select;
    document.getElementById("value-options").append(button);
}

async function openValuePicker(card, key) {
    const dialog = document.getElementById("value-dialog");
    prepareValueDialog(FINDING_LABELS[key]);
    const select = text => {
        card.querySelector(`[data-field='${key}']`).value = text;
        card.querySelector(`[data-picker='${key}']`).textContent = text || `Seleziona ${FINDING_LABELS[key].toLowerCase()}`;
        state.inspectionDirty = true;
        invalidateVision(card);
        dialog.close();
    };
    const recent = [...els.findingsList.children].map(item => readFindingCard(item)[key]);
    for (const report of state.inspections) recent.push(...createReportModel(report).findings.map(finding => finding[key]));
    const defaults = key === "floor" ? ["Piano Terra", "Piano Primo", "Piano Secondo", "Copertura", "Interrato"]
        : state.sites.map(site => key === "building" ? site.name : site.contractor);
    let saved;
    try { saved = await CSEStorage.get("meta", `choices:${key}`); }
    catch (error) { setInspectionStatus(`Valori salvati non disponibili: ${error.message}`, true); return; }
    for (const text of [...new Set([...(saved?.values || []), ...recent, ...defaults].filter(Boolean))]) appendValueOption(text, () => select(text));
    appendValueOption("Non indicato", () => select(""));
    document.getElementById("btn-add-value").onclick = () => {
        document.getElementById("new-value-form").hidden = false;
        document.getElementById("new-value").focus();
    };
    document.getElementById("new-value-form").onsubmit = async event => {
        event.preventDefault();
        const input = document.getElementById("new-value");
        const text = input.value.trim();
        if (!text) { input.focus(); return; }
        const submit = event.submitter;
        submit.disabled = true;
        try {
            await CSEStorage.addChoice(key, text);
            select(text);
        } catch (error) {
            const status = document.getElementById("value-error");
            status.hidden = false;
            status.textContent = `Valore non salvato: ${error.message}. Riprova.`;
        } finally { submit.disabled = false; }
    };
    dialog.showModal();
}

function confirmReportDeletion(report) {
    const dialog = document.getElementById("delete-dialog");
    document.getElementById("delete-dialog-message").textContent = `Eliminare definitivamente il Report ${String(report.reportNumber).padStart(3, "0")} del ${formatDate(report.date)}?`;
    dialog.returnValue = "cancel";
    return new Promise(resolve => {
        dialog.addEventListener("close", () => resolve(dialog.returnValue === "delete"), { once: true });
        dialog.showModal();
        dialog.querySelector("[value='cancel']").focus();
    });
}
