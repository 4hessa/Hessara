import ts from 'typescript';
import { readFileSync, writeFileSync } from 'node:fs';

const shared = new Set(Object.values(JSON.parse(readFileSync('lib/locales/en.json','utf8'))));
const keys = file => {
  const ast = ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
  const out = new Set();
  const visit = node => { if(ts.isPropertyAssignment(node) && ts.isStringLiteralLike(node.name)) out.add(node.name.text); ts.forEachChild(node,visit); };
  visit(ast); return out;
};
for (const key of keys('lib/ui-copy.ts')) shared.add(key);
const sections = {
 'app/workspace.tsx':['lib/core-ui-locales.ts'],
 'app/nvidia-start.tsx':['lib/core-ui-locales.ts'],
 'app/agents.tsx':['lib/agent-locales.ts'],
 'app/discover.tsx':['lib/discovery-locales.ts'],
 'app/student-notebook.tsx':[],
};
const report={};
for(const [file,dictionaries] of Object.entries(sections)) {
  const known = new Set(shared);
  for(const path of dictionaries) for(const key of keys(path)) known.add(key);
  const ast = ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
  const missing=new Map();
  const visit=node=>{
    if(ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text==='c' && node.arguments.length===2 && ts.isStringLiteralLike(node.arguments[1])) {
      const en=node.arguments[1].text;
      if(!known.has(en)) missing.set(en,ts.isStringLiteralLike(node.arguments[0])?node.arguments[0].text:'dynamic');
    }
    ts.forEachChild(node,visit);
  };
  visit(ast); report[file]=Object.fromEntries(missing);
}
writeFileSync('docs/ui-localization-gaps.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
