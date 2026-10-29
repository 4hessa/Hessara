import { lstat, open } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { databaseTls } from '../lib/postgres-tls.mjs';
import { APPROVED_PROFILE_PROJECT, VERIFIED_PROFILE_POOLER, checkIntegrationProfile } from './configure-integration-profile.mjs';

const MAX_PROFILE_BYTES = 65536;
const MAX_INPUT_BYTES = 8192;
const ROLE = 'hessara_runtime';
const identitySql = 'SELECT current_user AS role, session_user AS session_role, current_database() AS database';
const knownProfileErrors = new Set(['LOCAL_CONFIGURATION_ONLY','PRIVATE_PROFILE_PATH_INVALID','PRIVATE_PROFILE_UNAVAILABLE','PRIVATE_PROFILE_UNSAFE','PRIVATE_PROFILE_INVALID']);
class ProvisionError extends Error { constructor(code) { super(code); this.code = code; } }
const fail = code => { throw new ProvisionError(code); };
function localOnly(environment) { if (environment.VERCEL) fail('LOCAL_CONFIGURATION_ONLY'); }
function validPassword(value) { return typeof value === 'string' && !!value.trim() && value.length <= 1024 && !/[\x00-\x1f\x7f]/.test(value); }
function asciiPassword(value, code) { if (!/^[\x20-\x7e]+$/.test(value)) fail(code); }
function checkedAdministratorInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).join(',') !== 'administratorPassword' || !validPassword(input.administratorPassword)) fail('ADMINISTRATOR_INPUT_INVALID');
  asciiPassword(input.administratorPassword, 'ADMINISTRATOR_PASSWORD_ASCII_REQUIRED');
  return input.administratorPassword;
}

// PostgreSQL accepts a supplied SCRAM verifier as-is; only this verifier enters ALTER ROLE.
// https://www.postgresql.org/docs/current/sql-createrole.html
// ASCII-only avoids incorrectly approximating SASLprep or silently changing a password.
export function runtimeScramVerifier(password, suppliedSalt = randomBytes(16)) {
  if (!validPassword(password)) fail('RUNTIME_PASSWORD_INVALID');
  asciiPassword(password, 'RUNTIME_PASSWORD_ASCII_REQUIRED');
  if (!Buffer.isBuffer(suppliedSalt) || suppliedSalt.length !== 16) fail('SCRAM_SALT_INVALID');
  const salt = Buffer.from(suppliedSalt), secret = Buffer.from(password, 'utf8');
  let salted, clientKey, storedKey, serverKey;
  try {
    salted = pbkdf2Sync(secret, salt, 4096, 32, 'sha256');
    clientKey = createHmac('sha256', salted).update('Client Key').digest();
    storedKey = createHash('sha256').update(clientKey).digest();
    serverKey = createHmac('sha256', salted).update('Server Key').digest();
    return `SCRAM-SHA-256$4096:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;
  } finally { secret.fill(0); salt.fill(0); salted?.fill(0); clientKey?.fill(0); storedKey?.fill(0); serverKey?.fill(0); }
}
export async function readPrivateProfile(profilePath) {
  if (basename(profilePath) !== '.env.integration.local') fail('PRIVATE_PROFILE_PATH_INVALID');
  let before, handle, buffer;
  try {
    before = await lstat(profilePath);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > MAX_PROFILE_BYTES) fail('PRIVATE_PROFILE_UNSAFE');
    handle = await open(profilePath, 'r');
    const opened = await handle.stat();
    if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== before.dev || opened.ino !== before.ino || opened.size > MAX_PROFILE_BYTES) fail('PRIVATE_PROFILE_CHANGED');
    buffer = Buffer.alloc(MAX_PROFILE_BYTES + 1);
    let size = 0;
    while (size < buffer.length) { const part = await handle.read(buffer, size, buffer.length - size, size); if (!part.bytesRead) break; size += part.bytesRead; }
    if (size > MAX_PROFILE_BYTES || size !== opened.size) fail('PRIVATE_PROFILE_CHANGED');
    const after = await lstat(profilePath);
    if (!after.isFile() || after.isSymbolicLink() || after.nlink !== 1 || after.dev !== before.dev || after.ino !== before.ino || after.size !== opened.size || after.mtimeMs !== before.mtimeMs) fail('PRIVATE_PROFILE_CHANGED');
    return parseEnv(new TextDecoder('utf8', { fatal: true }).decode(buffer.subarray(0, opened.size)));
  } catch (error) { if (error instanceof ProvisionError) throw error; fail('PRIVATE_PROFILE_UNAVAILABLE'); }
  finally { buffer?.fill(0); await handle?.close().catch(() => {}); }
}
export function checkedRuntimeTarget(profile) {
  try {
    if (profile.VERCEL || profile.HESSARA_TEST_PROJECT_REF !== APPROVED_PROFILE_PROJECT || profile.NEXT_PUBLIC_SUPABASE_URL !== `https://${APPROVED_PROFILE_PROJECT}.supabase.co` || profile.HESSARA_TEST_ISOLATED !== 'true' || profile.HESSARA_INTEGRATION_TEST !== 'true' || profile.POSTGRES_URL?.trim()) fail('PROFILE_TARGET_NOT_APPROVED');
    const url = new URL(profile.DATABASE_URL);
    const password = decodeURIComponent(url.password);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== VERIFIED_PROFILE_POOLER || url.port !== '6543' || decodeURIComponent(url.username) !== `${ROLE}.${APPROVED_PROFILE_PROJECT}` || url.pathname !== '/postgres' || url.search || url.hash || !validPassword(password) || password.length < 16) fail('PROFILE_TARGET_NOT_APPROVED');
    asciiPassword(password, 'RUNTIME_PASSWORD_ASCII_REQUIRED');
    return { url, password };
  } catch (error) { if (error instanceof ProvisionError) throw error; fail('PROFILE_TARGET_NOT_APPROVED'); }
}
function optionsFor(url, profile) {
  let ssl; try { ssl = databaseTls(url, profile.DATABASE_SSL_CA || ''); } catch { fail('PROFILE_DATABASE_CA_INVALID'); }
  return {
    max: 1, max_pipeline: 1, prepare: false, ssl,
    connect_timeout: 10, idle_timeout: 5, max_lifetime: 30, debug: false, onnotice: () => {},
    connection: { application_name: 'hessara-isolated-runtime-provision', statement_timeout: '10000', lock_timeout: '5000', idle_in_transaction_session_timeout: '15000' },
  };
}
async function closeConnection(connection) { try { await connection?.end({ timeout: 5 }); } catch {} }
function validIdentity(rows, role) { return rows.length === 1 && rows[0].role === role && rows[0].session_role === role && rows[0].database === 'postgres'; }
function safeFailure(error, phase) {
  if (error instanceof ProvisionError) return error.code;
  if (knownProfileErrors.has(error?.code)) return error.code;
  if (error?.code === '28P01') return phase === 'runtime' ? 'RUNTIME_AUTHENTICATION_FAILED' : 'ADMINISTRATOR_AUTHENTICATION_FAILED';
  if (error?.code === '42501') return 'RUNTIME_PROVISION_PERMISSION_DENIED';
  if (['57014', '55P03', 'ETIMEDOUT', 'CONNECT_TIMEOUT'].includes(error?.code)) return 'DATABASE_OPERATION_TIMED_OUT';
  if (['SELF_SIGNED_CERT_IN_CHAIN','DEPTH_ZERO_SELF_SIGNED_CERT','CERT_HAS_EXPIRED','ERR_TLS_CERT_ALTNAME_INVALID','UNABLE_TO_VERIFY_LEAF_SIGNATURE'].includes(error?.code)) return 'DATABASE_TLS_VERIFICATION_FAILED';
  return phase === 'runtime' ? 'RUNTIME_VERIFICATION_FAILED' : phase === 'administrator' ? 'RUNTIME_PROVISION_FAILED' : 'RUNTIME_CONFIGURATION_FAILED';
}

/** Explicit caller action only. Does not create users, write application data or edit local files. */
export async function provisionIntegrationRuntime(input, { profilePath = resolve('.env.integration.local'), environment = process.env, connect = postgres, readProfile = readPrivateProfile } = {}) {
  let administrator, runtime, phase = 'configuration', verifier;
  const result = { status: 'blocked', verified: false, networkAttempted: false, roleChange: 'not_attempted', projectRef: APPROVED_PROFILE_PROJECT };
  try {
    localOnly(environment);
    const administratorPassword = checkedAdministratorInput(input);
    const checked = await checkIntegrationProfile({ profilePath, environment });
    if (!checked.configured) fail('PRIVATE_PROFILE_NOT_CONFIGURED');
    const profile = await readProfile(profilePath);
    const target = checkedRuntimeTarget(profile);
    verifier = runtimeScramVerifier(target.password);
    if (!/^SCRAM-SHA-256\$4096:[A-Za-z0-9+/]{22}==\$[A-Za-z0-9+/]{43}=:[A-Za-z0-9+/]{43}=$/.test(verifier)) fail('SCRAM_VERIFIER_INVALID');
    const administratorUrl = new URL(target.url);
    administratorUrl.username = `postgres.${APPROVED_PROFILE_PROJECT}`;
    administratorUrl.password = encodeURIComponent(administratorPassword);
    // Always construct SSL options before the injected/default connection can be reached.
    const administratorOptions = optionsFor(administratorUrl.toString(), profile);
    const runtimeOptions = optionsFor(target.url.toString(), profile);
    phase = 'administrator'; result.networkAttempted = true;
    administrator = connect(administratorUrl.toString(), administratorOptions);
    await administrator.begin(async tx => {
      if (!validIdentity(await tx.unsafe(identitySql), 'postgres')) fail('ADMINISTRATOR_DATABASE_IDENTITY_INVALID');
      await tx.unsafe("SELECT pg_advisory_xact_lock(hashtextextended('hessara:isolated-runtime-provision',0))");
      const roles = await tx.unsafe("SELECT rolname,rolcanlogin,rolinherit,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname='hessara_runtime'");
      if (roles.length !== 1 || roles[0].rolname !== ROLE || typeof roles[0].rolcanlogin !== 'boolean') fail('RUNTIME_ROLE_MISSING');
      if (['rolinherit','rolsuper','rolcreatedb','rolcreaterole','rolreplication','rolbypassrls'].some(attribute => roles[0][attribute] !== false)) fail('RUNTIME_ROLE_PRIVILEGED');
      const memberships = await tx.unsafe("SELECT r_granted.rolname AS granted_role,r_member.rolname AS member_role,m.admin_option,m.inherit_option,m.set_option FROM pg_auth_members m JOIN pg_roles r_granted ON r_granted.oid=m.roleid JOIN pg_roles r_member ON r_member.oid=m.member WHERE r_granted.rolname='hessara_runtime' OR r_member.rolname='hessara_runtime'");
      // Supabase grants the creator postgres ADMIN OPTION only; it cannot SET ROLE or inherit.
      // Never add memberships to work around permissions or accept a runtime parent role.
      if (memberships.length > 1 || memberships.some(row => row.granted_role !== ROLE || row.member_role !== 'postgres' || row.admin_option !== true || row.inherit_option !== false || row.set_option !== false)) fail('RUNTIME_ROLE_MEMBERSHIPS_REQUIRE_REVIEW');
      result.roleChange = 'unknown';
      await tx.unsafe(`ALTER ROLE hessara_runtime LOGIN PASSWORD '${verifier}'`);
    });
    result.roleChange = 'committed';
    await administrator.end({ timeout: 5 }); administrator = null;
    phase = 'runtime';
    runtime = connect(target.url.toString(), runtimeOptions);
    if (!validIdentity(await runtime.unsafe(identitySql), ROLE)) fail('RUNTIME_DATABASE_IDENTITY_INVALID');
    await runtime.unsafe('SELECT id FROM public.runs LIMIT 0');
    result.status = 'verified'; result.verified = true;
  } catch (error) { result.status = result.networkAttempted ? 'failed' : 'blocked'; result.error = safeFailure(error, phase); }
  finally {
    verifier = undefined;
    await closeConnection(runtime);
    await closeConnection(administrator);
  }
  return result;
}
export async function readRuntimeProvisionInput(stream, { timeoutMs = 30000 } = {}) {
  if (!stream || typeof stream[Symbol.asyncIterator] !== 'function' || typeof stream.destroy !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) fail('ADMINISTRATOR_INPUT_INVALID');
  if (stream.isTTY) fail('ADMINISTRATOR_INPUT_PIPE_REQUIRED');
  const chunks = []; let size = 0, combined;
  const timer = setTimeout(() => stream.destroy(new ProvisionError('ADMINISTRATOR_INPUT_TIMED_OUT')), timeoutMs);
  try {
    for await (const chunk of stream) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += bytes.length;
      if (size > MAX_INPUT_BYTES) { bytes.fill(0); fail('ADMINISTRATOR_INPUT_TOO_LARGE'); }
      chunks.push(bytes);
    }
    if (!size) fail('ADMINISTRATOR_INPUT_REQUIRED');
    combined = Buffer.concat(chunks);
    try { const parsed = JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(combined)); checkedAdministratorInput(parsed); return parsed; }
    catch (error) { if (error instanceof ProvisionError) throw error; fail('ADMINISTRATOR_INPUT_INVALID'); }
  } finally { clearTimeout(timer); combined?.fill(0); for (const chunk of chunks) chunk.fill(0); }
}
export async function runRuntimeProvisionCli({ args = process.argv.slice(2), input = process.stdin, environment = process.env, profilePath = resolve('.env.integration.local'), connect = postgres, readProfile = readPrivateProfile } = {}) {
  let payload;
  try {
    if (args.length > 1 || (args.length && !['--check','--apply'].includes(args[0]))) fail('RUNTIME_ARGUMENT_INVALID');
    localOnly(environment);
    const checked = await checkIntegrationProfile({ profilePath, environment });
    if (args[0] !== '--apply') return { result: { ...checked, verified: false, databaseWrites: false }, exitCode: checked.configured ? 0 : 2 };
    if (!checked.configured) fail('PRIVATE_PROFILE_NOT_CONFIGURED');
    payload = await readRuntimeProvisionInput(input);
    const result = await provisionIntegrationRuntime(payload, { profilePath, environment, connect, readProfile });
    return { result, exitCode: result.verified ? 0 : 2 };
  } catch (error) { return { result: { status: 'blocked', verified: false, networkAttempted: false, roleChange: 'not_attempted', error: safeFailure(error, 'configuration') }, exitCode: 2 }; }
  finally { if (payload) payload.administratorPassword = undefined; }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { result, exitCode } = await runRuntimeProvisionCli();
  process.stdout.write(JSON.stringify(result) + '\n'); process.exitCode = exitCode;
}
