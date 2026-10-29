/** Read-only check of two known CLI entrypoints; this is not a complete bundle/SBOM scan. */
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {resolve,relative} from 'node:path';
import {fileURLToPath} from 'node:url';

export function inspectEmbeddedZod(source) {
  const embedded=source.includes('$ZodType') && source.includes('$ZodError');
  const versions=[...new Set([...source.matchAll(/\b\w+\s*=\s*\{\s*major\s*:\s*(\d+)\s*,\s*minor\s*:\s*(\d+)\s*,\s*patch\s*:\s*(\d+)\s*\}/g)].map(match=>match.slice(1,4).join('.')))];
  const external=/(?:\bfrom\s*|\brequire\s*\(\s*)['"]zod(?:\/[^'"]+)?['"]/.test(source);
  const belowPatch=version=>{const [major,minor,patch]=version.split('.').map(Number);return major<4 || major===4 && (minor<6 || minor===6 && patch<6);};
  if(embedded) return {state:versions.length?'embedded':'unversioned-embedded',versions,needsReview:!versions.length||versions.some(belowPatch)};
  return {state:external?'external':'unknown',versions:[],needsReview:!external};
}

export function isAffectedZodVersion(version) {
  const stable=/^(\d+)\.(\d+)\.(\d+)$/.exec(version||'');
  if(!stable) return true;
  const [,major,minor,patch]=stable.map(Number);
  return major<4 || major===4 && (minor<6 || minor===6 && patch<6);
}

export function assessZodEntrypoint(source,resolvedVersion) {
  const inspection=inspectEmbeddedZod(source);
  const externalDependencyAffected=isAffectedZodVersion(resolvedVersion);
  return {...inspection,externalDependencyAffected,needsReview:inspection.needsReview||externalDependencyAffected};
}
export async function inspectKnownCLIEntrypoints(root=process.cwd()) {
  const require=createRequire(resolve(root,'package.json'));
  const entries=[];
  for(const [name,entryName] of [['@vercel/cli-config','@vercel/cli-config'],['@vercel/cli-auth','@vercel/cli-auth/oauth.js']]) {
    const entry=require.resolve(entryName),source=await readFile(entry,'utf8');
    const metadata=JSON.parse(await readFile(resolve(root,'node_modules',name,'package.json'),'utf8'));
    const dependencyRequire=createRequire(entry);
    const resolvedZod=JSON.parse(await readFile(dependencyRequire.resolve('zod/package.json'),'utf8')).version;
    entries.push({name,packageVersion:metadata.version,entry:relative(root,entry).replaceAll('\\','/'),sha256:createHash('sha256').update(source).digest('hex'),resolvedZod,...assessZodEntrypoint(source,resolvedZod)});
  }
  return {date:new Date().toISOString(),scope:'Static version-marker review of the public cli-config and CLI OAuth entrypoints only. No account/configuration files are read. Not a complete bundle vulnerability scan.',entries,releaseReviewRequired:entries.some(entry=>entry.needsReview)};
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const report=await inspectKnownCLIEntrypoints();
  await writeFile('docs/embedded-dependency-audit.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
  process.exitCode=report.releaseReviewRequired?1:0;
}

