/**
 * AES-256-GCM 암호화 — 서버 전용.
 * 클라이언트 컴포넌트에서 import하면 안 됨 (Node.js crypto 의존).
 *
 * 환경변수: ENCRYPTION_KEY — 32바이트 hex 문자열 (64자)
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

function getKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error('ENCRYPTION_KEY must be a 64-char hex string (32 bytes)');
  }
  return Buffer.from(hex, 'hex');
}

/**
 * 평문을 AES-256-GCM으로 암호화한다.
 * @returns base64 인코딩된 문자열 (iv + ciphertext + authTag)
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  // iv(12) + encrypted(N) + tag(16) → base64
  return Buffer.concat([iv, encrypted, tag]).toString('base64');
}

/**
 * AES-256-GCM으로 암호화된 base64 문자열을 복호화한다.
 */
export function decrypt(encoded: string): string {
  const key = getKey();
  // Supabase returns bytea columns as '\x' + hex — decode hex first to recover the base64 string
  let base64Str = encoded;
  if (encoded.startsWith('\\x') || encoded.startsWith('\\X')) {
    base64Str = Buffer.from(encoded.slice(2), 'hex').toString('utf8');
  }
  const buf = Buffer.from(base64Str, 'base64');

  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(buf.length - TAG_LEN);
  const ciphertext = buf.subarray(IV_LEN, buf.length - TAG_LEN);

  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString('utf8');
}

/**
 * PII 마스킹 유틸.
 * - 주민번호: 940101-1******
 * - 계좌번호: 1234-**-****56
 * - 사업자등록번호: 123-45-*****
 */
export function maskSSN(ssn: string): string {
  const digits = ssn.replace(/\D/g, '');
  if (digits.length < 7) return '******-*******';
  return digits.slice(0, 6) + '-' + digits[6] + '******';
}

export function maskBankAccount(account: string): string {
  const digits = account.replace(/\D/g, '');
  if (digits.length < 4) return '****';
  return digits.slice(0, 4) + '-**-****' + digits.slice(-2);
}

export function maskBusinessReg(reg: string): string {
  const digits = reg.replace(/\D/g, '');
  if (digits.length < 5) return '***-**-*****';
  return digits.slice(0, 3) + '-' + digits.slice(3, 5) + '-*****';
}
