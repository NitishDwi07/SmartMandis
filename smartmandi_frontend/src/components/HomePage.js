import React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowUpRight, Boxes, IndianRupee, Layers, LineChart, MapPin, Tag, Warehouse
} from 'lucide-react';
import { GlassCard, StatTile, ErrorState, Skeleton, Badge } from './ui/Primitives';
import { Sparkline } from './charts/Charts';
import { useApi, fmt } from '../lib/api';
import './HomePage.css';

const selectOverview = (payload) => payload.data;

const FEATURES = [
  {
    to: '/DemandForecast.html',
    icon: LineChart,
    accent: 1,
    kicker: 'Module 01',
    title: 'Demand Forecasting',
    body: 'Project unit demand per product, city and weekday, then compare it against stock on hand to see where you are short and where you are over.',
    points: ['7 cities', 'Day-of-week shape', 'Stock gap analysis']
  },
  {
    to: '/DynamicPricing.html',
    icon: Tag,
    accent: 2,
    kicker: 'Module 02',
    title: 'Dynamic Pricing',
    body: 'An XGBoost model scores stock level, days to expiry and demand to recommend a price, with the reasoning behind each move made explicit.',
    points: ['Gradient-boosted', '23 features', 'Reasoned output']
  }
];

/* Shape hints for the stat tiles — decorative only, never read as data. */
const SPARK = {
  products: [3, 5, 4, 7, 6, 9, 8, 11, 10, 13],
  stock: [8, 6, 9, 7, 11, 9, 13, 11, 14, 12],
  price: [4, 6, 5, 8, 7, 9, 8, 10, 12, 11],
  categories: [2, 4, 3, 5, 6, 5, 8, 7, 9, 10]
};

export default function HomePage() {
  const { data, error, loading, reload } = useApi('/api/dashboard/overview', { select: selectOverview });

  const inv = data?.inventory;
  const demand = data?.demand_forecasting;

  return (
    <div className="home">
      {/* ------------------------------------------------------------ hero */}
      <section className="hero">
        <motion.div
          className="hero__copy"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        >
          <Badge tone="accent">Retail intelligence platform</Badge>

          <h1 className="hero__title">
            Intelligence for<br />
            <span className="hero__title-grad">India&rsquo;s supply chain</span>
          </h1>

          <p className="hero__lede">
            SmartMandi turns 17,019 rows of historical sales across seven cities into
            demand projections and priced recommendations — so buyers stop guessing
            what to stock and what to charge.
          </p>

          <div className="hero__actions">
            <Link to="/DemandForecast.html" className="hero__cta">
              Open demand forecasting
              <ArrowUpRight size={16} strokeWidth={2.2} aria-hidden="true" />
            </Link>
            <Link to="/DynamicPricing.html" className="hero__cta hero__cta--ghost">
              Pricing engine
            </Link>
          </div>

          <ul className="hero__meta">
            <li><MapPin size={13} strokeWidth={2} aria-hidden="true" /> 7 cities</li>
            <li><Boxes size={13} strokeWidth={2} aria-hidden="true" /> {fmt(inv?.total_products)} products</li>
            <li><Layers size={13} strokeWidth={2} aria-hidden="true" /> {fmt(inv?.categories)} categories</li>
          </ul>
        </motion.div>

        {/* Console panel — the "live" face of the platform. */}
        <motion.div
          className="hero__panel"
          initial={{ opacity: 0, scale: 0.97, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
        >
          <GlassCard className="console" glow>
            <div className="console__bar">
              <span className="console__dots" aria-hidden="true">
                <i /><i /><i />
              </span>
              <span className="console__title">inventory · live</span>
            </div>

            {error && <div className="console__error"><ErrorState error={error} onRetry={reload} compact /></div>}

            {!error && (
              <div className="console__grid">
                <ConsoleCell label="Products"   value={fmt(inv?.total_products)} loading={loading} />
                <ConsoleCell label="Categories" value={fmt(inv?.categories)}     loading={loading} />
                <ConsoleCell label="Units in stock" value={fmt(inv?.total_stock)} loading={loading} />
                <ConsoleCell label="Avg price"  value={fmt(inv?.avg_price, { decimals: 2, prefix: '₹' })} loading={loading} />
              </div>
            )}

            <div className="console__spark">
              <Sparkline values={SPARK.stock} color="var(--accent-bright)" />
            </div>

            <div className="console__foot">
              <span className="console__pulse" aria-hidden="true" />
              {loading ? 'Syncing…' : `${fmt(demand?.total_forecasts)} forecasts on record`}
            </div>
          </GlassCard>
        </motion.div>
      </section>

      {/* ----------------------------------------------------------- stats */}
      <section className="home__stats" aria-label="Inventory summary">
        <StatTile
          icon={Boxes} accent={1} label="Products tracked"
          value={inv?.total_products} sublabel="Active in catalogue"
          spark={<Sparkline values={SPARK.products} color="var(--series-1)" />}
        />
        <StatTile
          icon={Warehouse} accent={3} label="Units in stock"
          value={inv?.total_stock} sublabel="Across all cities"
          spark={<Sparkline values={SPARK.stock} color="var(--series-3)" />}
        />
        <StatTile
          icon={IndianRupee} accent={4} label="Average price"
          value={inv?.avg_price} decimals={2} prefix="₹" sublabel="Catalogue mean"
          spark={<Sparkline values={SPARK.price} color="var(--series-4)" />}
        />
        <StatTile
          icon={Layers} accent={7} label="Categories"
          value={inv?.categories} sublabel="Distinct product lines"
          spark={<Sparkline values={SPARK.categories} color="var(--series-7)" />}
        />
      </section>

      {/* --------------------------------------------------------- modules */}
      <section className="home__modules" aria-label="Modules">
        {FEATURES.map((f, i) => (
          <GlassCard
            key={f.to}
            className="module"
            whileHover={{ y: -4 }}
            transition={{ type: 'spring', stiffness: 300, damping: 26 }}
          >
            <Link to={f.to} className="module__link">
              <div className="module__head">
                <span className="module__icon" data-accent={f.accent}>
                  <f.icon size={19} strokeWidth={1.9} aria-hidden="true" />
                </span>
                <span className="eyebrow">{f.kicker}</span>
                <ArrowUpRight className="module__arrow" size={17} strokeWidth={2} aria-hidden="true" />
              </div>

              <h3 className="module__title">{f.title}</h3>
              <p className="module__body">{f.body}</p>

              <ul className="module__points">
                {f.points.map((p) => <li key={p}>{p}</li>)}
              </ul>
            </Link>
            <span className="module__sheen" aria-hidden="true" style={{ animationDelay: `${i * 1.4}s` }} />
          </GlassCard>
        ))}
      </section>
    </div>
  );
}

function ConsoleCell({ label, value, loading }) {
  return (
    <div className="console__cell">
      <span className="console__cell-label">{label}</span>
      <span className="console__cell-value tabular">
        {loading ? <Skeleton height={22} width="70%" /> : value}
      </span>
    </div>
  );
}
