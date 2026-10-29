import { lstat, open, readFile, writeFile, realpath } from 'node:fs/promises';
import { resolve, dirname, basename, join, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

export const APPROVED_PROFILE_PROJECT = 'lmhnyqtcfvgrcygsgqjg';
export const VERIFIED_PROFILE_POOLER = 'aws-1-eu-central-1.pooler.supabase.com';
export const PROFILE_FIELDS = ['DATABASE_URL', 'HESSARA_TEST_EMAIL_A', 'HESSARA_TEST_PASSWORD_A', 'HESSARA_TEST_EMAIL_B', 'HESSARA_TEST_PASSWORD_B'];
const inputFields = ['databasePassword', 'emailA', 'passwordA', 'emailB', 'passwordB'];
const MAX_PROFILE_BYTES = 65536;
const MAX_INPUT_BYTES = 8192;
const loopback = new Set(['localhost', '127.0.0.1', '[::1]']);
const emailPattern = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;
class ProfileError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const fail = code => { throw new ProfileError(code); };
const present = value => typeof value === 'string' && !!value.trim();
function localContext(env) { if (env.VERCEL) fail('LOCAL_CONFIGURATION_ONLY'); }
function baseIssues(profile) {
  const issues = [];
  if (profile.VERCEL) issues.push('LOCAL_CONFIGURATION_ONLY');
  if (profile.HESSARA_TEST_PROJECT_REF !== APPROVED_PROFILE_PROJECT) issues.push('PROFILE_PROJECT_NOT_APPROVED');
  if (profile.NEXT_PUBLIC_SUPABASE_URL !== `https://${APPROVED_PROFILE_PROJECT}.supabase.co`) issues.push('PROFILE_AUTH_TARGET_INVALID');
  if (profile.HESSARA_TEST_ISOLATED !== 'true' || profile.HESSARA_INTEGRATION_TEST !== 'true') issues.push('PROFILE_ISOLATION_REQUIRED');
  try {
    const url = new URL(profile.HESSARA_TEST_URL);
    if (url.protocol !== 'http:' || !loopback.has(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash || profile.HESSARA_TEST_URL !== url.origin || profile.HESSARA_SITE_URL !== url.origin) throw Error();
  } catch { issues.push('PROFILE_ORIGIN_INVALID'); }
  const vault = profile.HESSARA_ENCRYPTION_KEY;
  if (!vault || !/^[A-Za-z0-9+/]{43}=$/.test(vault) || Buffer.from(vault, 'base64').length !== 32 || Buffer.from(vault, 'base64').toString('base64') !== vault) issues.push('PROFILE_ENCRYPTION_KEY_INVALID');
  const key = profile.HESSARA_TEST_ATTESTATION_KEY;
  if (!key || key.trim().length < 32 || key.length > 4096) issues.push('PROFILE_ATTESTATION_KEY_INVALID');
  return issues;
}
function validPassword(value, minimum, maximum) {
  return typeof value === 'string' && !!value.trim() && [...value].length >= minimum && value.length <= maximum && !/[\x00-\x1f\x7f]/.test(value);
}
function validDatabase(profile) {
  try {
    const url = new URL(profile.DATABASE_URL);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== VERIFIED_PROFILE_POOLER || url.port !== '6543' || decodeURIComponent(url.username) !== `hessara_runtime.${APPROVED_PROFILE_PROJECT}` || url.pathname !== '/postgres' || url.search || url.hash || !validPassword(decodeURIComponent(url.password), 16, 1024)) throw Error();
  } catch { return false; }
  return true;
}
function accountIssues(profile) {
  const issues = [];
  if (!validDatabase(profile)) issues.push('PROFILE_DATABASE_INVALID');
  for (const account of ['A', 'B']) {
    const email = profile[`HESSARA_TEST_EMAIL_${account}`];
    if (typeof email !== 'string' || email.length > 254 || email !== email.trim() || !emailPattern.test(email)) issues.push(`PROFILE_EMAIL_${account}_INVALID`);
    if (!validPassword(profile[`HESSARA_TEST_PASSWORD_${account}`], 12, 128)) issues.push(`PROFILE_PASSWORD_${account}_INVALID`);
  }
  if (present(profile.HESSARA_TEST_EMAIL_A) && present(profile.HESSARA_TEST_EMAIL_B) && profile.HESSARA_TEST_EMAIL_A.toLowerCase() === profile.HESSARA_TEST_EMAIL_B.toLowerCase()) issues.push('TEST_ACCOUNTS_MUST_DIFFER');
  return issues;
}
async function loadProfile(profilePath) {
  if (basename(profilePath) !== '.env.integration.local') fail('PRIVATE_PROFILE_PATH_INVALID');
  let metadata;
  try { metadata = await lstat(profilePath); } catch { fail('PRIVATE_PROFILE_UNAVAILABLE'); }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink > 1 || metadata.size > MAX_PROFILE_BYTES) fail('PRIVATE_PROFILE_UNSAFE');
  let content, profile;
  try { content = await readFile(profilePath, 'utf8'); profile = parseEnv(content); } catch { fail('PRIVATE_PROFILE_INVALID'); }
  return { content, profile, metadata };
}
/** Configuration inspection only: never connects to Auth, Postgres or any provider. */
export async function checkIntegrationProfile({ profilePath = resolve('.env.integration.local'), environment = process.env } = {}) {
  localContext(environment);
  const { profile } = await loadProfile(profilePath);
  const issues = baseIssues(profile);
  const missingFields = PROFILE_FIELDS.filter(name => !present(profile[name]));
  if (present(profile.POSTGRES_URL)) issues.push('LEGACY_DATABASE_CONNECTION_PRESENT');
  if (!missingFields.length) issues.push(...accountIssues(profile));
  const configured = !issues.length && !missingFields.length;
  return { status: issues.length ? 'blocked' : configured ? 'configured' : 'needs_configuration', configured, networkTested: false, issues, missingFields };
}
function validatedAccountValues(input) {
  const values = {};
  for (const account of ['A', 'B']) {
    const email = input[`email${account}`];
    if (typeof email !== 'string' || email.length > 254 || !emailPattern.test(email.trim())) fail(`TEST_EMAIL_${account}_INVALID`);
    if (!validPassword(input[`password${account}`], 12, 128)) fail(`TEST_PASSWORD_${account}_INVALID`);
    values[`HESSARA_TEST_EMAIL_${account}`] = email.trim();
    values[`HESSARA_TEST_PASSWORD_${account}`] = input[`password${account}`];
  }
  if (values.HESSARA_TEST_EMAIL_A.toLowerCase() === values.HESSARA_TEST_EMAIL_B.toLowerCase()) fail('TEST_ACCOUNTS_MUST_DIFFER');
  return values;
}
function validatedInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).sort().join(',') !== [...inputFields].sort().join(',')) fail('CONFIGURATION_INPUT_INVALID');
  if (!validPassword(input.databasePassword, 16, 1024)) fail('DATABASE_PASSWORD_INVALID');
  const values = validatedAccountValues(input);
  values.DATABASE_URL = `postgresql://${encodeURIComponent(`hessara_runtime.${APPROVED_PROFILE_PROJECT}`)}:${encodeURIComponent(input.databasePassword)}@${VERIFIED_PROFILE_POOLER}:6543/postgres`;
  return values;
}
function serializeProfile(profile) {
  const lines = [];
  for (const [name, value] of Object.entries(profile)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || typeof value !== 'string') fail('PROFILE_SERIALIZATION_UNSUPPORTED');
    // Literal single/backtick quotes preserve backslashes. Double quotes decode \n in Node's dotenv parser.
    const delimiter = ["'", '`', '"'].find(quote => !value.includes(quote) && (quote !== '"' || !/\\[nr]/.test(value)));
    if (!delimiter) fail('PROFILE_SERIALIZATION_UNSUPPORTED');
    lines.push(`${name}=${delimiter}${value}${delimiter}`);
  }
  const content = '# Private isolated integration profile. Never commit or share.\n' + lines.join('\n') + '\n';
  const roundTrip = parseEnv(content);
  if (Object.keys(roundTrip).length !== Object.keys(profile).length || Object.entries(profile).some(([name, value]) => roundTrip[name] !== value)) fail('PROFILE_SERIALIZATION_UNSUPPORTED');
  return content;
}
async function saveProfile(profilePath, loaded, content, backupName) {
  const backupPath = join(dirname(profilePath), backupName);
  let handle;
  try {
    handle = await open(profilePath, 'r+');
    const current = await handle.stat();
    if (!current.isFile() || current.dev !== loaded.metadata.dev || current.ino !== loaded.metadata.ino || current.nlink > 1 || await handle.readFile('utf8') !== loaded.content) fail('PRIVATE_PROFILE_CHANGED');
    try { await writeFile(backupPath, loaded.content, { flag: 'wx', mode: 0o600 }); }
    catch (error) { fail(error.code === 'EEXIST' ? 'PRIVATE_BACKUP_ALREADY_EXISTS' : 'PRIVATE_BACKUP_FAILED'); }
    const bytes = Buffer.from(content, 'utf8');
    try {
      let offset = 0;
      while (offset < bytes.length) { const result = await handle.write(bytes, offset, bytes.length - offset, offset); if (!result.bytesWritten) fail('PRIVATE_PROFILE_WRITE_FAILED'); offset += result.bytesWritten; }
      await handle.truncate(bytes.length);
      await handle.sync();
    } finally { bytes.fill(0); }
  } catch (error) { if (error instanceof ProfileError) throw error; fail('PRIVATE_PROFILE_WRITE_FAILED'); }
  finally { await handle?.close().catch(() => {}); }
  return backupPath;
}

/** Writes only the pre-existing private profile, after full validation and an exclusive backup. */
export async function configureIntegrationProfile(input, { profilePath = resolve('.env.integration.local'), environment = process.env } = {}) {
  localContext(environment);
  const loaded = await loadProfile(profilePath);
  if (baseIssues(loaded.profile).length) fail('PROFILE_BASE_INVALID');
  if (PROFILE_FIELDS.some(name => present(loaded.profile[name])) || present(loaded.profile.POSTGRES_URL)) fail('PROFILE_FIELDS_ALREADY_CONFIGURED');
  const values = validatedInput(input);
  const configured = { ...loaded.profile, ...values };
  if (accountIssues(configured).length) fail('CONFIGURATION_INPUT_INVALID');
  const content = serializeProfile(configured);
  const backupPath = await saveProfile(profilePath, loaded, content, '.env.integration.backup.local');
  return { status: 'configured', configured: true, networkTested: false, changedFields: PROFILE_FIELDS, backup: basename(backupPath) };
}

/** New staged actions stay inside this checkout, including a resolved parent path. */
export async function integrationProfilePath(profilePath = resolve('.env.integration.local')) {
  const exact = resolve(profilePath);
  if (basename(exact) !== '.env.integration.local') fail('PRIVATE_PROFILE_PATH_INVALID');
  let root, parent;
  try {
    root = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
    parent = await realpath(dirname(exact));
  } catch { fail('PRIVATE_PROFILE_PATH_INVALID'); }
  const inside = relative(root, parent);
  if (inside === '..' || inside.startsWith('..' + sep) || isAbsolute(inside)) fail('PRIVATE_PROFILE_PATH_INVALID');
  return join(parent, basename(exact));
}

/** Read-only database-stage state; does not expose connection values or contact services. */
export async function checkIntegrationDatabase({ profilePath = resolve('.env.integration.local'), environment = process.env } = {}) {
  localContext(environment); profilePath = await integrationProfilePath(profilePath);
  const { profile } = await loadProfile(profilePath);
  const issues = baseIssues(profile);
  if (present(profile.POSTGRES_URL)) issues.push('LEGACY_DATABASE_CONNECTION_PRESENT');
  const databaseConfigured = present(profile.DATABASE_URL) && validDatabase(profile);
  if (present(profile.DATABASE_URL) && !databaseConfigured) issues.push('PROFILE_DATABASE_INVALID');
  return { status: issues.length ? 'blocked' : databaseConfigured ? 'database_configured' : 'needs_database',
    databaseConfigured, configured: false, verified: false, networkTested: false, issues,
    missingAuthFields: PROFILE_FIELDS.slice(1).filter(name => !present(profile[name])) };
}

/** Configure only the approved runtime connection; account fields remain untouched. */
export async function configureIntegrationDatabase(input, { profilePath = resolve('.env.integration.local'), environment = process.env } = {}) {
  localContext(environment); profilePath = await integrationProfilePath(profilePath);
  const loaded = await loadProfile(profilePath);
  if (baseIssues(loaded.profile).length) fail('PROFILE_BASE_INVALID');
  if (present(loaded.profile.DATABASE_URL) || present(loaded.profile.POSTGRES_URL)) fail('PROFILE_DATABASE_ALREADY_CONFIGURED');
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).join(',') !== 'databasePassword') fail('CONFIGURATION_INPUT_INVALID');
  if (!validPassword(input.databasePassword, 16, 1024)) fail('DATABASE_PASSWORD_INVALID');
  if (!/^[\x20-\x7e]+$/.test(input.databasePassword)) fail('DATABASE_PASSWORD_ASCII_REQUIRED');
  const url = 'postgresql://' + encodeURIComponent('hessara_runtime.' + APPROVED_PROFILE_PROJECT) + ':' + encodeURIComponent(input.databasePassword) + '@' + VERIFIED_PROFILE_POOLER + ':6543/postgres';
  const configured = { ...loaded.profile, DATABASE_URL: url };
  const backupPath = await saveProfile(profilePath, loaded, serializeProfile(configured), '.env.integration.database.backup.local');
  return { status: 'database_configured', databaseConfigured: true, configured: false, configurationOnly: true, verified: false, networkTested: false, changedFields: ['DATABASE_URL'], backup: basename(backupPath) };
}

/** Store a public CA only; the actual server connection remains unverified. */
export async function configureIntegrationDatabaseTls(input, { profilePath = resolve('.env.integration.local'), environment = process.env } = {}) {
  localContext(environment); profilePath = await integrationProfilePath(profilePath);
  const loaded = await loadProfile(profilePath);
  if (baseIssues(loaded.profile).length) fail('PROFILE_BASE_INVALID');
  if (!present(loaded.profile.DATABASE_URL)) fail('PROFILE_DATABASE_REQUIRED');
  if (!validDatabase(loaded.profile) || present(loaded.profile.POSTGRES_URL)) fail('PROFILE_DATABASE_INVALID');
  if (typeof loaded.profile.DATABASE_SSL_CA === 'string' && loaded.profile.DATABASE_SSL_CA.length) fail('PROFILE_TLS_ALREADY_CONFIGURED');
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).join(',') !== 'certificate'
    || typeof input.certificate !== 'string' || !input.certificate.trim() || input.certificate.length > 32768) fail('TLS_CERTIFICATE_INPUT_INVALID');
  let options;
  try {
    // Load only for this new action; existing standalone full-configure stays Node-only.
    const { databaseTls } = await import('../lib/postgres-tls.mjs');
    options = databaseTls(loaded.profile.DATABASE_URL, input.certificate);
  } catch { fail('TLS_CERTIFICATE_INVALID'); }
  if (!options || options.rejectUnauthorized !== true || typeof options.ca !== 'string') fail('TLS_CERTIFICATE_INVALID');
  const configured = { ...loaded.profile, DATABASE_SSL_CA: options.ca };
  const backupPath = await saveProfile(profilePath, loaded, serializeProfile(configured), '.env.integration.tls.backup.local');
  return { status: 'database_tls_configured', tlsConfigured: true, rejectUnauthorized: true, configured: false, configurationOnly: true, verified: false,
    networkTested: false, changedFields: ['DATABASE_SSL_CA'], backup: basename(backupPath) };
}

/** Configure only complete dedicated test-account fields; preserves the runtime connection. */
export async function configureIntegrationAccounts(input, { profilePath = resolve('.env.integration.local'), environment = process.env } = {}) {
  localContext(environment); profilePath = await integrationProfilePath(profilePath);
  const loaded = await loadProfile(profilePath);
  if (baseIssues(loaded.profile).length) fail('PROFILE_BASE_INVALID');
  if (!present(loaded.profile.DATABASE_URL)) fail('PROFILE_DATABASE_REQUIRED');
  if (!validDatabase(loaded.profile) || present(loaded.profile.POSTGRES_URL)) fail('PROFILE_DATABASE_INVALID');
  if (PROFILE_FIELDS.slice(1).some(name => present(loaded.profile[name]))) fail('PROFILE_AUTH_FIELDS_ALREADY_CONFIGURED');
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).sort().join(',') !== 'emailA,emailB,passwordA,passwordB') fail('CONFIGURATION_INPUT_INVALID');
  const configured = { ...loaded.profile, ...validatedAccountValues(input) };
  const backupPath = await saveProfile(profilePath, loaded, serializeProfile(configured), '.env.integration.accounts.backup.local');
  return { status: 'accounts_configured', accountsConfigured: true, configured: true, configurationOnly: true, verified: false, networkTested: false, changedFields: PROFILE_FIELDS.slice(1), backup: basename(backupPath) };
}

/** Store the approved test Storage credential server-side only; this is not a remote verification. */
export async function configureIntegrationStorageKey(input, { profilePath = resolve('.env.integration.local'), environment = process.env } = {}) {
  localContext(environment); profilePath = await integrationProfilePath(profilePath);
  const loaded = await loadProfile(profilePath);
  if (baseIssues(loaded.profile).length) fail('PROFILE_BASE_INVALID');
  if (!present(loaded.profile.DATABASE_URL)) fail('PROFILE_DATABASE_REQUIRED');
  if (!validDatabase(loaded.profile) || present(loaded.profile.POSTGRES_URL)) fail('PROFILE_DATABASE_INVALID');
  if (accountIssues(loaded.profile).length) fail('PROFILE_AUTH_FIELDS_REQUIRED');
  if (typeof loaded.profile.SUPABASE_AUTH_SECRET_KEY === 'string' && loaded.profile.SUPABASE_AUTH_SECRET_KEY.length) fail('PROFILE_STORAGE_ALREADY_CONFIGURED');
  // Load only for this action: the shared validator imports this profile module too.
  const { validateIntegrationAdminKey } = await import('./provision-integration-users.mjs');
  const key = validateIntegrationAdminKey(input);
  const configured = { ...loaded.profile, SUPABASE_AUTH_SECRET_KEY: key };
  const backupPath = await saveProfile(profilePath, loaded, serializeProfile(configured), '.env.integration.storage.backup.local');
  return { status: 'configured', configured: true, storageKeyConfigured: true, configurationOnly: true, verified: false,
    networkTested: false, changedFields: ['SUPABASE_AUTH_SECRET_KEY'], backup: basename(backupPath) };
}
export const OPENAI_INTEGRATION_FIELDS = ['OPENAI_API_KEY', 'OPENAI_MODEL'];
export const OPENAI_INTEGRATION_BACKUP = '.env.integration.openai.backup.local';
/** Input syntax only; the official provider must still verify access and a real response. */
export function validateIntegrationOpenAI(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).sort().join(',') !== 'apiKey,model' || typeof input.apiKey !== 'string' || typeof input.model !== 'string') fail('OPENAI_INPUT_INVALID');
  if (input.apiKey.length > 4096 || input.model.length > 240) fail('OPENAI_INPUT_TOO_LARGE');
  // Strip only boundary clipboard whitespace/direction formatting; never alter the credential body.
  const key = input.apiKey.replace(/^[\s\u061c\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]+|[\s\u061c\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]+$/g, ''), model = input.model.trim();
  if (!key) fail('OPENAI_KEY_REQUIRED');
  if (/^(?:sb_(?:secret|publishable)_|sk-ant-)/.test(key)) fail('OPENAI_KEY_PROVIDER_MISMATCH');
  if (/^sk-admin-/.test(key)) fail('OPENAI_ADMIN_KEY_NOT_ALLOWED');
  if (/[*•●…]|\.{3}/.test(key)) fail('OPENAI_KEY_MASKED');
  if (/^(?:Bearer|apikey)\s/i.test(key) || /^["']|["']$/.test(key)) fail('OPENAI_KEY_WRAPPED');
  if (/\s/.test(key)) fail('OPENAI_KEY_INTERNAL_WHITESPACE');
  if (/[^\x21-\x7e]/.test(key)) fail('OPENAI_KEY_UNSAFE_CHARACTERS');
  if (!key.startsWith('sk-')) fail('OPENAI_KEY_PREFIX_INVALID');
  if (key.length < 20) fail('OPENAI_KEY_TOO_SHORT');
  // Bounded bearer-token syntax is only an input guard, never proof of provider identity/access.
  if (!/^sk-[A-Za-z0-9._~+/-]+=*$/.test(key)) fail('OPENAI_KEY_FORMAT_INVALID');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/.test(model) || /^(?:sk-|sb_|eyJ)/.test(model) || model === key) fail('OPENAI_MODEL_INVALID');
  return { apiKey: key, model };
}
async function openAIProfile(options) {
  localContext(options.environment ?? process.env);
  const profilePath = await integrationProfilePath(options.profilePath ?? resolve('.env.integration.local'));
  const loaded = await loadProfile(profilePath);
  if (baseIssues(loaded.profile).length) fail('PROFILE_BASE_INVALID');
  if (accountIssues(loaded.profile).length || present(loaded.profile.POSTGRES_URL)) fail('PROFILE_AUTH_FIELDS_REQUIRED');
  if (Object.entries(loaded.profile).some(([key, value]) => /^NEXT_PUBLIC_.*OPENAI.*(?:KEY|TOKEN)/.test(key) && present(value))) fail('OPENAI_PUBLIC_SECRET_FIELD_NOT_ALLOWED');
  return { profilePath, loaded };
}
/** Entirely offline: presence is configuration, never model availability or successful inference. */
export async function checkIntegrationOpenAI(options = {}) {
  const { loaded } = await openAIProfile(options);
  const keyPresent = present(loaded.profile.OPENAI_API_KEY), modelPresent = present(loaded.profile.OPENAI_MODEL);
  const configured = keyPresent && modelPresent;
  if (configured) validateIntegrationOpenAI({ apiKey: loaded.profile.OPENAI_API_KEY, model: loaded.profile.OPENAI_MODEL });
  return { status: configured ? 'configured' : 'needs_configuration', configured, configurationOnly: true, verified: false, networkTested: false,
    projectRef: APPROVED_PROFILE_PROJECT, keyPresent, modelPresent,
    missingFields: ['OPENAI_API_KEY', 'OPENAI_MODEL'].filter(name => !present(loaded.profile[name])) };
}
/** Explicit local setup only. This stores a server-side model profile; it does not probe the provider. */
export async function configureIntegrationOpenAI(input, options = {}) {
  const { profilePath, loaded } = await openAIProfile(options);
  if (['OPENAI_API_KEY', 'OPENAI_MODEL'].some(name => typeof loaded.profile[name] === 'string' && loaded.profile[name].length)) fail('OPENAI_PROFILE_ALREADY_CONFIGURED');
  const validated = validateIntegrationOpenAI(input);
  const configured = { ...loaded.profile, OPENAI_API_KEY: validated.apiKey, OPENAI_MODEL: validated.model };
  const backupPath = await saveProfile(profilePath, loaded, serializeProfile(configured), OPENAI_INTEGRATION_BACKUP);
  return { status: 'configured', configured: true, configurationOnly: true, verified: false, networkTested: false, keySavedServerOnly: true,
    projectRef: APPROVED_PROFILE_PROJECT, changedFields: OPENAI_INTEGRATION_FIELDS, backup: basename(backupPath) };
}

export async function readConfigurationInput(stream) {
  const chunks = []; let size = 0, buffer;
  try {
    for await (const chunk of stream) { const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += bytes.length; if (size > MAX_INPUT_BYTES) fail('CONFIGURATION_INPUT_TOO_LARGE'); chunks.push(bytes); }
    if (!size) fail('CONFIGURATION_INPUT_REQUIRED');
    buffer = Buffer.concat(chunks);
    try { return JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(buffer)); } catch { fail('CONFIGURATION_INPUT_INVALID'); }
  } finally { buffer?.fill(0); for (const chunk of chunks) chunk.fill(0); }
}
export async function runConfigurationCli({ args = process.argv.slice(2), input = process.stdin, environment = process.env, profilePath = resolve('.env.integration.local') } = {}) {
  try {
    if (args.length > 1 || (args.length && !['--check', '--configure', '--configure-accounts'].includes(args[0]))) fail('CONFIGURATION_ARGUMENT_INVALID');
    localContext(environment);
    const result = args[0] === '--configure' ? await configureIntegrationProfile(await readConfigurationInput(input), { profilePath, environment })
      : args[0] === '--configure-accounts' ? await configureIntegrationAccounts(await readConfigurationInput(input), { profilePath, environment })
        : await checkIntegrationProfile({ profilePath, environment });
    return { result, exitCode: result.configured ? 0 : 2 };
  } catch (error) {
    return { result: { status: 'blocked', configured: false, networkTested: false, error: error instanceof ProfileError ? error.code : 'CONFIGURATION_FAILED' }, exitCode: 2 };
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { result, exitCode } = await runConfigurationCli();
  process.stdout.write(JSON.stringify(result) + '\n'); process.exitCode = exitCode;
}
