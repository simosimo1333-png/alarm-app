import { chromium, devices } from 'playwright';
import fs from 'fs';

const SCRATCH = '/tmp/claude-0/-home-user-alarm-app/7a4abfc4-78e7-58ed-a646-22083753c0a0/scratchpad';
const BASE = 'http://127.0.0.1:8899';
const results = [];
const log = (s) => { console.log(s); results.push(s); };

function collectErrors(page, tag, store) {
  page.on('pageerror', e => store.push(`[${tag}] pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') store.push(`[${tag}] console.error: ${m.text()}`); });
  page.on('requestfailed', r => store.push(`[${tag}] requestfailed: ${r.url()} -> ${r.failure()?.errorText}`));
  page.on('response', r => { if (r.status() >= 400) store.push(`[${tag}] http${r.status()}: ${r.url()}`); });
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

// ---------- Test 1: index.html ----------
{
  const errs = [];
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  collectErrors(page, 'index', errs);
  const resp = await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(2000);
  log(`TEST1 index.html status=${resp.status()} title="${await page.title()}" errors=${errs.length}`);
  errs.forEach(e => log('  ' + e));
  log(`TEST1 ${resp.ok() && errs.length === 0 ? 'PASS' : 'FAIL'}`);
  await ctx.close();
}

// ---------- Test 2+3: mobile solo ----------
{
  const errs = [];
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true, hasTouch: true, deviceScaleFactor: 3,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const page = await ctx.newPage();
  collectErrors(page, 'mobile', errs);
  await page.goto(BASE + '/fallflat.html', { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  const panelVisible = await page.locator('#panel').isVisible();
  const soloVisible = await page.locator('#solo-btn').isVisible();
  log(`TEST2 mobile menu: panelVisible=${panelVisible} soloBtnVisible=${soloVisible} errors=${errs.length}`);
  errs.forEach(e => log('  ' + e));
  log(`TEST2 ${panelVisible && soloVisible && errs.length === 0 ? 'PASS' : 'FAIL'}`);

  // Test 3: tap solo
  const errCountBefore = errs.length;
  await page.tap('#solo-btn');
  await page.waitForTimeout(4000);
  const hudVisible = await page.locator('#hud').isVisible();
  const panelHidden = await page.locator('#panel').isHidden();
  const glInfo = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    if (!c) return { canvas: false };
    // three.js already owns the context; getContext with same type returns it
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    return { canvas: true, w: c.width, h: c.height, hasGL: !!gl, lost: gl ? gl.isContextLost() : null };
  });
  await page.screenshot({ path: SCRATCH + '/qa-solo.png' });
  const size = fs.statSync(SCRATCH + '/qa-solo.png').size;
  const newErrs = errs.slice(errCountBefore);
  log(`TEST3 solo: hudVisible=${hudVisible} panelHidden=${panelHidden} gl=${JSON.stringify(glInfo)} shotBytes=${size} newErrors=${newErrs.length}`);
  newErrs.forEach(e => log('  ' + e));
  log(`TEST3 ${hudVisible && panelHidden && glInfo.hasGL && !glInfo.lost && size > 20000 && newErrs.length === 0 ? 'PASS' : 'FAIL'} (visual check of qa-solo.png pending)`);
  await ctx.close();
}

// ---------- Test 4: desktop W movement ----------
{
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  collectErrors(page, 'desktop', errs);
  await page.goto(BASE + '/fallflat.html', { waitUntil: 'load' });
  await page.waitForTimeout(2000);
  await page.click('#solo-btn');
  await page.waitForTimeout(3000); // let spawn settle
  await page.screenshot({ path: SCRATCH + '/qa-move-before.png' });
  await page.keyboard.down('w');
  await page.waitForTimeout(2000);
  await page.keyboard.up('w');
  await page.waitForTimeout(300);
  await page.screenshot({ path: SCRATCH + '/qa-move-after.png' });
  const b = fs.readFileSync(SCRATCH + '/qa-move-before.png');
  const a = fs.readFileSync(SCRATCH + '/qa-move-after.png');
  const identical = b.equals(a);
  log(`TEST4 desktop move: before=${b.length}B after=${a.length}B identicalPNG=${identical} errors=${errs.length}`);
  errs.forEach(e => log('  ' + e));
  log(`TEST4 ${!identical && errs.length === 0 ? 'PASS(tentative)' : 'FAIL'} (visual diff pending)`);
  await ctx.close();
}

// ---------- Test 5: local multiplayer ----------
{
  const errsH = [], errsG = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const host = await ctx.newPage();
  collectErrors(host, 'mp-host', errsH);
  await host.goto(BASE + '/fallflat.html?local=1', { waitUntil: 'load' });
  await host.waitForTimeout(1500);
  await host.click('#host-btn');
  await host.waitForTimeout(2000);
  const code = (await host.locator('#hud-code').textContent())?.trim();
  log(`TEST5 host room code = "${code}"`);

  const guest = await ctx.newPage();
  collectErrors(guest, 'mp-guest', errsG);
  await guest.goto(BASE + '/fallflat.html?local=1', { waitUntil: 'load' });
  await guest.waitForTimeout(1500);
  await guest.fill('#code-input', code || '');
  await guest.click('#join-btn');
  await guest.waitForTimeout(3500);

  const hostHud = await host.locator('#hud').isVisible();
  const guestHud = await guest.locator('#hud').isVisible();
  const playersText = (await host.locator('#hud-players').innerText()).trim();
  const playerLines = playersText.split('\n').filter(s => s.trim());
  const playersChildren = await host.locator('#hud-players > *').count();
  await host.bringToFront();
  await host.screenshot({ path: SCRATCH + '/qa-mp-host.png' });
  await guest.bringToFront();
  await guest.screenshot({ path: SCRATCH + '/qa-mp-guest.png' });
  log(`TEST5 mp: hostHud=${hostHud} guestHud=${guestHud} hud-players children=${playersChildren} lines=${JSON.stringify(playerLines)} hostErrors=${errsH.length} guestErrors=${errsG.length}`);
  errsH.forEach(e => log('  ' + e));
  errsG.forEach(e => log('  ' + e));
  const twoPlayers = playersChildren >= 2 || playerLines.length >= 2;
  log(`TEST5 ${hostHud && guestHud && twoPlayers && errsH.length === 0 && errsG.length === 0 ? 'PASS' : 'FAIL'}`);
  await ctx.close();
}

await browser.close();
console.log('=== DONE ===');
