import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
export const APPROVED_TEST_PROJECT_REF = 'lmhnyqtcfvgrcygsgqjg';
export const PRODUCTION_PROJECT_REF = 'waaaxdjymuauknbcxskn';
const refPattern = /^[a-z0-9]{20}$/;
const noncePattern = /^[a-f0-9]{64}$/;
const hexPattern = /^[a-f0-9]{64}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const keyReady = value => typeof value === 'string' && value.trim().length >= 32 && value.length <= 4096;
/** Only public target identity and issue codes are returned; no credentials or key. */
export function validateIntegrationTarget(env = {}) {
    const issues = [];
    let origin = null;
    const raw = env.HESSARA_TEST_URL;
    if (typeof raw !== 'string' || !raw.trim())
        issues.push('TEST_URL_REQUIRED');
    else
        try {
            const url = new URL(raw);
            if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
                throw Error();
            origin = url.origin;
        }
        catch {
            issues.push('TEST_URL_INVALID');
        }
    const projectRef = typeof env.HESSARA_TEST_PROJECT_REF === 'string' ? env.HESSARA_TEST_PROJECT_REF.trim().toLowerCase() : '';
    if (!projectRef)
        issues.push('TEST_PROJECT_REQUIRED');
    else if (projectRef === PRODUCTION_PROJECT_REF)
        issues.push('PRODUCTION_PROJECT_FORBIDDEN');
    else if (!refPattern.test(projectRef))
        issues.push('TEST_PROJECT_INVALID');
    else if (projectRef !== APPROVED_TEST_PROJECT_REF)
        issues.push('TEST_PROJECT_NOT_APPROVED');
    if (env.HESSARA_TEST_ISOLATED !== 'true')
        issues.push('ISOLATION_ACK_REQUIRED');
    if (!keyReady(env.HESSARA_TEST_ATTESTATION_KEY))
        issues.push('ATTESTATION_KEY_REQUIRED');
    const emails = [];
    for (const account of ['A', 'B']) {
        const email = env['HESSARA_TEST_EMAIL_' + account], password = env['HESSARA_TEST_PASSWORD_' + account];
        if (typeof email !== 'string' || email.length > 254 || !emailPattern.test(email.trim()))
            issues.push('TEST_EMAIL_' + account + '_REQUIRED');
        else
            emails.push(email.trim().toLowerCase());
        if (typeof password !== 'string' || password.length < 1 || password.length > 128)
            issues.push('TEST_PASSWORD_' + account + '_REQUIRED');
    }
    if (emails.length === 2 && emails[0] === emails[1])
        issues.push('TEST_ACCOUNTS_MUST_DIFFER');
    return { configured: issues.length === 0, issues, target: origin && projectRef === APPROVED_TEST_PROJECT_REF ? { origin, projectRef } : null };
}
function validTarget(target) {
    if (!target || target.projectRef !== APPROVED_TEST_PROJECT_REF)
        return false;
    try {
        const url = new URL(target.origin);
        return url.origin === target.origin && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash;
    }
    catch {
        return false;
    }
}
const sign = (key, value) => createHmac('sha256', key).update(value).digest('hex');
export function createIntegrationChallenge(target, key, nonce = randomBytes(32).toString('hex')) {
    if (!validTarget(target) || !keyReady(key) || !noncePattern.test(nonce))
        throw Error('INVALID_INTEGRATION_CHALLENGE');
    return { nonce, headers: { 'x-hessara-test-nonce': nonce, 'x-hessara-test-auth': sign(key, `hessara-integration-request-v1\n${nonce}\n${target.origin}\n${target.projectRef}`) } };
}
/** Verify a fresh challenge response before any authentication or application write. */
export function verifyIntegrationAttestation(body, target, key, nonce, now = Date.now()) {
    if (!validTarget(target) || !keyReady(key) || !noncePattern.test(nonce) || !Number.isFinite(now) || !body || typeof body !== 'object' || Array.isArray(body) || body.status !== 'ready')
        return false;
    if (Object.keys(body).sort().join(',') !== 'integration,status')
        return false;
    const value = body.integration;
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'issuedAt,nonce,origin,projectRef,proof,version')
        return false;
    if (value.version !== 1 || value.nonce !== nonce || value.origin !== target.origin || value.projectRef !== target.projectRef || typeof value.issuedAt !== 'string' || typeof value.proof !== 'string' || !hexPattern.test(value.proof))
        return false;
    const issued = Date.parse(value.issuedAt);
    if (!Number.isFinite(issued) || new Date(issued).toISOString() !== value.issuedAt || now - issued > 30000 || issued - now > 5000)
        return false;
    const expected = Buffer.from(sign(key, `hessara-integration-response-v1\n${nonce}\n${target.origin}\n${target.projectRef}\n${value.issuedAt}`), 'hex'), provided = Buffer.from(value.proof, 'hex');
    return provided.length === expected.length && timingSafeEqual(provided, expected);
}
