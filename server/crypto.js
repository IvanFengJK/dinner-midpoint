import { randomBytes, createHash } from 'node:crypto';

// 128 random bits each, so a link cannot be guessed.
export const newGroupId = () => randomBytes(16).toString('base64url'); // 22 chars
export const newKey = () => randomBytes(16).toString('base64url'); // 22 chars
export const newMemberId = () => randomBytes(8).toString('base64url'); // 11 chars
// Only hashes of keys are stored. The keys are high-entropy, so a plain SHA-256 is enough.
export const hashKey = (key) => createHash('sha256').update(String(key)).digest('hex');

export const GROUP_ID_RE = /^[A-Za-z0-9_-]{22}$/;
export const MEMBER_ID_RE = /^[A-Za-z0-9_-]{11}$/;
export const KEY_RE = /^[A-Za-z0-9_-]{22}$/;
