import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { browserOptions, closePurchase } from './helpers/browser.mjs';

const output = 'test-results/persona-motion';
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ ...browserOptions, headless: true });
const report = { errors: [], tracks: {} };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (e) => report.errors.push(e.message));
  await page.goto('http://127.0.0.1:5173');
  await page.waitForFunction(
    () => !document.getAnimations().some((a) => a.effect?.target?.closest?.('#app')),
  );
  async function sample(selector, times, name) {
    await page.waitForFunction(
      (selector) => document.getAnimations().some((a) => a.effect?.target?.matches?.(selector)),
      selector,
    );
    await page.evaluate((selector) => {
      window.poseTrack = document
        .getAnimations()
        .find((a) => a.effect?.target?.matches?.(selector));
      window.poseTrack.pause();
      window.poseExtras = document
        .getAnimations()
        .filter((a) => a !== window.poseTrack && a.effect?.target?.closest?.('.settings-persona'));
      window.poseExtras.forEach((a) => a.pause());
      if (selector === '.settings-card-display') {
        document
          .getAnimations()
          .filter((a) => a.effect?.target?.closest?.('#page-transition'))
          .forEach((a) => a.finish());
      }
    }, selector);
    const probe =
      selector === '.settings-card-display'
        ? await page.locator('.settings-persona').evaluate((root) => {
            const card = root.querySelector('.settings-card-display');
            const rect = root.getBoundingClientRect();
            return {
              left: Math.round(rect.x + card.offsetLeft + card.offsetWidth / 2),
              top: Math.round(rect.y + 24),
              width: 2,
              height: 2,
            };
          })
        : null;
    const poses = [],
      shots = [];
    for (const ms of times) {
      await page.evaluate((ms) => {
        window.poseTrack.currentTime = ms;
        window.poseExtras.forEach((a) => (a.currentTime = ms));
      }, ms);
      const box = await page.locator(selector).boundingBox();
      const sweep = (await page.locator('.settings-card-sweep').count())
        ? await page.locator('.settings-card-sweep').evaluate((el) => ({
            opacity: getComputedStyle(el).opacity,
            clip: getComputedStyle(el).clipPath,
          }))
        : null;
      const screenshot = await page.screenshot();
      const passingColor = probe
        ? [...(await sharp(screenshot).extract(probe).removeAlpha().raw().toBuffer())]
        : null;
      const arcError = (await page.locator('.settings-persona.is-system').count())
        ? await page.locator('.settings-persona.is-system').evaluate((root) => {
            const a = root.querySelector('.settings-circle').getBoundingClientRect();
            const b = root.querySelector('.settings-scene').getBoundingClientRect();
            return Math.max(
              ...['x', 'y', 'width', 'height'].map((key) => Math.abs(a[key] - b[key])),
            );
          })
        : null;
      const orbit = (await page.locator('.settings-persona.is-system').count())
        ? await page.locator('.settings-system-orbit').evaluate((group) => {
            const word = group.querySelector('text');
            const point = word.getStartPositionOfChar(0).matrixTransform(group.getScreenCTM());
            const ellipse = group.closest('.settings-circle').getBoundingClientRect();
            const x = (point.x - ellipse.x - ellipse.width / 2) / (ellipse.width / 2);
            const y = (point.y - ellipse.y - ellipse.height / 2) / (ellipse.height / 2);
            return { angle: Math.atan2(y, x), radius: Math.hypot(x, y) };
          })
        : null;
      let withoutSweep = null;
      if (probe && ms === 360) {
        await page.evaluate(() => {
          window.sweepTrack = window.poseExtras.find((a) =>
            a.effect.target.matches('.settings-card-sweep'),
          );
          window.sweepTrack.currentTime = 0;
        });
        withoutSweep = [
          ...(await sharp(await page.screenshot())
            .extract(probe)
            .removeAlpha()
            .raw()
            .toBuffer()),
        ];
        await page.evaluate((ms) => (window.sweepTrack.currentTime = ms), ms);
      }
      poses.push({ ms, ...box, sweep, passingColor, withoutSweep, arcError, orbit });
      shots.push(
        await sharp(screenshot)
          .resize(384, 240, { fit: 'contain', background: '#06174e' })
          .toBuffer(),
      );
    }
    await sharp({ create: { width: 1152, height: 480, channels: 3, background: '#06174e' } })
      .composite(
        shots.map((input, i) => ({ input, left: (i % 3) * 384, top: Math.floor(i / 3) * 240 })),
      )
      .jpeg({ quality: 89 })
      .toFile(`${output}/${name}.jpg`);
    await page.evaluate(() => {
      window.poseTrack.finish();
      window.poseExtras.forEach((a) => a.finish());
    });
    return poses;
  }
  await page.locator('.tile-shop').click();
  report.tracks.phone = await sample('.phone-wrap', [0, 110, 220, 330, 440, 559], 'phone-pickup');
  assert.ok(report.tracks.phone[0].x > 1440, 'Phone begins beyond the right edge');
  assert.ok(
    report.tracks.phone.at(-1).x < 1100 && report.tracks.phone.at(-1).x > 700,
    'Phone settles over the right side of the original page',
  );
  await page.locator('.purchase-overlay[data-phase="open"]').waitFor();
  await closePurchase(page);
  await page.evaluate(() => {
    window.settingsMaxCards = 0;
    window.settingsCardObserver = new MutationObserver(() => {
      window.settingsMaxCards = Math.max(
        window.settingsMaxCards,
        document.querySelectorAll('.settings-feature-card').length,
      );
    });
    window.settingsCardObserver.observe(document.body, { subtree: true, childList: true });
  });
  await page.locator('.tile-settings').click();
  report.tracks.systemCard = await sample(
    '.settings-card-display',
    [0, 180, 360, 540, 720, 899],
    'settings-card-descent',
  );
  assert.ok(
    report.tracks.systemCard.at(-1).y - report.tracks.systemCard[0].y > 200,
    'SYSTEM card visibly descends',
  );
  assert.ok(
    report.tracks.systemCard[0].y + report.tracks.systemCard[0].height < 0,
    'Card starts above the viewport',
  );
  assert.ok(Number(report.tracks.systemCard[2].sweep.opacity) > 0.5);
  assert.notEqual(report.tracks.systemCard[0].sweep.clip, report.tracks.systemCard[2].sweep.clip);
  assert.notDeepEqual(
    report.tracks.systemCard[0].passingColor,
    report.tracks.systemCard[2].passingColor,
    'The swept background changes color in the rendered frame',
  );
  assert.notDeepEqual(
    report.tracks.systemCard[2].passingColor,
    report.tracks.systemCard[2].withoutSweep,
    'The sweep changes pixels independently of the circle motion',
  );
  assert.ok(
    report.tracks.systemCard.every((p) => p.arcError < 0.1),
    'SYSTEM follows the same ellipse throughout the transition',
  );
  assert.ok(
    report.tracks.systemCard.every((p) => Math.abs(p.orbit.radius - 1) < 0.06),
    'SYSTEM stays on the ellipse while moving',
  );
  assert.ok(
    Math.abs(
      report.tracks.systemCard[0].orbit.angle - report.tracks.systemCard.at(-1).orbit.angle,
    ) > 0.8,
    'SYSTEM travels around the ellipse instead of only fading in',
  );
  await page.waitForFunction(() => !document.body.classList.contains('navigating'));
  const finalCard = await page.locator('.settings-card-display').boundingBox();
  assert.ok(
    Math.abs(finalCard.y - report.tracks.systemCard.at(-1).y) < 2,
    'The falling card settles without a handoff jump',
  );
  assert.equal(
    await page.evaluate(() => {
      window.settingsCardObserver.disconnect();
      return window.settingsMaxCards;
    }),
    1,
    'Only the page card appears during entry',
  );
  async function sectionMotion(section, name) {
    const returning = section === '';
    if (!returning) {
      await page.locator(`#app [data-section="${section}"]`).hover();
      await page.waitForTimeout(180);
    }
    const source = await page.locator('#app .settings-card-display').boundingBox();
    if (returning) await page.keyboard.press('Escape');
    else await page.locator(`#app [data-section="${section}"]`).click();
    await page.locator('.settings-section-transition[data-phase="moving"]').waitFor();
    const target = await page
      .locator('.settings-section-reveal .settings-card-display')
      .boundingBox();
    const setPhaseTracks = () =>
      page.evaluate(() => {
        const moving =
          document.querySelector('.settings-section-transition').dataset.phase === 'moving';
        window.sectionTracks = document
          .getAnimations()
          .filter((a) =>
            a.effect?.target?.closest?.(
              moving
                ? '.settings-section-transition,#app .settings-persona'
                : '.settings-section-transition',
            ),
          );
        window.sectionTracks.forEach((a) => {
          a.pause();
          a.currentTime = 0;
        });
      });
    await setPhaseTracks();
    const frames = [],
      flightPoses = [];
    for (const ms of [0, 128, 256, 384, 512, 639]) {
      await page.evaluate(
        (ms) =>
          window.sectionTracks.forEach((a) => {
            a.currentTime = ms;
          }),
        ms,
      );
      const box = await page.locator('.settings-section-flight').boundingBox();
      const angle = await page
        .locator(returning ? '#app .settings-config-orbit' : '#app .settings-system-orbit')
        .evaluate((el) => {
          const matrix = new DOMMatrix(getComputedStyle(el).transform);
          return Math.atan2(matrix.b, matrix.a);
        });
      flightPoses.push({ ms, ...box, angle });
      frames.push(
        await sharp(await page.screenshot())
          .resize(384, 240, { fit: 'contain', background: '#06174e' })
          .toBuffer(),
      );
      const trail = await page.locator('#app .settings-card-sweep').evaluate((el) => ({
        opacity: Number(getComputedStyle(el).opacity),
        animations: el.getAnimations().length,
      }));
      assert.deepEqual(
        trail,
        { opacity: 0, animations: 0 },
        'Settings section card movement leaves no trail',
      );
    }
    assert.ok(
      Math.hypot(
        flightPoses[0].x + flightPoses[0].width / 2 - source.x - source.width / 2,
        flightPoses[0].y + flightPoses[0].height / 2 - source.y - source.height / 2,
      ) < 1,
      'Card starts at its actual displayed position',
    );
    assert.ok(
      Math.abs(flightPoses[0].width - source.width) < 1 &&
        Math.abs(flightPoses[0].height - source.height) < 1,
      'The card keeps its displayed size at departure',
    );
    assert.ok(
      flightPoses.some(
        (p) =>
          p.ms > 0 && p.ms < 512 && Math.abs(p.x - source.x) > 5 && Math.abs(p.x - target.x) > 5,
      ),
      'The card is rendered between source and destination',
    );
    assert.ok(
      flightPoses.every((p) => p.y >= 0),
      'Card never falls from above the viewport',
    );
    assert.ok(
      returning ? flightPoses.at(-1).angle < -1.4 : flightPoses.at(-1).angle > 1.4,
      'SYSTEM exits in the requested arc direction',
    );
    const before = flightPoses.at(-1);
    assert.ok(
      Math.hypot(
        before.x + before.width / 2 - target.x - target.width / 2,
        before.y + before.height / 2 - target.y - target.height / 2,
      ) < 2,
      'Card lands at the section card position',
    );
    await sharp({ create: { width: 1152, height: 480, channels: 3, background: '#06174e' } })
      .composite(
        frames.map((input, i) => ({ input, left: (i % 3) * 384, top: Math.floor(i / 3) * 240 })),
      )
      .jpeg({ quality: 89 })
      .toFile(`${output}/${name}-flight.jpg`);
    await page.evaluate(() => window.sectionTracks.forEach((a) => a.finish()));
    await page.locator('.settings-section-transition[data-phase="revealing"]').waitFor();
    await setPhaseTracks();
    const revealFrames = [],
      arcPoses = [];
    const centerError = await page.locator('.settings-section-reveal').evaluate((el) => {
      const track = el.getAnimations()[0];
      const start = track.effect.getKeyframes()[0].clipPath;
      const center = start.match(/at ([\d.]+)px ([\d.]+)px/);
      const card = el.querySelector('.settings-card-display').getBoundingClientRect();
      window.preparedSection = el.querySelector('.settings-page');
      return Math.hypot(
        Number(center[1]) - card.x - card.width / 2,
        Number(center[2]) - card.y - card.height / 2,
      );
    });
    assert.ok(centerError < 0.1, 'The reveal circle begins at the landed card center');
    for (const ms of [0, 150, 300, 450, 600, 759]) {
      const pose = await page.evaluate(
        ({ ms, returning }) => {
          window.sectionTracks.forEach((a) => {
            a.currentTime = ms;
          });
          const word = document.querySelector(
            returning
              ? '.settings-section-reveal .settings-system-word'
              : '.settings-section-reveal .settings-config-word',
          );
          const orbit = word.querySelector(
            returning ? '.settings-system-orbit' : '.settings-config-orbit',
          );
          const matrix = new DOMMatrix(getComputedStyle(orbit).transform);
          const point = orbit
            .querySelector('text')
            .getStartPositionOfChar(0)
            .matrixTransform(orbit.getScreenCTM());
          const rect = (
            returning ? word.closest('.settings-circle') : word
          ).getBoundingClientRect();
          return {
            ms,
            angle: Math.atan2(matrix.b, matrix.a),
            radius: Math.hypot(
              (point.x - rect.x - rect.width / 2) / (rect.width / 2),
              (point.y - rect.y - rect.height / 2) / (rect.height / 2),
            ),
          };
        },
        { ms, returning },
      );
      arcPoses.push(pose);
      revealFrames.push(
        await sharp(await page.screenshot())
          .resize(384, 240, { fit: 'contain', background: '#06174e' })
          .toBuffer(),
      );
    }
    assert.ok(
      arcPoses[0].angle > 1.2 && Math.abs(arcPoses.at(-1).angle) < 0.01,
      'Section SYSTEM moves upward around the circle',
    );
    await sharp({ create: { width: 1152, height: 480, channels: 3, background: '#06174e' } })
      .composite(
        revealFrames.map((input, i) => ({
          input,
          left: (i % 3) * 384,
          top: Math.floor(i / 3) * 240,
        })),
      )
      .jpeg({ quality: 89 })
      .toFile(`${output}/${name}-reveal.jpg`);
    assert.ok(
      arcPoses.every((p) =>
        returning ? Math.abs(p.radius - 1) < 0.06 : p.radius >= 1 && p.radius < 1.08,
      ),
      'Section SYSTEM hugs the outside of the ring',
    );
    await page.evaluate(() => window.sectionTracks.forEach((a) => a.finish()));
    await page.waitForFunction(() => !document.body.dataset.settingsTransition);
    assert.ok(
      await page.evaluate(
        () => window.preparedSection === document.querySelector('#app>.settings-page'),
      ),
    );
    assert.deepEqual(await page.locator('#app .settings-card-display').boundingBox(), target);
    report.tracks[name] = { flightPoses, arcPoses };
  }
  async function secondaryMotion(section, name, direction) {
    await page.mouse.move(1, 1);
    const sourceCard = await page.locator('#app .settings-card-display').boundingBox();
    const sourceMenu = await page.locator('#app .settings-menu').boundingBox();
    const sourceContent = await page.locator('#app .settings-content').boundingBox();
    const sourceRing = await page.locator('#app .settings-circle').boundingBox();
    await page.locator(`#app [data-section="${section}"]`).click();
    await page.locator('.settings-section-transition[data-kind="switch"]').waitFor();
    assert.equal(
      await page.locator('.settings-section-flight').count(),
      0,
      'Secondary switching keeps the original card',
    );
    assert.equal(
      await page.locator('.settings-section-transition').getAttribute('data-direction'),
      direction === 1 ? 'left' : 'right',
    );
    await page.evaluate(() => {
      window.sectionTracks = document
        .getAnimations()
        .filter((a) =>
          a.effect?.target?.closest?.('.settings-section-transition,#app .settings-persona'),
        );
      window.sectionTracks.forEach((a) => {
        a.pause();
        a.currentTime = 0;
      });
      window.preparedSection = document.querySelector('.settings-secondary-next>.settings-page');
    });
    const frames = [],
      poses = [];
    let previousAngle = 0,
      traveled = 0;
    for (const ms of [0, 220, 440, 660, 880, 1099]) {
      await page.evaluate(
        (ms) =>
          window.sectionTracks.forEach((a) => {
            a.currentTime = ms;
          }),
        ms,
      );
      const pose = await page.evaluate(() => {
        const rect = (selector) =>
          document.querySelector(selector).getBoundingClientRect().toJSON();
        const group = document.querySelector('#app .settings-config-orbit');
        const matrix = new DOMMatrix(getComputedStyle(group).transform);
        const point = group
          .querySelector('text')
          .getStartPositionOfChar(0)
          .matrixTransform(group.getScreenCTM());
        const ring = rect('#app .settings-config-word');
        return {
          angle: Math.atan2(matrix.b, matrix.a),
          radius: Math.hypot(
            (point.x - ring.x - ring.width / 2) / (ring.width / 2),
            (point.y - ring.y - ring.height / 2) / (ring.height / 2),
          ),
          card: rect('#app .settings-card-display'),
          ring: rect('#app .settings-circle'),
          previewRingVisibility: getComputedStyle(
            document.querySelector('.settings-secondary-next .settings-circle'),
          ).visibility,
          menu: rect('#app .settings-menu'),
          content: rect('#app .settings-content'),
          nextMenu: rect('.settings-secondary-next .settings-menu'),
          nextContent: rect('.settings-secondary-next .settings-content'),
        };
      });
      let delta = pose.angle - previousAngle;
      if (delta < -Math.PI) delta += Math.PI * 2;
      traveled += delta;
      previousAngle = pose.angle;
      pose.ms = ms;
      pose.traveled = traveled;
      poses.push(pose);
      for (const key of ['x', 'y', 'width', 'height'])
        assert.ok(
          Math.abs(pose.card[key] - sourceCard[key]) < 0.1,
          'The secondary card stays still throughout switching',
        );
      for (const key of ['x', 'y', 'width', 'height'])
        assert.ok(
          Math.abs(pose.ring[key] - sourceRing[key]) < 0.1,
          'The background ring stays still throughout switching',
        );
      assert.equal(pose.previewRingVisibility, 'hidden');
      if (ms === 440)
        await sharp(await page.screenshot())
          .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 88 })
          .toFile(`${output}/${name}-middle.jpg`);
      frames.push(
        await sharp(await page.screenshot())
          .resize(384, 240, { fit: 'contain', background: '#06174e' })
          .toBuffer(),
      );
    }
    assert.ok(Math.abs(traveled - Math.PI * 2) < 0.01, 'SYSTEM completes a full orbit');
    assert.ok(
      poses.every((p) => p.radius >= 1 && p.radius < 1.08),
      'SYSTEM stays outside the ring throughout its orbit',
    );
    assert.ok(
      direction * (sourceMenu.x - poses[1].menu.x) > 100 &&
        direction * (sourceContent.x - poses[1].content.x) > 100,
      'Outgoing controls slide in the requested direction',
    );
    assert.ok(
      direction * (poses[0].nextMenu.x - poses.at(-1).nextMenu.x) > 100 &&
        direction * (poses[0].nextContent.x - poses.at(-1).nextContent.x) > 100,
      'Incoming controls follow the outgoing controls',
    );
    const colors = await page.locator('#app .settings-persona').evaluate((root) => ({
      ring: getComputedStyle(root.querySelector('.settings-circle')).borderTopColor,
      word: getComputedStyle(root.querySelector('.settings-config-word')).fill,
    }));
    assert.deepEqual(colors, { ring: 'rgb(244, 251, 255)', word: 'rgb(6, 27, 102)' });
    await sharp({ create: { width: 1152, height: 480, channels: 3, background: '#06174e' } })
      .composite(
        frames.map((input, i) => ({ input, left: (i % 3) * 384, top: Math.floor(i / 3) * 240 })),
      )
      .jpeg({ quality: 89 })
      .toFile(`${output}/${name}.jpg`);
    await page.evaluate(() => window.sectionTracks.forEach((a) => a.finish()));
    await page.waitForFunction(() => !document.body.dataset.settingsTransition);
    assert.ok(
      await page.evaluate(
        () => window.preparedSection === document.querySelector('#app>.settings-page'),
      ),
    );
    assert.deepEqual(await page.locator('#app .settings-card-display').boundingBox(), sourceCard);
    report.tracks[name] = poses;
  }
  await sectionMotion('settings-audio', 'config-card');
  await secondaryMotion('settings-save', 'config-to-save', 1);
  await secondaryMotion('settings-audio', 'save-to-config', -1);
  await sectionMotion('', 'config-return');
  await sectionMotion('settings-save', 'save-card');
  await sectionMotion('', 'save-return');
  await page.setViewportSize({ width: 390, height: 844 });
  await sectionMotion('settings-audio', 'config-card-narrow');
  await secondaryMotion('settings-save', 'config-to-save-narrow', 1);
  await secondaryMotion('settings-audio', 'save-to-config-narrow', -1);
  await sectionMotion('', 'config-return-narrow');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    await page.mouse.move(1, 1);
    await page.locator('.settings-menu [data-action="home"]').click();
    await page.waitForFunction(() =>
      document.getAnimations().some((a) => a.effect?.target?.matches?.('.home-route-reveal')),
    );
    const colorMatch = await page.evaluate(() => {
      window.homeTracks = document
        .getAnimations()
        .filter((a) => a.effect?.target?.closest?.('#page-transition,.settings-persona'));
      window.homeTracks.forEach((a) => {
        a.pause();
        a.currentTime = 0;
      });
      window.preparedHome = document.querySelector('.home-route-content>.home');
      window.preparedDisc = window.preparedHome
        .querySelector('.hero-disc')
        .getBoundingClientRect()
        .toJSON();
      return (
        getComputedStyle(document.querySelector('.home-route-color')).backgroundColor ===
        getComputedStyle(document.querySelector('.home-route-reveal .hero-disc')).backgroundColor
      );
    });
    assert.ok(colorMatch, 'The expanding circle uses the home disc color');
    assert.equal(await page.locator('.settings-route-wipe').count(), 0);
    const frames = [],
      poses = [];
    for (const ms of [0, 170, 310, 460, 630, 789]) {
      const pose = await page.evaluate((ms) => {
        window.homeTracks.forEach((a) => {
          a.currentTime = ms;
        });
        const group = document.querySelector('.settings-system-orbit');
        const matrix = new DOMMatrix(getComputedStyle(group).transform);
        const point = group
          .querySelector('text')
          .getStartPositionOfChar(0)
          .matrixTransform(group.getScreenCTM());
        const ellipse = group.closest('.settings-circle').getBoundingClientRect();
        const x = (point.x - ellipse.x - ellipse.width / 2) / (ellipse.width / 2);
        const y = (point.y - ellipse.y - ellipse.height / 2) / (ellipse.height / 2);
        return {
          ms,
          angle: Math.atan2(matrix.b, matrix.a),
          radius: Math.hypot(x, y),
          clip: getComputedStyle(document.querySelector('.home-route-reveal')).clipPath,
        };
      }, ms);
      poses.push(pose);
      frames.push(
        await sharp(await page.screenshot())
          .resize(384, 240, { fit: 'contain', background: '#06174e' })
          .toBuffer(),
      );
    }
    assert.ok(
      poses.every((p) => Math.abs(p.radius - 1) < 0.06),
      'Exit stays attached to the ellipse',
    );
    assert.ok(
      poses.at(-1).angle < -1.7 && poses[0].angle === 0,
      'Exit continues past the resting angle in the entry direction',
    );
    await sharp({ create: { width: 1152, height: 480, channels: 3, background: '#06174e' } })
      .composite(
        frames.map((input, i) => ({ input, left: (i % 3) * 384, top: Math.floor(i / 3) * 240 })),
      )
      .jpeg({ quality: 89 })
      .toFile(`${output}/settings-home-${width}.jpg`);
    await page.evaluate(() => window.homeTracks.forEach((a) => a.finish()));
    await page.waitForFunction(() => !document.body.classList.contains('navigating'));
    assert.ok(
      await page.evaluate(() => window.preparedHome === document.querySelector('#app>.home')),
    );
    assert.deepEqual(
      await page.locator('.hero-disc').evaluate((el) => el.getBoundingClientRect().toJSON()),
      await page.evaluate(() => window.preparedDisc),
    );
    report.tracks[`homeExit${width}`] = poses;
    if (width === 1440) {
      await page.locator('.tile-settings').click();
      await page.waitForFunction(() => !document.body.classList.contains('navigating'));
    }
  }
  assert.deepEqual(report.errors, []);
  report.passed = true;
  console.log(
    JSON.stringify({
      passed: true,
      checks: [
        'Phone enters from outside the right edge',
        'SYSTEM card slides downward',
        'Secondary settings cards move continuously from their actual position without a color trail',
        'CONFIG and DATA SAVE switch with a full SYSTEM orbit and directional sliding controls',
        'Section SYSTEM rises along the outside of the circle; the prepared section commits without a card jump',
        'Six real rendered poses sampled for each animation',
        'SYSTEM follows its ellipse during entry and return; one falling card settles without a handoff jump',
      ],
    }),
  );
} finally {
  await fs.writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
