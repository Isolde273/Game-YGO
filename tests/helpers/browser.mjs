// Use a local browser by default; override these for another machine or CI.
export async function dragAlbumCard(page, source, destination) {
  const card = page.locator(source).first();
  const target = page.locator(destination).first();
  await card.scrollIntoViewIfNeeded();
  const from = await card.boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 10, from.y + from.height / 2);
  await target.scrollIntoViewIfNeeded();
  const to = await target.boundingBox();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();
}

export async function closePurchase(page) {
  if (!(await page.locator('.purchase-overlay').count())) return;
  await page.locator('.purchase-overlay[data-phase="open"]').waitFor();
  await page.locator('.phone-home-button').click();
  await page.waitForFunction(
    () => !document.querySelector('#phone-content')?.dataset.localTransition,
  );
  await page.locator('[data-action="phone-close"]').click();
  await page.locator('.purchase-overlay').waitFor({ state: 'detached' });
}
export async function navigatePage(page, target) {
  await page.waitForFunction(() => !document.body.dataset.settingsTransition);
  await closePurchase(page);
  if (target !== 'settings' && (await page.locator('.settings-page').count())) {
    await page.locator('.settings-menu [data-action="home"]').click();
    await page.waitForFunction(() => !document.body.classList.contains('navigating'));
    if (target === 'home') return;
  }
  if (target === 'home') {
    const home = page.locator('.rail-home,.space-return,.brand').first();
    await home.click();
  } else if (await page.locator(`.tile-${target}`).count()) {
    await page.locator(`.tile-${target}`).click();
  } else {
    await page.locator(`#app .mini-nav [data-page="${target}"]`).click();
  }
  await page.waitForFunction(
    () =>
      !document.body.classList.contains('navigating') &&
      (!document.querySelector('.purchase-overlay') ||
        document.querySelector('.purchase-overlay').dataset.phase === 'open'),
  );
}
export async function openPhoneApp(page, app) {
  await page.locator('.phone-home-button').click();
  await page.waitForFunction(
    () => !document.querySelector('#phone-content')?.dataset.localTransition,
  );
  await page.locator(`.phone-apps [data-app="${app}"]`).click();
  await page.waitForFunction(
    () => !document.querySelector('#phone-content')?.dataset.localTransition,
  );
}
export const browserOptions = process.env.YGO_BROWSER_PATH
  ? { executablePath: process.env.YGO_BROWSER_PATH }
  : { channel: process.env.YGO_BROWSER_CHANNEL || 'msedge' };
