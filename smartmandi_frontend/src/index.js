import React from 'react';
import ReactDOM from 'react-dom/client';
import axios from 'axios';
import './styles/tokens.css';
import './index.css';
import App from './App';

// Components call relative paths ('/api/...'). In development the CRA `proxy`
// in package.json forwards those to the backend. For a deployment where the API
// lives on another origin, set REACT_APP_API_URL at build time.
axios.defaults.baseURL = process.env.REACT_APP_API_URL || '';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
