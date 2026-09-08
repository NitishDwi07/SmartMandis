import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Activity, ArrowDownRight, ArrowUpRight, BarChart3, CalendarDays, Cpu, Gauge,
  Layers, LineChart as LineChartIcon, Package, Sparkles, TrendingDown, TrendingUp
} from 'lucide-react';
import {
  Badge, Button, EmptyState, ErrorState, Field, GlassCard,
  NumberInput, SectionHeading, Select, Skeleton, StatTile
} from './ui/Primitives';
import { DemandTrendChart } from './charts/Charts';
import { toApiError, fmt, toPercent } from '../lib/api';
import './DemandForecastingDashboard.css';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** Reshape /api/demand/analytics into one row per weekday, one key per category. */
function toWeekdayRows(analytics) {
  if (!Array.isArray(analytics)) return [];
  return DAYS.map((day) => {
    const row = { day };
    analytics.forEach((entry) => {
      row[entry._id] = entry.daily_predictions?.[day]?.predicted_units ?? 0;
    });
    return row;
  });
}

export default function DemandForecastingDashboard() {
  // -- reference data -------------------------------------------------------
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [cities, setCities] = useState([]);
  const [chartData, setChartData] = useState([]);
  const [stats, setStats] = useState(null);

  const [bootError, setBootError] = useState(null);
  const [booting, setBooting] = useState(true);

  // -- form -----------------------------------------------------------------
  const [selectedProduct, setSelectedProduct] = useState('');
  const [selectedCity, setSelectedCity] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [currentStock, setCurrentStock] = useState('');
  const [forecastDays, setForecastDays] = useState('7');

  // -- results --------------------------------------------------------------
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const loadReferenceData = useCallback(async () => {
    setBooting(true);
    setBootError(null);
    try {
      const [overview, productList, categoryList, cityList, analytics] = await Promise.all([
        axios.get('/api/dashboard/overview'),
        axios.get('/api/products?limit=200'),
        axios.get('/api/products/meta/categories'),
        axios.get('/api/products/meta/cities'),
        axios.get('/api/demand/analytics')
      ]);

      const overviewData = overview.data?.data;
      setStats({
        totalForecasts: overviewData?.demand_forecasting?.total_forecasts,
        predictedUnits: overviewData?.demand_forecasting?.total_predicted_units,
        // null means "not measured" — toPercent preserves that rather than 0.
        avgConfidence: toPercent(overviewData?.demand_forecasting?.avg_confidence),
        categories: overviewData?.inventory?.categories
      });

      setProducts(productList.data?.data ?? []);
      setCategories(categoryList.data?.data ?? []);
      setCities(cityList.data?.data ?? []);
      setChartData(toWeekdayRows(analytics.data?.data));
    } catch (err) {
      setBootError(toApiError(err));
    } finally {
      setBooting(false);
    }
  }, []);

  useEffect(() => { loadReferenceData(); }, [loadReferenceData]);

  // Reloading the product list when the category filter changes.
  const handleCategoryChange = async (category) => {
    setSelectedCategory(category);
    setSelectedProduct('');
    try {
      const url = category ? `/api/products/category/${encodeURIComponent(category)}` : '/api/products?limit=200';
      const res = await axios.get(url);
      setProducts(res.data?.data ?? []);
    } catch (err) {
      setError(toApiError(err));
    }
  };

  const stockNumber = Number(currentStock) || 0;
  const daysNumber = Number(forecastDays) || 0;
  const canSubmit = selectedProduct && selectedCity && daysNumber > 0 && !loading;

  const handleGenerate = async () => {
    if (!canSubmit) {
      setError({ status: 0, message: 'Choose a product and city, and set a forecast window.' });
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const product = products.find((p) => p.product_id === selectedProduct);
      const res = await axios.post('/api/demand/predict', {
        products: [{ product_name: product?.product_name || selectedProduct }],
        forecast_days: daysNumber,
        cities: [selectedCity]
      });
      setResults(res.data?.data ?? null);
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setLoading(false);
    }
  };

  // -- derived --------------------------------------------------------------
  const summary = useMemo(() => {
    const predictions = results?.predictions;
    if (!predictions?.length) return null;

    const total = predictions.reduce((sum, p) => sum + (p.predicted_units || 0), 0);
    const peak = predictions.reduce((a, b) => (b.predicted_units > a.predicted_units ? b : a));
    const trough = predictions.reduce((a, b) => (b.predicted_units < a.predicted_units ? b : a));
    const average = total / predictions.length;

    return {
      total,
      average,
      peak,
      trough,
      peakDelta: ((peak.predicted_units - average) / average) * 100,
      troughDelta: ((trough.predicted_units - average) / average) * 100,
      gap: stockNumber > 0 ? total - stockNumber : null,
      gapPct: stockNumber > 0 ? ((total - stockNumber) / stockNumber) * 100 : null
    };
  }, [results, stockNumber]);

  const isTrained = results?.is_trained_model === true;
  const performance = results?.model_performance;

  // Label the band by what it actually achieved on held-out data, not by the
  // quantiles it was asked for — those differ here (73% observed vs 80% nominal).
  const intervalLabel = performance?.interval_coverage_pct
    ? `${Math.round(performance.interval_coverage_pct)}%`
    : '';

  return (
    <div className="page">
      {/* ------------------------------------------------------------ head */}
      <header className="page__head">
        <div>
          <span className="eyebrow">Module 01</span>
          <h1 className="page__title">Demand Forecasting</h1>
          <p className="page__lede">
            Project unit demand by product, city and weekday, then measure it against the stock you hold.
          </p>
        </div>
        <Badge tone="accent" icon={Cpu}>XGBoost</Badge>
      </header>

      {bootError && <ErrorState error={bootError} onRetry={loadReferenceData} />}

      {/* ----------------------------------------------------------- stats */}
      <section className="page__stats" aria-label="Forecast summary">
        <StatTile icon={BarChart3} accent={1} label="Forecasts on record" value={stats?.totalForecasts} sublabel="Dated last 7 days or later" />
        <StatTile icon={Package}   accent={3} label="Predicted units"     value={stats?.predictedUnits} sublabel="Summed over those forecasts" />
        <StatTile icon={Gauge}     accent={4} label="Avg confidence"      value={stats?.avgConfidence} suffix="%" sublabel="Across recorded forecasts" />
        <StatTile icon={Layers}    accent={7} label="Categories"          value={stats?.categories} sublabel="In catalogue" />
      </section>

      {/* -------------------------------------------------- chart + control */}
      <section className="page__split">
        <GlassCard className="panel">
          <SectionHeading
            icon={LineChartIcon}
            title="Demand by category"
            subtitle="Recorded forecasts, distributed across the week"
          />
          {booting ? (
            <div className="panel__skeleton">
              <Skeleton height={320} radius={12} />
            </div>
          ) : chartData.length && chartData.some((r) => Object.keys(r).length > 1) ? (
            <DemandTrendChart data={chartData} />
          ) : (
            <EmptyState
              icon={LineChartIcon}
              title="No forecast history yet"
              message="Generate a forecast and this chart will fill in."
            />
          )}
        </GlassCard>

        <GlassCard className="panel panel--form" glow>
          <SectionHeading icon={Sparkles} title="New forecast" />

          <div className="form">
            <Field label="Category" hint="optional filter" htmlFor="df-category">
              <Select id="df-category" value={selectedCategory} onChange={(e) => handleCategoryChange(e.target.value)}>
                <option value="">All categories</option>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </Field>

            <Field label="Product" htmlFor="df-product">
              <Select id="df-product" value={selectedProduct} onChange={(e) => setSelectedProduct(e.target.value)}>
                <option value="">Choose a product…</option>
                {products.map((p) => (
                  <option key={p.product_id} value={p.product_id}>{p.product_name}</option>
                ))}
              </Select>
            </Field>

            <Field label="City" htmlFor="df-city">
              <Select id="df-city" value={selectedCity} onChange={(e) => setSelectedCity(e.target.value)}>
                <option value="">Choose a city…</option>
                {cities.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </Field>

            <div className="form__row">
              <Field label="Current stock" hint="units" htmlFor="df-stock">
                <NumberInput id="df-stock" value={currentStock} onChange={setCurrentStock} placeholder="0" />
              </Field>

              <Field label="Horizon" hint="days" htmlFor="df-days">
                <NumberInput id="df-days" value={forecastDays} onChange={setForecastDays} placeholder="7" />
              </Field>
            </div>

            <Button onClick={handleGenerate} disabled={!canSubmit} loading={loading} icon={Sparkles} className="btn--block">
              Generate forecast
            </Button>

            {error && <ErrorState error={error} compact />}
          </div>
        </GlassCard>
      </section>

      {/* --------------------------------------------------------- results */}
      <AnimatePresence mode="wait">
        {summary && (
          <motion.section
            key="results"
            className="page__results"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          >
            <GlassCard className="panel">
              <SectionHeading
                icon={CalendarDays}
                title="Forecast result"
                subtitle={`${results.total_predictions} day-level projections for ${selectedCity}`}
                aside={isTrained
                  ? <Badge tone="good" icon={Cpu}>Model output</Badge>
                  : <Badge tone="warning" icon={Activity}>Not a model</Badge>}
              />

              <div className="result-summary">
                <SummaryStat label={`Total units · ${daysNumber}d`} value={fmt(summary.total)} />
                <SummaryStat label="Daily average" value={fmt(summary.average, { decimals: 0 })} />
                <SummaryStat
                  label="Stock gap"
                  value={summary.gap === null ? '—' : `${summary.gap >= 0 ? '+' : ''}${fmt(summary.gap)}`}
                  hint={summary.gapPct === null ? 'Enter current stock' : `${summary.gapPct >= 0 ? '+' : ''}${summary.gapPct.toFixed(0)}% vs held`}
                  tone={summary.gap === null ? undefined : summary.gap > 0 ? 'critical' : 'good'}
                />
                <SummaryStat
                  label="Peak day"
                  value={summary.peak.day_of_week}
                  hint={`${summary.peakDelta >= 0 ? '+' : ''}${summary.peakDelta.toFixed(0)}% vs mean`}
                />
              </div>

              {/* Accuracy is a property of the model, not of each row, so it is
                  stated once here rather than faked as a per-day confidence. */}
              {performance && (
                <div className="result-note">
                  <strong>Held-out accuracy</strong>
                  <span className="result-note__metrics tabular">
                    MAE {performance.mae} units · RMSE {performance.rmse} · R² {performance.r2}
                    {performance.interval_coverage_pct != null &&
                      ` · interval covers ${performance.interval_coverage_pct}% of actuals`}
                  </span>
                  <span className="result-note__text">{performance.note}</span>
                </div>
              )}

              <div className="day-grid">
                {results.predictions.map((p, i) => {
                  const perDay = daysNumber > 0 ? stockNumber / daysNumber : 0;
                  const short = perDay > 0 && p.predicted_units > perDay;
                  const hasRange = p.lower_bound != null && p.upper_bound != null;

                  return (
                    <motion.div
                      key={`${p.forecast_date}-${i}`}
                      className="day-card"
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.32, delay: Math.min(i * 0.03, 0.4) }}
                    >
                      <div className="day-card__head">
                        <span className="day-card__dow">{p.day_of_week?.slice(0, 3)}</span>
                        <span className="day-card__date">
                          {new Date(p.forecast_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                        </span>
                      </div>

                      <div className="day-card__units tabular">{fmt(p.predicted_units)}</div>
                      <div className="day-card__unitlabel">
                        {hasRange
                          ? <span className="tabular">{p.lower_bound}–{p.upper_bound} likely</span>
                          : 'units'}
                      </div>

                      <div className="day-card__foot">
                        <span className="day-card__conf">
                          {hasRange ? `${intervalLabel} interval` : 'units'}
                        </span>
                        {perDay > 0 && (
                          <span className={`day-card__flag ${short ? 'is-short' : 'is-ok'}`}>
                            {short
                              ? <><ArrowUpRight size={11} strokeWidth={2.6} aria-hidden="true" />Short</>
                              : <><ArrowDownRight size={11} strokeWidth={2.6} aria-hidden="true" />Covered</>}
                          </span>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </GlassCard>

            <div className="analysis-pair">
              <AnalysisCard
                icon={TrendingUp}
                tone="good"
                title="Peak demand"
                value={summary.peak.day_of_week}
                delta={`${summary.peakDelta >= 0 ? '+' : ''}${summary.peakDelta.toFixed(0)}%`}
                detail={`${fmt(summary.peak.predicted_units)} units — the heaviest day in this window.`}
              />
              <AnalysisCard
                icon={TrendingDown}
                tone="serious"
                title="Lowest demand"
                value={summary.trough.day_of_week}
                delta={`${summary.troughDelta >= 0 ? '+' : ''}${summary.troughDelta.toFixed(0)}%`}
                detail={`${fmt(summary.trough.predicted_units)} units — the lightest day in this window.`}
              />
            </div>
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  );
}

function SummaryStat({ label, value, hint, tone }) {
  return (
    <div className="summary-stat">
      <span className="summary-stat__label">{label}</span>
      <span className={`summary-stat__value tabular ${tone ? `is-${tone}` : ''}`}>{value}</span>
      {hint && <span className="summary-stat__hint">{hint}</span>}
    </div>
  );
}

function AnalysisCard({ icon: Icon, tone, title, value, delta, detail }) {
  return (
    <GlassCard className="analysis" whileHover={{ y: -3 }}>
      <div className="analysis__head">
        <span className="analysis__icon" data-tone={tone}>
          <Icon size={16} strokeWidth={2} aria-hidden="true" />
        </span>
        <span className="eyebrow">{title}</span>
      </div>
      <div className="analysis__value">
        {value} <span className="analysis__delta tabular">{delta}</span>
      </div>
      <p className="analysis__detail">{detail}</p>
    </GlassCard>
  );
}
