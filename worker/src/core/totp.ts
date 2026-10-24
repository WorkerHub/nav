// TOTP (RFC 6238) primitives — eNotify/Zeta scheme: SHA-1, 6 digits, 30s period.
// Implemented on WebCrypto (the runtime-native primitive); the TOTP math is
// standard-library-free everywhere in the Worker ecosystem.

const BASE32_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(data: Uint8Array): string {
  let result = "";
  let bits = 0;
  let value = 0;

  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += BASE32_CHARS[(value >>> bits) & 0x1f];
    }
  }

  if (bits > 0) {
    result += BASE32_CHARS[(value << (5 - bits)) & 0x1f];
  }

  return result;
}

function base32Decode(encoded: string): Uint8Array {
  const cleaned = encoded.replace(/[=\s]/g, "").toUpperCase();
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;

  for (const char of cleaned) {
    const idx = BASE32_CHARS.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >>> bits) & 0xff);
    }
  }

  return new Uint8Array(bytes);
}

export function generateTOTPSecret(): { secret: string; uri: string } {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  const secret = base32Encode(bytes);
  const issuer = "nav";
  const uri = `otpauth://totp/${issuer}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
  return { secret, uri };
}

export async function generateTOTPCode(
  secret: string,
  counter: number,
): Promise<string> {
  const key = base32Decode(secret);
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setBigUint64(0, BigInt(counter));

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign("HMAC", cryptoKey, buffer);
  const hash = new Uint8Array(signature);

  const offset = hash[hash.length - 1] & 0x0f;
  const binary =
    ((hash[offset] & 0x7f) << 24) |
    ((hash[offset + 1] & 0xff) << 16) |
    ((hash[offset + 2] & 0xff) << 8) |
    (hash[offset + 3] & 0xff);

  return (binary % 1000000).toString().padStart(6, "0");
}

/** Verify a TOTP code with ±1 step drift (same as eNotify). */
export async function verifyTOTP(
  secret: string,
  code: string,
): Promise<boolean> {
  const time = Math.floor(Date.now() / 1000 / 30);
  for (let i = -1; i <= 1; i++) {
    const expected = await generateTOTPCode(secret, time + i);
    if (expected === code) return true;
  }
  return false;
}
