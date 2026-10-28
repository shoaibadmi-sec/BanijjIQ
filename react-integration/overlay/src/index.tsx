import './index.css';
import ReactDOM from 'react-dom/client';
import { ThemeProvider } from './contexts/ThemeContext';
import { App } from './App';
import { BackendGate } from './integration/BackendGate';

const rootEl = document.getElementById('root');
if (rootEl) {
  ReactDOM.createRoot(rootEl).render(
    <ThemeProvider><BackendGate><App /></BackendGate></ThemeProvider>
  );
}
