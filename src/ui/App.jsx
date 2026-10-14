import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { applyTheme, loadTheme, watchSystemTheme } from '../lib/theme.js';
import { forgetEverything, loadPrefixes, loadTab, savePrefixes, saveTab } from '../lib/prefs.js';
import { DEFAULT_PREFIXES } from '../core/reconcile/normalize.js';
import { ToastProvider } from './common/Toasts.jsx';
import Header from './shell/Header.jsx';
import SplitTab from './split/SplitTab.jsx';
import ReconcileTab from './reconcile/ReconcileTab.jsx';
import SummaryTab from './summary/SummaryTab.jsx';
import SettingsTab from './settings/SettingsTab.jsx';
import { apiEnabled } from '../lib/apiConfig.js';

// Loaded only in builds with a server, so the others carry none of its code.
const ExtractTab = lazy(() => import('./extract/ExtractTab.jsx'));

const TABS = [
  { id: 'split', label: 'Split' },
  { id: 'reconcile', label: 'Reconcile' },
  { id: 'summary', label: 'Summary' },
  // Only in builds pointed at your own OCR server (VITE_INVOICE_API_URL).
  ...(apiEnabled ? [{ id: 'extract', label: 'Extract' }] : []),
  { id: 'settings', label: 'Settings' },
];

/** What the root element actually shows: always light or dark, never "system". */
const shownTheme = () => document.documentElement.dataset.theme ?? 'light';

/**
 * Invoice Hub: the bar along the top and the tabs under it.
 *
 * Every tab stays mounted while another is open, so a batch half way through
 * being fixed is still there after a look at Settings.
 */
export default function App() {
  const [tab, setTab] = useState(loadTab);
  const [theme, setTheme] = useState(loadTheme);
  const [shown, setShown] = useState(shownTheme);
  // The prefixes Reconcile takes off before comparing numbers.
  const [prefixes, setPrefixes] = useState(() => loadPrefixes() ?? DEFAULT_PREFIXES.join(', '));
  const changePrefixes = useCallback((written) => {
    setPrefixes(written);
    savePrefixes(written);
  }, []);
  // The PDFs and sheet rows loaded on Reconcile, which the Summary tab sums up.
  const [reconcileData, setReconcileData] = useState(null);
  // Where the Split tab draws its own settings, inside the Settings tab.
  const [splitSettings, setSplitSettings] = useState(null);

  useEffect(() => {
    saveTab(tab);
  }, [tab]);

  const themeRef = useRef(theme);
  themeRef.current = theme;
  useEffect(() => {
    applyTheme(theme);
    setShown(shownTheme());
    return watchSystemTheme(
      () => themeRef.current,
      () => setShown(shownTheme())
    );
  }, [theme]);

  const startAfresh = useCallback(() => {
    forgetEverything();
    window.location.reload();
  }, []);

  return (
    <ToastProvider>
      <div className="app-shell">
        <a className="skip-link" href="#main">
          Skip to the work
        </a>
        <Header tabs={TABS} tab={tab} onTab={setTab} shownTheme={shown} onTheme={setTheme} />
        <main id="main">
          <section
            className="tab-panel"
            role="tabpanel"
            id="panel-split"
            aria-labelledby="tab-split"
            hidden={tab !== 'split'}
          >
            <SplitTab
              active={tab === 'split'}
              settingsSlot={splitSettings}
              onOpenSettings={() => setTab('settings')}
            />
          </section>
          <section
            className="tab-panel"
            role="tabpanel"
            id="panel-reconcile"
            aria-labelledby="tab-reconcile"
            hidden={tab !== 'reconcile'}
          >
            <ReconcileTab prefixes={prefixes} onData={setReconcileData} />
          </section>
          <section
            className="tab-panel"
            role="tabpanel"
            id="panel-summary"
            aria-labelledby="tab-summary"
            hidden={tab !== 'summary'}
          >
            <SummaryTab data={reconcileData} prefixes={prefixes} />
          </section>
          {apiEnabled && (
            <section
              className="tab-panel"
              role="tabpanel"
              id="panel-extract"
              aria-labelledby="tab-extract"
              hidden={tab !== 'extract'}
            >
              <Suspense fallback={null}>
                <ExtractTab active={tab === 'extract'} />
              </Suspense>
            </section>
          )}
          <section
            className="tab-panel"
            role="tabpanel"
            id="panel-settings"
            aria-labelledby="tab-settings"
            hidden={tab !== 'settings'}
          >
            <SettingsTab
              theme={theme}
              onTheme={setTheme}
              prefixes={prefixes}
              onPrefixes={changePrefixes}
              splitSlotRef={setSplitSettings}
              onForgetEverything={startAfresh}
            />
          </section>
        </main>
      </div>
    </ToastProvider>
  );
}
