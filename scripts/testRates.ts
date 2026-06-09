import { getAzureCredential } from "../src/lib/azure";
import { getReservationRecommendations } from "../src/services/rateService";

async function main() {
    const tenantId = process.env.TEST_TENANT_ID || "54d7cf18-0baa-4da7-8242-fbf59a92aaac";
    const subId = process.env.TEST_SUB_ID || "292fdd9f-2ff3-465b-9091-d554c1af4456";
    try {
        const credential = await getAzureCredential(tenantId);
        const recs = await getReservationRecommendations(credential, subId, "Single", "Last30Days");
        const rec = recs[0];
        console.log("Keys of rec:", Object.keys(rec));
        console.log("All properties of rec:", rec);
    } catch(e) {
        console.error(e);
    }
}
main();
