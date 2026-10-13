import Icon from './Icon.jsx';

/** A calm placeholder for a space with nothing in it yet, saying what goes there. */
export default function EmptyState({ icon = 'upload', title, children, testId }) {
  return (
    <div className="empty-state" data-testid={testId}>
      <span className="empty-state-icon">
        <Icon name={icon} size={20} />
      </span>
      <h3>{title}</h3>
      {children}
    </div>
  );
}
