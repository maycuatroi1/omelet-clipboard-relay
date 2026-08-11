export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 6;
export const CODE_REGEX = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;
const MAX_GENERATE_RETRIES = 3;

function unbiasedIndex(alphabetLength: number): number {
  const limit = 256 - (256 % alphabetLength);
  const buf = new Uint8Array(1);
  while (true) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % alphabetLength;
  }
}

export function generateCode(): string {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CODE_ALPHABET[unbiasedIndex(CODE_ALPHABET.length)];
  }
  return out;
}

export function generateUniqueCode(isTaken: (code: string) => boolean): string {
  for (let i = 0; i < MAX_GENERATE_RETRIES; i++) {
    const code = generateCode();
    if (!isTaken(code)) return code;
  }
  throw new Error("code-collision-exhausted");
}
