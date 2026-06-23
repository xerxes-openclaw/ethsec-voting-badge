import { z } from "zod";

export const AddressSchema = z.string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "not an EVM address")
  .transform((s) => s.toLowerCase() as `0x${string}`);

export const NonZeroAddressSchema = AddressSchema
  .refine((s) => s !== "0x" + "0".repeat(40), "zero address not allowed");

export const Hex32Schema = z.string().regex(/^0x[a-fA-F0-9]{64}$/, "not a 32-byte hex string");
// EOA wallets produce a 65-byte ECDSA signature (130 hex chars); smart-
// contract wallets (Safe and other ERC-1271 wallets) produce variable-
// length approval blobs that concatenate per-owner sigs and may include
// ERC-6492 wrappers. The shape check here only enforces well-formed hex;
// cryptographic validity is the API's `verifySignature` job, which
// handles both ECDSA and ERC-1271 via viem's `verifyTypedData`.
export const HexSigSchema = z
  .string()
  .regex(/^0x([a-fA-F0-9]{2})+$/, "signature must be 0x-prefixed even-length hex");

export const PlaintextPayloadSchema = z.object({
  votingAddress: NonZeroAddressSchema,
  tokenId: z.string().regex(/^\d+$/),
  holderWallet: AddressSchema,
  timestamp: z.string().datetime(),
});
export type PlaintextPayload = z.infer<typeof PlaintextPayloadSchema>;

export const SubmitRequestSchema = z.object({
  badgeContract: AddressSchema,
  tokenId: z.string().regex(/^\d+$/),
  holderWallet: AddressSchema,
  ciphertext: z.string().min(1),
  ciphertextHash: Hex32Schema,
  nonce: Hex32Schema,
  issuedAt: z.number().int().positive(),
  expiresAt: z.number().int().positive(),
  signature: HexSigSchema,
});
export type SubmitRequest = z.infer<typeof SubmitRequestSchema>;
