import ts from 'typescript';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
const files=['lib/tool-description-locales.ts','lib/tool-description-middle-locales.ts','lib/tool-description-tail-locales.ts','lib/tool-description-extra-locales.ts'];
const rows=new Map();
for(const file of files) {
  if(!existsSync(file)) continue;
  const ast=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
  let count=0;
  function walk(node){
    if(ts.isPropertyAssignment(node) && ts.isStringLiteralLike(node.name) && ts.isArrayLiteralExpression(node.initializer)) {
      const values=node.initializer.elements.map(n=>ts.isStringLiteralLike(n)?n.text:'');
      if(values.length!==11 || values.some(v=>!v)) console.log('INVALID',node.name.text,values.length);
      if(rows.has(node.name.text)) console.log('DUPLICATE',node.name.text);
      rows.set(node.name.text,values);count++;
    }
    ts.forEachChild(node,walk);
  }
  walk(ast); console.log(file,count);
}
const tools=JSON.parse(readFileSync('lib/catalog/tools.json','utf8'));
const missing=tools.map((tool,index)=>({...tool,index})).filter(tool=>!rows.has(tool.id));
writeFileSync('docs/missing-card-locales.json',JSON.stringify(missing,null,2));
console.log('TOTAL',tools.length,'MISSING',missing.length);
console.log(missing.map(t=>JSON.stringify({index:t.index,id:t.id,ar:t.summaryAr})).join('\n'));
