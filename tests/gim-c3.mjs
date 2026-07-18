import { chromium } from 'playwright';
const SCRATCH = '/tmp/claude-0/-home-user-alarm-app/7a4abfc4-78e7-58ed-a646-22083753c0a0/scratchpad';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
const errs = [];
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
await page.goto('http://127.0.0.1:8899/fallflat.html', { waitUntil: 'load' });
await page.waitForTimeout(1400);
await page.evaluate(() => document.querySelectorAll('#course-row button')[2].click());
await page.waitForTimeout(500);
await page.click('#solo-btn');
await page.waitForTimeout(2200);
const results = [];
const rep = (name, pass, info = '') => { results.push([name, pass]); console.log(`${name}: ${pass ? 'PASS' : 'FAIL'} ${info}`); };

// ---- A: 堀1のくさりが振り子(物理読み) ----
await page.evaluate(() => {
  const ch = window.__dbg.gim.chains[0];
  const b = window.__dbg.objs[ch.links[ch.links.length - 1]].body;
  b.wakeUp(); b.velocity.set(0, 0, 2.5);
});
let zMax = -1e9, zMin = 1e9;
for (let i = 0; i < 25; i++) {
  await page.waitForTimeout(200);
  const z = await page.evaluate(() => {
    const ch = window.__dbg.gim.chains[0];
    return window.__dbg.objs[ch.links[ch.links.length - 1]].body.position.z;
  });
  zMax = Math.max(zMax, z); zMin = Math.min(zMin, z);
}
rep('A chain1-pendulum', zMax > 10.9 && zMin < 10.1, `z ${zMin.toFixed(2)}..${zMax.toFixed(2)}`);

// ---- B: カタパルト(岩をおしてかごへおとす→発射) ----
const rockIdx = await page.evaluate(() => window.__dbg.gim.catapults[0].weights[0]);
let fired = false;
for (let i = 0; i < 45 && !fired; i++) {
  await page.evaluate((rockIdx) => {
    const d = window.__dbg;
    const r = d.objs[rockIdx].body.position;
    const me = d.pos();
    const bx = r.x, bz = r.z + 1.0;
    d.setYaw(0);
    if (Math.hypot(me[0] - bx, me[2] - bz) > 1.0 || me[1] < r.y - 0.6) d.tp(bx, r.y + 0.35, bz);
  }, rockIdx);
  await page.keyboard.down('w');
  await page.waitForTimeout(350);
  fired = await page.evaluate(() => {
    const cp = window.__dbg.gim.catapults[0];
    return cp.fireAt > 0 || cp.readyAt > 1;
  });
}
await page.keyboard.up('w');
rep('B catapult-fired', fired);
await page.screenshot({ path: SCRATCH + '/box-c3-catapult.png' });
await page.waitForTimeout(2000);

// ---- C: はねばし1 くさりをつかんで引きおろす ----
async function pullBridge(dbIdx, stand) {
  let opened = false, grabbed = false;
  for (let att = 0; att < 8 && !opened; att++) {
    await page.evaluate(([dbIdx, stand]) => {
      const d = window.__dbg;
      const db = d.gim.drawbridges[dbIdx];
      const linkB = d.objs[db.grabIdxs[db.grabIdxs.length - 2]].body.position;
      d.tp(stand[0], stand[1], stand[2]);
      const dx = linkB.x - stand[0], dz = linkB.z - stand[2];
      d.setYaw(Math.atan2(-dx, -dz));
      d.setPitch(-0.4);
      d.setGrab(true);
    }, [dbIdx, stand]);
    await page.waitForTimeout(500);
    await page.keyboard.down('w');
    await page.evaluate(() => window.__dbg.jump());
    for (let i = 0; i < 30 && !opened; i++) {
      await page.waitForTimeout(400);
      const st = await page.evaluate((dbIdx) => {
        const d = window.__dbg;
        const db = d.gim.drawbridges[dbIdx];
        const doll = d.dolls.get(0);
        const holding = doll.sides.some(s => s.grabC && db.bodySet && db.bodySet.has(s.grabC.bodyB));
        const p = doll.torso.position;
        return { holding, open: db.open, y: p.y };
      }, dbIdx);
      if (st.holding) grabbed = true;
      opened = st.open;
      if (st.y < stand[1] - 3) break;
    }
    await page.keyboard.up('w');
    await page.evaluate(() => window.__dbg.setGrab(false));
  }
  const ang = await page.evaluate((i) => window.__dbg.hingeAngle(window.__dbg.gim.drawbridges[i].idx), dbIdx);
  return { opened, grabbed, ang };
}
const db1 = await pullBridge(0, [0.9, 0.75, 29.3]);
rep('C drawbridge1-open', db1.grabbed && db1.opened && db1.ang < 0.2, `grabbed=${db1.grabbed} ang=${db1.ang.toFixed(2)}`);
await page.screenshot({ path: SCRATCH + '/box-c3-bridge1.png' });

// ---- D: ルートA 塔のうえ→うき石→柱とび→ろうか1 (歩き+ジャンプ) ----
async function hopTo(targets, opts = {}) {
  // targets: [x, ytop, z]。おちたら直前の足場へtpしてリトライ
  let retries = 0;
  let prev = targets[0];
  await page.evaluate((p) => { window.__dbg.tp(p[0], p[1] + 0.75, p[2]); }, prev);
  await page.waitForTimeout(400);
  for (let ti = 1; ti < targets.length; ti++) {
    const t = targets[ti];
    let arrived = false;
    for (let att = 0; att < 5 && !arrived; att++) {
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
        if (dist < 0.75 && Math.abs(me[1] - (t[1] + 0.61)) < 1.15) arrived = true;
        if (me[1] < t[1] - 3.2) break; // おちた
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
const routeA = await hopTo([
  [0, 7.2, 55],        // 塔1のうえ
  [5.1, 6.85, 55, 3.4], // うき石1
  [7.9, 6.7, 55],      // うき石2
  [10.8, 6.7, 55],     // 柱1
  [13.4, 6.1, 53.6],   // 柱2
  [16.0, 5.5, 56.2, 3.1], // 柱3
  [18.4, 4.9, 54.4],   // 柱4
  [22.5, 4.6, 55, 3.5], // ろうか1
]);
rep('D routeA-pillar-hop', routeA.ok, `retries=${routeA.retries} stuckAt=${routeA.at ?? '-'}`);
await page.screenshot({ path: SCRATCH + '/box-c3-routeA.png' });

// ---- E: ターザンごし(くさりをつかんでスイング→ろうか2) ----
let tarzanOk = false, tHold = false;
for (let att = 0; att < 8 && !tarzanOk; att++) {
  await page.evaluate(() => {
    const d = window.__dbg;
    d.tp(25.5, 5.95, 55);
    const doll = d.dolls.get(0);
    doll.torso.velocity.setZero(); doll.limpUntil = 0; doll.staggerUntil = 0;
    d.setYaw(-Math.PI / 2);
    d.setPitch(-0.35);
    d.setGrab(true);
  });
  await page.waitForTimeout(450);
  await page.keyboard.down('w');
  let holding = false, jumpArmed = true;
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(160);
    const st = await page.evaluate(() => {
      const d = window.__dbg;
      const ch = d.gim.chains[2];
      const set = new Set(ch.links.map(i => d.objs[i].body));
      const doll = d.dolls.get(0);
      const hold = doll.sides.some(s => s.grabC && set.has(s.grabC.bodyB));
      const p = doll.torso.position;
      return { hold, x: p.x, y: p.y, vx: doll.torso.velocity.x, vy: doll.torso.velocity.y };
    });
    if (jumpArmed && st.x > 25.7) { await page.evaluate(() => window.__dbg.jump()); if (st.vy > 1.5) jumpArmed = false; }
    if (st.hold) { holding = true; tHold = true; }
    if (holding && st.x > 29.6 && st.vx > 1) {         // まえへふれたら はなす
      await page.evaluate(() => window.__dbg.setGrab(false));
    }
    if (st.x > 30.6 && st.y > 4.4) { tarzanOk = true; break; }
    if (st.y < 1.5) break;
  }
  await page.keyboard.up('w');
  await page.evaluate(() => window.__dbg.setGrab(false));
  await page.waitForTimeout(300);
}
rep('E tarzan-cross', tarzanOk, `held=${tHold}`);
await page.screenshot({ path: SCRATCH + '/box-c3-tarzan.png' });

// ---- F: ルートB すいどうばし(塔のうえ→パッド→3スパン→ろうか2) ----
const routeB = await hopTo([
  [0, 7.2, 55],        // 塔1のうえ
  [2.2, 7.03, 59.6],   // きたのパッド
  [4.5, 6.85, 61],     // スパン1
  [10.9, 6.85, 61],    // スパン1のはし
  [13.9, 6.55, 61, 2.9], // スパン2
  [21.9, 6.55, 61],    // スパン2のはし
  [24.8, 6.25, 61],    // スパン3
  [32.4, 6.25, 61],    // スパン3のはし
  [33.4, 5.4, 58.7],   // 段さがりの石
  [33.4, 4.6, 55],     // ろうか2(ごうりゅう)
]);
rep('F routeB-aqueduct', routeB.ok, `retries=${routeB.retries} stuckAt=${routeB.at ?? '-'}`);
await page.screenshot({ path: SCRATCH + '/box-c3-routeB.png' });

// ---- G: ゆれるつり橋をわたる(ろうか2→べっかん) ----
const planks = await page.evaluate(() => {
  const pb = window.__dbg.gim.plankBridges[0];
  return pb.planks.map(i => { const p = window.__dbg.objs[i].body.position; return [+p.x.toFixed(1), +p.y.toFixed(1), +p.z.toFixed(1)]; });
});
console.log('  planks:', JSON.stringify(planks));
const bridgeWalk = await hopTo([
  [33.4, 4.6, 55],
  [38.4, 4.15, 55],    // 橋のまんなか(たわみ)
  [42.6, 4.2, 55],     // べっかんの島
]);
rep('G hanging-bridge-cross', bridgeWalk.ok, `retries=${bridgeWalk.retries}`);

// ---- H: 落とし格子(木箱を床スイッチへ) ----
const gateBefore = await page.evaluate(() => {
  const pd = window.__dbg.gim.pads[0];
  return { gy: window.__dbg.objs[pd.gateIdx].body.position.y, pad: pd.padPos.map(n => +n.toFixed(2)) };
});
console.log('  pad at', JSON.stringify(gateBefore));
const crateIdx = await page.evaluate(() => window.__dbg.objs.findIndex(o => o.mass === 12));
await page.evaluate(([ci, px, pz]) => {
  const b = window.__dbg.objs[ci].body;
  b.wakeUp(); b.position.set(px, 5.2, pz); b.velocity.setZero();
}, [crateIdx, gateBefore.pad[0], gateBefore.pad[2]]);
let gateOpen = false, gy = 0;
for (let i = 0; i < 20 && !gateOpen; i++) {
  await page.waitForTimeout(300);
  gy = await page.evaluate(() => window.__dbg.objs[window.__dbg.gim.pads[0].gateIdx].body.position.y);
  gateOpen = gy < 3.4;
}
rep('H portcullis-pad', gateOpen, `gateY ${gateBefore.gy.toFixed(2)}→${gy.toFixed(2)}`);
await page.screenshot({ path: SCRATCH + '/box-c3-portcullis.png' });

// ---- I: 基壇の二段のぼりごし→はねばし2 ----
const db2 = await pullBridge(1, [57.15, 4.85, 43.4]);
rep('I drawbridge2-open', db2.grabbed && db2.opened && Math.abs(db2.ang) < 0.2, `grabbed=${db2.grabbed} ang=${db2.ang.toFixed(2)}`);
await page.screenshot({ path: SCRATCH + '/box-c3-bridge2.png' });
// おりた橋のうえを歩いてわたれるか
const crossMoat = await hopTo([
  [57.3, 4.2, 46.6],   // 島のひがしのおび
  [57.3, 4.44, 43.6],  // 橋のうえ
  [57.3, 4.2, 40.6],   // 大聖塔の島がわ
]);
rep('I2 drawbridge2-walk', crossMoat.ok, `retries=${crossMoat.retries}`);

// ---- J: よりみち(とび石→ほしの小島→きのこでもどる) ----
const detour = await hopTo([
  [57.5, 4.2, 25.6],   // 島のみなみのふち
  [58.6, 3.4, 23],     // とび石1
  [59.6, 2.8, 20.4],   // とび石2
  [59.6, 2.2, 17.4],   // ほしの小島
]);
rep('J star-detour', detour.ok, `retries=${detour.retries}`);
// きのこバウンド: きのこのうえに立つ→vyが上むきになる
await page.evaluate(() => window.__dbg.tp(57.6, 3.6, 21.8));
let bounced = false;
for (let i = 0; i < 14 && !bounced; i++) {
  await page.waitForTimeout(200);
  const vy = await page.evaluate(() => window.__dbg.dolls.get(0).torso.velocity.y);
  if (vy > 4) bounced = true;
}
rep('K shroom-bounce', bounced);
await page.screenshot({ path: SCRATCH + '/box-c3-star.png' });

console.log('errors:', errs.length);
errs.slice(0, 8).forEach(e => console.log(' ', e));
console.log('=== GIM-C3', results.every(r => r[1]) && errs.length === 0 ? 'ALL PASS' : 'SOME FAIL', '===');
await browser.close();
