// Public configuration only. API credentials belong exclusively to the Worker.
const RDS_CONFIG = Object.freeze({
    appName: "RDS_pro",
    databaseName: "RDSProArchive",
    activeSiteKey: "rdsProActiveSiteV1",
    // Phase 1 preserves the existing text service; image analysis gets a separate Worker.
    textAIEndpoint: "https://romeo.fra-1991xy.workers.dev",
    visionEndpoint: "",
    maxAnalysisPhotos: 6
});
