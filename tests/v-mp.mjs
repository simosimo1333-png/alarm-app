import { chromium } from 'playwright';
const SCRATCH = '/tmp/claude-0/-home-user-alarm-app/7a4abfc4-78e7-58ed-a646-22083753c0a0/scratchpad';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 640, height: 360 } });
const errsH = [], errsG = [];

const host = await ctx.newPage();
host.on('pageerror', e => errsH.push('pageerror: ' + e.message));
host.on('console', m => { if (m.type() === 'error') errsH.push('console: ' + m.text()); });
await host.goto('http://127.0.0.1:8899/fallflat.html?local=1', { waitUntil: 'load' });
await host.waitForTimeout(1200);
await host.evaluate(() => document.querySelectorAll('#course-row button')[0].click());
await host.waitForTimeout(400);
await host.click('#host-btn');
await host.waitForTimeout(2000);
const code = (await host.locator('#hud-code').textContent()).trim();
console.log('room code:', code);

const guest = await ctx.newPage();
guest.on('pageerror', e => errsG.push('pageerror: ' + e.message));
guest.on('console', m => { if (m.type() === 'error') errsG.push('console: ' + m.text()); });
await guest.goto('http://127.0.0.1:8899/fallflat.html?local=1', { waitUntil: 'load' });
await guest.waitForTimeout(1200);
await guest.fill('#code-input', code);
await guest.click('#join-btn');
await guest.waitForTimeout(3000);

const gState = await guest.evaluate(() => ({
  state: window.__dbg.state, isHost: window.__dbg.isHost, course: window.__dbg.course,
  nObjs: window.__dbg.objs.length, players: window.__dbg.metas.size, snaps: window.__dbg.snaps.length,
}));
const hState = await host.evaluate(() => ({ nObjs: window.__dbg.objs.length, players: window.__dbg.metas.size }));
console.log('guest:', JSON.stringify(gState), 'host:', JSON.stringify(hState));

// ---- ホストでボタンをおしてスライドドアをうごかし、ゲストに同期するか ----
await host.evaluate(() => {
  window.__dbg.tp(2.1, 0.75, 13.45);
  window.__dbg.setYaw(Math.PI);
  window.__dbg.setPitch(-0.17);
  window.__dbg.setGrab(true);
});
let btnOn = false;
for (let i = 0; i < 25 && !btnOn; i++) {
  await host.waitForTimeout(300);
  btnOn = await host.evaluate(() => window.__dbg.gim.buttons[0].on);
}
await host.evaluate(() => window.__dbg.setGrab(false));
console.log('host pressed button:', btnOn);
// ホストで木箱もうごかす（動的物の同期テスト）
await host.evaluate(() => {
  const b = window.__dbg.objs[7].body;
  b.wakeUp(); b.velocity.set(-1.5, 2, 1.5);
});
await host.waitForTimeout(4000);

// 位置くらべ（door=スライドドア kinematic, crate=木箱 dynamic, 玄関ヒンジドア=idx0）
const doorIdx = await host.evaluate(() => window.__dbg.gim.buttons[0].doorIdx);
// 新セクションの動的オブジェクト: つり橋の板・なげる箱もうごかして同期をみる
const extIdx = await host.evaluate(() => ({
  plank: window.__dbg.gim.plankBridges[0].planks[2],
  cube: window.__dbg.objs.findIndex(o => o.mass === 5),
}));
await host.evaluate(({ plank, cube }) => {
  const p = window.__dbg.objs[plank].body;
  p.wakeUp(); p.velocity.set(0, 1.5, 0);            // 板をゆらす
  const c = window.__dbg.objs[cube].body;
  c.wakeUp(); c.velocity.set(1.5, 2, 1);            // 箱をとばす
}, extIdx);
await host.waitForTimeout(2500);
const idxList = [doorIdx, 7, 0, extIdx.plank, extIdx.cube];
const cmp = await Promise.all([
  host.evaluate((idxList) => idxList.map(i => {
    const b = window.__dbg.objs[i].body;
    return [+b.position.x.toFixed(2), +b.position.y.toFixed(2), +b.position.z.toFixed(2)];
  }), idxList),
  guest.evaluate((idxList) => idxList.map(i => {
    const m = window.__dbg.objs[i].mesh;
    return [+m.position.x.toFixed(2), +m.position.y.toFixed(2), +m.position.z.toFixed(2)];
  }), idxList),
]);
const names = ['slideDoor', 'crate', 'hingeDoor', 'bridgePlank', 'throwCube'];
let allOk = true;
for (let k = 0; k < names.length; k++) {
  const [h, g] = [cmp[0][k], cmp[1][k]];
  const d = Math.hypot(h[0] - g[0], h[1] - g[1], h[2] - g[2]);
  const ok = d < 0.35;
  allOk = allOk && ok;
  console.log(`sync ${names[k]}: host=${JSON.stringify(h)} guest=${JSON.stringify(g)} diff=${d.toFixed(2)} ${ok ? 'OK' : 'NG'}`);
}
// スライドドアがひらいた状態（さがった）で同期しているか
const doorLow = cmp[1][0][1] < 0.0;
console.log('guest sees door lowered:', doorLow, cmp[1][0][1]);
console.log('MP OBJ SYNC:', (allOk && btnOn && doorLow) ? 'PASS' : 'FAIL');

// ゲスト側でホストのキャラ・じぶんのキャラが見えているところをスクショ
await host.bringToFront();
await host.screenshot({ path: SCRATCH + '/mp-obj-host.png' });
await guest.bringToFront();
await guest.screenshot({ path: SCRATCH + '/mp-obj-guest.png' });
console.log('host errors:', errsH.length, 'guest errors:', errsG.length);
[...errsH, ...errsG].slice(0, 6).forEach(e => console.log(' ', e));
await browser.close();
