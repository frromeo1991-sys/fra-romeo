const CSEMedia = (() => {
    const sources = new Map();
    let blobSources = new WeakMap();
    const temporaryUrls = new Set();
    const optimized = new WeakMap();

    async function source(value) {
        if (value instanceof Blob) {
            if (!blobSources.has(value)) {
                const url = URL.createObjectURL(value);
                blobSources.set(value, url);
                temporaryUrls.add(url);
            }
            return blobSources.get(value);
        }
        if (!value || !String(value).startsWith("media:")) return value || "";
        if (!sources.has(value)) sources.set(value, (async () => {
            const record = await CSEStorage.get("media", value.slice(6));
            if (!(record?.blob instanceof Blob)) throw new Error("Fotografia non disponibile nell'archivio.");
            return URL.createObjectURL(record.blob);
        })());
        try { return await sources.get(value); }
        catch (error) { sources.delete(value); throw error; }
    }

    async function bindImages(container) {
        await Promise.all([...container.querySelectorAll("img[data-media-source], img[data-media-pending]")].map(async image => {
            const value = image.mediaValue ?? image.dataset.mediaSource;
            try {
                const url = await source(value);
                if (image.isConnected && (image.mediaValue ?? image.dataset.mediaSource) === value) image.src = url;
            } catch {
                image.alt = "Foto non disponibile";
                image.dataset.mediaError = "true";
            }
        }));
    }

    async function pdfSource(value) {
        if (!String(value).startsWith("media:")) return value;
        const record = await CSEStorage.get("media", value.slice(6));
        if (!(record?.blob instanceof Blob)) throw new Error("Fotografia del report non disponibile nell'archivio.");
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(record.blob);
        });
    }

    function releaseTemporary(value) {
        if (!(value instanceof Blob) || !blobSources.has(value)) return;
        const url = blobSources.get(value);
        URL.revokeObjectURL(url);
        temporaryUrls.delete(url);
        blobSources.delete(value);
    }

    async function decode(file) {
        if (typeof createImageBitmap === "function") {
            try { return await createImageBitmap(file, { imageOrientation: "from-image" }); }
            catch { /* Use browser image decoding where ImageBitmap is unavailable for the format. */ }
        }
        const url = URL.createObjectURL(file);
        try {
            const image = new Image();
            await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = url; });
            return image;
        } finally { URL.revokeObjectURL(url); }
    }

    async function compress(file, maxDim = 1600, quality = 0.82, preserveAlpha = false) {
        const settings = `${maxDim}:${quality}:${preserveAlpha}`;
        if (optimized.get(file) === settings) return file;
        if (!file.type.startsWith("image/")) throw new Error("Seleziona una fotografia JPG, PNG o un formato immagine supportato dal browser.");
        let image;
        try { image = await decode(file); }
        catch { throw new Error("Fotografia non leggibile. Prova a esportarla come JPG o PNG."); }
        try {
            const scale = Math.min(1, maxDim / Math.max(image.width, image.height));
            const canvas = document.createElement("canvas");
            canvas.width = Math.max(1, Math.round(image.width * scale));
            canvas.height = Math.max(1, Math.round(image.height * scale));
            const ctx = canvas.getContext("2d");
            if (!preserveAlpha) { ctx.fillStyle = "white"; ctx.fillRect(0, 0, canvas.width, canvas.height); }
            ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
            const type = preserveAlpha ? "image/png" : "image/jpeg";
            const encode = q => new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Compressione fotografia non riuscita.")), type, q));
            let blob = await encode(quality);
            while (!preserveAlpha && blob.size > 700 * 1024 && quality > 0.62) {
                quality = Math.max(0.62, quality - 0.06);
                blob = await encode(quality);
            }
            while (!preserveAlpha && blob.size > 700 * 1024 && Math.max(canvas.width, canvas.height) > 1000) {
                canvas.width = Math.round(canvas.width * 0.85);
                canvas.height = Math.round(canvas.height * 0.85);
                ctx.fillStyle = "white";
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
                blob = await encode(0.74);
            }
            optimized.set(blob, settings);
            return blob;
        } finally { image.close?.(); }
    }

    window.addEventListener("pagehide", () => {
        for (const promise of sources.values()) promise.then(url => URL.revokeObjectURL(url)).catch(() => {});
        sources.clear();
        for (const url of temporaryUrls) URL.revokeObjectURL(url);
        temporaryUrls.clear();
        blobSources = new WeakMap();
    });
    return { source, bindImages, compress, pdfSource, releaseTemporary };
})();
