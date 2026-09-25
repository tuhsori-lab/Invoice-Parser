import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './ui/App.jsx';
import ErrorBoundary from './ui/components/ErrorBoundary.jsx';
import './ui/styles.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
