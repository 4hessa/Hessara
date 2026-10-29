import{resolve}from'node:path';import{fileURLToPath}from'node:url';
import{checkIntegrationOpenAI,configureIntegrationOpenAI,validateIntegrationOpenAI,APPROVED_PROFILE_PROJECT}from'./configure-integration-profile.mjs';
const safeCodes=new Set(['LOCAL_CONFIGURATION_ONLY','PRIVATE_PROFILE_PATH_INVALID','PRIVATE_PROFILE_UNAVAILABLE','PRIVATE_PROFILE_UNSAFE','PRIVATE_PROFILE_INVALID','PRIVATE_PROFILE_CHANGED','PROFILE_BASE_INVALID','PROFILE_AUTH_FIELDS_REQUIRED','PRIVATE_BACKUP_ALREADY_EXISTS','PRIVATE_BACKUP_FAILED','PRIVATE_PROFILE_WRITE_FAILED','PROFILE_SERIALIZATION_UNSUPPORTED','OPENAI_INPUT_INVALID','OPENAI_INPUT_TOO_LARGE','OPENAI_KEY_REQUIRED','OPENAI_KEY_PROVIDER_MISMATCH','OPENAI_ADMIN_KEY_NOT_ALLOWED','OPENAI_KEY_MASKED','OPENAI_KEY_WRAPPED','OPENAI_KEY_FORMAT_INVALID','OPENAI_KEY_INTERNAL_WHITESPACE','OPENAI_KEY_UNSAFE_CHARACTERS','OPENAI_KEY_PREFIX_INVALID','OPENAI_KEY_TOO_SHORT','OPENAI_MODEL_INVALID','OPENAI_PUBLIC_SECRET_FIELD_NOT_ALLOWED','OPENAI_PROFILE_ALREADY_CONFIGURED','OPENAI_ARGUMENT_INVALID','OPENAI_PIPE_REQUIRED','OPENAI_INPUT_TIMEOUT']);
const failure=code=>Object.assign(new Error(code),{code});
export async function readOpenAIConfiguration(stream,{timeoutMs=20000}={}){
 if(stream.isTTY)throw failure('OPENAI_PIPE_REQUIRED');
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>20000)throw failure('OPENAI_INPUT_TIMEOUT');
 const chunks=[];let size=0,combined,timer,expired=false;
 const consume=async()=>{try{for await(const chunk of stream){if(expired)throw failure('OPENAI_INPUT_TIMEOUT');const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);size+=bytes.length;if(size>8192){bytes.fill(0);throw failure('OPENAI_INPUT_TOO_LARGE');}chunks.push(bytes);}if(!size)throw failure('OPENAI_INPUT_INVALID');combined=Buffer.concat(chunks);let input;try{input=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(combined));}catch{throw failure('OPENAI_INPUT_INVALID');}return validateIntegrationOpenAI(input);}finally{combined?.fill(0);for(const bytes of chunks)bytes.fill(0);}};
 try{return await Promise.race([consume(),new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;stream.destroy?.();reject(failure('OPENAI_INPUT_TIMEOUT'));},timeoutMs);})]);}finally{clearTimeout(timer);}
}
export async function runOpenAIConfiguration({args=process.argv.slice(2),input=process.stdin,...options}={}){
 let payload;
 try{
  if(args.length>1||(args.length&&!['--check','--configure'].includes(args[0])))throw failure('OPENAI_ARGUMENT_INVALID');
  const checked=await checkIntegrationOpenAI(options);
  if(args[0]!=='--configure')return{result:checked,exitCode:checked.configured?0:2};
  if(checked.keyPresent||checked.modelPresent)throw failure('OPENAI_PROFILE_ALREADY_CONFIGURED');
  payload=await readOpenAIConfiguration(input);const result=await configureIntegrationOpenAI(payload,options);return{result,exitCode:result.configured?0:2};
 }catch(error){return{result:{status:'blocked',configured:false,configurationOnly:true,verified:false,networkTested:false,projectRef:APPROVED_PROFILE_PROJECT,error:safeCodes.has(error?.code)?error.code:'OPENAI_SETUP_FAILED'},exitCode:2};}
 finally{if(payload){payload.apiKey=undefined;payload.model=undefined;}}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){const{result,exitCode}=await runOpenAIConfiguration();process.stdout.write(JSON.stringify(result)+'\n');process.exitCode=exitCode;}
