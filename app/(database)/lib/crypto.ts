import crypto from "crypto";

const KEY = Buffer.from(process.env.TOKEN_ENC_KEY_BASE64 ?? "", "base64");
if (KEY.length !== 32) throw new Error("TOKEN_ENC_KEY_BASE64 must be 32 bytes base64.");

export function encryptString(plain: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${ciphertext.toString("base64")}`;
}
