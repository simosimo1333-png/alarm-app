import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.goto('http://127.0.0.1:8899/fallflat.html', { waitUntil: 'load' });
await page.waitForTimeout(1700);
await page.click('#solo-btn');
await page.waitForTimeout(2300);
// シムステップカウンタ（headlessは実時間より遅いのでシム時間で計測）
await page.evaluate(() => {
  const d = window.__dbg.dolls.get(0);
  window.__steps = 0;
  const orig = d.control.bind(d);
  d.control = function () { orig(); window.__steps++; };
});
const y = () => page.evaluate(() => window.__dbg.pos()[1]);
const steps = () => page.evaluate(() => window.__steps);
const waitSim = async (sec) => { const s0 = await steps(); while ((await steps()) - s0 < sec * 60) await page.waitForTimeout(120); };

// C1の塀(1.45m)で掴む（下を見たままW短押しで接触→掴み→W離す）
await page.evaluate(() => { window.__dbg.tp(0, 0.7, 54.4); window.__dbg.setYaw(Math.PI); });
await page.waitForTimeout(600);
await page.evaluate(() => { window.__dbg.setPitch(-0.3); window.__dbg.setGrab(true); window.__dbg.pressKey('KeyW'); });
let grabbed = false;
for (let i = 0; i < 18 && !grabbed; i++) {
  if (i % 5 === 2) await page.evaluate(() => window.__dbg.jump());
  await page.waitForTimeout(300);
  grabbed = await page.evaluate(() => window.__dbg.dolls.get(0).sides.some(s => !!s.grabC));
}
await page.evaluate(() => { window.__dbg.releaseKey('KeyW'); window.__dbg.setPitch(0.9); }); // 下を見る・入力なし
await waitSim(0.8); // 落ちつかせる

// 状態A: 下を見る + 入力なし → 上昇しない（ぶら下がり/立ち静止）
const a0 = await y(); await waitSim(1.2); const a1 = await y();
// 状態B: 前進入力開始 → 上昇開始
await page.evaluate(() => window.__dbg.pressKey('KeyW'));
const b0 = await y(); await waitSim(1.0); const b1 = await y();
// 状態C: 入力中断 → 上昇停止（ぶら下がりにもどる・登り切らない）
await page.evaluate(() => window.__dbg.releaseKey('KeyW'));
await waitSim(0.4); // 慣性の減衰待ち
const c0 = await y(); await waitSim(1.2); const c1 = await y();
const cGrab = await page.evaluate(() => window.__dbg.dolls.get(0).sides.some(s => !!s.grabC));
const cPos = await page.evaluate(() => window.__dbg.pos());
// 再開 → のぼり切り
await page.evaluate(() => window.__dbg.pressKey('KeyW'));
let topped = false, pos = null;
for (let i = 0; i < 30 && !topped; i++) {
  await page.waitForTimeout(320);
  pos = await page.evaluate(() => window.__dbg.pos());
  topped = pos[2] > 56.2 && pos[1] > 0.4;
}
await page.evaluate(() => { window.__dbg.releaseKey('KeyW'); window.__dbg.setGrab(false); });
const A = Math.abs(a1 - a0), B = b1 - b0, C = c1 - c0;
console.log(`A(入力なし): dy=${A.toFixed(2)}m (要<0.12) | B(前進中): dy=+${B.toFixed(2)}m (要>0.15) | C(入力中断): dy=${C.toFixed(2)}m (要: 上昇停止 <0.1) grab維持=${cGrab} 未完走=${cPos[2] < 55.9}`);
console.log(`再開後の登頂: ${topped} pos=${JSON.stringify(pos?.map(n => +n.toFixed(2)))}`);
const pass = A < 0.12 && B > 0.15 && C < 0.1 && cGrab && cPos[2] < 55.9 && topped; // Cは上昇停止が要件（ぶら下がりへ下がるのは仕様どおり）
console.log(`CLIMB-STATES ${pass ? 'PASS' : 'FAIL'}`);
await browser.close();
