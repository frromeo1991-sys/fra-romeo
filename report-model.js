function createReportModel(inspection) {
    const model = JSON.parse(JSON.stringify(inspection));
    model.general ||= {};
    model.siteSnapshot ||= {};
    const site = model.siteSnapshot;
    site.cseName = site.cseName ?? (typeof site.cse === "string" ? site.cse : "");
    site.responsibleForWorks = site.responsibleForWorks ?? site.responsabileLavori ?? model.general.respLavori ?? "";
    model.completionStatus ||= "COMPLETATO";
    const reportPhotos = (model.photos || []).filter(Boolean);
    // With multiple old findings, ownership cannot be reconstructed from report-level photos.
    model.unassignedPhotos = model.findings?.length === 1 ? [] : reportPhotos;
    model.findings = (model.findings || []).map((finding, index) => {
        const legacy = model.legacyFindingLayout || !Array.isArray(model.photos);
        const photos = [...(finding.photos || []), ...(model.findings.length === 1 ? reportPhotos : [])].filter(Boolean);
        const photoGroups = [];
        for (let i = 0; i < photos.length; i += 2) photoGroups.push(photos.slice(i, i + 2));
        return {
            ...finding,
            number: finding.number || index + 1,
            executingCompany: finding.executingCompany ?? (finding.company || model.general.esecutrice || ""),
            building: finding.building ?? model.general.fabbricato ?? "",
            floor: finding.floor ?? model.general.piano ?? "",
            activitySuspended: finding.activitySuspended ?? model.general.sospensioneLavori ?? "NO",
            photos,
            pdfDescription: legacy
                ? [...new Set([finding.activityDescription, finding.observation].filter(Boolean))].join("\n\n")
                : finding.activityDescription || "",
            pdfPhotoGroups: photoGroups,
            showPhotoFrame: legacy || photos.length > 0
        };
    });
    return model;
}
