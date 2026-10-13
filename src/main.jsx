import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './ui/App.jsx';
import ErrorBoundary from './ui/common/ErrorBoundary.jsx';
import '@fontsource-variable/inter';
import './ui/styles.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
