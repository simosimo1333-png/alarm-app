import { chromium } from 'playwright';
const SCRATCH = '/tmp/claude-0/-home-user-alarm-app/7a4abfc4-78e7-58ed-a646-22083753c0a0/scratchpad';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
for (let course = 0; course < 3; course++) {
  const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await page.goto('http://127.0.0.1:8899/fallflat.html', { waitUntil: 'load' });
  await page.waitForTimeout(1300);
  await page.evaluate((c) => document.querySelectorAll('#course-row button')[c].click(), course);
  await page.waitForTimeout(400);
  await page.click('#solo-btn');
  await page.waitForTimeout(2000);
  // すこし歩く+ジャンプ+つかみ
  await page.keyboard.down('w');
  await page.waitForTimeout(1500);
  await page.keyboard.press('Space');
  await page.waitForTimeout(1200);
  await page.keyboard.up('w');
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SCRATCH}/final-c${course + 1}.png` });
  console.log(`course${course + 1} errors:`, errs.length, errs.slice(0, 3));
  await page.close();
}
// MPスモーク
const ctx = await browser.newContext({ viewport: { width: 640, height: 360 } });
const errsM = [];
const host = await ctx.newPage();
host.on('pageerror', e => errsM.push('H:' + e.message));
host.on('console', m => { if (m.type() === 'error') errsM.push('H:' + m.text()); });
await host.goto('http://127.0.0.1:8899/fallflat.html?local=1', { waitUntil: 'load' });
await host.waitForTimeout(1200);
await host.click('#host-btn');
await host.waitForTimeout(1800);
const code = (await host.locator('#hud-code').textContent()).trim();
const guest = await ctx.newPage();
guest.on('pageerror', e => errsM.push('G:' + e.message));
guest.on('console', m => { if (m.type() === 'error') errsM.push('G:' + m.text()); });
await guest.goto('http://127.0.0.1:8899/fallflat.html?local=1', { waitUntil: 'load' });
await guest.waitForTimeout(1200);
await guest.fill('#code-input', code);
await guest.click('#join-btn');
await guest.waitForTimeout(3000);
console.log('MP smoke errors:', errsM.length, errsM.slice(0, 3));
await browser.close();
console.log('SMOKE DONE');
