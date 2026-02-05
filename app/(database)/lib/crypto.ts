import crypto from "crypto";

const KEY = Buffer.from(process.env.TOKEN_ENC_KEY_BASE64 ?? "", "base64");
if (KEY.length !== 32)
  throw new Error("TOKEN_ENC_KEY_BASE64 must be 32 bytes base64.");

export function encryptString(plain: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plain, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${ciphertext.toString("base64")}`;
}

export function decryptString(encrypted: string): string {
  const [ivB64, tagB64, dataB64] = encrypted.split(".");

  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Invalid encrypted string format");
  }

  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(tagB64, "base64");
  const encryptedData = Buffer.from(dataB64, "base64");

  const decipher = crypto.createDecipheriv("aes-256-gcm", KEY, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(encryptedData),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}
