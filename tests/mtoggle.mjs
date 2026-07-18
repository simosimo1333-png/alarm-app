import { chromium } from 'playwright';
const SCRATCH = '/tmp/claude-0/-home-user-alarm-app/7a4abfc4-78e7-58ed-a646-22083753c0a0/scratchpad';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
await page.goto('http://127.0.0.1:8899/fallflat.html', { waitUntil: 'load' });
await page.waitForTimeout(1800);
await page.tap('#solo-btn');
await page.waitForTimeout(2500);
const cdp = await ctx.newCDPSession(page);
const box = async (sel) => { const b = await page.locator(sel).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
const cL = await box('#t-grab-l'), cR = await box('#t-grab-r'), cB = await box('#t-grab-b');
const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
const tap = async (pt) => {
  await touch('touchStart', [{ x: pt.x, y: pt.y, id: 1 }]);
  await page.waitForTimeout(120);
  await touch('touchEnd', [{ x: pt.x, y: pt.y, id: 1 }]);
  await page.waitForTimeout(250);
};
const st = () => page.evaluate(() => {
  const d = window.__dbg.dolls.get(0);
  return {
    gl: d.input.gl, gr: d.input.gr, ap: d.input.ap,
    hlOn: document.getElementById('t-grab-l').classList.contains('on'),
    hrOn: document.getElementById('t-grab-r').classList.contains('on'),
    hbOn: document.getElementById('t-grab-b').classList.contains('on'),
  };
});
const fmt = (s) => `gl:${s.gl},gr:${s.gr},hl:${+s.hlOn},hr:${+s.hrOn},hb:${+s.hbOn}`;

// M1: 左タップ→オン(指を離しても保持)→もう一度タップ→オフ
await tap(cL); const m1a = await st();
await tap(cL); const m1b = await st();
console.log(`M1 L-toggle: on=[${fmt(m1a)}] off=[${fmt(m1b)}] ${m1a.gl === 1 && m1a.gr === 0 && m1a.hlOn && !m1a.hrOn && m1b.gl === 0 && !m1b.hlOn ? 'PASS' : 'FAIL'}`);
// M2: 右タップ→オン→タップ→オフ
await tap(cR); const m2a = await st();
await tap(cR); const m2b = await st();
console.log(`M2 R-toggle: on=[${fmt(m2a)}] off=[${fmt(m2b)}] ${m2a.gr === 1 && m2a.gl === 0 && m2a.hrOn && m2b.gr === 0 ? 'PASS' : 'FAIL'}`);
// M3: りょうてタップ→両手オン(ボタン3つハイライト)→タップ→全オフ
await tap(cB); const m3a = await st();
await page.screenshot({ path: SCRATCH + '/toggle-both-on.png' });
await tap(cB); const m3b = await st();
console.log(`M3 B-toggle: on=[${fmt(m3a)}] off=[${fmt(m3b)}] ${m3a.gl === 1 && m3a.gr === 1 && m3a.hbOn && m3a.hlOn && m3a.hrOn && m3b.gl === 0 && m3b.gr === 0 && !m3b.hbOn ? 'PASS' : 'FAIL'}`);
// M4: 片手オン状態でりょうてタップ→全部オフ
await tap(cL);
await tap(cB); const m4 = await st();
console.log(`M4 B-clears-partial: [${fmt(m4)}] ${m4.gl === 0 && m4.gr === 0 ? 'PASS' : 'FAIL'}`);
// M5: りょうて押し→ドラッグでうでの高さ→離してもつかみ保持・高さだけリセット
await touch('touchStart', [{ x: cB.x, y: cB.y, id: 1 }]);
await page.waitForTimeout(250);
const m5a = await st();
await touch('touchMove', [{ x: cB.x, y: cB.y - 110, id: 1 }]);
await page.waitForTimeout(350);
const m5b = await st();
await page.screenshot({ path: SCRATCH + '/toggle-drag-arms.png' });
await touch('touchEnd', [{ x: cB.x, y: cB.y - 110, id: 1 }]);
await page.waitForTimeout(300);
const m5c = await st();
console.log(`M5 drag: press=[${fmt(m5a)}] ap:${m5a.ap}->${m5b.ap} release=[${fmt(m5c)}] ap:${m5c.ap} ${m5a.gl === 1 && m5b.ap > m5a.ap + 0.5 && m5c.gl === 1 && m5c.gr === 1 && Math.abs(m5c.ap - (-0.22)) < 0.15 ? 'PASS' : 'FAIL'} (ドラッグしても離してもつかみ保持・高さはリセット)`);
// M6: 脱力(6m落下)で強制解除→トグルとハイライトもリセット
await page.evaluate(() => { const p = window.__dbg.pos(); window.__dbg.tp(p[0], p[1] + 6, p[2]); });
let cleared = false;
for (let i = 0; i < 30 && !cleared; i++) {
  await page.waitForTimeout(400);
  const s = await st();
  cleared = s.gl === 0 && s.gr === 0 && !s.hlOn && !s.hrOn && !s.hbOn;
}
console.log(`M6 limp-clears-toggle: cleared=${cleared} ${cleared ? 'PASS' : 'FAIL'}`);
// M7: R(リスポーン)でも解除
await page.waitForTimeout(2500);
await tap(cB);
await page.evaluate(() => { window.__dbg.pressKey('KeyR'); });
await page.keyboard.press('r');
await page.waitForTimeout(200);
// requestRespawn はキーダウンハンドラ経由。直接呼べるか確認
await page.evaluate(() => { const btn = document.getElementById('hud-respawn'); btn.click(); });
await page.waitForTimeout(400);
const m7 = await st();
console.log(`M7 respawn-clears: [${fmt(m7)}] ${m7.gl === 0 && m7.gr === 0 && !m7.hbOn ? 'PASS' : 'FAIL'}`);
console.log('errors:', errs.length);
errs.forEach(e => console.log('  ' + e));
await ctx.close(); await browser.close();
