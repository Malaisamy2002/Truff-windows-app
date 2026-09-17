import { describe, expect, it } from "vitest";

import {
  decryptBackup,
  encryptBackup,
  isEncryptedBackup,
  WrongPassphraseError,
} from "./backup-crypto";

const bytesOf = (s: string) => new TextEncoder().encode(s);
const textOf = (b: Uint8Array) => new TextDecoder().decode(b);

describe("backup-crypto", () => {
  it("round-trips arbitrary bytes under the right passphrase", async () => {
    const plaintext = bytesOf(
      "every customer, bill, expense and receipt photo",
    );
    const container = await encryptBackup(
      plaintext,
      "correct horse battery staple",
    );
    const restored = await decryptBackup(
      container,
      "correct horse battery staple",
    );
    expect(textOf(restored)).toBe(textOf(plaintext));
  });

  it("round-trips empty and binary (non-UTF8) payloads", async () => {
    const empty = new Uint8Array(0);
    const emptyContainer = await encryptBackup(empty, "pw");
    expect(await decryptBackup(emptyContainer, "pw")).toEqual(empty);

    const binary = new Uint8Array([0, 255, 1, 254, 128, 10, 13]);
    const binaryContainer = await encryptBackup(binary, "pw");
    expect(await decryptBackup(binaryContainer, "pw")).toEqual(binary);
  });

  it("produces different ciphertext for the same plaintext on each call", async () => {
    const plaintext = bytesOf("same bytes every time");
    const a = await encryptBackup(plaintext, "pw");
    const b = await encryptBackup(plaintext, "pw");
    expect(a).not.toEqual(b); // fresh random salt+IV each call
    expect(textOf(await decryptBackup(a, "pw"))).toBe(textOf(plaintext));
    expect(textOf(await decryptBackup(b, "pw"))).toBe(textOf(plaintext));
  });

  it("rejects the wrong passphrase instead of returning garbage", async () => {
    const container = await encryptBackup(
      bytesOf("secret ledger data"),
      "right-pw",
    );
    await expect(decryptBackup(container, "wrong-pw")).rejects.toBeInstanceOf(
      WrongPassphraseError,
    );
  });

  it("rejects a tampered container (GCM auth check)", async () => {
    const container = await encryptBackup(bytesOf("secret ledger data"), "pw");
    const tampered = container.slice();
    const lastIndex = tampered.length - 1;
    tampered[lastIndex] = (tampered[lastIndex] ?? 0) ^ 0xff; // flip a bit in the ciphertext/tag
    await expect(decryptBackup(tampered, "pw")).rejects.toBeInstanceOf(
      WrongPassphraseError,
    );
  });

  it("refuses to encrypt with an empty passphrase", async () => {
    await expect(encryptBackup(bytesOf("data"), "")).rejects.toThrow();
  });

  it("refuses to decrypt with an empty passphrase", async () => {
    const container = await encryptBackup(bytesOf("data"), "pw");
    await expect(decryptBackup(container, "")).rejects.toThrow();
  });

  it("isEncryptedBackup identifies containers and rejects plain data", async () => {
    const container = await encryptBackup(bytesOf("data"), "pw");
    expect(isEncryptedBackup(container)).toBe(true);
    expect(isEncryptedBackup(bytesOf("PK\x03\x04 a plain zip file"))).toBe(
      false,
    );
    expect(isEncryptedBackup(new Uint8Array(0))).toBe(false);
  });

  it("rejects decrypting bytes that aren't a container at all", async () => {
    await expect(
      decryptBackup(bytesOf("not a container"), "pw"),
    ).rejects.toThrow(/isn't an encrypted backup/);
  });

  it("encrypts at or above OWASP's current PBKDF2-HMAC-SHA256 recommendation (600,000 iterations)", async () => {
    const container = await encryptBackup(bytesOf("data"), "pw");
    // Header layout (see backup-crypto.ts's doc comment): 4-byte magic +
    // 1-byte version + 4-byte big-endian iteration count. Read straight off
    // the produced bytes, the same way decryptBackup does, rather than
    // importing the private PBKDF2_ITERATIONS constant — this pins the
    // actual on-disk behavior, and fails loudly if a future edit lowers it
    // (OWASP's guidance has only ever moved up: 310k in 2021, 600k from
    // 2023 onward — see the Password Storage Cheat Sheet).
    const view = new DataView(
      container.buffer,
      container.byteOffset,
      container.byteLength,
    );
    const iterations = view.getUint32(5, false);
    expect(iterations).toBeGreaterThanOrEqual(600_000);
  });
});
