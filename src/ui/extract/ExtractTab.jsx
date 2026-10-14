import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  apiHost,
  forgetToken,
  listInvoices,
  loadToken,
  saveToken,
  uploadInvoice,
} from '../../lib/invoiceApi.js';
import DropArea from '../common/DropArea.jsx';
import EmptyState from '../common/EmptyState.jsx';
import ProgressBar from '../common/ProgressBar.jsx';
import { useToast } from '../common/Toasts.jsx';
import ResultSection from '../reconcile/ResultSection.jsx';
import InvoiceReview, { STATUS_LABELS } from './InvoiceReview.jsx';

const ACCEPTED = /\.(pdf|png|jpe?g)$/i;
const SHOW = ['all', 'needs_review', 'accepted', 'failed', 'working'];
const SHOW_LABELS = { all: 'All', working: 'In progress', ...STATUS_LABELS };
const working = (status) => status === 'queued' || status === 'processing';

/**
 * The Extract tab: invoices read by your own OCR server, with every field,
 * where it came from, and what did not check out. Only in builds made with
 * VITE_INVOICE_API_URL, and the only part of the app that uploads anything.
 */
export default function ExtractTab({ active }) {
  const toast = useToast();
  const [token, setToken] = useState(loadToken);
  const [docs, setDocs] = useState(null);
  const [problem, setProblem] = useState('');
  const [uploads, setUploads] = useState([]);
  const [selected, setSelected] = useState(null);
  const [show, setShow] = useState('all');

  const signOut = useCallback(() => {
    forgetToken();
    setToken('');
    setDocs(null);
    setSelected(null);
  }, []);

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      setDocs(await listInvoices(token));
      setProblem('');
    } catch (error) {
      if (error.status === 401) signOut();
      setProblem(error.message);
    }
  }, [token, signOut]);

  useEffect(() => {
    if (active) refresh();
  }, [active, refresh]);

  // While anything is being read, keep its status current.
  const busy = docs?.some((doc) => working(doc.status));
  useEffect(() => {
    if (!active || !busy) return undefined;
    const timer = setInterval(refresh, 2500);
    return () => clearInterval(timer);
  }, [active, busy, refresh]);

  const addFiles = async (found) => {
    const files = found.map(({ file }) => file).filter((file) => ACCEPTED.test(file.name));
    if (files.length < found.length) {
      toast('Only PDF, PNG and JPEG files can be read.', { kind: 'info' });
    }
    for (const file of files) {
      const key = `${file.name}-${file.size}-${Math.random()}`;
      setUploads((current) => [...current, { key, name: file.name, loaded: 0, total: file.size }]);
      try {
        await uploadInvoice(token, file, (loaded, total) =>
          setUploads((current) =>
            current.map((upload) => (upload.key === key ? { ...upload, loaded, total } : upload))
          )
        );
      } catch (error) {
        toast(`${file.name}: ${error.message}`, { kind: 'error' });
        if (error.status === 401) signOut();
      } finally {
        setUploads((current) => current.filter((upload) => upload.key !== key));
      }
    }
    refresh();
  };

  const table = useMemo(() => {
    const rows = (docs ?? []).map((doc) => ({
      id: doc.id,
      status: doc.status,
      file: doc,
      flagged: doc.status === 'needs_review' || doc.status === 'failed',
      cells: {
        status: STATUS_LABELS[doc.status],
        file: doc.filename,
        created: new Date(doc.created).toLocaleString(),
        reviewed: doc.reviewed_by ?? '',
      },
    }));
    return {
      rows,
      columns: [
        {
          key: 'status',
          label: 'Status',
          render: (row) => (
            <span className={`status status-${row.status}`}>{row.cells.status}</span>
          ),
        },
        { key: 'file', label: 'File' },
        { key: 'created', label: 'Uploaded', rank: (row) => Date.parse(row.file.created) },
        { key: 'reviewed', label: 'Approved by' },
      ],
    };
  }, [docs]);

  const shown = table.rows.filter((row) =>
    show === 'all' ? true : show === 'working' ? working(row.status) : row.status === show
  );

  return (
    <div className="extract-tab">
      <div className="page-head split-head">
        <div>
          <h2>Extract</h2>
          <p>
            Read invoices with your own OCR server: every field, where it came from, and what needs
            a person to check.
          </p>
        </div>
        {token && (
          <button type="button" className="button quiet" onClick={signOut} data-testid="sign-out">
            Sign out
          </button>
        )}
      </div>

      <p className="upload-notice" data-testid="upload-notice">
        Files added on this tab are uploaded to <strong>{apiHost}</strong> to be read. Signed in,
        Split also sends pictures of scanned pages there when you ask for them to be read. Reconcile
        never sends anything.
      </p>

      {!token ? (
        <ConnectForm
          onConnect={async (candidate, remember) => {
            try {
              await listInvoices(candidate);
              saveToken(candidate, remember);
              setToken(candidate);
              setProblem('');
            } catch (error) {
              setProblem(error.message);
            }
          }}
          problem={problem}
        />
      ) : (
        <>
          <section className="input-panel" aria-labelledby="extract-input-heading">
            <header className="input-panel-head">
              <h3 id="extract-input-heading">Invoices to read</h3>
            </header>
            <DropArea
              title="Drop invoice PDFs or images"
              note="PDF, PNG or JPEG. Each is read on your server and checked field by field."
              accept="application/pdf,.pdf,image/png,image/jpeg"
              onFiles={addFiles}
              inputLabel="Invoices to read"
              testId="extract-drop"
            />
            {uploads.map((upload) => (
              <ProgressBar
                key={upload.key}
                label={`Uploading ${upload.name}`}
                done={upload.loaded}
                total={upload.total}
                testId="upload-progress"
              />
            ))}
          </section>

          {problem && (
            <p className="problems" role="alert">
              {problem}
            </p>
          )}

          {selected && (
            <InvoiceReview
              token={token}
              id={selected}
              onClose={() => setSelected(null)}
              onChanged={refresh}
            />
          )}

          {docs && docs.length > 0 ? (
            <ResultSection
              id="extracted"
              title="Invoices"
              toolbar={
                <div className="segmented" role="group" aria-label="Show">
                  {SHOW.map((key) => (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={show === key}
                      onClick={() => setShow(key)}
                      data-testid={`extract-show-${key}`}
                    >
                      {key !== 'all' && key !== 'working' && (
                        <span className={`status-dot status-${key}`} />
                      )}
                      {SHOW_LABELS[key]}
                      <span className="segment-count">
                        {
                          table.rows.filter((row) =>
                            key === 'all'
                              ? true
                              : key === 'working'
                                ? working(row.status)
                                : row.status === key
                          ).length
                        }
                      </span>
                    </button>
                  ))}
                </div>
              }
              columns={table.columns}
              rows={shown}
              initialSort={{ key: 'created', down: true }}
              onOpen={(row) => setSelected(row.id)}
              emptyText="Nothing here."
            />
          ) : (
            docs && (
              <EmptyState title="Read invoices appear here" testId="extract-empty">
                <p>
                  Add invoices above. Each one is read, checked, and either accepted or sent to you
                  to review.
                </p>
              </EmptyState>
            )
          )}
        </>
      )}
    </div>
  );
}

function ConnectForm({ onConnect, problem }) {
  const [value, setValue] = useState('');
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="input-panel connect-form"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        await onConnect(value.trim(), remember);
        setBusy(false);
      }}
    >
      <header className="input-panel-head">
        <h3>Sign in to {apiHost}</h3>
      </header>
      <label htmlFor="api-token">Access token</label>
      <input
        id="api-token"
        type="password"
        autoComplete="current-password"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        data-testid="api-token"
        required
      />
      <label className="check">
        <input
          type="checkbox"
          checked={remember}
          onChange={(event) => setRemember(event.target.checked)}
        />
        Remember on this computer
      </label>
      {problem && (
        <p className="problem" role="alert">
          {problem}
        </p>
      )}
      <div>
        <button
          type="submit"
          className="button"
          disabled={busy || !value.trim()}
          data-testid="connect"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </div>
      <p className="input-summary-note">
        Ask whoever runs the server for a token (
        <code>python -m invoice_service.admin add-user</code>).
      </p>
    </form>
  );
}
