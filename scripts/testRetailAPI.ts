async function testRetail() {
    const sku = "D2as v4"; // Formatted for Retail API
    const location = "westus2";

    const filter1 = `serviceName eq 'Virtual Machines' and armRegionName eq '${location}' and skuName eq '${sku}' and priceType eq 'Consumption'`;
    let res1 = await fetch(`https://prices.azure.com/api/retail/prices?$filter=${encodeURIComponent(filter1)}`);
    const data1 = await res1.json();
    console.log("Consumption:", data1.Items.length > 0 ? data1.Items[0] : "Not found");

    const filter2 = `serviceName eq 'Virtual Machines' and armRegionName eq '${location}' and skuName eq '${sku}' and priceType eq 'Reservation' and reservationTerm eq '1 Year'`;
    let res2 = await fetch(`https://prices.azure.com/api/retail/prices?$filter=${encodeURIComponent(filter2)}`);
    const data2 = await res2.json();
    console.log("Reservation 1Y:", data2.Items.length > 0 ? data2.Items[0] : "Not found");
}
testRetail();
