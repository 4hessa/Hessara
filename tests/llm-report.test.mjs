import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createDemonstration} from '../lib/llm-demonstration.ts';
import {serializeTeachingReport,TEACHING_REPORT_FILENAME} from '../lib/llm-report.ts';

test('the teaching report preserves its established format, provenance and arithmetic in every architecture',()=>{
  for(const mode of ['encoder','decoder','encoder-decoder']) {
    const data=createDemonstration('مرحبا بالعالم',mode),before=JSON.stringify(data);
    const text=serializeTeachingReport(data,16,false),report=JSON.parse(text);
    assert.equal(report.format,'hessara-teaching-transformer/1');
    assert.match(report.provenance,/Not a provider tokenizer/);
    assert.deepEqual(report.data,JSON.parse(before));assert.equal(report.contextWindow,16);assert.equal(report.sourceTruncated,false);
    assert.equal(JSON.stringify(data),before);assert.equal(serializeTeachingReport(data,16,false),text);
  }
  assert.equal(TEACHING_REPORT_FILENAME,'hessara-teaching-model.json');
});

test('report JSON preserves Arabic, emoji, quotation and line-break data without interpreting it',()=>{
  const data=createDemonstration('أهلًا "بايت" 👩🏽‍💻\n<b>نص</b>','decoder');
  const restored=JSON.parse(serializeTeachingReport(data,16,false)).data;
  assert.deepEqual(restored.tokens,data.tokens);
  assert.ok(restored.tokens.some(token=>token.text.includes('أهلًا')));
  assert.ok(restored.tokens.some(token=>token.text.includes('👩')));
});

test('source truncation and the chosen context remain explicit without inventing additional results',()=>{
  const data=createDemonstration('last two','decoder');
  const report=JSON.parse(serializeTeachingReport(data,2,true));
  assert.equal(report.sourceTruncated,true);assert.equal(report.contextWindow,2);assert.equal(report.data.tokens.length,2);
  const empty=JSON.parse(serializeTeachingReport(createDemonstration('','decoder'),16,false));
  assert.deepEqual(empty.data.tokens,[]);assert.equal(empty.data.nextToken,null);
});

test('the shared report formatter runs without DOM, Node, network or storage APIs',()=>{
  const source=readFileSync(new URL('../lib/llm-report.ts',import.meta.url),'utf8');
  const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const context={exports:{}};vm.runInNewContext(output,context,{timeout:1000});
  const data=createDemonstration('owned example','decoder');
  assert.equal(context.exports.serializeTeachingReport(data,16,false),serializeTeachingReport(data,16,false));
});
