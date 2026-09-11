import { z } from "zod";
export const text = z.string().trim().min(1).max(500);
export const oid = z.string().regex(/^[0-9a-f]{24}$/);
export const email = z
  .email()
  .max(254)
  .transform((s) => s.toLowerCase());
export const money = z
  .union([z.number(), z.string()])
  .refine(
    (x) => /^\d{1,8}(\.\d{1,2})?$/.test(String(x)) && Number(x) > 0,
    "Positive rupee amount with at most two decimals required",
  );
export const plan = z.strictObject({
  name: text.max(100),
  amount: money,
  description: text.max(2000),
});
export const gift = z.strictObject({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_-]{3,40}$/),
  rewardAmount: money,
  maxUsers: z.number().int().min(1).max(10000000),
  expiryDate: z.iso.datetime(),
});
export const task = z.strictObject({
  title: text.max(200),
  description: text.max(3000),
  rewardAmount: money,
});
export const contact = z.strictObject({
  type: text.max(50),
  label: text.max(100),
  value: text,
});
export const bank = z.strictObject({
  accountHolderName: text.max(150),
  bankName: text.max(150),
  accountNumber: z.string().regex(/^\d{6,24}$/),
  ifscCode: z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/),
  upiId: z.string().max(150).optional(),
});
export const reason = z.strictObject({
  reason: text.max(1000).optional(),
  payoutRef: text.max(150).optional(),
});
export const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(100).optional(),
  status: z.enum(["pending", "approved", "rejected"]).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  userId: oid.optional(),
});
export { z };
