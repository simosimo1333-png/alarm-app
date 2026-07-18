import { chromium } from 'playwright';

const base = 'http://127.0.0.1:8899';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 800, height: 450 }, hasTouch: true, isMobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(base + '/fallflat.html', { waitUntil: 'load' });
await page.waitForTimeout(2500);
await page.tap('#solo-btn');
await page.waitForTimeout(4000);

// ✊ひだり を押しっぱなしにして左手だけつかむ
const l = page.locator('#t-grab-l');
const box = await l.boundingBox();
await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2); // warm-up
const cdp = await ctx.newCDPSession(page);
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1 }] });
await page.waitForTimeout(2500);
await page.screenshot({ path: '/tmp/claude-0/-home-user-alarm-app/7a4abfc4-78e7-58ed-a646-22083753c0a0/scratchpad/lr-left.png' });
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await page.waitForTimeout(800);

// ✊みぎ
const r = page.locator('#t-grab-r');
const rb = await r.boundingBox();
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: rb.x + rb.width / 2, y: rb.y + rb.height / 2, id: 2 }] });
await page.waitForTimeout(2500);
await page.screenshot({ path: '/tmp/claude-0/-home-user-alarm-app/7a4abfc4-78e7-58ed-a646-22083753c0a0/scratchpad/lr-right.png' });
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

console.log('errors:', errors.length ? errors : 'none');
await browser.close();
