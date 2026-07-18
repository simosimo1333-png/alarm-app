import { chromium } from 'playwright';
const SCRATCH = '/tmp/claude-0/-home-user-alarm-app/7a4abfc4-78e7-58ed-a646-22083753c0a0/scratchpad';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
const errs = [];
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
await page.goto('http://127.0.0.1:8899/fallflat.html', { waitUntil: 'load' });
await page.waitForTimeout(1400);
await page.evaluate(() => document.querySelectorAll('#course-row button')[1].click());
await page.waitForTimeout(800);
await page.screenshot({ path: SCRATCH + '/box-c2-menu.png' });
await page.click('#solo-btn');
await page.waitForTimeout(2200);
const results = [];
const rep = (name, pass, info = '') => { results.push([name, pass]); console.log(`${name}: ${pass ? 'PASS' : 'FAIL'} ${info}`); };

// ---- 俯瞰（フライカメラ） ----
const fly = [
  ['over-c2-0', 13, 80, 15, 13, 0, 15],      // 真上
  ['over-c2-1', -26, 36, -26, 13, 6, 15],    // 南西から
  ['over-c2-2', 50, 32, 44, 13, 7, 12],      // 北東から
];
for (const [n, x, y, z, lx, ly, lz] of fly) {
  await page.evaluate((a) => window.__dbg.setFly(...a), [x, y, z, lx, ly, lz]);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SCRATCH}/${n}.png` });
}
await page.evaluate(() => window.__dbg.clearFly());

// ---- スポットごとの視点スクショ＋接地確認 ----
const spots = [
  ['start', 0, 0.9, 0.5, Math.PI],
  ['deck1', 0, 3.9, 14, Math.PI],
  ['deck2', 9.5, 3.9, 24, -Math.PI / 2],
  ['rooftop-fork', 22.5, 7.2, 24, 0],
  ['rest-deck', 24.6, 7.2, -1.8, 0],
  ['highfloor', 24.6, 11.1, -8.5, Math.PI / 2],
  ['west-arm', 13.5, 11.1, -13, Math.PI / 2],
  ['goal-front', -1.6, 11.1, -13, Math.PI / 2],
];
for (const [name, x, y, z, yaw] of spots) {
  await page.evaluate(([x, y, z, yaw]) => { window.__dbg.tp(x, y, z); window.__dbg.setYaw(yaw); }, [x, y, z, yaw]);
  await page.waitForTimeout(800);
  const p = await page.evaluate(() => window.__dbg.pos());
  console.log('spot', name, 'pos:', p.map(v => +v.toFixed(2)).join(','), p[1] > y - 2 ? 'grounded' : 'FELL!');
  await page.screenshot({ path: `${SCRATCH}/box-c2-${name}.png` });
}

// ---- A: レバー → 貨物リフト ----
await page.evaluate(() => { window.__dbg.tp(2.4, 0.75, 6.2); window.__dbg.setYaw(Math.PI); });
await page.waitForTimeout(300);
await page.keyboard.down('w');
let liftUp = false, flipped = false, aInfo = null;
for (let i = 0; i < 50 && !liftUp; i++) {
  await page.waitForTimeout(250);
  aInfo = await page.evaluate(() => {
    const d = window.__dbg;
    const lf = d.gim.lifts[0];
    return { ang: +d.hingeAngle(lf.leverIdx).toFixed(2), lift: +d.objs[lf.liftIdx].body.position.y.toFixed(2), me: +d.pos()[2].toFixed(1) };
  });
  if (!flipped && aInfo.ang > 0.25) { flipped = true; await page.keyboard.up('w'); }
  if (flipped && aInfo.me > 7.6) await page.evaluate(() => window.__dbg.tp(2.4, 0.75, 6.0));
  liftUp = aInfo.lift > 1.5;
}
await page.keyboard.up('w');
rep('A lever-lift', liftUp, JSON.stringify(aInfo));
await page.screenshot({ path: SCRATCH + '/box-c2-lift.png' });

// ---- B: 鉄球の振り子（クレーンのくさり） ----
const ballIdx = await page.evaluate(() => window.__dbg.objs.findIndex(o => o.kind === 'sphere' && o.radius === 0.6));
await page.evaluate((i) => { const b = window.__dbg.objs[i].body; b.wakeUp(); b.velocity.set(0, 0, 2.5); }, ballIdx);
let zMax = -1e9, zMin = 1e9;
for (let i = 0; i < 36; i++) {
  await page.waitForTimeout(200);
  const z = await page.evaluate((i) => window.__dbg.objs[i].body.position.z, ballIdx);
  zMax = Math.max(zMax, z); zMin = Math.min(zMin, z);
}
rep('B ball-pendulum', zMax > 24.45 && zMin < 23.55, `z ${zMin.toFixed(2)}..${zMax.toFixed(2)}`);
await page.screenshot({ path: SCRATCH + '/box-c2-ball.png' });

// ---- C: こわせるかべ（木箱をぶつける） ----
const crateIdx = await page.evaluate(() => window.__dbg.objs.findIndex(o => o.mass === 12));
const brickBefore = await page.evaluate(() => window.__dbg.objs.filter(o => o.breakGroup !== undefined).map(o => +o.body.position.x.toFixed(2)));
await page.evaluate((i) => {
  const b = window.__dbg.objs[i].body;
  b.wakeUp();
  b.position.set(11.2, 4.2, 24);
  b.velocity.set(9, 0.5, 0);
}, crateIdx);
let hit = false;
for (let i = 0; i < 20 && !hit; i++) {
  await page.waitForTimeout(300);
  hit = await page.evaluate(() => window.__dbg.gim.breakables[0].hit);
}
const brickAfter = await page.evaluate(() => window.__dbg.objs.filter(o => o.breakGroup !== undefined).map(o => +o.body.position.x.toFixed(2)));
const moved = brickAfter.filter((x, i) => Math.abs(x - brickBefore[i]) > 0.15).length;
rep('C breakable-wall', hit && moved >= 2, `hit=${hit} moved=${moved}`);
await page.screenshot({ path: SCRATCH + '/box-c2-wall.png' });

// ---- D: ウィンチ → ゴンドラ上昇 ----
const wBefore = await page.evaluate(() => {
  const wn = window.__dbg.gim.lifts[1];
  return +window.__dbg.objs[wn.liftIdx].body.position.y.toFixed(2);
});
await page.evaluate(() => { window.__dbg.tp(16.5, 3.75, 22.2); window.__dbg.setYaw(-Math.PI / 2); });
await page.waitForTimeout(300);
await page.keyboard.down('w');
let dFlipped = false, gy = 0, dInfo = null;
for (let i = 0; i < 50; i++) {
  await page.waitForTimeout(250);
  dInfo = await page.evaluate(() => {
    const d = window.__dbg;
    const wn = d.gim.lifts[1];
    return { ang: +d.hingeAngle(wn.leverIdx).toFixed(2), y: +d.objs[wn.liftIdx].body.position.y.toFixed(2), me: d.pos().map(n => +n.toFixed(1)) };
  });
  if (!dFlipped && dInfo.ang > 0.25) { dFlipped = true; await page.keyboard.up('w'); }
  if (dFlipped && dInfo.me[0] > 17.6) await page.evaluate(() => window.__dbg.tp(16.4, 3.75, 22.2));
  gy = dInfo.y;
  if (gy > wBefore + 0.8) break;
}
await page.keyboard.up('w');
rep('D winch-gondola', gy > wBefore + 0.8, `y ${wBefore}->${gy} ${JSON.stringify(dInfo)}`);
await page.screenshot({ path: SCRATCH + '/box-c2-winch.png' });

// ---- E: 回転する床（のって運ばれる） ----
await page.evaluate(() => { window.__dbg.tp(25.3, 7.0, 12.3); const d = window.__dbg.dolls.get(0); d.torso.velocity.setZero(); });
await page.waitForTimeout(500);
const e0 = await page.evaluate(() => window.__dbg.pos());
await page.waitForTimeout(2200);
const e1 = await page.evaluate(() => window.__dbg.pos());
const eMoved = Math.hypot(e1[0] - e0[0], e1[2] - e0[2]);
const spinQ = await page.evaluate(() => {
  const sp = window.__dbg.gim.spinners[0];
  return Math.abs(window.__dbg.objs[sp.idx].body.angularVelocity.y);
});
rep('E spinner-carry', eMoved > 0.35 && e1[1] > 5.5 && spinQ > 0.3, `moved=${eMoved.toFixed(2)} omega=${spinQ.toFixed(2)}`);
await page.screenshot({ path: SCRATCH + '/box-c2-spinner.png' });

// ---- F: おもりエレベーター（木箱2つをかごへ） ----
const balCrates = await page.evaluate(() => window.__dbg.objs.map((o, i) => [o.mass, i]).filter(([m]) => m === 15).map(([, i]) => i));
const fBefore = await page.evaluate(() => +window.__dbg.objs[window.__dbg.gim.balances[0].liftIdx].body.position.y.toFixed(2));
await page.evaluate((idxs) => {
  const [a, b] = idxs;
  const ba = window.__dbg.objs[a].body, bb = window.__dbg.objs[b].body;
  ba.wakeUp(); ba.position.set(21.3, 7.2, -2.7); ba.velocity.setZero();
  bb.wakeUp(); bb.position.set(21.3, 7.9, -2.1); bb.velocity.setZero();
}, balCrates);
let fy = 0;
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(300);
  fy = await page.evaluate(() => +window.__dbg.objs[window.__dbg.gim.balances[0].liftIdx].body.position.y.toFixed(2));
  if (fy > fBefore + 2.5) break;
}
rep('F balance-elevator', fy > fBefore + 2.5, `y ${fBefore}->${fy}`);
await page.screenshot({ path: SCRATCH + '/box-c2-balance.png' });

// ---- G: ゆれる鉄骨・うごく足場（キネマティック運動） ----
const movers = await page.evaluate(() => window.__dbg.gim.movers.map(m => m.idx));
const mPos0 = await page.evaluate((idxs) => idxs.map(i => { const p = window.__dbg.objs[i].body.position; return [p.x, p.z]; }), movers);
let mRange = movers.map(() => 0);
for (let i = 0; i < 20; i++) {
  await page.waitForTimeout(300);
  const mp = await page.evaluate((idxs) => idxs.map(i => { const p = window.__dbg.objs[i].body.position; return [p.x, p.z]; }), movers);
  mRange = mRange.map((r, j) => Math.max(r, Math.hypot(mp[j][0] - mPos0[j][0], mp[j][1] - mPos0[j][1])));
}
rep('G movers', movers.length >= 2 && mRange.every(r => r > 1.2), `n=${movers.length} range=${mRange.map(r => r.toFixed(1)).join(',')}`);

// ---- 歩きヘルパー ----
async function hopTo(targets) {
  let retries = 0;
  let prev = targets[0];
  await page.evaluate((p) => { window.__dbg.tp(p[0], p[1] + 0.75, p[2]); }, prev);
  await page.waitForTimeout(400);
  for (let ti = 1; ti < targets.length; ti++) {
    const t = targets[ti];
    let arrived = false;
    for (let att = 0; att < 6 && !arrived; att++) {
      await page.evaluate(([t]) => {
        const doll = window.__dbg.dolls.get(0);
        doll.limpUntil = 0; doll.staggerUntil = 0;
        const me = window.__dbg.pos();
        window.__dbg.setYaw(Math.atan2(-(t[0] - me[0]), -(t[2] - me[2])));
        window.__dbg.pressKey('KeyW');
      }, [t]);
      let jumped = false;
      for (let i = 0; i < 22 && !arrived; i++) {
        await page.waitForTimeout(180);
        const me = await page.evaluate(([t]) => {
          const me = window.__dbg.pos();
          window.__dbg.setYaw(Math.atan2(-(t[0] - me[0]), -(t[2] - me[2])));
          return me;
        }, [t]);
        const dist = Math.hypot(me[0] - t[0], me[2] - t[2]);
        if (!jumped && dist < (t[3] || 2.6) && me[1] > t[1] - 1.5) { await page.evaluate(() => window.__dbg.jump()); jumped = true; }
        if (dist < 0.8 && Math.abs(me[1] - (t[1] + 0.61)) < 1.15) arrived = true;
        if (me[1] < t[1] - 3.2) break;
      }
      await page.evaluate(() => window.__dbg.releaseKey('KeyW'));
      if (!arrived) {
        retries++;
        await page.evaluate((p) => { window.__dbg.tp(p[0], p[1] + 0.75, p[2]); const d = window.__dbg.dolls.get(0); d.torso.velocity.setZero(); d.limpUntil = 0; d.staggerUntil = 0; }, prev);
        await page.waitForTimeout(500);
      }
    }
    if (!arrived) return { ok: false, at: ti, retries };
    prev = t;
  }
  return { ok: true, retries };
}

// ---- H: ルートA バランス梁 → 回転床 → 休けいデッキ ----
const routeA = await hopTo([
  [24.6, 6.3, 21.5],    // 屋上の南
  [25.8, 6.3, 18.5],    // 梁A
  [25.8, 6.3, 14.8],    // 梁Aの南はし
  [24.6, 6.3, 12.3],    // 回転床1
  [23.4, 6.3, 9.6],     // 梁B
  [23.4, 6.3, 4.6],     // 梁Bの南はし
  [24.6, 6.3, 2.1],     // 回転床2
  [24.6, 6.3, -1.8],    // 休けいデッキ
]);
rep('H routeA-beams-spinners', routeA.ok, `retries=${routeA.retries} stuckAt=${routeA.at ?? '-'}`);
await page.screenshot({ path: SCRATCH + '/box-c2-routeA.png' });

// ---- I: ルートB 空中の梁（すきまとび2回） ----
const routeB = await hopTo([
  [29.4, 10.05, 23.2],  // はりのスタート台
  [29.8, 9.9, 21.0],    // 梁1の北
  [29.8, 9.9, 17.2],    // 梁1
  [29.8, 9.9, 13.2],    // 梁1の南はし
  [29.8, 9.9, 9.9, 2.9],// 梁2（すきま1.6とび）
  [29.8, 9.9, 2.4],     // 梁2の南はし
  [29.8, 9.9, -1.0, 2.9], // 梁3（すきま1.5とび）
  [29.8, 9.9, -6.4],    // 梁3の南はし
  [28.6, 10.2, -7.6],   // 合流パッド
]);
rep('I routeB-sky-beams', routeB.ok, `retries=${routeB.retries} stuckAt=${routeB.at ?? '-'}`);
await page.screenshot({ path: SCRATCH + '/box-c2-routeB.png' });

// ---- J: よりみち（おやつのだい） ----
const detour = await hopTo([
  [24.6, 6.3, -2.6],
  [29.5, 6.3, -2.6],    // ほそい梁
  [33.2, 6.3, -2.6],    // おやつのだい
]);
rep('J star-detour', detour.ok, `retries=${detour.retries}`);
await page.screenshot({ path: SCRATCH + '/box-c2-star.png' });

// ---- K: チェックポイント（ルートA）→ ルートBゾーン → ゴール ----
await page.evaluate(() => window.__dbg.tp(0, 0.9, 0.5));
await page.waitForTimeout(400);
await page.evaluate(() => { window.__dbg.dolls.get(0).cp = 0; });
const cpSpots = [
  [0, 3.9, 14], [9.5, 3.9, 24], [22.5, 7.2, 24], [24.6, 7.2, -1.8],
  [24.6, 11.1, -8.5], [13.5, 11.1, -13], [-1.6, 11.1, -13],
];
for (const [x, y, z] of cpSpots) {
  await page.evaluate(([x, y, z]) => window.__dbg.tp(x, y, z), [x, y, z]);
  await page.waitForTimeout(450);
}
const cpA = await page.evaluate(() => window.__dbg.dolls.get(0).cp);
rep('K cp-routeA', cpA === 7, `cp=${cpA}`);
await page.evaluate(() => window.__dbg.tp(29.8, 10.4, 6.1));
await page.waitForTimeout(400);
await page.evaluate(() => { window.__dbg.dolls.get(0).cp = 3; });
await page.waitForTimeout(500);
const cpB = await page.evaluate(() => window.__dbg.dolls.get(0).cp);
rep('K2 cp-routeB', cpB === 4, `cp=${cpB}`);
await page.evaluate(() => window.__dbg.tp(-4.7, 12.5, -13));
let goal = false;
for (let i = 0; i < 10 && !goal; i++) {
  await page.waitForTimeout(300);
  goal = await page.evaluate(() => window.__dbg.metas.get(0).goal);
}
rep('L goal', goal);
await page.screenshot({ path: SCRATCH + '/box-c2-goal.png' });

console.log('errors:', errs.length);
errs.slice(0, 8).forEach(e => console.log(' ', e));
console.log('=== BOX-C2', results.every(r => r[1]) && errs.length === 0 ? 'ALL PASS' : 'SOME FAIL', '===');
await browser.close();
