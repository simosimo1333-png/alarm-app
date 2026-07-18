import { chromium } from 'playwright';
const SCRATCH = '/tmp/claude-0/-home-user-alarm-app/7a4abfc4-78e7-58ed-a646-22083753c0a0/scratchpad';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
const errs = [];
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
await page.goto('http://127.0.0.1:8899/fallflat.html', { waitUntil: 'load' });
await page.waitForTimeout(1400);
await page.evaluate(() => document.querySelectorAll('#course-row button')[0].click());
await page.waitForTimeout(500);
await page.click('#solo-btn');
await page.waitForTimeout(2200);
const results = [];
const rep = (name, pass, info = '') => { results.push([name, pass]); console.log(`${name}: ${pass ? 'PASS' : 'FAIL'} ${info}`); };

// ---- A: おしてあけるドア ----
await page.evaluate(() => { window.__dbg.tp(0, 0.75, 2.2); window.__dbg.setYaw(Math.PI); });
await page.waitForTimeout(400);
await page.keyboard.down('w');
let inside = false;
for (let i = 0; i < 30 && !inside; i++) {
  await page.waitForTimeout(400);
  const p = await page.evaluate(() => window.__dbg.pos());
  inside = p[2] > 5.5;
}
await page.keyboard.up('w');
rep('A push-door', inside);
await page.screenshot({ path: SCRATCH + '/box-c1-door.png' });

// ---- B: 赤ボタン → スライドドア ----
await page.evaluate(() => {
  window.__dbg.tp(2.1, 0.75, 13.45);
  window.__dbg.setYaw(Math.PI);
  window.__dbg.setPitch(-0.17);
  window.__dbg.setGrab(true);
});
let btnOn = false;
for (let i = 0; i < 30 && !btnOn; i++) {
  await page.waitForTimeout(300);
  btnOn = await page.evaluate(() => window.__dbg.gim.buttons[0].on);
}
await page.evaluate(() => window.__dbg.setGrab(false));
let doorY = 99;
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(300);
  doorY = await page.evaluate(() => window.__dbg.objs[window.__dbg.gim.buttons[0].doorIdx].body.position.y);
  if (doorY < -1.0) break;
}
rep('B button-door', btnOn && doorY < -1.0, `doorY=${doorY.toFixed(2)}`);
await page.screenshot({ path: SCRATCH + '/box-c1-button.png' });

// ---- C: 木箱 → 床スイッチ → とびら ----
const crateIdx = await page.evaluate(() => window.__dbg.objs.findIndex(o => o.mass === 12 && o.home.p[2] <= 21));
let onPad = false;
for (let i = 0; i < 80 && !onPad; i++) {
  const st = await page.evaluate(({ crateIdx }) => {
    const d = window.__dbg;
    const c = d.objs[crateIdx].body.position;
    const pad = d.gim.pads[0].padPos;
    const dx = pad[0] - c.x, dz = pad[2] - c.z;
    const L = Math.hypot(dx, dz) || 1;
    let ux, uz;
    if (Math.abs(dz) >= Math.abs(dx)) { ux = 0; uz = Math.sign(dz); }
    else { ux = Math.sign(dx); uz = 0; }
    d.setYaw(Math.atan2(-ux, -uz));
    const me = d.pos();
    let bx = c.x - ux * 1.1, bz = c.z - uz * 1.1;
    bx = Math.max(-4.6, Math.min(4.6, bx));
    bz = Math.max(15.6, Math.min(25.2, bz));
    if (Math.hypot(me[0] - bx, me[2] - bz) > 1.0 || me[1] < 0.3 || me[1] > 1.4) d.tp(bx, 0.78, bz);
    return { L: +L.toFixed(2) };
  }, { crateIdx });
  await page.keyboard.down('w');
  await page.waitForTimeout(st.L > 0.8 ? 600 : 200);
  if (st.L < 0.75) { await page.keyboard.up('w'); await page.waitForTimeout(150); }
  onPad = await page.evaluate(({ crateIdx }) => {
    const d = window.__dbg;
    const c = d.objs[crateIdx].body.position;
    const pad = d.gim.pads[0].padPos;
    return Math.abs(c.x - pad[0]) < 0.9 && Math.abs(c.z - pad[2]) < 0.9;
  }, { crateIdx });
}
await page.keyboard.up('w');
await page.evaluate(() => window.__dbg.tp(0, 0.8, 18));
let gateY = 99;
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(300);
  gateY = await page.evaluate(() => window.__dbg.objs[window.__dbg.gim.pads[0].gateIdx].body.position.y);
  if (gateY < -1.0) break;
}
rep('C crate-switch-door', onPad && gateY < -1.0, `onPad=${onPad} gateY=${gateY.toFixed(2)}`);
await page.screenshot({ path: SCRATCH + '/box-c1-pad.png' });

// ---- D: まとあて（箱を高いボタンへぶつける → 生けがきの門） ----
const throwIdx = await page.evaluate(() => window.__dbg.objs.findIndex(o => o.mass === 5));
const dBefore = await page.evaluate(() => {
  const bt = window.__dbg.gim.buttons[1];
  return { on: bt.on, doorY: +window.__dbg.objs[bt.doorIdx].body.position.y.toFixed(2) };
});
let dOn = false, dDoorY = 99;
for (let att = 0; att < 5 && !dOn; att++) {
  await page.evaluate((i) => {
    const b = window.__dbg.objs[i].body;
    b.wakeUp();
    b.position.set(22.3, 3.25, 35.4);
    b.velocity.set(7.5, 1.2, 0);
    b.angularVelocity.setZero();
  }, throwIdx);
  for (let i = 0; i < 10 && !dOn; i++) {
    await page.waitForTimeout(300);
    dOn = await page.evaluate(() => window.__dbg.gim.buttons[1].on);
  }
}
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(300);
  dDoorY = await page.evaluate(() => window.__dbg.objs[window.__dbg.gim.buttons[1].doorIdx].body.position.y);
  if (dDoorY < dBefore.doorY - 0.8) break;
}
rep('D target-button-gate', dOn && dDoorY < dBefore.doorY - 0.8, `on=${dOn} doorY ${dBefore.doorY}->${dDoorY.toFixed(2)}`);
await page.screenshot({ path: SCRATCH + '/box-c1-target.png' });

// ---- 歩きヘルパー ----
async function hopTo(targets) {
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

// ---- E: シーソー橋をわたる（ルートA） ----
const seesaw = await hopTo([
  [25.4, 0.03, 31.6],
  [28.2, 0.55, 31.6],   // 板の西がわ
  [30.1, 0.85, 31.6],   // シーソーのまんなか
  [34.8, 0, 31.6],      // 果樹園の島
]);
rep('E seesaw-cross', seesaw.ok, `retries=${seesaw.retries} stuckAt=${seesaw.at ?? '-'}`);
await page.screenshot({ path: SCRATCH + '/box-c1-seesaw.png' });

// ---- F: ゆれるつり橋をわたる（ルートA） ----
const bridge = await hopTo([
  [40.4, 0, 31.6],
  [45.6, -0.35, 31.6],  // 橋のまんなか（たわみ）
  [50.8, 0.03, 31.6],   // テラス
]);
rep('F hanging-bridge', bridge.ok, `retries=${bridge.retries} stuckAt=${bridge.at ?? '-'}`);
await page.screenshot({ path: SCRATCH + '/box-c1-bridge.png' });

// ---- G: バウンドきのこ（ルートB） ----
await page.evaluate(() => { window.__dbg.tp(29.0, 1.8, 44.4); const d = window.__dbg.dolls.get(0); d.torso.velocity.setZero(); });
let maxY = -9, bounces = 0, lastVy = 0;
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(150);
  const st = await page.evaluate(() => {
    const d = window.__dbg.dolls.get(0);
    return [d.torso.position.y, d.torso.velocity.y];
  });
  maxY = Math.max(maxY, st[0]);
  if (lastVy < -1 && st[1] > 2) bounces++;
  lastVy = st[1];
}
rep('G shroom-bounce', bounces >= 1 && maxY > 1.4, `bounces=${bounces} maxY=${maxY.toFixed(2)}`);
await page.screenshot({ path: SCRATCH + '/box-c1-shroom.png' });

// ---- H: くさりターザン（テラス高台 → そらのテラス） ----
let tarzanOk = false, tHold = false;
for (let att = 0; att < 8 && !tarzanOk; att++) {
  await page.evaluate(() => {
    const d = window.__dbg;
    d.tp(55, 2.15, 42.8);
    const doll = d.dolls.get(0);
    doll.torso.velocity.setZero(); doll.limpUntil = 0; doll.staggerUntil = 0;
    d.setYaw(Math.PI);
    d.setPitch(-0.5);
    d.setGrab(true);
  });
  await page.waitForTimeout(450);
  await page.keyboard.down('w');
  let holding = false, jumpArmed = true;
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(160);
    const st = await page.evaluate(() => {
      const d = window.__dbg;
      const ch = d.gim.chains[0];
      const set = new Set(ch.links.map(i => d.objs[i].body));
      const doll = d.dolls.get(0);
      const hold = doll.sides.some(s => s.grabC && set.has(s.grabC.bodyB));
      const p = doll.torso.position;
      return { hold, z: p.z, y: p.y, vz: doll.torso.velocity.z, vy: doll.torso.velocity.y };
    });
    if (jumpArmed && st.z > 43.2) { await page.evaluate(() => window.__dbg.jump()); if (st.vy > 1.5) jumpArmed = false; }
    if (st.hold) { holding = true; tHold = true; }
    if (holding && st.z > 47.2 && st.vz > 1) {
      await page.evaluate(() => window.__dbg.setGrab(false));
    }
    if (st.z > 48.7 && st.y > 0.2) { tarzanOk = true; break; }
    if (st.y < -2.5) break;
  }
  await page.keyboard.up('w');
  await page.evaluate(() => { window.__dbg.setGrab(false); window.__dbg.setPitch(0.22); });
  await page.waitForTimeout(300);
}
rep('H tarzan', tarzanOk, `held=${tHold}`);
await page.screenshot({ path: SCRATCH + '/box-c1-tarzan.png' });

// ---- I: チェックポイント（ルートA）→ ゴール ----
await page.evaluate(() => window.__dbg.tp(0, 0.9, 0.5));
await page.waitForTimeout(400);
await page.evaluate(() => { window.__dbg.dolls.get(0).cp = 0; });
const cpSpots = [
  [0, 0.9, 16.5], [0, 0.9, 27.5], [3, 2.9, 34.5], [9.1, 0.9, 38],
  [25.8, 0.9, 38], [35.4, 0.9, 31.6], [51.4, 0.9, 38], [55, 0.9, 50.5],
];
for (const [x, y, z] of cpSpots) {
  await page.evaluate(([x, y, z]) => window.__dbg.tp(x, y, z), [x, y, z]);
  await page.waitForTimeout(450);
}
const cpA = await page.evaluate(() => window.__dbg.dolls.get(0).cp);
rep('I cp-routeA', cpA === 8, `cp=${cpA}`);
// ルートB（きのこの休けい島）ゾーン
await page.evaluate(() => window.__dbg.tp(39.6, 0.4, 44.4));
await page.waitForTimeout(400);
await page.evaluate(() => { window.__dbg.dolls.get(0).cp = 5; });
await page.waitForTimeout(500);
const cpB = await page.evaluate(() => window.__dbg.dolls.get(0).cp);
rep('I2 cp-routeB', cpB === 6, `cp=${cpB}`);
// ゴール
await page.evaluate(() => window.__dbg.tp(55, 0.9, 53));
let goal = false;
for (let i = 0; i < 10 && !goal; i++) {
  await page.waitForTimeout(300);
  goal = await page.evaluate(() => window.__dbg.metas.get(0).goal);
}
rep('J goal', goal);

console.log('errors:', errs.length);
errs.slice(0, 8).forEach(e => console.log(' ', e));
console.log('=== BOX-C1-GIM', results.every(r => r[1]) && errs.length === 0 ? 'ALL PASS' : 'SOME FAIL', '===');
await browser.close();
