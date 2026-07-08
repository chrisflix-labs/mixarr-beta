import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decryptSecret, encryptSecret, maskSecret } from "./secretStorage";

describe("secret storage", () => {
  it("encrypts and decrypts secrets without returning plaintext ciphertext", () => {
    const previous = process.env.MIXARR_SECRET_KEY;
    process.env.MIXARR_SECRET_KEY = "test-secret-key-with-enough-entropy";

    try {
      const raw = "spotify-client-secret-1234";
      const encrypted = encryptSecret(raw);

      assert.notEqual(encrypted, raw);
      assert.equal(encrypted.includes(raw), false);
      assert.equal(decryptSecret(encrypted), raw);
    } finally {
      if (previous === undefined) delete process.env.MIXARR_SECRET_KEY;
      else process.env.MIXARR_SECRET_KEY = previous;
    }
  });

  it("masks saved credentials", () => {
    assert.equal(maskSecret("abcdef1234"), "••••••••••••1234");
    assert.equal(maskSecret("abc"), "Saved credential");
  });
});
