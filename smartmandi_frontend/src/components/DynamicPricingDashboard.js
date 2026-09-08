import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowRight, BadgeIndianRupee, Boxes, CircleSlash, Cpu, Gauge, Minus,
  PieChart, Sparkles, Tag, TrendingDown, TrendingUp
} from 'lucide-react';
import {
  Badge, Button, EmptyState, ErrorState, Field, GlassCard,
  NumberInput, SectionHeading, Select, Skeleton, StatTile
} from './ui/Primitives';
import { PriceCompareChart } from './charts/Charts';
import { toApiError, fmt, money, signed, toPercent } from '../lib/api';
import './DynamicPricingDashboard.css';

export default function DynamicPricingDashboard() {
  // -- reference data -------------------------------------------------------
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [analytics, setAnalytics] = useState([]);
  const [optimization, setOptimization] = useState(null);
  const [stats, setStats] = useState(null);

  const [bootError, setBootError] = useState(null);
  const [booting, setBooting] = useState(true);

  // -- form -----------------------------------------------------------------
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedProduct, setSelectedProduct] = useState('');
  const [currentPrice, setCurrentPrice] = useState('');
  const [currentStock, setCurrentStock] = useState('');
  const [daysLeft, setDaysLeft] = useState('7');
  const [demandScore, setDemandScore] = useState('');

  // -- results --------------------------------------------------------------
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const loadReferenceData = useCallback(async () => {
    setBooting(true);
    setBootError(null);
    try {
      const [overview, productList, categoryList, analyticsRes, summaryRes] = await Promise.all([
        axios.get('/api/dashboard/overview'),
        axios.get('/api/products?limit=200'),
        axios.get('/api/products/meta/categories'),
        axios.get('/api/pricing/analytics'),
        axios.get('/api/pricing/optimization-summary')
      ]);

      const pricing = overview.data?.data?.dynamic_pricing;
      setStats({
        totalRecommendations: pricing?.total_recommendations,
        avgPriceChange: pricing?.avg_price_change,
        // Preserved as null — the model emits no calibrated confidence.
        avgConfidence: toPercent(pricing?.avg_confidence),
        uniqueProducts: pricing?.unique_products
      });

      setProducts(productList.data?.data ?? []);
      setCategories(categoryList.data?.data ?? []);
      setAnalytics(
        Array.isArray(analyticsRes.data?.data)
          ? analyticsRes.data.data.map((d) => ({ ...d, category: d._id }))
          : []
      );
      setOptimization(summaryRes.data?.data ?? null);
    } catch (err) {
      setBootError(toApiError(err));
    } finally {
      setBooting(false);
    }
  }, []);

  useEffect(() => { loadReferenceData(); }, [loadReferenceData]);

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

  /* Selecting a product pre-fills the form from its catalogue record, so the
     model is scored against real stored values rather than empty defaults. */
  const handleProductChange = (productId) => {
    setSelectedProduct(productId);
    const product = products.find((p) => p.product_id === productId);
    if (!product) return;
    if (product.current_price != null) setCurrentPrice(String(product.current_price));
    if (product.stock_level != null) setCurrentStock(String(product.stock_level));
    if (product.days_left != null) setDaysLeft(String(product.days_left));
    if (product.demand_score != null) setDemandScore(String(product.demand_score));
  };

  const canSubmit = selectedProduct && currentPrice !== '' && currentStock !== '' &&
                    daysLeft !== '' && demandScore !== '' && !loading;

  const handleGenerate = async () => {
    if (!canSubmit) {
      setError({ status: 0, message: 'Pick a product and fill in price, stock, days left and demand score.' });
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const product = products.find((p) => p.product_id === selectedProduct);
      const res = await axios.post('/api/pricing/recommend', {
        products: [{
          product_id: product.product_id,
          product_name: product.product_name,
          category: product.category || 'Unknown',
          current_price: parseFloat(currentPrice),
          stock_level: parseInt(currentStock, 10),
          days_left: parseInt(daysLeft, 10),
          demand_score: parseFloat(demandScore)
        }]
      });
      setResults(res.data?.data ?? null);
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setLoading(false);
    }
  };

  const recommendations = results?.recommendations ?? [];
  const isFallback = recommendations.some((r) => r.model_version?.startsWith('fallback'));

  const mix = useMemo(() => {
    if (!optimization) return [];
    const total = optimization.total_products || 0;
    const pct = (n) => (total > 0 ? (n / total) * 100 : 0);
    return [
      { key: 'up',   label: 'Increase',  count: optimization.products_with_increase, pct: pct(optimization.products_with_increase), color: 'var(--series-3)' },
      { key: 'down', label: 'Decrease',  count: optimization.products_with_decrease, pct: pct(optimization.products_with_decrease), color: 'var(--series-2)' },
      { key: 'flat', label: 'No change', count: optimization.products_no_change,     pct: pct(optimization.products_no_change),     color: 'var(--series-other)' }
    ];
  }, [optimization]);

  return (
    <div className="page">
      <header className="page__head">
        <div>
          <span className="eyebrow">Module 02</span>
          <h1 className="page__title">Dynamic Pricing</h1>
          <p className="page__lede">
            A gradient-boosted model scores stock, shelf life and demand across 23 features to recommend a price — with its reasoning attached.
          </p>
        </div>
        <Badge tone="accent" icon={Cpu}>XGBoost</Badge>
      </header>

      {bootError && <ErrorState error={bootError} onRetry={loadReferenceData} />}

      <section className="page__stats" aria-label="Pricing summary">
        <StatTile icon={Tag}              accent={1} label="Recommendations" value={stats?.totalRecommendations} sublabel="Created in the last 7 days" />
        <StatTile icon={TrendingUp}       accent={3} label="Avg price change" value={stats?.avgPriceChange} decimals={2} suffix="%" sublabel="Mean over those recommendations" />
        <StatTile icon={Gauge}            accent={4} label="Avg confidence"  value={stats?.avgConfidence} suffix="%" sublabel="Model emits no interval" />
        <StatTile icon={Boxes}            accent={7} label="Products priced" value={stats?.uniqueProducts} sublabel="Distinct SKUs" />
      </section>

      <section className="page__split">
        <GlassCard className="panel">
          <SectionHeading
            icon={BadgeIndianRupee}
            title="Current vs recommended"
            subtitle="Average price per category, both on one rupee scale"
          />
          {booting ? (
            <div className="panel__skeleton"><Skeleton height={320} radius={12} /></div>
          ) : analytics.length ? (
            <PriceCompareChart data={analytics} />
          ) : (
            <EmptyState
              icon={BadgeIndianRupee}
              title="No pricing history yet"
              message="Generate a recommendation and this chart will fill in."
            />
          )}
        </GlassCard>

        <GlassCard className="panel panel--form" glow>
          <SectionHeading icon={Sparkles} title="Price a product" />

          <div className="form">
            <Field label="Category" hint="optional filter" htmlFor="dp-category">
              <Select id="dp-category" value={selectedCategory} onChange={(e) => handleCategoryChange(e.target.value)}>
                <option value="">All categories</option>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </Field>

            <Field label="Product" hint="fills the fields below" htmlFor="dp-product">
              <Select id="dp-product" value={selectedProduct} onChange={(e) => handleProductChange(e.target.value)}>
                <option value="">Choose a product…</option>
                {products.map((p) => (
                  <option key={p.product_id} value={p.product_id}>{p.product_name}</option>
                ))}
              </Select>
            </Field>

            <div className="form__row">
              <Field label="Current price" hint="₹" htmlFor="dp-price">
                <NumberInput id="dp-price" value={currentPrice} onChange={setCurrentPrice} placeholder="0.00" />
              </Field>
              <Field label="Stock level" hint="units" htmlFor="dp-stock">
                <NumberInput id="dp-stock" value={currentStock} onChange={setCurrentStock} placeholder="0" />
              </Field>
            </div>

            <div className="form__row">
              <Field label="Days left" hint="shelf life" htmlFor="dp-days">
                <NumberInput id="dp-days" value={daysLeft} onChange={setDaysLeft} placeholder="7" />
              </Field>
              <Field label="Demand score" hint="0–100" htmlFor="dp-demand">
                <NumberInput id="dp-demand" value={demandScore} onChange={setDemandScore} placeholder="50" />
              </Field>
            </div>

            <Button onClick={handleGenerate} disabled={!canSubmit} loading={loading} icon={Sparkles} className="btn--block">
              Recommend price
            </Button>

            {error && <ErrorState error={error} compact />}
          </div>
        </GlassCard>
      </section>

      {/* --------------------------------------------------- recommendations */}
      <AnimatePresence mode="wait">
        {recommendations.length > 0 && (
          <motion.section
            key="recs"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          >
            <GlassCard className="panel">
              <SectionHeading
                icon={Tag}
                title="Recommendation"
                subtitle={`${recommendations.length} priced ${recommendations.length === 1 ? 'product' : 'products'}`}
                aside={isFallback
                  ? <Badge tone="warning" icon={CircleSlash}>Rule-based fallback</Badge>
                  : <Badge tone="good" icon={Cpu}>Model output</Badge>}
              />

              <div className="rec-grid">
                {recommendations.map((r, i) => <PriceCard key={`${r.product_id}-${i}`} rec={r} index={i} />)}
              </div>
            </GlassCard>
          </motion.section>
        )}
      </AnimatePresence>

      {/* ---------------------------------------------------- optimization */}
      {optimization && (
        <GlassCard className="panel">
          <SectionHeading
            icon={PieChart}
            title="Optimisation summary"
            subtitle={`Recommendations from the last ${optimization.period_days ?? 7} days`}
          />

          <div className="mix">
            <div className="mix__bar" role="img" aria-label="Distribution of price movements">
              {mix.map((m) => m.pct > 0 && (
                <span key={m.key} className="mix__seg" style={{ width: `${m.pct}%`, background: m.color }} />
              ))}
            </div>

            <ul className="mix__legend">
              {mix.map((m) => (
                <li key={m.key}>
                  <span className="mix__swatch" style={{ background: m.color }} aria-hidden="true" />
                  <span className="mix__label">{m.label}</span>
                  <span className="mix__count tabular">{fmt(m.count)}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="result-summary">
            <SummaryStat label="Products" value={fmt(optimization.total_products)} />
            <SummaryStat label="Avg change" value={signed(optimization.avg_price_change, { decimals: 2 })} />
            <SummaryStat label="Max increase" value={signed(optimization.max_price_increase, { decimals: 1 })} tone="good" />
            <SummaryStat label="Max decrease" value={signed(optimization.max_price_decrease, { decimals: 1 })} tone="serious" />
          </div>
        </GlassCard>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------- */

function PriceCard({ rec, index }) {
  const change = rec.price_change_percentage;
  const direction = change > 0.5 ? 'up' : change < -0.5 ? 'down' : 'flat';
  const Icon = direction === 'up' ? TrendingUp : direction === 'down' ? TrendingDown : Minus;
  const confidence = toPercent(rec.confidence_score);

  return (
    <motion.div
      className="price-card"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.34, delay: Math.min(index * 0.05, 0.3) }}
    >
      <div className="price-card__head">
        <div>
          <div className="price-card__name">{rec.product_name}</div>
          <div className="price-card__meta">{rec.category} · {rec.product_id}</div>
        </div>
        <span className={`price-card__delta is-${direction}`}>
          <Icon size={13} strokeWidth={2.6} aria-hidden="true" />
          {signed(change, { decimals: 2 })}
        </span>
      </div>

      <div className="price-card__prices">
        <div className="price-card__from">
          <span className="price-card__plabel">Current</span>
          <span className="price-card__pvalue tabular">{money(rec.current_price)}</span>
        </div>

        <ArrowRight className="price-card__arrow" size={18} strokeWidth={2} aria-hidden="true" />

        <div className="price-card__to">
          <span className="price-card__plabel">Recommended</span>
          <span className={`price-card__pvalue price-card__pvalue--hero tabular is-${direction}`}>
            {money(rec.recommended_price)}
          </span>
        </div>
      </div>

      <p className="price-card__reason">{rec.recommendation_reason}</p>

      <div className="price-card__foot">
        <span>{confidence === null ? 'No confidence interval' : `${confidence}% confidence`}</span>
        <span className="price-card__version">{rec.model_version}</span>
      </div>
    </motion.div>
  );
}

function SummaryStat({ label, value, tone }) {
  return (
    <div className="summary-stat">
      <span className="summary-stat__label">{label}</span>
      <span className={`summary-stat__value tabular ${tone ? `is-${tone}` : ''}`}>{value}</span>
    </div>
  );
}
