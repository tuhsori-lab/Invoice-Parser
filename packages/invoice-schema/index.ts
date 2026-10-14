/**
 * The shape of a processed invoice, as the API sends it.
 *
 * Mirrors services/invoice_service/schema.py. The two are held together by a
 * contract test: the Python tests write fixtures/sample-result.json from a real
 * pipeline run, and tests/unit/invoiceSchema.test.js parses it with this file.
 *
 * Amounts are decimal strings and dates ISO strings, never numbers, so nothing
 * is rounded on the way.
 */
import { z } from 'zod';

export const FieldStatus = z.enum(['valid', 'unverified', 'invalid', 'missing', 'corrected']);
export const DocStatus = z.enum(['accepted', 'needs_review', 'failed']);
export const JobStatus = z.enum(['queued', 'processing', 'accepted', 'needs_review', 'failed']);

export const Evidence = z.object({
  page: z.number().int().positive(),
  /** PDF points from the page's top-left corner: x0, y0, x1, y1. */
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  source: z.enum(['pdf_text', 'ocr']),
  text: z.string(),
});

export const Field = z.object({
  value: z.string().nullable(),
  raw: z.string().nullable(),
  evidence: Evidence.nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  status: FieldStatus,
  note: z.string().nullable(),
});

export const TaxLine = z.object({ label: z.string().nullable(), rate: Field, amount: Field });

export const LineItem = z.object({
  description: Field,
  quantity: Field,
  unit_price: Field,
  tax_rate: Field,
  line_total: Field,
});

export const FIELD_NAMES = [
  'vendor_name',
  'vendor_address',
  'vendor_tax_id',
  'invoice_number',
  'purchase_order',
  'invoice_date',
  'due_date',
  'currency',
  'subtotal',
  'discount',
  'shipping',
  'fees',
  'tax_total',
  'withholding',
  'total_due',
] as const;
export const LINE_FIELDS = [
  'description',
  'quantity',
  'unit_price',
  'tax_rate',
  'line_total',
] as const;

export const Invoice = z.object({
  ...(Object.fromEntries(FIELD_NAMES.map((name) => [name, Field])) as Record<
    (typeof FIELD_NAMES)[number],
    typeof Field
  >),
  taxes: z.array(TaxLine),
  line_items: z.array(LineItem),
});

export const Issue = z.object({
  code: z.string(),
  severity: z.enum(['error', 'warning']),
  message: z.string(),
  field: z.string().nullable(),
});

export const PageInfo = z.object({
  number: z.number().int().positive(),
  width: z.number(),
  height: z.number(),
  source: z.enum(['pdf_text', 'ocr']),
  dpi: z.number().int().nullable(),
  rotation: z.number().int(),
  mean_confidence: z.number().nullable(),
  text_check: z.string().nullable(),
});

export const Retry = z.object({
  kind: z.string(),
  target: z.string(),
  reason: z.string(),
  helped: z.boolean(),
});

export const Result = z.object({
  schema_version: z.literal(1),
  status: DocStatus,
  invoice: Invoice.nullable(),
  issues: z.array(Issue),
  pages: z.array(PageInfo),
  retries: z.array(Retry),
  engine: z.record(z.string(), z.string()),
  seconds: z.number().nullable(),
});

export const DocumentSummary = z.object({
  id: z.string().uuid(),
  filename: z.string(),
  status: JobStatus,
  attempts: z.number().int(),
  error: z.string().nullable(),
  created: z.string(),
  updated: z.string(),
  reviewed_by: z.string().nullable(),
  reviewed_at: z.string().nullable(),
});

export const DocumentList = z.object({ invoices: z.array(DocumentSummary) });

export const DocumentResult = DocumentSummary.extend({
  result: Result.nullable(),
  corrections: z.record(z.string(), z.string().nullable()),
});

/** What a reviewer may send: field paths such as "total_due" or "line_items.2.quantity". */
const correctionPath = z
  .string()
  .regex(
    new RegExp(`^(${FIELD_NAMES.join('|')}|line_items\\.\\d{1,3}(\\.(${LINE_FIELDS.join('|')}))?)$`)
  );

export const CorrectionRequest = z.object({
  corrections: z.record(correctionPath, z.string().max(500).nullable()),
  approve: z.boolean().default(false),
});

export type Field = z.infer<typeof Field>;
export type Invoice = z.infer<typeof Invoice>;
export type Result = z.infer<typeof Result>;
export type DocumentSummary = z.infer<typeof DocumentSummary>;
export type DocumentResult = z.infer<typeof DocumentResult>;
export type CorrectionRequest = z.infer<typeof CorrectionRequest>;
