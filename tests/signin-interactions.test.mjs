import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
const directory=await mkdtemp(resolve('.signin-state-test-'));
let ui;
try{
  const result=await build({absWorkingDir:process.cwd(),stdin:{contents:"export {SignInForm} from './app/signin/signin-form';export {begin,reset} from 'signin-hooks';",resolveDir:process.cwd(),loader:'tsx'},bundle:true,platform:'node',format:'esm',packages:'external',write:false,loader:{'.css':'empty'},jsx:'automatic',tsconfig:resolve('tsconfig.json'),plugins:[{name:'signin-state',setup(builder){
    builder.onResolve({filter:/^next\/(link|image)$/},args=>({path:args.path,namespace:'next-component'}));
    builder.onLoad({filter:/.*/,namespace:'next-component'},()=>({contents:"export default function NativeComponent(props){return props.children ?? null;}",loader:'js'}));
    builder.onResolve({filter:/^(react|signin-hooks)$/},args=>{if(args.path==='signin-hooks'||/signin-form\.tsx$/.test(args.importer))return{path:'hooks',namespace:'signin-hooks'};});
    builder.onLoad({filter:/.*/,namespace:'signin-hooks'},()=>({contents:`let values=[],cursor=0;export function begin(){cursor=0;}export function reset(){values=[];cursor=0;}export function useState(initial){const i=cursor++;if(!(i in values))values[i]=typeof initial==='function'?initial():initial;return[values[i],v=>values[i]=typeof v==='function'?v(values[i]):v];}export function useRef(initial){return useState(()=>({current:initial}))[0];}export function useEffect(){}`,loader:'js'}));
  }}]});
  const output=join(directory,'ui.mjs');await writeFile(output,result.outputFiles[0].text);ui=await import(pathToFileURL(output).href);
}finally{await rm(directory,{recursive:true,force:true});}
const props={locale:'ar',configured:true,availability:{email:true,password:true,linking:true,providers:{google:true}},session:'none',next:'/reverse-engineering',expired:false};
function render(){ui.begin();return ui.SignInForm(props);}
function elements(node){if(!node||typeof node!=='object')return[];if(Array.isArray(node))return node.flatMap(elements);return[node,...elements(node.props?.children)];}
const find=predicate=>elements(render()).find(predicate);
const input=id=>find(node=>node.props?.id===id);
const form=()=>find(node=>node.type==='form');
const text=node=>node==null||typeof node==='boolean'?'':Array.isArray(node)?node.map(text).join(''):typeof node==='object'?text(node.props?.children):String(node);
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('remember choice is sent with real password and Google actions without persisting credentials in browser storage',async t=>{
  ui.reset();const calls=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{calls.push({url,value:JSON.parse(options.body)});return{ok:false,json:async()=>({code:'credentialsFailed'})};});
  input('signin-email').props.onChange({target:{value:'person@example.org'}});
  input('signin-password').props.onChange({target:{value:'fixture-password'}});
  form().props.onSubmit({preventDefault(){}});await settle();
  assert.equal(calls[0].url,'/api/auth');assert.deepEqual(calls[0].value,{action:'signin',next:props.next,email:'person@example.org',password:'fixture-password',remember:false});
  find(node=>node.props?.name==='remember').props.onChange({target:{checked:true}});
  find(node=>node.props?.className==='signin-provider').props.onClick();await settle();
  assert.deepEqual(calls[1].value,{action:'oauth',provider:'google',next:props.next,remember:true});
  ui.reset();
});

test('forgot password switches to an email-only real recovery request and announces the generic success',async t=>{
  ui.reset();const calls=[];
  t.mock.method(globalThis,'fetch',async(_url,options)=>{calls.push(JSON.parse(options.body));return{ok:true,json:async()=>({code:'recoverySent'})};});
  input('signin-email').props.onChange({target:{value:'person@example.org'}});
  input('signin-password').props.onChange({target:{value:'do-not-send-this'}});
  find(node=>node.props?.className==='signin-forgot').props.onClick();
  assert.equal(input('signin-password'),undefined);assert.equal(input('signin-email').props.value,'person@example.org');
  assert.equal(find(node=>node.props?.className==='signin-provider'),undefined);
  form().props.onSubmit({preventDefault(){}});await settle();
  assert.deepEqual(calls,[{action:'recover',email:'person@example.org',next:props.next}]);
  const notice=find(node=>node.props?.className==='signin-message');assert.equal(notice.props.role,'status');assert.match(text(notice),/هذا المتصفح/);
  ui.reset();
});

test('password visibility and real errors retain labels, values and usable controls',async t=>{
  ui.reset();t.mock.method(globalThis,'fetch',async()=>({ok:false,json:async()=>({code:'credentialsFailed'})}));
  input('signin-email').props.onChange({target:{value:'person@example.org'}});input('signin-password').props.onChange({target:{value:'fixture'}});
  find(node=>node.props?.className==='signin-eye').props.onClick();assert.equal(input('signin-password').props.type,'text');
  form().props.onSubmit({preventDefault(){}});await settle();
  assert.equal(find(node=>node.props?.className==='signin-message').props.role,'alert');
  assert.equal(input('signin-email').props.value,'person@example.org');assert.equal(input('signin-password').props.value,'fixture');
  assert.equal(find(node=>node.type==='fieldset').props.disabled,false);ui.reset();
});
