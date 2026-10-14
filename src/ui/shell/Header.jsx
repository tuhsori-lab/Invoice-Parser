import Icon from '../common/Icon.jsx';
import TabBar from './TabBar.jsx';
import ThemeToggle from './ThemeToggle.jsx';
import { apiEnabled, apiHost } from '../../lib/apiConfig.js';

/** The bar along the top: the name, the tabs, and the light or dark switch. */
export default function Header({ tabs, tab, onTab, shownTheme, onTheme }) {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <h1 className="brand">
          <Icon name="logo" />
          Invoice Hub
        </h1>
        <TabBar tabs={tabs} active={tab} onChange={onTab} />
        <div className="topbar-end">
          {apiEnabled ? (
            <p
              className="privacy-note"
              title={`Files go to ${apiHost} only from the Extract tab, or when you ask for scanned pages to be read there.`}
            >
              <Icon name="lock" size={14} />
              Files go only to your own server
            </p>
          ) : (
            <p className="privacy-note" title="There is no server to send them to.">
              <Icon name="lock" size={14} />
              Your files never leave this browser
            </p>
          )}
          <ThemeToggle shown={shownTheme} onChange={onTheme} />
        </div>
      </div>
    </header>
  );
}
