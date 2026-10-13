import EmptyState from '../common/EmptyState.jsx';

/** Checking a folder of invoice PDFs against a spreadsheet. Being built. */
export default function ReconcileTab() {
  return (
    <div className="reconcile-tab">
      <div className="page-head">
        <h2>Reconcile</h2>
        <p>Check a folder of invoice PDFs against a spreadsheet, both ways.</p>
      </div>
      <EmptyState icon="compare" title="Coming next" testId="reconcile-soon">
        <p>
          Drop invoice PDFs on one side and an Excel or CSV file on the other, and see which
          invoices are missing from each.
        </p>
      </EmptyState>
    </div>
  );
}
