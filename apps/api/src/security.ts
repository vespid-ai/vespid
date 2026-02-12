import crypto from "node:crypto";

const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }, (error, key) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(key as Buffer);
    });
  });
  return `${salt}:${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, expected] = stored.split(":");
  if (!salt || !expected) {
    return false;
  }

  const derived = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }, (error, key) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(key as Buffer);
    });
  });

  const actual = Buffer.from(derived.toString("hex"), "hex");
  const expectedBuf = Buffer.from(expected, "hex");
  if (actual.length !== expectedBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(actual, expectedBuf);
}
