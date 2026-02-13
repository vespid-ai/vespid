import crypto from "node:crypto";

export type Kek = {
  kekId: string;
  kekKeyBytes: Buffer;
};

export type EncryptedSecretRecord = {
  kekId: string;
  dekCiphertext: Buffer;
  dekIv: Buffer;
  dekTag: Buffer;
  secretCiphertext: Buffer;
  secretIv: Buffer;
  secretTag: Buffer;
};

function encryptAes256Gcm(input: { key: Buffer; plaintext: Buffer }): { ciphertext: Buffer; iv: Buffer; tag: Buffer } {
  if (input.key.length !== 32) {
    throw new Error("KEK_INVALID_LENGTH");
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", input.key, iv);
  const ciphertext = Buffer.concat([cipher.update(input.plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext, iv, tag };
}

function decryptAes256Gcm(input: { key: Buffer; ciphertext: Buffer; iv: Buffer; tag: Buffer }): Buffer {
  if (input.key.length !== 32) {
    throw new Error("KEK_INVALID_LENGTH");
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", input.key, input.iv);
  decipher.setAuthTag(input.tag);
  return Buffer.concat([decipher.update(input.ciphertext), decipher.final()]);
}

export function parseKekFromEnv(): Kek {
  const kekId = process.env.SECRETS_KEK_ID ?? "dev-kek-v1";
  const base64 = process.env.SECRETS_KEK_BASE64;
  if (!base64) {
    throw new Error("SECRETS_KEK_BASE64_REQUIRED");
  }
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length !== 32) {
    throw new Error("SECRETS_KEK_BASE64_INVALID");
  }
  return { kekId, kekKeyBytes: bytes };
}

export function encryptSecret(input: { plaintext: string; kek: Kek }): EncryptedSecretRecord {
  const dek = crypto.randomBytes(32);
  const dekEncrypted = encryptAes256Gcm({ key: input.kek.kekKeyBytes, plaintext: dek });
  const secretEncrypted = encryptAes256Gcm({ key: dek, plaintext: Buffer.from(input.plaintext, "utf8") });

  return {
    kekId: input.kek.kekId,
    dekCiphertext: dekEncrypted.ciphertext,
    dekIv: dekEncrypted.iv,
    dekTag: dekEncrypted.tag,
    secretCiphertext: secretEncrypted.ciphertext,
    secretIv: secretEncrypted.iv,
    secretTag: secretEncrypted.tag,
  };
}

export function decryptSecret(input: {
  encrypted: EncryptedSecretRecord;
  resolveKek: (kekId: string) => Buffer | null;
}): string {
  const kekKeyBytes = input.resolveKek(input.encrypted.kekId);
  if (!kekKeyBytes) {
    throw new Error("SECRETS_KEK_NOT_FOUND");
  }
  const dek = decryptAes256Gcm({
    key: kekKeyBytes,
    ciphertext: input.encrypted.dekCiphertext,
    iv: input.encrypted.dekIv,
    tag: input.encrypted.dekTag,
  });
  const plaintextBytes = decryptAes256Gcm({
    key: dek,
    ciphertext: input.encrypted.secretCiphertext,
    iv: input.encrypted.secretIv,
    tag: input.encrypted.secretTag,
  });
  return plaintextBytes.toString("utf8");
}

