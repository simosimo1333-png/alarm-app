import { chromium } from 'playwright';
const SCRATCH = '/tmp/claude-0/-home-user-alarm-app/7a4abfc4-78e7-58ed-a646-22083753c0a0/scratchpad';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
const errs = [];
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
await page.goto('http://127.0.0.1:8899/fallflat.html', { waitUntil: 'load' });
await page.waitForTimeout(1400);
await page.evaluate(() => document.querySelectorAll('#course-row button')[2].click());
await page.waitForTimeout(800);
await page.screenshot({ path: SCRATCH + '/box-c3-menu.png' });
await page.click('#solo-btn');
await page.waitForTimeout(2200);

// 俯瞰(フライカメラ)
const fly = [
  ['over-c3-0', 28, 85, 26, 28, 0, 26],      // 真上
  ['over-c3-1', -32, 40, -28, 28, 3, 30],    // 南西から
  ['over-c3-2', 80, 34, 78, 25, 3, 25],      // 北東から
];
for (const [n, x, y, z, lx, ly, lz] of fly) {
  await page.evaluate((a) => window.__dbg.setFly(...a), [x, y, z, lx, ly, lz]);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SCRATCH}/${n}.png` });
}
await page.evaluate(() => window.__dbg.clearFly());

// スポットごとの一人称視点スクショ+接地確認
const spots = [
  ['start', 0, 0.9, 0.5, Math.PI],
  ['maeniwa', 0, 0.9, 15, Math.PI],
  ['nakaniwa', 0, 0.9, 37.5, Math.PI],
  ['tower-fork', 0, 8.1, 55, -Math.PI / 2],
  ['rouka1', 22.5, 5.5, 55, -Math.PI / 2],
  ['aqueduct', 8, 7.6, 61, -Math.PI / 2],
  ['bekkan', 50.4, 5.1, 55, -Math.PI / 2],
  ['daiseitou-in', 56, 5.1, 40.2, 0],
  ['star-island', 59.6, 3.1, 17.4, Math.PI],
];
for (const [name, x, y, z, yaw] of spots) {
  await page.evaluate(([x, y, z, yaw]) => { window.__dbg.tp(x, y, z); window.__dbg.setYaw(yaw); }, [x, y, z, yaw]);
  await page.waitForTimeout(800);
  const p = await page.evaluate(() => window.__dbg.pos());
  console.log('spot', name, 'pos:', p.map(v => +v.toFixed(2)).join(','), p[1] > -1 ? 'grounded' : 'FELL!');
  await page.screenshot({ path: `${SCRATCH}/box-c3-${name}.png` });
}

// チェックポイントを順にふんで cp が9まで進むか(ルートAがわのゾーン)
await page.evaluate(() => { window.__dbg.dolls.get(0).cp = 0; });
const cpSpots = [
  [0, 0.9, 15], [0, 0.9, 33.5], [0, 0.9, 37.5], [-7.4, 5.1, 47], [0, 8.1, 55],
  [22.5, 5.5, 55], [33.4, 5.5, 55], [50.4, 5.1, 55], [56, 5.1, 40.2],
];
for (const [x, y, z] of cpSpots) {
  await page.evaluate(([x, y, z]) => window.__dbg.tp(x, y, z), [x, y, z]);
  await page.waitForTimeout(450);
}
const cpA = await page.evaluate(() => window.__dbg.dolls.get(0).cp);
console.log('cp after route-A sweep:', cpA, cpA === 9 ? 'PASS' : 'FAIL');
// ルートBのゾーン(すいどうばし)
await page.evaluate(() => window.__dbg.tp(18, 7.3, 61));
await page.waitForTimeout(400);
await page.evaluate(() => { window.__dbg.dolls.get(0).cp = 5; });
await page.waitForTimeout(500);
const cpB = await page.evaluate(() => window.__dbg.dolls.get(0).cp);
console.log('cp on aqueduct (route B):', cpB, cpB === 6 ? 'PASS' : 'FAIL');

// ゴール判定(大聖塔のてっぺん)
await page.evaluate(() => window.__dbg.tp(56, 11.2, 31));
let goal = false;
for (let i = 0; i < 10 && !goal; i++) {
  await page.waitForTimeout(300);
  goal = await page.evaluate(() => window.__dbg.metas.get(0).goal);
}
console.log('goal:', goal ? 'PASS' : 'FAIL');
await page.screenshot({ path: SCRATCH + '/box-c3-goal.png' });
console.log('errors:', errs.length);
errs.slice(0, 8).forEach(e => console.log(' ', e));
await browser.close();
