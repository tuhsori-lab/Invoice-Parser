import { useCallback, useEffect, useState } from 'react';
import { FIELD_NAMES, LINE_FIELDS } from '../../../packages/invoice-schema/index.ts';
import { getResult, retryInvoice, saveCorrections } from '../../lib/invoiceApi.js';
import { useToast } from '../common/Toasts.jsx';
import EvidenceViewer from './EvidenceViewer.jsx';

export const STATUS_LABELS = {
  queued: 'Waiting',
  processing: 'Reading',
  accepted: 'Accepted',
  needs_review: 'Needs review',
  failed: 'Failed',
};

const FIELD_LABELS = {
  vendor_name: 'Vendor',
  vendor_address: 'Vendor address',
  vendor_tax_id: 'Vendor tax ID',
  invoice_number: 'Invoice number',
  purchase_order: 'PO number',
  invoice_date: 'Invoice date',
  due_date: 'Due date',
  currency: 'Currency',
  subtotal: 'Subtotal',
  discount: 'Discount',
  shipping: 'Shipping',
  fees: 'Fees',
  tax_total: 'Tax',
  withholding: 'Withholding',
  total_due: 'Total due',
};
const LINE_LABELS = {
  description: 'Description',
  quantity: 'Qty',
  unit_price: 'Unit price',
  tax_rate: 'Tax %',
  line_total: 'Line total',
};
const FIELD_STATUS = {
  valid: 'Checked',
  unverified: 'Not checked',
  invalid: 'Problem',
  missing: 'Not found',
  corrected: 'Corrected',
};
const DATES = new Set(['invoice_date', 'due_date']);
const AMOUNTS = new Set([
  'subtotal',
  'discount',
  'shipping',
  'fees',
  'tax_total',
  'withholding',
  'total_due',
]);

/**
 * One document under review: what was read, where it was read from, what did
 * not check out, and a way to correct and approve it.
 */
export default function InvoiceReview({ token, id, onClose, onChanged }) {
  const toast = useToast();
  const [doc, setDoc] = useState(null);
  const [edits, setEdits] = useState({});
  const [focus, setFocus] = useState(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState('');

  const load = useCallback(async () => {
    try {
      setDoc(await getResult(token, id));
      setProblem('');
    } catch (error) {
      setProblem(error.message);
    }
  }, [token, id]);

  useEffect(() => {
    setDoc(null);
    setEdits({});
    setFocus(null);
    load();
  }, [load]);

  const waiting = doc && (doc.status === 'queued' || doc.status === 'processing');
  useEffect(() => {
    if (!waiting) return undefined;
    const timer = setInterval(load, 2500);
    return () => clearInterval(timer);
  }, [waiting, load]);

  const save = async (approve) => {
    setSaving(true);
    try {
      setDoc(await saveCorrections(token, id, edits, approve));
      setEdits({});
      toast(approve ? 'Approved.' : 'Corrections saved. The invoice was checked again.', {
        kind: 'success',
      });
      onChanged?.();
    } catch (error) {
      toast(error.message, { kind: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const retry = async () => {
    try {
      await retryInvoice(token, id);
      toast('Queued to be read again.');
      await load();
      onChanged?.();
    } catch (error) {
      toast(error.message, { kind: 'error' });
    }
  };

  const invoice = doc?.result?.invoice;
  const issues = doc?.result?.issues ?? [];
  const errors = issues.filter((issue) => issue.severity === 'error');
  const issuesFor = (path) => issues.filter((issue) => issue.field === path);
  const edited = Object.keys(edits).length > 0;
  const valueOf = (path, field) => (path in edits ? (edits[path] ?? '') : (field?.value ?? ''));
  const edit = (path, value) => setEdits((current) => ({ ...current, [path]: value }));
  const lines = invoice?.line_items ?? [];
  const lineCount = Math.max(
    lines.length,
    ...Object.keys(edits)
      .map((path) => /^line_items\.(\d+)\./.exec(path))
      .filter(Boolean)
      .map((match) => Number(match[1]) + 1)
  );

  return (
    <section
      className="result-section extract-review"
      aria-labelledby="review-heading"
      data-testid="review"
    >
      <header className="result-head">
        <div className="result-title">
          <h3 id="review-heading">{doc?.filename ?? 'Invoice'}</h3>
          {doc && (
            <span className={`status status-${doc.status}`} data-testid="review-status">
              {STATUS_LABELS[doc.status]}
            </span>
          )}
        </div>
        <div className="result-tools">
          {doc?.status === 'failed' && (
            <button type="button" className="button" onClick={retry} data-testid="retry">
              Try again
            </button>
          )}
          {invoice && (
            <>
              <button
                type="button"
                className="button quiet"
                disabled={!edited || saving}
                onClick={() => save(false)}
                data-testid="save-corrections"
              >
                Save corrections
              </button>
              <button
                type="button"
                className="button"
                disabled={saving || (doc.status === 'accepted' && !edited)}
                onClick={() => save(true)}
                data-testid="approve"
              >
                {edited ? 'Save and approve' : 'Approve'}
              </button>
            </>
          )}
          <button type="button" className="button quiet" onClick={onClose}>
            Close
          </button>
        </div>
      </header>

      <div className="result-body">
        {problem && <p className="result-empty">{problem}</p>}
        {waiting && (
          <p className="result-hint" role="status">
            {doc.status === 'queued'
              ? 'Waiting for the reader…'
              : 'Reading — scanned pages take about ten seconds each.'}
          </p>
        )}
        {doc?.status === 'failed' && (
          <p className="result-hint problem" role="alert">
            {doc.error ?? errors[0]?.message ?? 'This file could not be read.'}
          </p>
        )}
        {doc?.reviewed_by && (
          <p className="result-hint">
            Approved by {doc.reviewed_by} on {new Date(doc.reviewed_at).toLocaleString()}.
          </p>
        )}

        {issues.length > 0 && invoice && (
          <ul className="review-issues" data-testid="issues">
            {issues.map((issue, at) => (
              <li key={`${issue.code}-${at}`} className={`issue issue-${issue.severity}`}>
                <button
                  type="button"
                  className="link-button"
                  disabled={!issue.field || !invoice[issue.field]?.evidence}
                  onClick={() => setFocus(invoice[issue.field]?.evidence ?? null)}
                >
                  {issue.field ? `${FIELD_LABELS[issue.field] ?? issue.field}: ` : ''}
                </button>
                {issue.message}
              </li>
            ))}
          </ul>
        )}

        {invoice && (
          <div className="review-grid">
            <EvidenceViewer token={token} id={id} pages={doc.result.pages} focus={focus} />
            <div className="review-fields">
              <table className="field-table">
                <caption className="visually-hidden">The fields read from this invoice</caption>
                <thead>
                  <tr>
                    <th scope="col">Field</th>
                    <th scope="col">Value</th>
                    <th scope="col">Check</th>
                  </tr>
                </thead>
                <tbody>
                  {FIELD_NAMES.map((name) => {
                    const field = invoice[name];
                    const fieldIssues = issuesFor(name);
                    return (
                      <tr key={name} className={fieldIssues.length ? 'has-issue' : undefined}>
                        <th scope="row">
                          <label htmlFor={`field-${name}`}>{FIELD_LABELS[name]}</label>
                        </th>
                        <td>
                          <input
                            id={`field-${name}`}
                            type={DATES.has(name) ? 'date' : 'text'}
                            inputMode={AMOUNTS.has(name) ? 'decimal' : undefined}
                            value={valueOf(name, field)}
                            onChange={(event) => edit(name, event.target.value || null)}
                            onFocus={() => setFocus(field.evidence)}
                            aria-describedby={fieldIssues.length ? `issues-${name}` : undefined}
                            data-testid={`field-${name}`}
                          />
                          {fieldIssues.length > 0 && (
                            <span id={`issues-${name}`} className="field-issue">
                              {fieldIssues.map((issue) => issue.message).join(' ')}
                            </span>
                          )}
                        </td>
                        <td>
                          <span
                            className={`field-status field-${name in edits ? 'corrected' : field.status}`}
                          >
                            {FIELD_STATUS[name in edits ? 'corrected' : field.status]}
                          </span>
                          {field.confidence !== null && (
                            <span className="field-confidence" title="OCR confidence">
                              {Math.round(field.confidence * 100)}%
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <h4 className="review-subhead">Line items</h4>
              <div className="data-scroll">
                <table className="field-table line-table" data-testid="line-items">
                  <thead>
                    <tr>
                      {LINE_FIELDS.map((name) => (
                        <th key={name} scope="col">
                          {LINE_LABELS[name]}
                        </th>
                      ))}
                      <th scope="col">
                        <span className="visually-hidden">Remove</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: lineCount }, (_, row) => {
                      if (edits[`line_items.${row}`] === null) return null;
                      const item = lines[row];
                      return (
                        <tr
                          key={row}
                          className={
                            issuesFor(`line_items.${row}.line_total`).length
                              ? 'has-issue'
                              : undefined
                          }
                        >
                          {LINE_FIELDS.map((name) => {
                            const path = `line_items.${row}.${name}`;
                            return (
                              <td key={name}>
                                <input
                                  aria-label={`Line ${row + 1} ${LINE_LABELS[name]}`}
                                  inputMode={name === 'description' ? undefined : 'decimal'}
                                  value={valueOf(path, item?.[name])}
                                  onChange={(event) => edit(path, event.target.value || null)}
                                  onFocus={() => setFocus(item?.[name]?.evidence ?? null)}
                                />
                              </td>
                            );
                          })}
                          <td>
                            <button
                              type="button"
                              className="link-button"
                              onClick={() => edit(`line_items.${row}`, null)}
                              aria-label={`Remove line ${row + 1}`}
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <button
                type="button"
                className="link-button add-line"
                onClick={() => edit(`line_items.${lineCount}.description`, '')}
              >
                Add a line
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
