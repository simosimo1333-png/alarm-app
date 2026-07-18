import { chromium } from 'playwright';
const SCRATCH = '/tmp/claude-0/-home-user-alarm-app/7a4abfc4-78e7-58ed-a646-22083753c0a0/scratchpad';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const host = await ctx.newPage();
host.on('pageerror', e => console.log('HOST PAGEERROR', e.message));
await host.goto('http://127.0.0.1:8899/fallflat.html?local=1', { waitUntil: 'load' });
await host.waitForTimeout(1200);
await host.click('#host-btn');
await host.waitForTimeout(1500);
const code = (await host.locator('#hud-code').textContent())?.trim();
const guest = await ctx.newPage();
guest.on('pageerror', e => console.log('GUEST PAGEERROR', e.message));
await guest.goto('http://127.0.0.1:8899/fallflat.html?local=1', { waitUntil: 'load' });
await guest.waitForTimeout(1200);
await guest.fill('#code-input', code || '');
await guest.click('#join-btn');
await guest.waitForTimeout(2500);
await host.bringToFront();

// ホストの人形をゲストの人形のすぐ手前に置き、正面をむいて つかむ
await host.evaluate(() => {
  const g = window.__dbg.dolls.get(1);
  const p = g.torso.position;
  window.__dbg.tp(p.x, 0.63, p.z - 0.85);
  window.__dbg.setYaw(Math.PI);
  window.__dbg.setPitch(0.1);
  window.__dbg.setGrab(true);
  window.__dbg.pressKey('KeyW');
});
let holds = null;
for (let i = 0; i < 20 && !holds; i++) {
  await host.waitForTimeout(300);
  holds = await host.evaluate(() => {
    const d = window.__dbg.dolls.get(0);
    for (const s of d.sides) {
      if (s.grabC) {
        const other = s.grabC.bodyA === s.body ? s.grabC.bodyB : s.grabC.bodyA;
        return { grabbed: true, otherDollId: other.dollId !== undefined ? other.dollId : null };
      }
    }
    return null;
  });
}
await host.evaluate(() => { window.__dbg.releaseKey('KeyW'); window.__dbg.setGrab(false); });
await host.screenshot({ path: SCRATCH + '/char-grab-player.png' });
console.log('grab-other-player:', JSON.stringify(holds));
console.log('GRABPLAYER', holds && holds.otherDollId === 1 ? 'PASS' : 'FAIL');
await ctx.close(); await browser.close();
