/* eslint-disable @typescript-eslint/no-require-imports -- Node --require preloads must initialize synchronously as CommonJS. */
const fs = require('node:fs');
const path = require('node:path');
const {setTimeout: delay} = require('node:timers/promises');

/** Preserve mkdir semantics while retrying transient EPERM within build output. */
function createBuildMkdir({root, mkdir, stat, writable, wait = delay}) {
  const boundary = path.resolve(root).toLowerCase();
  return async (target, options) => {
    const filename = typeof target === 'string' ? path.resolve(target).toLowerCase() : '';
    const scoped = filename === boundary || filename.startsWith(boundary + path.sep);
    for (let attempt = 0; ; attempt++) {
      try { return await mkdir(target, options); }
      catch (error) {
        if (!scoped || error.code !== 'EPERM') throw error;
        const info = await stat(target).catch(() => null);
        if (info?.isDirectory() && await writable(target)) {
          // A non-recursive mkdir may be an atomic lock: it must still fail.
          if (!options || typeof options !== 'object' || !options.recursive) {
            const exists = Object.assign(new Error(`EEXIST: directory already exists, mkdir '${target}'`), {code:'EEXIST', syscall:'mkdir', path:target, cause:error});
            throw exists;
          }
          return undefined;
        }
        if (attempt >= 2) throw error;
        await wait(20 * (attempt + 1));
      }
    }
  };
}

exports.createBuildMkdir = createBuildMkdir;

// Activated only by build-local.mjs, inside its child build processes.
if (process.platform === 'win32' && process.env.HESSARA_LOCAL_WINDOWS_BUILD === '1') {
  const nativeMkdir = fs.promises.mkdir.bind(fs.promises);
  const nativeCallbackMkdir = fs.mkdir;
  const guarded = createBuildMkdir({
    root:path.resolve(__dirname,'..','.next'),
    mkdir:nativeMkdir,
    stat:fs.promises.lstat.bind(fs.promises),
    writable:target=>fs.promises.access(target,fs.constants.W_OK).then(()=>true,()=>false),
  });
  fs.promises.mkdir = guarded;
  fs.mkdir = function(target, options, callback) {
    if (typeof target !== 'string') return nativeCallbackMkdir.apply(this,arguments);
    if (typeof options === 'function') { callback=options; options=undefined; }
    if (typeof callback !== 'function') return nativeCallbackMkdir.apply(this,arguments);
    guarded(target,options).then(created=>callback(null,created),error=>callback(error));
  };
  require('node:module').syncBuiltinESMExports();
}
