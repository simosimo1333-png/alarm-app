import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

async function measure(name, start, doneFn, pitchUp = -0.35) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', e => console.log('PAGEERROR', e.message));
  await page.goto('http://127.0.0.1:8899/fallflat.html', { waitUntil: 'load' });
  await page.waitForTimeout(1700);
  await page.click('#solo-btn');
  await page.waitForTimeout(2300);
  await page.evaluate(() => {
    const d = window.__dbg.dolls.get(0);
    window.__grabCount = [0, 0];
    window.__grabLog = [];
    const origTry = d.tryGrab.bind(d);
    d.tryGrab = (side) => {
      const had = !!side.grabC;
      origTry(side);
      if (!had && side.grabC) {
        const i = d.sides.indexOf(side);
        window.__grabCount[i]++;
        const p = side.body.position;
        window.__grabLog.push(['+', i, +p.y.toFixed(2)]);
      }
    };
    const origRel = d.releaseSide.bind(d);
    d.releaseSide = (side) => {
      if (side.grabC) window.__grabLog.push(['-', d.sides.indexOf(side), +window.__dbg.pos()[1].toFixed(2)]);
      origRel(side);
    };
  });
  await page.evaluate((s) => { window.__dbg.tp(...s); window.__dbg.setYaw(Math.PI); }, start);
  await page.waitForTimeout(600);
  await page.evaluate((p) => { window.__dbg.setPitch(p); window.__dbg.setGrab(true); window.__dbg.pressKey('KeyW'); }, pitchUp);
  let grabbed = false;
  for (let i = 0; i < 18 && !grabbed; i++) {
    if (i % 5 === 0) await page.evaluate(() => window.__dbg.jump());
    await page.waitForTimeout(300);
    grabbed = await page.evaluate(() => window.__dbg.dolls.get(0).sides.some(s => !!s.grabC));
  }
  await page.evaluate(() => { window.__grabCount = [0, 0]; window.__grabLog = []; window.__dbg.setPitch(0.9); });
  let done = false, pos = null;
  for (let i = 0; i < 30 && !done; i++) {
    await page.waitForTimeout(320);
    pos = await page.evaluate(() => window.__dbg.pos());
    done = doneFn(pos);
  }
  await page.waitForTimeout(800);
  const out = await page.evaluate(() => ({ c: window.__grabCount, log: window.__grabLog }));
  console.log(`${name}: regrabs L=${out.c[0]} R=${out.c[1]} topped=${done} pos=${JSON.stringify(pos?.map(n => +n.toFixed(2)))}`);
  console.log(`  timeline: ${JSON.stringify(out.log)}`);
  await page.close();
}

await measure('ロフト1.95m', [0, 0.77, 30.0], p => p[1] > 2.3 && p[2] > 31.0, -0.45);
await measure('高台z91(1.5m奥行4m)', [0, 0.7, 89.6], p => p[2] > 91.2 && p[1] > 1.95);
await browser.close();
