import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Shell from './components/layout/Shell';
import HomePage from './components/HomePage';
import DemandForecastingDashboard from './components/DemandForecastingDashboard';
import DynamicPricingDashboard from './components/DynamicPricingDashboard';
import './App.css';

function App() {
  return (
    <Router>
      <Shell>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/DemandForecast.html" element={<DemandForecastingDashboard />} />
          <Route path="/DynamicPricing.html" element={<DynamicPricingDashboard />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Shell>
    </Router>
  );
}

export default App;
