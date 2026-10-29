import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Render the real components, including their child cards and forms. Effects never
// run during SSR, so this verifies copy without contacting a provider or database.
const dir = await mkdtemp(resolve('.i18n-test-'));
const output = join(dir, 'components.mjs');
const built = await build({
  absWorkingDir: process.cwd(),
  stdin: { contents: `
    export { AssistantStudio } from './app/assistant-studio';
    export { AgentsPanel } from './app/agents';
    export { StudentNotebook } from './app/student-notebook';
    export { NvidiaStart } from './app/nvidia-start';
    export { SignInForm } from './app/signin/signin-form';
    export { LLMDirectory, ToolsDirectory, HowWork, PaperclipPanel } from './app/discover';
    export { featuredAssistants } from './lib/featured-assistant-copy';
    export { FEATURED_ASSISTANT_TRANSLATIONS } from './lib/featured-assistant-locales';
    export { AGENTS } from './lib/agent-catalog';
    export { agentDescription, agentCatalogDescriptions } from './lib/agent-catalog-locales';
    export { toolDescription, toolDescriptions } from './lib/tool-copy';
    export { default as toolCatalog } from './lib/catalog/tools.json';
    export { guideKeys, guideTranslations } from './lib/guide-locales';
    export { studentTerms, studentLanguage } from './lib/student-locales';
    export { signinEnglish } from './lib/signin-copy';
    export { signinTerms, signinMessage } from './lib/signin-locales';
    export { signinExperienceCopy } from './lib/signin-experience-copy';
    export { LANGUAGES, dictionaries, isLocale, isRTL } from './lib/i18n';
    export { coreRows, coreLocales } from './lib/core-ui-locales';
    export { assistantLocaleMessages } from './lib/assistant-locales';
    export { assistantEnglish } from './lib/assistant-messages';
    export { ModelAdvisor, ModelEvidenceComparison } from './app/model-advisor';
    export { LabPanel } from './app/lab-panel';
    export { labTranslations } from './lib/lab-copy';
    export { evaluationTranslations } from './lib/lab-evaluation-copy';
    export { labExtras } from './lib/lab-extras-copy';
    export { advisorTranslations, advisorEnglish } from './lib/advisor-copy';
    export { advisorSnapshot } from './lib/advisor-snapshot';
    export { personalAgentCopy } from './lib/personal-agent-i18n';
    export { PersonalAgents } from './app/personal-agents';
  `, resolveDir: process.cwd(), loader: 'tsx' },
  bundle: true, platform: 'node', format: 'esm', write: false,
  packages: 'external', loader: { '.css': 'empty' }, jsx: 'automatic',
  tsconfigRaw: { compilerOptions: { jsx: 'react-jsx' } },
  plugins: [{ name: 'workspace-resolution', setup(builder) {
    // Localization renders native elements without requiring a Next.js runtime.
    // Discard image-only flags so they do not become invalid DOM attributes.
    builder.onResolve({filter: /^next\/(link|image)$/}, args => ({path: args.path, namespace: 'test-next'}));
    builder.onLoad({filter: /.*/, namespace: 'test-next'}, args => ({
      contents: args.path.endsWith('link')
        ? "import React from 'react';export default function Link(props){return React.createElement('a',props);}"
        : "import React from 'react';export { getImageProps } from 'next/image.js';export default function Image({fill,priority,preload,...props}){return React.createElement('img',props);}",
      loader: 'js', resolveDir: process.cwd(),
    }));
    builder.onResolve({filter: /.*/}, args => {
      if (!args.path.startsWith('.') && !args.path.startsWith('@/')) return { path: ['next/image','next/link'].includes(args.path) ? args.path + '.js' : args.path, external: true };
      const base = args.path.startsWith('@/') ? resolve(args.path.slice(2)) : resolve(args.resolveDir, args.path);
      const path = [base, ...['.tsx','.ts','.json','.css'].map(ext => base + ext)].find(existsSync);
      return path ? { path } : { errors: [{ text: `Missing module ${args.path}` }] };
    });
    builder.onLoad({filter: /\.(tsx?|json|css)$/}, args => ({ contents: extname(args.path) === '.css' ? '' : readFileSync(args.path,'utf8'), loader: extname(args.path).slice(1) === 'css' ? 'js' : extname(args.path).slice(1), resolveDir: resolve(args.path,'..') }));
  }}],
});
await writeFile(output, built.outputFiles[0].text);
const ui = await import(pathToFileURL(output).href);
await unlink(output); await rmdir(dir);
const text = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const signinAvailability = { guest:true, email:true, password:true, linking:true, providers:{google:false,apple:false,x:false,github:false} };
const render = (component, props) => {
  let markup = renderToStaticMarkup(React.createElement(component, props));
  if (component === ui.SignInForm) {
    // The new language picker intentionally lists every language's native name,
    // including العربية/اردو/فارسی. Validate that complete picker separately,
    // then check every other rendered sign-in string for accidental fallback.
    // Never remove Arabic script generally, notices, fields, or other controls.
    const picker = markup.match(/<select\b[^>]*\bid="signin-language"[^>]*>[\s\S]*?<\/select>/)?.[0];
    assert.ok(picker, `${props.locale}: native language picker is rendered`);
    for (const [code,name] of ui.LANGUAGES) {
      assert.ok(picker.includes(`value="${code}"`), `${props.locale}: missing language ${code}`);
      assert.ok(text(picker).includes(name), `${props.locale}: missing native label ${name}`);
    }
    markup = markup.replace(picker, '');
  }
  return text(markup);
};
const escapedText = value => text(renderToStaticMarkup(React.createElement('span', null, value))).trim();

test('new lab, evaluation, report and preference controls have complete copy in every locale',()=>{
 for(const [locale] of ui.LANGUAGES){
   for(const dictionary of [ui.labTranslations,ui.evaluationTranslations]){
     assert.deepEqual(Object.keys(dictionary[locale]).sort(),Object.keys(dictionary.en).sort());
     for(const [key,value] of Object.entries(dictionary[locale])) assert.ok(typeof value==='string'&&value.trim(),`${locale}.${key}`);
   }
   for(const value of Object.values(ui.labExtras(locale))) assert.ok(typeof value==='string'&&value.trim());
   const html=renderToStaticMarkup(React.createElement(ui.LabPanel,{locale,sessionMode:'guest',onConnect:()=>{}}));
   assert.ok(html.includes(ui.labTranslations[locale].title));
   assert.ok(html.includes(ui.labExtras(locale).prefs));
   if(!['ar','ur','fa'].includes(locale))assert.ok(!/[\u0600-\u06ff]/u.test(html),locale+' unexpected Arabic script');
 }
});

test('English assistant cards, setup guides, form and validation labels contain no fixed Arabic', () => {
  const result = render(ui.AssistantStudio, { locale: 'en' });
  assert.match(result, /Four doors to your ideas/);
  assert.match(result, /Run assistant/);
  assert.match(result, /Grok Bot memory/);
  assert.doesNotMatch(result, /[\u0600-\u06ff]/);
  const arabic = render(ui.AssistantStudio, { locale: 'ar' });
  assert.match(arabic, /أربعة أبواب/);
  assert.match(arabic, /تشغيل المساعد/);
});

test('every featured card and its setup content changes for every supported locale', () => {
  for (const [locale] of ui.LANGUAGES) {
    const cards = ui.featuredAssistants(locale);
    const result = render(ui.AssistantStudio, { locale });
    for (const card of cards) {
      for (const key of ['title','description','capability','distinction','example']) {
        assert.ok(card[key]?.trim(), `${locale}/${card.id}/${key}`);
        if (!['ar','en'].includes(locale)) assert.notEqual(card[key], ui.featuredAssistants('en').find(v=>v.id===card.id)[key]);
      }
      for (const key of ['title','description']) assert.ok(result.includes(escapedText(card[key])), `${locale}/${card.id}/${key} not rendered`);
      assert.ok(card.steps.length >= 3);
      assert.ok(card.steps.every(value=>value.trim().length > 15));
    }
    assert.ok(result.includes(escapedText(cards[0].distinction)), `${locale} active setup`);
    assert.ok(result.includes(escapedText(cards[0].steps[0])), `${locale} active guide`);
  }
});

test('all 319 tool cards and all 21 agent descriptions have every translation', () => {
  const extraLocales = ui.LANGUAGES.map(([locale])=>locale).filter(locale=>!['ar','en'].includes(locale));
  assert.equal(ui.toolCatalog.length, 319);
  assert.equal(ui.AGENTS.length, 21);
  assert.equal(Object.keys(ui.toolDescriptions).length, ui.toolCatalog.length);
  assert.equal(Object.keys(ui.agentCatalogDescriptions).length, ui.AGENTS.length);
  for (const locale of extraLocales) {
    const tools = render(ui.ToolsDirectory, { locale, onPaperclip:()=>{} });
    const agents = render(ui.AgentsPanel, { locale, onCreate:()=>{}, onPaperclip:()=>{}, onTools:()=>{} });
    for (const item of ui.toolCatalog) {
      assert.equal(ui.toolDescriptions[item.id]?.length, extraLocales.length, item.id);
      const description = ui.toolDescription(item,locale);
      assert.ok(description?.trim().length > 5, `${locale}/${item.id}`);
      assert.notEqual(description,item.summaryEn, `${locale}/${item.id} fell back to English`);
    }
    for (const item of ui.toolCatalog.slice(0,24)) assert.ok(tools.includes(escapedText(ui.toolDescription(item,locale))), `${locale}/${item.id} card ignores locale`);
    for (const item of ui.AGENTS) {
      const description = ui.agentDescription(item,locale);
      assert.ok(description?.trim(), `${locale}/${item.id}`);
      assert.notEqual(description,item.summaryEn);
      const visibleDescription = ['openclaw', 'letta'].includes(item.id)
        ? ui.personalAgentCopy[locale].agents[item.id].description : description;
      assert.ok(agents.includes(escapedText(visibleDescription)), `${locale}/${item.id} card ignores locale`);
    }
  }
});

test('new personal-agent entries are official external references, never HESSARA execution buttons', () => {
  for (const [id, releaseDate, host] of [
    ['openai-dots', '2026-09-29', 'openai.com'],
    ['meta-muse', '2026-09-08', 'ai.meta.com'],
  ]) {
    const item = ui.AGENTS.find((agent) => agent.id === id);
    assert.ok(item, id);
    assert.equal(item.mode, 'external');
    assert.equal(item.releaseDate, releaseDate);
    assert.equal(new URL(item.url).hostname, host);
    assert.match(item.summaryEn, /Not integrated with HESSARA/);
  }
});

test('advisor, comparison and personal activation guides have complete localized copy in all 13 languages', () => {
  const keys = Object.keys(ui.advisorEnglish).sort();
  for (const [locale] of ui.LANGUAGES) {
    const copy = ui.advisorTranslations[locale];
    assert.deepEqual(Object.keys(copy).sort(), keys, `${locale} advisor keys`);
    for (const key of keys) {
      assert.ok(copy[key].trim().length > 0, `${locale}/${key}`);
      // Short labels may be genuine cognates (e.g. German/Dutch "Student").
      if (locale !== 'en' && ui.advisorEnglish[key].length > 18) assert.notEqual(copy[key], ui.advisorEnglish[key], `${locale}/${key} English fallback`);
    }
    const advisor = render(ui.ModelAdvisor, { locale, onCompare:()=>{} });
    assert.ok(advisor.includes(escapedText(copy.title)));
    assert.ok(advisor.includes(escapedText(copy.privacy)));
    const comparison = render(ui.ModelEvidenceComparison, { locale, models:ui.advisorSnapshot.models.slice(0, 2) });
    assert.ok(comparison.includes(escapedText(copy.provenance)));
    assert.ok(comparison.includes(escapedText(copy.unmeasured)));
    const personal = render(ui.PersonalAgents, {locale, sessionMode:'guest'});
    for(const id of ['openclaw','letta','lindy','hermes']) {
      const agent = ui.personalAgentCopy[locale].agents[id];
      assert.ok(personal.includes(escapedText(agent.description)), `${locale}/${id}`);
      for(const step of agent.steps) assert.ok(personal.includes(escapedText(step)), `${locale}/${id}/guide`);
      assert.ok(personal.includes(escapedText(agent.note)), `${locale}/${id}/limits`);
    }
  }
});

test('private-data cautions remain for guest agent guides only across all locales', () => {
  for (const [locale] of ui.LANGUAGES) {
    const guest = render(ui.PersonalAgents,{locale,sessionMode:'guest'});
    const cautions = [ui.personalAgentCopy[locale].agents.openclaw.note,ui.personalAgentCopy[locale].agents.letta.steps[2]];
    for (const caution of cautions) assert.ok(guest.includes(escapedText(caution)),`${locale}: guest caution`);
    for (const sessionMode of ['account','none']) {
      const result = render(ui.PersonalAgents,{locale,sessionMode});
      for (const caution of cautions) assert.ok(!result.includes(escapedText(caution)),`${locale}: ${sessionMode} warning removed`);
    }
  }
});

test('guide cards, student prompts and sign-in copy follow all eleven extra locales', () => {
  for (const [locale] of ui.LANGUAGES.filter(([value])=>!['ar','en'].includes(value))) {
    const guide = render(ui.HowWork,{locale,onStart:()=>{},onModels:()=>{},onTools:()=>{},onAgents:()=>{}});
    assert.equal(ui.guideTranslations[locale].length,ui.guideKeys.length);
    for (const entry of ui.guideTranslations[locale]) assert.ok(guide.includes(escapedText(entry)), `${locale} missing guide paragraph: ${entry}`);
    for (const english of Object.values(ui.signinEnglish)) {
      assert.equal(ui.signinTerms[english]?.length,11,english);
      assert.ok(ui.signinTerms[english].every(value=>value.trim().length));
    }
    for(const [english,row] of Object.entries(ui.studentTerms)) {
      assert.equal(row.length,11,english);
      const value = ui.studentLanguage(locale)('Arabic',english);
      assert.ok(value.trim());
      if(english.length>20) assert.notEqual(value,english,`${locale} study copy fell back`);
    }
    const student = render(ui.StudentNotebook,{locale});
    assert.ok(student.includes(escapedText(ui.studentLanguage(locale)('', 'From scattered notes to clearer understanding'))));
    const signin = render(ui.SignInForm,{locale,configured:true,availability:signinAvailability,session:'guest',next:'/',expired:true});
    const signinCopy = ui.signinExperienceCopy(locale);
    for (const key of ['sessionGuest','signIn','signUp','email','password','expired'])
      assert.ok(signin.includes(escapedText(signinCopy[key])), `${locale}: missing ${key}`);
    assert.ok(!signin.includes(escapedText(signinCopy.guest)), `${locale}: retired guest entry must not reappear`);
    if (!['ur','fa'].includes(locale)) assert.doesNotMatch(signin, /[\u0600-\u06ff]/, `${locale}: unexpected Arabic sign-in copy`);
  }
});

test('English agents, study tools, NVIDIA and sign-in render complete English UI', () => {
  const noop = () => {};
  for (const [component, props] of [
    [ui.AgentsPanel, { onCreate: noop, onPaperclip: noop, onTools: noop }],
    [ui.StudentNotebook, {}], [ui.NvidiaStart, { onLinked: noop }],
    [ui.SignInForm, { configured: true, availability:signinAvailability, session: 'guest', next: '/', expired: true }],
  ]) {
    const result = render(component, { locale: 'en', ...props });
    assert.doesNotMatch(result, /[\u0600-\u06ff]/, component.name);
    assert.ok(result.length > 150, component.name);
  }
});

test('all supported locales have complete core dictionaries and valid directions', () => {
  const keys = Object.keys(ui.dictionaries.en).sort();
  for (const [locale] of ui.LANGUAGES) {
    assert.equal(ui.isLocale(locale), true);
    assert.deepEqual(Object.keys(ui.dictionaries[locale]).sort(), keys);
    assert.equal(ui.isRTL(locale), ['ar','fa','ur'].includes(locale));
  }
  for (const invalid of ['xx', 'EN', '', null, undefined, '<script>']) assert.equal(ui.isLocale(invalid), false);
  for (const [key, row] of Object.entries(ui.coreRows)) {
    assert.equal(row.length, ui.coreLocales.length, key);
    assert.ok(row.every(value => typeof value === 'string' && value.trim().length), key);
  }
  for (const [locale, dictionary] of Object.entries(ui.assistantLocaleMessages)) {
    for (const message of Object.values(ui.assistantEnglish)) assert.ok(dictionary[message]?.trim(), `${locale}: ${message}`);
  }
});
