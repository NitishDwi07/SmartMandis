import React, { useEffect, useRef, useState } from 'react';
import { animate, motion, useInView } from 'framer-motion';
import { AlertTriangle, DatabaseZap, Inbox } from 'lucide-react';
import './Primitives.css';

/* ---------------------------------------------------------------------------
 * GlassCard — the surface everything sits on.
 * ------------------------------------------------------------------------ */
export function GlassCard({ children, className = '', glow = false, as = 'div', ...rest }) {
  const Tag = motion[as] || motion.div;
  return (
    <Tag
      className={`glass ${glow ? 'glass--glow' : ''} ${className}`}
      // Animates on mount, not on scroll. A `whileInView` reveal depends on an
      // IntersectionObserver callback that may never fire (throttled frame loop,
      // headless render, observer unsupported) — and when it doesn't, the card
      // stays at opacity 0 with real data stranded inside it. Mount animation
      // always resolves.
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/* ---------------------------------------------------------------------------
 * AnimatedCounter — springs to its value once, on first view.
 *
 * `value` of null/undefined renders an em dash: several backend fields are
 * deliberately null ("not measured") and must never display as 0.
 * ------------------------------------------------------------------------ */
export function AnimatedCounter({ value, decimals = 0, prefix = '', suffix = '' }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: '-40px' });

  // `tween` holds the in-flight intermediate value; null means "not animating",
  // in which case the exact prop is rendered. The correct number is therefore
  // shown even if the animation never runs (reduced motion, no IntersectionObserver,
  // a headless renderer) — the animation may only ever be decorative.
  const [tween, setTween] = useState(null);

  const numeric = typeof value === 'number' && Number.isFinite(value);

  useEffect(() => {
    if (!inView || !numeric) return undefined;

    let settled = false;
    const settle = () => { settled = true; setTween(null); };

    const controls = animate(0, value, {
      duration: 0.9,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => { if (!settled) setTween(v); },
      onComplete: settle
    });

    // Safety net: if the frame loop stalls (backgrounded tab, throttled rAF,
    // a headless renderer), the count-up must not strand a stale intermediate
    // number on screen. After this deadline the exact value always wins.
    const guard = setTimeout(() => { controls.stop(); settle(); }, 1600);

    return () => {
      clearTimeout(guard);
      controls.stop();
      settle();
    };
  }, [inView, numeric, value]);

  if (!numeric) {
    return <span ref={ref} className="counter counter--empty" title="Not measured">—</span>;
  }

  const shown = tween === null ? value : tween;

  return (
    <span ref={ref} className="counter tabular">
      {prefix}
      {shown.toLocaleString('en-IN', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
      })}
      {suffix}
    </span>
  );
}

/* ---------------------------------------------------------------------------
 * StatTile — a hero number with an optional sparkline behind it.
 * ------------------------------------------------------------------------ */
export function StatTile({ icon: Icon, label, value, sublabel, decimals = 0, prefix, suffix, accent = 1, spark }) {
  return (
    <GlassCard className="stat-tile" whileHover={{ y: -3 }}>
      <div className="stat-tile__top">
        {Icon && (
          <span className="stat-tile__icon" data-accent={accent}>
            <Icon size={16} strokeWidth={2} aria-hidden="true" />
          </span>
        )}
        <span className="eyebrow">{label}</span>
      </div>

      <div className="stat-tile__value">
        <AnimatedCounter value={value} decimals={decimals} prefix={prefix} suffix={suffix} />
      </div>

      {sublabel && <div className="stat-tile__sub">{sublabel}</div>}
      {spark && <div className="stat-tile__spark">{spark}</div>}
    </GlassCard>
  );
}

/* ---------------------------------------------------------------------------
 * Field — label + control, used by both dashboards.
 * ------------------------------------------------------------------------ */
export function Field({ label, hint, children, htmlFor }) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={htmlFor}>
        {label}
        {hint && <span className="field__hint">{hint}</span>}
      </label>
      {children}
    </div>
  );
}

export function Select({ id, value, onChange, children, ...rest }) {
  return (
    <div className="control-wrap">
      <select id={id} className="control control--select" value={value} onChange={onChange} {...rest}>
        {children}
      </select>
      <svg className="control__chevron" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

export function NumberInput({ id, value, onChange, placeholder, suffix, ...rest }) {
  return (
    <div className="control-wrap">
      <input
        id={id}
        className="control"
        inputMode="numeric"
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          // Digits only, with an optional single decimal point.
          if (/^\d*\.?\d*$/.test(e.target.value)) onChange(e.target.value);
        }}
        {...rest}
      />
      {suffix && <span className="control__suffix">{suffix}</span>}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Button — magnetic press, shimmer on the primary variant.
 * ------------------------------------------------------------------------ */
export function Button({ children, variant = 'primary', loading = false, icon: Icon, className = '', ...rest }) {
  return (
    <motion.button
      className={`btn btn--${variant} ${className}`}
      whileHover={{ y: -1 }}
      whileTap={{ y: 0, scale: 0.985 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      {...rest}
    >
      <span className="btn__label">
        {loading
          ? <><Spinner /> Working…</>
          : <>{Icon && <Icon size={16} strokeWidth={2.2} aria-hidden="true" />}{children}</>}
      </span>
    </motion.button>
  );
}

export function Spinner() {
  return (
    <svg className="spinner" width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/* ---------------------------------------------------------------------------
 * Badge — small labelled pill. `tone` maps to the reserved status colours.
 * ------------------------------------------------------------------------ */
export function Badge({ children, tone = 'neutral', icon: Icon }) {
  return (
    <span className={`badge badge--${tone}`}>
      {Icon && <Icon size={12} strokeWidth={2.4} aria-hidden="true" />}
      {children}
    </span>
  );
}

/* ---------------------------------------------------------------------------
 * State panels.
 *
 * ErrorState distinguishes a 503 (database unreachable) from other failures,
 * because the API now reports that difference and the operator needs to see it
 * rather than a generic "something went wrong".
 * ------------------------------------------------------------------------ */
export function ErrorState({ error, onRetry, compact = false }) {
  const unavailable = error?.status === 503;
  const Icon = unavailable ? DatabaseZap : AlertTriangle;

  return (
    <div className={`state state--error ${compact ? 'state--compact' : ''}`} role="alert">
      <span className="state__icon" data-tone={unavailable ? 'warning' : 'critical'}>
        <Icon size={compact ? 15 : 20} strokeWidth={2} aria-hidden="true" />
      </span>
      <div className="state__body">
        <div className="state__title">
          {unavailable ? 'Database unavailable' : 'Request failed'}
        </div>
        <div className="state__msg">{error?.message || 'Unknown error.'}</div>
      </div>
      {onRetry && (
        <button className="state__retry" onClick={onRetry} type="button">Retry</button>
      )}
    </div>
  );
}

export function EmptyState({ title, message, icon: Icon = Inbox }) {
  return (
    <div className="state state--empty">
      <span className="state__icon" data-tone="muted">
        <Icon size={20} strokeWidth={1.8} aria-hidden="true" />
      </span>
      <div className="state__body">
        <div className="state__title">{title}</div>
        {message && <div className="state__msg">{message}</div>}
      </div>
    </div>
  );
}

export function Skeleton({ height = 16, width = '100%', radius = 6 }) {
  return <span className="skeleton" style={{ height, width, borderRadius: radius }} aria-hidden="true" />;
}

/* ---------------------------------------------------------------------------
 * SectionHeading
 * ------------------------------------------------------------------------ */
export function SectionHeading({ icon: Icon, title, subtitle, aside }) {
  return (
    <div className="section-heading">
      <div className="section-heading__main">
        {Icon && (
          <span className="section-heading__icon">
            <Icon size={16} strokeWidth={2} aria-hidden="true" />
          </span>
        )}
        <div>
          <h2>{title}</h2>
          {subtitle && <p className="section-heading__sub">{subtitle}</p>}
        </div>
      </div>
      {aside && <div className="section-heading__aside">{aside}</div>}
    </div>
  );
}
