import { chromium } from 'playwright';
const SCRATCH = '/tmp/claude-0/-home-user-alarm-app/7a4abfc4-78e7-58ed-a646-22083753c0a0/scratchpad';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 640, height: 360 } });
const errsH = [], errsG = [];
const host = await ctx.newPage();
host.on('pageerror', e => errsH.push(e.message));
host.on('console', m => { if (m.type() === 'error') errsH.push(m.text()); });
await host.goto('http://127.0.0.1:8899/fallflat.html?local=1', { waitUntil: 'load' });
await host.waitForTimeout(1200);
await host.evaluate(() => document.querySelectorAll('#course-row button')[2].click());
await host.waitForTimeout(400);
await host.click('#host-btn');
await host.waitForTimeout(2000);
const code = (await host.locator('#hud-code').textContent()).trim();
const guest = await ctx.newPage();
guest.on('pageerror', e => errsG.push(e.message));
guest.on('console', m => { if (m.type() === 'error') errsG.push(m.text()); });
await guest.goto('http://127.0.0.1:8899/fallflat.html?local=1', { waitUntil: 'load' });
await guest.waitForTimeout(1200);
await guest.fill('#code-input', code);
await guest.click('#join-btn');
await guest.waitForTimeout(3000);
const [hN, gN] = await Promise.all([
  host.evaluate(() => window.__dbg.objs.length),
  guest.evaluate(() => window.__dbg.objs.length),
]);
console.log('objs host/guest:', hN, gN, hN === gN ? 'OK' : 'NG');
// ホストで はねばし2 をひらく → ゲストの板メッシュ角度/位置が追従するか
await host.evaluate(() => { window.__dbg.gim.drawbridges[1].open = true; });
await host.waitForTimeout(5000);
const dbIdx = await host.evaluate(() => window.__dbg.gim.drawbridges[1].idx);
const [hB, gB] = await Promise.all([
  host.evaluate((i) => { const b = window.__dbg.objs[i].body; return [+b.position.x.toFixed(2), +b.position.y.toFixed(2), +b.position.z.toFixed(2)]; }, dbIdx),
  guest.evaluate((i) => { const m = window.__dbg.objs[i].mesh; return [+m.position.x.toFixed(2), +m.position.y.toFixed(2), +m.position.z.toFixed(2)]; }, dbIdx),
]);
const d = Math.hypot(hB[0] - gB[0], hB[1] - gB[1], hB[2] - gB[2]);
console.log('drawbridge2 host', JSON.stringify(hB), 'guest', JSON.stringify(gB), 'diff', d.toFixed(2), d < 0.35 ? 'OK' : 'NG');
console.log('errors:', errsH.length + errsG.length);
console.log('MP C3:', hN === gN && d < 0.35 && errsH.length + errsG.length === 0 ? 'PASS' : 'FAIL');
await browser.close();
