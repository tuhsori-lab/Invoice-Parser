import { useCallback, useEffect, useRef, useState } from 'react';
import { applyTheme, loadTheme, watchSystemTheme } from '../lib/theme.js';
import { forgetEverything, loadTab, saveTab } from '../lib/prefs.js';
import { ToastProvider } from './common/Toasts.jsx';
import Header from './shell/Header.jsx';
import SplitTab from './split/SplitTab.jsx';
import ReconcileTab from './reconcile/ReconcileTab.jsx';
import SettingsTab from './settings/SettingsTab.jsx';

const TABS = [
  { id: 'split', label: 'Split' },
  { id: 'reconcile', label: 'Reconcile' },
  { id: 'settings', label: 'Settings' },
];

/** What the root element actually shows: always light or dark, never "system". */
const shownTheme = () => document.documentElement.dataset.theme ?? 'light';

/**
 * Invoice Hub: the bar along the top and the three tabs under it.
 *
 * Every tab stays mounted while another is open, so a batch half way through
 * being fixed is still there after a look at Settings.
 */
export default function App() {
  const [tab, setTab] = useState(loadTab);
  const [theme, setTheme] = useState(loadTheme);
  const [shown, setShown] = useState(shownTheme);

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
            <SplitTab active={tab === 'split'} />
          </section>
          <section
            className="tab-panel"
            role="tabpanel"
            id="panel-reconcile"
            aria-labelledby="tab-reconcile"
            hidden={tab !== 'reconcile'}
          >
            <ReconcileTab />
          </section>
          <section
            className="tab-panel"
            role="tabpanel"
            id="panel-settings"
            aria-labelledby="tab-settings"
            hidden={tab !== 'settings'}
          >
            <SettingsTab theme={theme} onTheme={setTheme} onForgetEverything={startAfresh} />
          </section>
        </main>
      </div>
    </ToastProvider>
  );
}
