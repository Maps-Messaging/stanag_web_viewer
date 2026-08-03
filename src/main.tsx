import React from 'react';
import ReactDOM from 'react-dom/client';
import 'maplibre-gl/dist/maplibre-gl.css';
import App from './App';
import './styles.css';
import './mapPopups.css';
import { installOperationalAreaSupport } from './services/operationalAreas';

installOperationalAreaSupport();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <App />,
);
