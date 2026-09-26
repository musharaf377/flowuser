// auth.js — password hashing and JWT-style tokens, using only node:crypto.
// No external dependencies (bcrypt/jsonwebtoken) needed.

const crypto = require('node:crypto');

const SCRYPT_KEYLEN = 64;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const check = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
  const original = Buffer.from(hash, 'hex');
  if (check.length !== original.length) return false;
  return crypto.timingSafeEqual(check, original);
}

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64urlToBuffer(input) {
  input = input.replace(/-/g, '+').replace(/_/g, '/');
  while (input.length % 4) input += '=';
  return Buffer.from(input, 'base64');
}

function sign(payload, secret, expiresInSec = 60 * 60 * 24 * 7) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = { ...payload, iat: now, exp: now + expiresInSec };
  const encHeader = base64url(JSON.stringify(header));
  const encPayload = base64url(JSON.stringify(fullPayload));
  const data = `${encHeader}.${encPayload}`;
  const sig = crypto.createHmac('sha256', secret).update(data).digest();
  const encSig = base64url(sig);
  return `${data}.${encSig}`;
}

function verify(token, secret) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [encHeader, encPayload, encSig] = parts;
  const data = `${encHeader}.${encPayload}`;
  const expectedSig = crypto.createHmac('sha256', secret).update(data).digest();
  const actualSig = base64urlToBuffer(encSig);
  if (expectedSig.length !== actualSig.length) return null;
  if (!crypto.timingSafeEqual(expectedSig, actualSig)) return null;

  let payload;
  try {
    payload = JSON.parse(base64urlToBuffer(encPayload).toString('utf8'));
  } catch {
    return null;
  }
  if (typeof payload.exp === 'number' && Date.now() / 1000 > payload.exp) return null;
  return payload;
}

function randomId(prefix = '') {
  return `${prefix}${crypto.randomBytes(12).toString('hex')}`;
}

function randomKey(bytes = 24) {
  return crypto.randomBytes(bytes).toString('hex');
}

module.exports = { hashPassword, verifyPassword, sign, verify, randomId, randomKey };
