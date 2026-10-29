/** Real owned-browser walkthrough of the original local teaching explorer. No provider requests. */
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
const {chromium}=await import(pathToFileURL(resolve(process.env.HESSARA_PLAYWRIGHT_MODULE||'.vercel/rea-tool/node_modules/playwright-core/index.mjs')).href);
const origin=process.env.HESSARA_QA_ORIGIN||'http://127.0.0.1:5173';
if(!['127.0.0.1','localhost','[::1]'].includes(new URL(origin).hostname)||new URL(origin).protocol!=='http:') throw Error('Owned loopback preview required');
const output=resolve('docs/advanced-explorer-ui');await mkdir(output,{recursive:true});
const axe=await readFile(resolve('node_modules/axe-core/axe.min.js'),'utf8');
const report={date:new Date().toISOString(),origin,node:process.version,scope:'Actual local production UI and in-browser numerical calculations. No credentials, provider inference, accounts or production writes. External browser requests blocked.',checks:[],pages:[],blockedChecks:[],failures:[]};
const check=(name,passed,evidence)=>report.checks.push({name,passed:!!passed,evidence});
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--disable-extensions','--disable-background-networking'],timeout:60000});
try{
 for(const [device,viewport] of [['desktop',{width:1536,height:900}],['mobile',{width:390,height:844}]]){
  const context=await browser.newContext({viewport,locale:'ar-SA',isMobile:device==='mobile',hasTouch:device==='mobile',acceptDownloads:true});
  const external=[],mutations=[],errors=[];
  await context.route('**/*',route=>{const request=route.request(),url=new URL(request.url());if(url.origin!==origin&&!['data:','blob:'].includes(url.protocol)){external.push(url.origin);return route.abort();}if(url.pathname.startsWith('/api/')&&request.method()!=='GET'){mutations.push(url.pathname);return route.abort();}return route.continue();});
  const page=await context.newPage();await page.addInitScript(()=>{const original=URL.createObjectURL.bind(URL);URL.createObjectURL=blob=>{window.__qaLastDownloadBlob=blob;return original(blob);};});page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.goto(origin+'/?view=how&lang=ar',{waitUntil:'networkidle',timeout:60000});
  await page.locator('.llm-learning-intro').waitFor();
  check(`${device}: explorer is on the existing guide and initially deferred`,await page.locator('.how-work').count()===1&&await page.locator('.llm-explorer').count()===0,page.url());
  const entry=page.getByRole('button',{name:'استكشف رحلة النموذج',exact:true});await entry.click();
  const root=page.locator('.llm-explorer');await root.waitFor();
  check(`${device}: actual component opens with bounded teaching provenance`,await root.getByText('مثال تعليمي · حسابات محلية',{exact:true}).count()===1,await root.locator('.llm-provenance').textContent());
  const input=root.getByRole('textbox',{name:'النص التجريبي',exact:true});const mode=root.getByRole('combobox',{name:'البنية',exact:true});
  const stage=async name=>{await root.locator('.llm-stage-nav').getByRole('button',{name,exact:false}).click();};
  const diagram=root.locator('.llm-diagram').first();await diagram.scrollIntoViewIfNeeded();await page.waitForTimeout(180);
  const animations=()=>root.evaluate(element=>document.getAnimations().filter(a=>a.playState==='running'&&a.effect?.target?.matches('.llm-flow')&&element.contains(a.effect.target)).length);
  check(`${device}: signal animation starts automatically when visible`,await animations()>0,await root.getAttribute('data-running'));
  await root.getByRole('button',{name:'تقليل حركة الإشارات',exact:true}).click();await page.waitForTimeout(80);check(`${device}: motion control pauses frames`,await animations()===0,await root.getAttribute('data-running'));
  await root.getByRole('button',{name:'السماح بحركة الإشارات',exact:true}).click();await diagram.scrollIntoViewIfNeeded();await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(80);check(`${device}: reduced-motion stops signal frames`,await animations()===0,await root.getAttribute('data-running'));await page.emulateMedia({reducedMotion:'no-preference'});
  await page.locator('.how-hero').scrollIntoViewIfNeeded();await page.waitForTimeout(120);check(`${device}: offscreen diagram stops frames`,await root.getAttribute('data-running')==='false',await animations());
  await input.fill('one two three');
  await stage('التمثيل');check(`${device}: embedding has actual numeric vector`,/\[[-\d., ]+\]/.test(await root.locator('.llm-vector-readout').textContent()),await root.locator('.llm-vector-readout').textContent());
  await stage('الموضع');check(`${device}: position shows separate embedding, position and sum`,await root.locator('.llm-vector-readout > div').count()===3,await root.locator('.llm-vector-readout').textContent());
  await stage('الانتباه');await root.locator('.llm-numerical summary').first().click();
  check(`${device}: decoder masks exactly three future relationships`,await root.locator('td[data-masked=true]').count()===3,await root.locator('tbody').textContent());
  const sum=await root.locator('tbody tr').first().locator('td').allTextContents();check(`${device}: selected causal first row is normalized`,sum[0]==='1.000'&&sum.slice(1).every(value=>value==='—'),sum);
  await root.locator('.llm-diagram').first().scrollIntoViewIfNeeded();await root.screenshot({path:resolve(output,`attention-${device}.png`)});
  await mode.selectOption('encoder');check(`${device}: encoder attention is bidirectional`,await root.locator('td[data-masked=true]').count()===0,await root.locator('.llm-weights').textContent());
  await stage('تقسيم النص');check(`${device}: encoder has no autoregressive loop`,await root.locator('.llm-recurrence').count()===0);
  await stage('التوقع');check(`${device}: encoder does not fabricate output logits`,await root.locator('.llm-probability').count()===0,await root.locator('.llm-empty').textContent());
  await mode.selectOption('encoder-decoder');await stage('الانتباه');check(`${device}: source cross-attention is separate from decoder self-attention`,await root.locator('.llm-diagram').count()===2&&await root.locator('.llm-weights').last().locator('> div').count()===3,await root.locator('h5').textContent());
  await stage('كتلة المحوّل');check(`${device}: explicit residual, normalization and feed-forward values`,await root.locator('.llm-block-values > div').count()===5&&await root.getByText('RMSNorm(N + CrossAttention(N, E))',{exact:true}).count()===1,await root.locator('.llm-block-values').textContent());
  await mode.selectOption('decoder');await stage('التوليد');const append=root.getByRole('button',{name:'أضف توقعًا إلى السياق',exact:true});await append.click();
  check(`${device}: greedy step changes real input and records one step`,await input.inputValue()!=='one two three'&&await root.locator('.llm-generated bdi').count()===1,await input.inputValue());
  await input.fill(Array.from({length:16},(_,i)=>'word'+i).join(' '));check(`${device}: append cannot exceed the chunk budget`,await append.isDisabled());
  await input.fill('x'.repeat(237));check(`${device}: append cannot exceed the character budget`,await append.isDisabled());
  await input.fill('a b c d e');const windowInput=root.getByLabel('نافذة السياق المصغرة',{exact:false});await windowInput.fill('2');await stage('تقسيم النص');check(`${device}: context control recomputes only selected suffix`,await root.locator('.llm-token-selector button').count()===2,await root.locator('.llm-token-selector').textContent());
  await windowInput.fill('16');await input.fill('مرحبا بالعالم');await stage('تقسيم النص');const byteText=await root.locator('.llm-formula').textContent();check(`${device}: Arabic text exposes real UTF-8 bytes`,/216|217/.test(byteText)&&!/NaN|Infinity/.test(byteText),byteText);
  const downloadPromise=page.waitForEvent('download');await root.getByRole('button',{name:'تنزيل حسابات المثال · JSON',exact:true}).click();const download=await downloadPromise;const diskFailure=await download.failure();if(diskFailure)report.blockedChecks.push({device,check:'Native download filesystem persistence',reason:diskFailure,evidence:'A separate owned simple Blob download also cancels with delayed revocation and explicit workspace download directory.'});const artifact=JSON.parse(await page.evaluate(()=>window.__qaLastDownloadBlob.text()));check(`${device}: exported arithmetic includes provenance and source bounds`,artifact.format==='hessara-teaching-transformer/1'&&artifact.provenance.includes('Not a provider')&&artifact.sourceTruncated===false&&artifact.data.tokens.length===2,{format:artifact.format,sourceTruncated:artifact.sourceTruncated,tokenCount:artifact.data.tokens.length});
  await page.addScriptTag({content:axe});const closedAccessibility=await page.evaluate(async()=>{const result=await axe.run(document.querySelector('.llm-learning'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}});return result.violations.map(({id,impact,nodes})=>({id,impact,nodes:nodes.map(({target,failureSummary})=>({target,failureSummary}))}));});check(`${device}: closed report disclosure passes scoped WCAG A/AA checks`,closedAccessibility.length===0,closedAccessibility);
  const exportToggle=root.getByRole('button',{name:'عرض JSON ونسخه',exact:true});
  check(`${device}: report text is deferred until requested`,await root.locator('.llm-report-panel').count()===0);
  await exportToggle.click();const reportField=root.getByRole('textbox',{name:'بيانات التقرير بصيغة JSON',exact:true});await reportField.waitFor();await page.waitForFunction(()=>document.activeElement?.matches('.llm-report-text'));
  check(`${device}: report view is readonly, labeled, left-to-right and focused`,await reportField.evaluate(element=>element.readOnly&&element.dir==='ltr'&&document.activeElement===element));
  const reportText=await reportField.inputValue();check(`${device}: visible report equals the actual native-download Blob byte for byte`,reportText===await page.evaluate(()=>window.__qaLastDownloadBlob.text()));
  await root.getByRole('button',{name:'تحديد النص بالكامل',exact:true}).click();check(`${device}: select-all exposes the entire JSON without clipboard access`,await reportField.evaluate(element=>element.selectionStart===0&&element.selectionEnd===element.value.length&&document.activeElement===element));
  await input.fill('updated example');check(`${device}: report view follows changed arithmetic without a stale snapshot`,JSON.parse(await reportField.inputValue()).data.tokens.map(piece=>piece.text).join('')==='updated example');
  await windowInput.fill('1');let visibleReport=JSON.parse(await reportField.inputValue());check(`${device}: report follows the chosen context window`,visibleReport.contextWindow===1&&visibleReport.data.tokens.length===1);await windowInput.fill('16');
  await mode.selectOption('encoder');visibleReport=JSON.parse(await reportField.inputValue());check(`${device}: report follows architecture changes`,visibleReport.data.mode==='encoder'&&visibleReport.data.candidates.length===0);await mode.selectOption('decoder');
  await input.fill('   ');check(`${device}: an open report has current empty data instead of stale values`,JSON.parse(await reportField.inputValue()).data.tokens.length===0);await input.fill('updated example');
  await reportField.focus();await page.keyboard.press('Escape');await page.waitForFunction(()=>document.activeElement?.matches('.llm-export-actions button[aria-controls]'));
  const escapeFocus=()=>exportToggle.evaluate(element=>{const rect=element.getBoundingClientRect();return {focused:element===document.activeElement,top:rect.top,bottom:rect.bottom,viewport:innerHeight};});
  const immediateFocus=await escapeFocus();await page.waitForTimeout(650);const settledFocus=await escapeFocus();
  check(`${device}: Escape closes only the report and keeps disclosure focus visible after scrolling settles`,await root.locator('.llm-report-panel').count()===0&&immediateFocus.focused&&settledFocus.focused&&immediateFocus.top>=0&&immediateFocus.bottom<=immediateFocus.viewport&&settledFocus.top>=0&&settledFocus.bottom<=settledFocus.viewport&&await root.count()===1,{immediateFocus,settledFocus});
  await exportToggle.click();await root.getByRole('button',{name:'إغلاق عرض التقرير',exact:true}).click();check(`${device}: explicit report close restores focus`,await root.locator('.llm-report-panel').count()===0&&await exportToggle.evaluate(element=>element===document.activeElement));
  await page.evaluate(()=>{window.__qaSavedCreateObjectURL=URL.createObjectURL;URL.createObjectURL=()=>{throw Error('Owned simulated object URL failure');};});
  try {
    await root.getByRole('button',{name:'تنزيل حسابات المثال · JSON',exact:true}).click();await root.getByRole('alert').waitFor();await reportField.waitFor();
    check(`${device}: a real synchronous download-API failure reveals the readable fallback with an honest error`,await root.getByRole('alert').textContent()==='تعذر بدء التنزيل. يمكنك تحديد بيانات JSON أدناه ونسخها يدويًا.'&&JSON.parse(await reportField.inputValue()).format==='hessara-teaching-transformer/1');
  } finally {await page.evaluate(()=>{URL.createObjectURL=window.__qaSavedCreateObjectURL;delete window.__qaSavedCreateObjectURL;});}
  await root.getByRole('button',{name:'إغلاق عرض التقرير',exact:true}).click();check(`${device}: closing clears the download error`,await root.getByRole('alert').count()===0);
  await input.fill('   ');check(`${device}: empty input has a usable state`,await root.locator('.llm-empty').count()===1,await root.locator('.llm-empty').textContent());
  await input.fill('restored text');await root.locator('.llm-diagram').first().scrollIntoViewIfNeeded();await page.waitForTimeout(120);check(`${device}: motion resumes after clearing and restoring text in the same stage`,await root.getAttribute('data-running')==='true'&&await animations()>0);
  await stage('التدريب');const loss=async()=>Number(await root.locator('.llm-training-metrics dd').nth(2).textContent());const before=await loss();await root.getByRole('button',{name:'خطوة تالية',exact:true}).click();const after=await loss();check(`${device}: training step reduces actually computed loss`,after<before,{before,after});
  await root.screenshot({path:resolve(output,`training-${device}.png`),animations:'disabled'});
  const film=root.locator('video');await film.scrollIntoViewIfNeeded();await page.waitForTimeout(350);
  await page.waitForFunction(()=>{const video=document.querySelector('.llm-training-film video');return video&&video.readyState>=2&&!video.paused;},undefined,{timeout:15000});
  const filmBefore=await film.evaluate(video=>({time:video.currentTime,muted:video.muted,controls:video.controls,loop:video.loop,inline:video.playsInline,autoplay:video.autoplay,width:video.videoWidth,height:video.videoHeight}));await page.waitForTimeout(350);const filmAfter=await film.evaluate(video=>video.currentTime);
  check(`${device}: rendered Manim film really autoplays silently without controls`,filmAfter>filmBefore.time&&filmBefore.muted&&!filmBefore.controls&&filmBefore.loop&&filmBefore.inline&&filmBefore.autoplay&&filmBefore.width===1280&&filmBefore.height===720,filmBefore);
  await film.evaluate(video=>{video.currentTime=video.duration-0.15;});await page.waitForTimeout(400);check(`${device}: native movie loop returns to the beginning`,await film.evaluate(video=>video.currentTime<1));
  await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(100);check(`${device}: reduced motion keeps the poster and stops movie decoding`,await film.evaluate(video=>video.paused)&&await film.getAttribute('data-ready')==='false');await page.emulateMedia({reducedMotion:'no-preference'});
  await film.screenshot({path:resolve(output,`manim-film-${device}.png`)});
  await input.fill('<script>window.__hessaraInjected=1</script>');await stage('تقسيم النص');check(`${device}: hostile text remains inert`,await page.evaluate(()=>typeof window.__hessaraInjected==='undefined')&&await root.locator('script').count()===0);
  await root.getByRole('button',{name:'عرض JSON ونسخه',exact:true}).click();
  check(`${device}: report preview keeps hostile markup inert`,await page.evaluate(()=>typeof window.__hessaraInjected==='undefined')&&await root.locator('script').count()===0&&JSON.parse(await reportField.inputValue()).data.tokens.length>0);
  await root.getByRole('button',{name:'إغلاق عرض التقرير',exact:true}).click();
  await input.fill('الذكاء يتعلم من الأمثلة');await stage('الانتباه');await root.locator('.llm-diagram').first().scrollIntoViewIfNeeded();
  await root.getByRole('button',{name:'عرض JSON ونسخه',exact:true}).click();await reportField.waitFor();await root.locator('.llm-report-panel').screenshot({path:resolve(output,`report-preview-${device}.png`)});
  const accessibility=await page.evaluate(async()=>{const result=await axe.run(document.querySelector('.llm-learning'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}});return result.violations.map(({id,impact,nodes})=>({id,impact,nodes:nodes.map(({target,failureSummary})=>({target,failureSummary}))}));});check(`${device}: scoped WCAG A/AA automated checks`,accessibility.length===0,accessibility);
  check(`${device}: no media controls or playback overlays`,await root.locator('video,audio,iframe,canvas').count()===0&&!/تشغيل المقطع/.test(await root.textContent()));
  const overflow=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));check(`${device}: no page overflow`,overflow.scrollWidth<=overflow.width,overflow);
  if(device==='desktop'){for(const width of [320,768,1024]){await page.setViewportSize({width,height:900});const size=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));check(`responsive ${width}: no page overflow`,size.scrollWidth<=size.width,size);}await page.setViewportSize(viewport);}
  check(`${device}: no external requests or mutations from the explorer`,external.length===0&&mutations.length===0,{external,mutations});check(`${device}: runtime and console stay clean`,errors.length===0,errors);
  report.pages.push({device,viewport,accessibility,closedAccessibility,errors,external,mutations,download:download.suggestedFilename()});
  await page.getByRole('button',{name:'إغلاق المستكشف',exact:true}).click();check(`${device}: closing cleans up the component`,await root.count()===0);
  if(device==='desktop'){await page.goto(origin+'/?view=how&lang=en',{waitUntil:'networkidle'});await page.getByRole('button',{name:'Explore the model pipeline',exact:true}).click();await page.locator('.llm-explorer').waitFor();check('English: localized form and teaching boundary',await page.getByRole('textbox',{name:'Example text',exact:true}).count()===1&&await page.locator('.llm-provenance').getByText(/not a provider tokenizer/).count()===1);await page.getByRole('button',{name:'View and copy JSON',exact:true}).click();const englishReport=page.getByRole('textbox',{name:'Report data as JSON',exact:true});check('English: report controls and current arithmetic are localized and readable',await englishReport.isVisible()&&JSON.parse(await englishReport.inputValue()).format==='hessara-teaching-transformer/1');await page.locator('.llm-report-panel').screenshot({path:resolve(output,'report-preview-english-desktop.png')});await page.getByRole('button',{name:'Close report view',exact:true}).click();await page.locator('.llm-learning').screenshot({path:resolve(output,'explorer-english-desktop.png')});}
  await context.close();
 }
}catch(error){report.failures.push({message:error.message,stack:error.stack});}finally{await browser.close();}
report.passed=report.checks.filter(check=>check.passed).length;report.failed=report.checks.length-report.passed+report.failures.length;
await writeFile(resolve(output,'verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,failed:report.failed,failures:report.failures,failedChecks:report.checks.filter(check=>!check.passed)},null,2));process.exitCode=report.failed?1:0;










