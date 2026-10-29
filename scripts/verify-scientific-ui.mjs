/** Owned local browser QA. No external accounts, credentials, deployment or real auth POSTs. */
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';

const { chromium } = await import(pathToFileURL(resolve(process.env.HESSARA_PLAYWRIGHT_MODULE || '.vercel/rea-tool/node_modules/playwright-core/index.mjs')).href);
const origin = process.env.HESSARA_QA_ORIGIN || 'http://127.0.0.1:5173';
const parsed = new URL(origin);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) || parsed.protocol !== 'http:') throw new Error('QA only accepts an owned loopback HTTP preview');
const axeSource = await readFile(resolve('node_modules/axe-core/axe.min.js'), 'utf8');
const output = resolve('docs/refinement-ui');
await mkdir(output, { recursive: true });
const report = { date: new Date().toISOString(), origin, environment: 'owned headless Chrome, local preview, no CPU/network throttling', limits: ['Single local lab run; not field Core Web Vitals or Lighthouse.', 'Local auth mutation readiness now fails closed for missing database/vault. Enabled form states use a presentation fixture and mocked responses, not a provider login.', 'No production data, accounts, session tokens or credentials used.'], checks: [], pages: [], fixtures: [], failures: [] };
function check(name, passed, evidence) { report.checks.push({ name, passed: !!passed, evidence }); writeFileSync(resolve(output, "verification-progress.json"), JSON.stringify(report, null, 2)); }
console.log("QA: loading current authentication styles");
async function within(task, milliseconds, label) {
  let timer;
  try { return await Promise.race([task, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} exceeded ${milliseconds}ms`)), milliseconds); })]); }
  finally { clearTimeout(timer); }
}
const signinHTML = await (await fetch(`${origin}/signin?lang=ar`, { signal: AbortSignal.timeout(20000) })).text();
const styles = [...signinHTML.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/g)].map(([tag]) => tag.match(/href="([^"]+)"/)?.[1]).filter(Boolean);
console.log("QA: bundling actual form fixture");
const result = await build({ absWorkingDir: process.cwd(), stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {SignInForm} from './app/signin/signin-form'; const q=new URLSearchParams(location.search); const locale=q.get('lang')==='en'?'en':'ar'; createRoot(document.getElementById('qa-root')).render(<main className="signin-page" dir={locale==='ar'?'rtl':'ltr'} lang={locale}><section className="signin-panel" aria-labelledby="signin-title"><SignInForm locale={locale} configured={true} availability={{email:true,password:true,linking:true,providers:{google:true}}} session="none" next="/" expired={false} initialMode={q.get('mode')==='signup'?'signup':'signin'} /></section></main>);`, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', minify: true, loader: { '.css': 'empty' }, define: { 'process.env.NODE_ENV': '"production"' }, plugins: [{ name: 'qa-native-next-presentation', setup(builder) { builder.onResolve({ filter: /^next\/(link|image)$/ }, args => ({ path: args.path, namespace: 'qa-next' })); builder.onLoad({ filter: /.*/, namespace: 'qa-next' }, args => ({ contents: args.path.endsWith('link') ? "import React from 'react';export default function Link(props){return React.createElement('a',props);}" : "import React from 'react';export default function Image({fill,priority,preload,unoptimized,...props}){return React.createElement('img',props);}", loader: 'js', resolveDir: process.cwd() })); } }] });
const fixtureHTML = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${styles.map(url => `<link rel="stylesheet" href="${url}">`).join('')}<title>HESSARA local presentation test — mocked authentication</title></head><body><div id="qa-root"></div><script>${result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
console.log("QA: launching owned local Chrome");
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--disable-extensions', '--disable-background-networking'], timeout: 60000 });
try {
  for (const [device, viewport] of [['desktop', { width: 1536, height: 823 }], ['mobile', { width: 390, height: 844 }]]) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: 'ar-SA', reducedMotion: 'no-preference', hasTouch: device === 'mobile', isMobile: device === 'mobile' });
    await context.route('**/*', route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== origin && !['data:', 'blob:'].includes(url.protocol)) return route.abort('blockedbyclient');
      if (url.pathname === '/__qa/auth') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fixtureHTML });
      if (url.pathname.startsWith('/api/') && request.method() !== 'GET') return route.fulfill({ status: 418, contentType: 'application/json', body: JSON.stringify({ code: 'failed' }) });
      return route.continue();
    });
    await context.addInitScript(() => {
      window.__hessaraQA = { lcp: null, cls: 0, shifts: [], events: [], supported: PerformanceObserver.supportedEntryTypes };
      let sessionStart = 0, lastShift = 0, sessionValue = 0;
      const observe = (type, callback, extra = {}) => { if (PerformanceObserver.supportedEntryTypes.includes(type)) new PerformanceObserver(list => callback(list.getEntries())).observe({ type, buffered: true, ...extra }); };
      observe('largest-contentful-paint', entries => { for (const entry of entries) window.__hessaraQA.lcp = { milliseconds: entry.startTime, size: entry.size, tag: entry.element?.tagName, className: String(entry.element?.className || ''), url: entry.url || null }; });
      observe('layout-shift', entries => { for (const entry of entries) if (!entry.hadRecentInput) { if (!sessionStart || entry.startTime - lastShift > 1000 || entry.startTime - sessionStart > 5000) { sessionStart = entry.startTime; sessionValue = 0; } sessionValue += entry.value; lastShift = entry.startTime; window.__hessaraQA.cls = Math.max(window.__hessaraQA.cls, sessionValue); window.__hessaraQA.shifts.push({ time: entry.startTime, value: entry.value }); } });
      observe('event', entries => { for (const entry of entries) if (entry.interactionId) window.__hessaraQA.events.push({ name: entry.name, duration: entry.duration, interactionId: entry.interactionId, target: entry.target?.id || entry.target?.tagName || null }); }, { durationThreshold: 16 });
    });
    const page = await context.newPage();
    for (const [kind, path] of [['overview', '/?lang=ar'], ['signin', '/signin?lang=ar']]) {
      const errors = [], httpErrors = [];
      const onPageError = error => errors.push({ kind: 'runtime', text: error.message });
      const onConsole = message => { if (message.type() === 'error') errors.push({ kind: 'console', text: message.text() }); };
      const onResponse = response => { if (response.status() >= 400) httpErrors.push({ status: response.status(), url: response.url() }); };
      page.on('pageerror', onPageError); page.on('console', onConsole); page.on('response', onResponse);
      console.log(`QA: ${device}/${kind} navigation`);
      const response = await page.goto(`${origin}${path}`, { waitUntil: 'networkidle', timeout: 60000 });
      console.log(`QA: ${device}/${kind} fonts and capture`);
      await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(400);
      const screenshot = `${kind}-${device}.png`; await page.screenshot({ path: resolve(output, screenshot), fullPage: kind === 'signin' });
      const info = await page.evaluate(() => {
        const visible = element => !!(element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden');
        const rect = element => { const box = element?.getBoundingClientRect(); return box ? { x: box.x, y: box.y, width: box.width, height: box.height, bottom: box.bottom } : null; };
        return { title: document.title, lang: document.documentElement.lang, dir: document.documentElement.dir, width: innerWidth, scrollWidth: document.documentElement.scrollWidth, h1: [...document.querySelectorAll('h1')].filter(visible).map(e => e.textContent), videos: document.querySelectorAll('video').length, canvases: document.querySelectorAll('canvas').length, diagrams: document.querySelectorAll('.scientific-visual').length, poster: [...document.images].map(e => ({ src: e.currentSrc, complete: e.complete, width: e.naturalWidth, height: e.naturalHeight })), submit: rect(document.querySelector('.signin-submit')), emptyButtons: [...document.querySelectorAll('button')].filter(visible).filter(e => !e.textContent.trim() && !e.getAttribute('aria-label') && !e.getAttribute('aria-labelledby')).length, fields: [...document.querySelectorAll('.signin-content input')].map(e => ({ id: e.id, type: e.type, disabled: e.matches(':disabled'), labelled: e.type === 'checkbox' ? !!e.closest('label') : !!document.querySelector(`label[for="${e.id}"]`) })), metrics: window.__hessaraQA, resources: performance.getEntriesByType('resource').map(e => ({ url: e.name, initiator: e.initiatorType, transferSize: e.transferSize, encodedBodySize: e.encodedBodySize, decodedBodySize: e.decodedBodySize })) };
      });
      check(`${kind}/${device}: no horizontal overflow`, info.scrollWidth <= info.width, { width: info.width, scrollWidth: info.scrollWidth });
      check(`${kind}/${device}: no unnamed visible buttons`, info.emptyButtons === 0, info.emptyButtons);
      check(`${kind}/${device}: HTTP 200`, response?.status() === 200, response?.status());
      check(`${kind}/${device}: no runtime/console errors`, errors.length === 0, errors);
      check(`${kind}/${device}: no media videos`, info.videos === 0, info.videos);
      if (kind === 'signin') {
        const minimal = await page.evaluate(() => ({art:document.querySelectorAll('.signin-editorial,.signin-architecture,aside,video,canvas').length, promo:/اختبر النماذج على مهام واضحة|مرحبًا بك مجددًا|Welcome back/.test(document.querySelector('main')?.textContent||''), panel:document.querySelector('.signin-panel')?.getBoundingClientRect().width}));
        check(`signin/${device}: functional-only form without artwork or welcome copy`,minimal.art===0&&!minimal.promo&&minimal.panel<=408,minimal);
        check(`${kind}/${device}: persistent field labels`, info.fields.every(e => e.labelled), info.fields); if (device === 'mobile') check('signin/mobile: primary action within initial viewport', info.submit?.bottom <= viewport.height, info.submit); }
      await page.addScriptTag({ content: axeSource });
      const accessibility = await page.evaluate(async () => { const results = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } }); return { violations: results.violations.map(({ id, impact, description, helpUrl, nodes }) => ({ id, impact, description, helpUrl, nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })) })), incomplete: results.incomplete.map(({ id, impact, nodes }) => ({ id, impact, nodes: nodes.length })), passedRules: results.passes.length }; });
      check(`${kind}/${device}: automated WCAG A/AA rules`, accessibility.violations.length === 0, accessibility.violations);
      const pageReport = { kind, device, screenshot, status: response?.status(), ...info, accessibility, errors, httpErrors };
      if (kind === 'overview') {
        const appearance = await page.evaluate(() => ({
          captions:document.querySelectorAll('.science-caption').length,
          openingCaption:document.querySelector('.scientific-visual--network figcaption')?.textContent ?? null,
          obsoleteCopy:/طبقات مترابطة|Connected layers\. Directed signals/.test(document.querySelector('.editions-experience')?.textContent||''),
          destinations:document.querySelectorAll('.edition-directory li').length,
          palette:[...document.querySelectorAll('.scientific-visual,.scientific-canvas,.science-caption')].map(e=>({background:getComputedStyle(e).backgroundColor,kind:e.className})),
          quality:document.querySelector('.scientific-visual--network')?.getAttribute('data-quality')
        }));
        check('overview/'+device+': neural caption removed and twelve destinations retained',appearance.captions===3&&!appearance.openingCaption&&!appearance.obsoleteCopy&&appearance.destinations===12,appearance);
        check('overview/'+device+': seamless Pale Moor art surfaces',appearance.palette.every(e=>e.background==='rgb(171, 186, 197)'),appearance.palette);
        check('overview/'+device+': adaptive SVG paint detail',appearance.quality===(device==='mobile'?'compact':'full'),appearance.quality);
        const frames = () => page.evaluate(() => document.getAnimations().filter(a => a.playState === 'running' && a.effect?.target?.closest('.scientific-visual')).map(a => ({ time: a.currentTime, target: a.effect?.target?.getAttribute('class'), duration: a.effect?.getTiming().duration })));
        pageReport.visibility = await page.locator('.scientific-visual').evaluateAll(figures => figures.map(figure => { const box = figure.getBoundingClientRect(); return { running: figure.dataset.running, visible: box.bottom > 0 && box.top < innerHeight }; }));
        check(`overview/${device}: offscreen diagrams are paused`, pageReport.visibility.filter(figure => !figure.visible).every(figure => figure.running === 'false'), pageReport.visibility);
        const first = await frames(); await page.waitForTimeout(280); const second = await frames();
        pageReport.animationSample = { before: first, after: second, advanced: second.some((a, i) => typeof a.time === 'number' && typeof first[i]?.time === 'number' && a.time > first[i].time) };
        check(`overview/${device}: scientific propagation advances`, pageReport.animationSample.advanced, { countBefore: first.length, countAfter: second.length });
        const pause = page.locator('.edition-motion-toggle');
        if (await pause.count()) { await pause.click(); await page.waitForTimeout(100); pageReport.pausedRunningAnimations = await frames(); check(`overview/${device}: page pause stops animation`, pageReport.pausedRunningAnimations.length === 0, pageReport.pausedRunningAnimations); await pause.click(); }
        await page.emulateMedia({ reducedMotion: 'reduce' }); await page.waitForTimeout(120);
        pageReport.reducedMotionRunningAnimations = await frames(); check(`overview/${device}: reduced motion stops animations`, pageReport.reducedMotionRunningAnimations.length === 0, pageReport.reducedMotionRunningAnimations);
        await page.screenshot({ path: resolve(output, `overview-${device}-reduced-motion.png`) });
        if (device === 'desktop') { await page.setViewportSize({ width: 1536, height: 1200 }); pageReport.plates = []; const figures = page.locator('.scientific-visual'); for (let index = 0; index < await figures.count(); index++) { const figure = figures.nth(index); await figure.scrollIntoViewIfNeeded(); await figure.evaluate(element => window.scrollBy(0, element.getBoundingClientRect().top - 180)); await page.waitForTimeout(80); const filename = `scientific-plate-${index + 1}.png`; await figure.screenshot({ path: resolve(output, filename) }); pageReport.plates.push(filename); } await page.setViewportSize(viewport); }
                await page.locator('.edition-primary').click();
        await page.locator('.app[data-view="llms"]').waitFor();
        check(`overview/${device}: primary action opens existing model workspace`, new URL(page.url()).searchParams.get('view') === 'llms', page.url());
        await page.goBack(); await page.locator('.edition-secondary').waitFor();
        await page.locator('.edition-secondary').click();
        await page.locator('.app[data-view="how"]').waitFor();
        check(`overview/${device}: explanation opens existing guide`, new URL(page.url()).searchParams.get('view') === 'how', page.url());
        await page.goBack(); await page.locator('.edition-primary').waitFor();
        pageReport.interactionMetrics = await page.evaluate(() => window.__hessaraQA);
        await page.emulateMedia({ reducedMotion: 'no-preference' });
      }
      report.pages.push(pageReport);
      page.off('pageerror', onPageError); page.off('console', onConsole); page.off('response', onResponse);
    }
    await page.goto(`${origin}/__qa/auth?lang=ar`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.locator('#signin-email').waitFor(); await page.evaluate(() => document.fonts.ready);
    console.log(`QA: ${device}/enabled-form fixture`);
    const fixture = { device, mocked: true, credentials: 'synthetic qa@example.invalid only', checks: [], screenshots: [] };
    console.log(`QA: ${device}/fixture injecting axe`);
    await within(page.addScriptTag({ content: axeSource }), 10000, "Fixture axe injection"); console.log(`QA: ${device}/fixture auditing accessibility`); fixture.accessibility = await within(page.evaluate(async () => { const results = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } }); return { violations: results.violations.map(({ id, impact, nodes }) => ({ id, impact, nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })) })), passedRules: results.passes.length }; }), 30000, "Fixture axe audit");
    check(`mock signin/${device}: enabled form automated WCAG rules`, fixture.accessibility.violations.length === 0, fixture.accessibility.violations);
    console.log(`QA: ${device}/fixture keyboard and validation`);
    await page.locator('#signin-email').focus(); await page.screenshot({ path: resolve(output, `signin-${device}-focus.png`), fullPage: true }); fixture.screenshots.push(`signin-${device}-focus.png`);
    const focus = await page.locator('#signin-email').evaluate(e => ({ active: document.activeElement === e, outline: getComputedStyle(e).outline, parentShadow: getComputedStyle(e.parentElement).boxShadow })); check(`mock signin/${device}: email focus`, focus.active && (focus.outline !== 'none' || focus.parentShadow !== 'none'), focus);
    await page.locator('#signin-email').press('Tab'); check(`mock signin/${device}: keyboard reaches password`, await page.locator('#signin-password').evaluate(e => document.activeElement === e));
    await page.locator('#signin-email').fill('invalid-address'); await page.locator('#signin-password').fill('Hessara-QA-only-password'); await page.locator('button.signin-submit').click();
    check(`mock signin/${device}: native email validation`, await page.locator('#signin-email').evaluate(e => e.validity.typeMismatch && !e.validity.valid));
    await page.locator('#signin-email').fill('qa@example.invalid');
    await page.locator('.signin-eye').click(); check(`mock signin/${device}: password show`, await page.locator('#signin-password').getAttribute('type') === 'text'); await page.locator('.signin-eye').click();
    let release; const hold = new Promise(resolveHold => { release = resolveHold; });
    const requests = [];
    await page.route('**/api/auth', async route => { requests.push(route.request().postDataJSON()); await hold; await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 'invalid' }) }); });
    await page.locator('button.signin-submit').click(); await page.locator('.signin-options[aria-busy="true"]').waitFor();
    check(`mock signin/${device}: submitting disables fieldset`, await page.locator('fieldset').evaluate(fieldset => fieldset.disabled && fieldset.querySelector('#signin-email').matches(':disabled') && fieldset.querySelector('button[type=submit]').matches(':disabled'))); await page.screenshot({ path: resolve(output, `signin-${device}-loading.png`), fullPage: true }); fixture.screenshots.push(`signin-${device}-loading.png`);
    release(); await page.locator('#signin-message[role="alert"]').waitFor(); await page.screenshot({ path: resolve(output, `signin-${device}-error.png`), fullPage: true }); fixture.screenshots.push(`signin-${device}-error.png`);
    check(`mock signin/${device}: error recovery enables inputs`, await page.locator('#signin-email').isEnabled()); check(`mock signin/${device}: actual signin payload`, requests.length === 1 && requests[0].action === 'signin' && requests[0].email === 'qa@example.invalid');
    await page.unroute('**/api/auth');
    await page.locator('.signin-forgot').click(); check(`mock signin/${device}: recovery removes password`, await page.locator('#signin-password').count() === 0);
    await page.route('**/api/auth', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: 'recoverySent' }) }));
    await page.locator('button.signin-submit').click(); await page.locator('#signin-message[role="status"]').waitFor(); fixture.recoveryStatus = await page.locator('#signin-message').textContent();
    await page.screenshot({ path: resolve(output, `signin-${device}-recovery.png`), fullPage: true }); fixture.screenshots.push(`signin-${device}-recovery.png`);
    fixture.signinInteractionMetrics = await page.evaluate(() => window.__hessaraQA);
    await page.goto(`${origin}/__qa/auth?lang=ar&mode=signup`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.locator('#signin-email').press('Tab'); check(`mock signin/${device}: keyboard reaches password`, await page.locator('#signin-password').evaluate(e => document.activeElement === e));
    await page.locator('#signin-email').fill('invalid-address'); await page.locator('#signin-password').fill('Hessara-QA-only-password'); await page.locator('button.signin-submit').click();
    check(`mock signin/${device}: native email validation`, await page.locator('#signin-email').evaluate(e => e.validity.typeMismatch && !e.validity.valid));
    await page.locator('#signin-email').fill('qa@example.invalid'); await page.locator('#signin-confirmation').fill('Hessara-QA-other-password'); await page.locator('button.signin-submit').click(); await page.locator('#signin-message[role="alert"]').waitFor();
    fixture.signupMismatch = await page.locator('#signin-message').textContent(); check(`mock signup/${device}: mismatch feedback`, fixture.signupMismatch === 'كلمتا المرور غير متطابقتين.', fixture.signupMismatch);
    await page.screenshot({ path: resolve(output, `signup-${device}-validation.png`), fullPage: true }); fixture.screenshots.push(`signup-${device}-validation.png`);
    await page.unroute('**/api/auth'); let oauthPayload;
    await page.route('**/api/auth', route => { oauthPayload = route.request().postDataJSON(); return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 'invalid' }) }); });
    await page.locator('.signin-provider').click(); await page.waitForFunction(() => document.querySelector('.signin-options')?.getAttribute('aria-busy') === 'false');
    check(`mock signin/${device}: Google uses existing OAuth action`, oauthPayload?.action === 'oauth' && oauthPayload.provider === 'google', { action: oauthPayload?.action, provider: oauthPayload?.provider });
    const metrics = await page.evaluate(() => window.__hessaraQA); fixture.lastPageMetrics = metrics;
    report.fixtures.push(fixture);
    await context.close();
  }
  const compact = await browser.newContext({ viewport: { width: 320, height: 740 }, reducedMotion: 'reduce' });
  console.log("QA: compact English layouts");
  const compactPage = await compact.newPage();
  for (const size of [{ width: 320, height: 740 }, { width: 1024, height: 768 }]) { await compactPage.setViewportSize(size); for (const path of ['/?lang=en', '/signin?lang=en']) { await compactPage.goto(`${origin}${path}`, { waitUntil: 'networkidle' }); const widths = await compactPage.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth })); check(`${path}/${size.width}: no overflow`, widths.width >= widths.scrollWidth, widths); } }
  await compact.close();
} catch (error) { console.error("QA failed:", error.message); report.failures.push({ message: error.message, stack: error.stack }); }
finally { await writeFile(resolve(output, 'verification.json'), JSON.stringify(report, null, 2)); console.log("QA: closing owned browser"); await browser.close(); }
const interactions = report.pages.flatMap(page => page.interactionMetrics?.events || []).concat(report.fixtures.flatMap(fixture => [...(fixture.signinInteractionMetrics?.events || []), ...(fixture.lastPageMetrics?.events || [])]));
report.interactionSamples = { observedEventEntries: interactions.length, worstObservedEventMilliseconds: interactions.length ? Math.max(...interactions.map(event => event.duration)) : null, interpretation: 'Event Timing observations from this short local interaction sequence; not a complete lifecycle INP calculation or field percentile. Entries below the 16ms observer threshold may be absent.' };
await writeFile(resolve(output, 'verification.json'), JSON.stringify(report, null, 2));
const passed = report.checks.filter(item => item.passed).length;
console.log(JSON.stringify({ passed, failed: report.checks.length - passed, failures: report.failures, report: resolve(output, 'verification.json') }, null, 2));
if (report.failures.length || report.checks.some(item => !item.passed)) process.exitCode = 1;















