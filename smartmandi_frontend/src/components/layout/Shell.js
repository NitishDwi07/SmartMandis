import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Activity, LineChart, Tag } from 'lucide-react';
import './Shell.css';

const NAV = [
  { to: '/', label: 'Overview', icon: Activity, end: true },
  { to: '/DemandForecast.html', label: 'Demand', icon: LineChart },
  { to: '/DynamicPricing.html', label: 'Pricing', icon: Tag }
];

/*
 * Aurora backdrop. Three slow-drifting radial blooms on a fixed layer behind
 * everything, plus a faint grid. Pure CSS — no canvas, no per-frame JS.
 */
function Aurora() {
  return (
    <div className="aurora" aria-hidden="true">
      <span className="aurora__blob aurora__blob--1" />
      <span className="aurora__blob aurora__blob--2" />
      <span className="aurora__blob aurora__blob--3" />
      <span className="aurora__grid" />
      <span className="aurora__vignette" />
    </div>
  );
}

function Brand() {
  return (
    <NavLink to="/" className="brand" aria-label="SmartMandi home">
      <span className="brand__mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none">
          <path d="M12 2.5 21 7.5v9L12 21.5 3 16.5v-9z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M12 7.2v9.6M7.6 9.8v4.4M16.4 9.8v4.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </span>
      <span className="brand__text">
        Smart<span className="brand__text-accent">Mandi</span>
      </span>
    </NavLink>
  );
}

export default function Shell({ children }) {
  const location = useLocation();

  return (
    <>
      <Aurora />

      <header className="topbar">
        <div className="topbar__inner">
          <Brand />

          <nav className="nav" aria-label="Primary">
            {NAV.map(({ to, label, icon: Icon, end }) => (
              <NavLink key={to} to={to} end={end} className="nav__link">
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <motion.span
                        layoutId="nav-pill"
                        className="nav__pill"
                        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                      />
                    )}
                    <Icon size={15} strokeWidth={2} aria-hidden="true" />
                    <span>{label}</span>
                  </>
                )}
              </NavLink>
            ))}
          </nav>

          <span className="topbar__status">
            <span className="topbar__dot" aria-hidden="true" />
            Live
          </span>
        </div>
      </header>

      <motion.main
        key={location.pathname}
        className="shell-main"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      >
        {children}
      </motion.main>

      <footer className="footer">
        <span>SmartMandi · retail intelligence</span>
        <span className="footer__sep" aria-hidden="true" />
        <span>Forecasts and prices are model output — check the stated held-out accuracy before acting on them</span>
      </footer>
    </>
  );
}
