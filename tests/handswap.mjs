import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.goto('http://127.0.0.1:8899/fallflat.html', { waitUntil: 'load' });
await page.waitForTimeout(1700);
await page.click('#solo-btn');
await page.waitForTimeout(2300);
// C1の塀にぶらさがる（両手・マウス左右クリック相当で個別制御）
await page.evaluate(() => { window.__dbg.tp(0, 0.7, 54.4); window.__dbg.setYaw(Math.PI); });
await page.waitForTimeout(600);
await page.evaluate(() => { window.__dbg.setPitch(-0.35); window.__dbg.setGrabL(true); window.__dbg.setGrabR(true); window.__dbg.pressKey('KeyW'); });
let both = false;
for (let i = 0; i < 18 && !both; i++) {
  if (i % 5 === 2) await page.evaluate(() => window.__dbg.jump());
  await page.waitForTimeout(300);
  both = await page.evaluate(() => window.__dbg.dolls.get(0).sides.every(s => !!s.grabC));
}
await page.evaluate(() => window.__dbg.releaseKey('KeyW'));
console.log('both hands gripping:', both);
// 意図的な掛け替え: 左手だけ離す → 右手は保持したまま → 左手でまた掴む
await page.evaluate(() => window.__dbg.setGrabL(false));
await page.waitForTimeout(500);
const mid = await page.evaluate(() => {
  const d = window.__dbg.dolls.get(0);
  return { L: !!d.sides[0].grabC, R: !!d.sides[1].grabC };
});
await page.evaluate(() => window.__dbg.setGrabL(true));
let reGrabbed = false;
for (let i = 0; i < 12 && !reGrabbed; i++) {
  await page.waitForTimeout(300);
  reGrabbed = await page.evaluate(() => !!window.__dbg.dolls.get(0).sides[0].grabC);
}
const fin = await page.evaluate(() => {
  const d = window.__dbg.dolls.get(0);
  return { L: !!d.sides[0].grabC, R: !!d.sides[1].grabC };
});
console.log(`HANDSWAP: released L (kept R=${mid.R}, L=${mid.L}) -> regrab L=${reGrabbed} final L=${fin.L} R=${fin.R} ${both && !mid.L && mid.R && reGrabbed && fin.R ? 'PASS' : 'FAIL'}`);
await browser.close();
