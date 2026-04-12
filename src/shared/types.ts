import { z } from 'zod';

// ===== Auth =====
export const UserSchema = z.object({
  id: z.number(),
  username: z.string(),
  displayName: z.string(),
  role: z.enum(['admin', 'user']),
  createdAt: z.string(),
});
export type User = z.infer<typeof UserSchema>;

export interface AuthUser {
  id: number;
  username: string;
  displayName: string;
  role: 'admin' | 'user';
}

// ===== Accounts =====
export const AccountTypeSchema = z.enum(['current', 'savings', 'credit', 'loan', 'investment']);
export type AccountType = z.infer<typeof AccountTypeSchema>;

export const AccountOwnerSchema = z.enum(['user1', 'user2', 'joint']);
export type AccountOwner = z.infer<typeof AccountOwnerSchema>;

export const AccountSchema = z.object({
  id: z.number(),
  name: z.string(),
  type: AccountTypeSchema,
  ownerUserId: z.number().nullable(), // null = joint
  bank: z.string().nullable(),
  accountNumber: z.string().nullable(),
  sortCode: z.string().nullable(),
  openingBalance: z.number(), // pence
  currentBalance: z.number(), // pence, derived
  active: z.number(), // 0/1
  createdAt: z.string(),
});
export type Account = z.infer<typeof AccountSchema>;

// ===== Transactions =====
export const TransactionSchema = z.object({
  id: z.number(),
  accountId: z.number(),
  date: z.string(), // YYYY-MM-DD
  amount: z.number(), // pence, signed (negative = debit)
  description: z.string(),
  merchant: z.string().nullable(),
  categoryId: z.number().nullable(),
  notes: z.string().nullable(),
  isTransfer: z.number(), // 0/1
  transferPairId: z.number().nullable(),
  importBatchId: z.number().nullable(),
  dedupeHash: z.string(),
  balanceAfter: z.number().nullable(), // pence
  createdAt: z.string(),
});
export type Transaction = z.infer<typeof TransactionSchema>;

// ===== Categories =====
export const CategorySchema = z.object({
  id: z.number(),
  name: z.string(),
  parentId: z.number().nullable(),
  icon: z.string().nullable(),
  color: z.string().nullable(),
  kind: z.enum(['expense', 'income', 'transfer']),
  systemLocked: z.number(),
});
export type Category = z.infer<typeof CategorySchema>;

// ===== Rules =====
export const RuleSchema = z.object({
  id: z.number(),
  name: z.string(),
  matchField: z.enum(['description', 'merchant', 'amount']),
  matchType: z.enum(['contains', 'equals', 'regex', 'startsWith']),
  matchValue: z.string(),
  categoryId: z.number(),
  priority: z.number(),
  createdByUserId: z.number().nullable(),
  createdAt: z.string(),
});
export type Rule = z.infer<typeof RuleSchema>;

// ===== Budgets =====
export const BudgetSchema = z.object({
  id: z.number(),
  categoryId: z.number(),
  monthlyAmount: z.number(), // pence
  source: z.enum(['ai', 'manual']),
  startMonth: z.string(), // YYYY-MM
  active: z.number(),
});
export type Budget = z.infer<typeof BudgetSchema>;

// ===== Salary profile =====
export const SalaryProfileSchema = z.object({
  id: z.number(),
  userId: z.number(),
  baseSalaryMonthly: z.number(), // pence
  payDay: z.number(), // 1-31
  accountId: z.number().nullable(),
  effectiveFrom: z.string(),
});
export type SalaryProfile = z.infer<typeof SalaryProfileSchema>;

// ===== Import batches =====
export interface ImportBatch {
  id: number;
  accountId: number;
  filename: string;
  rowCount: number;
  importedCount: number;
  skippedCount: number;
  dateFrom: string | null;
  dateTo: string | null;
  createdByUserId: number;
  createdAt: string;
}

// ===== Receipts =====
export interface Receipt {
  id: number;
  transactionId: number | null;
  filepath: string;
  thumbnailPath: string | null;
  mimeType: string;
  sizeBytes: number;
  ocrMerchant: string | null;
  ocrTotal: number | null; // pence
  ocrDate: string | null;
  uploadedByUserId: number;
  createdAt: string;
}

// ===== API envelope =====
export type ApiOk<T> = { ok: true; data: T };
export type ApiErr = { ok: false; error: string };
export type ApiResponse<T> = ApiOk<T> | ApiErr;
