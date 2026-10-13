import { useLayoutEffect, useRef } from 'react';

/**
 * The tabs along the top. Arrow keys move between them, Home and End jump to
 * the ends, as tabs do everywhere else.
 *
 * It is drawn as a segmented control: one thumb behind the open tab, which
 * slides to the next one rather than jumping, so it is plain where you went.
 */
export default function TabBar({ tabs, active, onChange }) {
  const buttons = useRef([]);
  const bar = useRef(null);

  useLayoutEffect(() => {
    const nav = bar.current;
    const place = () => {
      const button = buttons.current[tabs.findIndex((tab) => tab.id === active)];
      if (!nav || !button) return;
      nav.style.setProperty('--thumb-left', `${button.offsetLeft}px`);
      nav.style.setProperty('--thumb-width', `${button.offsetWidth}px`);
      nav.dataset.measured = '';
    };
    place();
    // A late web font or a badge appearing changes how wide the tabs are.
    const watcher = new ResizeObserver(place);
    buttons.current.forEach((button) => button && watcher.observe(button));
    return () => watcher.disconnect();
  }, [tabs, active]);

  const onKeyDown = (event, position) => {
    const last = tabs.length - 1;
    const to = {
      ArrowRight: position === last ? 0 : position + 1,
      ArrowLeft: position === 0 ? last : position - 1,
      Home: 0,
      End: last,
    }[event.key];
    if (to === undefined) return;
    event.preventDefault();
    onChange(tabs[to].id);
    buttons.current[to]?.focus();
  };

  return (
    <nav ref={bar} className="tabs" role="tablist" aria-label="Invoice Hub">
      {tabs.map((tab, position) => (
        <button
          key={tab.id}
          ref={(node) => {
            buttons.current[position] = node;
          }}
          type="button"
          role="tab"
          id={`tab-${tab.id}`}
          aria-controls={`panel-${tab.id}`}
          aria-selected={active === tab.id}
          tabIndex={active === tab.id ? 0 : -1}
          className="tab"
          data-testid={`tab-${tab.id}`}
          onClick={() => onChange(tab.id)}
          onKeyDown={(event) => onKeyDown(event, position)}
        >
          {tab.label}
          {tab.badge ? <span className="tab-badge">{tab.badge}</span> : null}
        </button>
      ))}
    </nav>
  );
}
