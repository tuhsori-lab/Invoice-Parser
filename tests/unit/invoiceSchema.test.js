import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CorrectionRequest, DocumentResult } from '../../packages/invoice-schema/index.ts';

// Written by the backend's own tests from a real API response
// (services/tests/test_schema_contract.py), so the two schemas cannot drift apart.
const sample = JSON.parse(
  readFileSync(
    new URL('../../packages/invoice-schema/fixtures/sample-result.json', import.meta.url)
  )
);

describe('the shared invoice schema', () => {
  it('accepts what the backend actually sends', () => {
    const parsed = DocumentResult.parse(sample);
    expect(parsed.result.invoice.purchase_order.status).toBe('corrected');
    expect(parsed.result.invoice.line_items.length).toBeGreaterThan(0);
  });

  it('keeps amounts as exact decimal strings', () => {
    const total = DocumentResult.parse(sample).result.invoice.total_due.value;
    expect(typeof total).toBe('string');
    expect(total).toMatch(/^-?\d+(\.\d+)?$/);
  });

  it('rejects a response of the wrong shape', () => {
    const broken = structuredClone(sample);
    broken.result.invoice.total_due.value = 12.5;
    expect(DocumentResult.safeParse(broken).success).toBe(false);
  });

  it('only lets known fields be corrected', () => {
    expect(CorrectionRequest.safeParse({ corrections: { total_due: '10.00' } }).success).toBe(true);
    expect(
      CorrectionRequest.safeParse({ corrections: { 'line_items.3.quantity': '2' } }).success
    ).toBe(true);
    expect(CorrectionRequest.safeParse({ corrections: { __proto__x: '1' } }).success).toBe(false);
    expect(CorrectionRequest.safeParse({ corrections: { password: 'x' } }).success).toBe(false);
  });
});
