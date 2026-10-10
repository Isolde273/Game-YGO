// Explicitly synthetic quotes for transaction verification. Never write to production assets.
export async function installPriceFixtures(page, entries) {
  await page.evaluate(async (entries) => {
    const { jihuanshePrices } = await import(
      new URL('./src/generated/jihuanshe-prices.js', location.href).href
    );
    jihuanshePrices.entries = Object.fromEntries(
      Object.entries(entries).map(([id, price]) => [id, { price, sourceUrl: 'test-fixture' }]),
    );
    jihuanshePrices.excludedPrintIds = [];
  }, entries);
}
