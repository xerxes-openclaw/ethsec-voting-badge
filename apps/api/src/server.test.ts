import { describe, it, expect } from "vitest";
import { buildServer } from "./server.js";

describe("buildServer", () => {
  it("fails closed when RPC_URL is missing and no ownership override is provided", async () => {
    const original = {
      BADGE_CONTRACT: process.env.BADGE_CONTRACT,
      CHAIN_ID: process.env.CHAIN_ID,
      RPC_URL: process.env.RPC_URL,
      ENCRYPTION_PUBLIC_KEY_HEX: process.env.ENCRYPTION_PUBLIC_KEY_HEX,
      DATABASE_URL: process.env.DATABASE_URL,
    };

    process.env.BADGE_CONTRACT = "0xf67c0ade41c607efebf198f9d6065ab1ec5ad4cd";
    process.env.CHAIN_ID = "1";
    delete process.env.RPC_URL;
    process.env.ENCRYPTION_PUBLIC_KEY_HEX = "0xdeadbeef";
    process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";

    try {
      await expect(buildServer()).rejects.toThrow(/RPC_URL is required/i);
    } finally {
      process.env.BADGE_CONTRACT = original.BADGE_CONTRACT;
      process.env.CHAIN_ID = original.CHAIN_ID;
      if (original.RPC_URL === undefined) {
        delete process.env.RPC_URL;
      } else {
        process.env.RPC_URL = original.RPC_URL;
      }
      process.env.ENCRYPTION_PUBLIC_KEY_HEX = original.ENCRYPTION_PUBLIC_KEY_HEX;
      process.env.DATABASE_URL = original.DATABASE_URL;
    }
  });
});
