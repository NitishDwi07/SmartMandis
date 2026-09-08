/**
 * Seed products and cities from the CSV datasets.
 *
 *   npm run seed            (from smartmandi_backend/)
 *
 * Idempotent: every write is an upsert keyed on product_id / city name, so
 * re-running refreshes existing rows instead of duplicating them.
 *
 * Why this exists: the previous root-level seed.js loaded only product_id,
 * product_name and category, leaving current_price, stock_level, days_left and
 * demand_score at 0 for every product. That made the inventory dashboard read
 * "total_stock: 0, avg_price: 0" and gave the pricing model all-zero inputs.
 *
 * Sources:
 *   dynamic_pricing_data.csv  - per-product pricing/stock attributes
 *   demand_forecasting_data.csv - historical sales, used for the city list and
 *                                 for which cities actually stock each product
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const mongoose = require('mongoose');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { Product, City } = require('../models');

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const PRICING_CSV = path.join(PROJECT_ROOT, 'Dataset_CSV_Files', 'dynamic_pricing_data.csv');
const DEMAND_CSV = path.join(PROJECT_ROOT, 'Dataset_CSV_Files', 'demand_forecasting_data.csv');

/**
 * Minimal CSV reader. These files are plain comma-separated with no quoted
 * fields or embedded commas, so a full parser would be overkill.
 */
async function readCsv(filePath, onRow) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Dataset not found: ${filePath}`);
  }

  const stream = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity
  });

  let headers = null;
  let count = 0;

  for await (const line of stream) {
    if (!line.trim()) continue;
    const cells = line.split(',');

    if (!headers) {
      headers = cells.map(h => h.trim());
      continue;
    }

    const row = {};
    headers.forEach((h, i) => { row[h] = (cells[i] || '').trim(); });
    onRow(row);
    count += 1;
  }

  return count;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function seed() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is not set. Copy .env.example to .env first.');
  }

  // ---- Read pricing attributes -------------------------------------------
  // Each product appears 21-48 times, one row per weekday/season/stock
  // scenario. Those are training samples, not inventory snapshots, so the
  // median is used as a representative current state rather than the last row
  // read (which would depend on file order).
  const pricingRows = new Map();
  const pricingCount = await readCsv(PRICING_CSV, (row) => {
    const id = row.product_id;
    if (!id) return;
    if (!pricingRows.has(id)) pricingRows.set(id, []);
    pricingRows.get(id).push(row);
  });
  console.log(`Read ${pricingCount} pricing rows for ${pricingRows.size} products`);

  // ---- Read cities and per-product city coverage --------------------------
  const cityNames = new Set();
  const productCities = new Map();
  const demandCount = await readCsv(DEMAND_CSV, (row) => {
    const { product_id: id, city } = row;
    if (city) cityNames.add(city);
    if (!id || !city) return;
    if (!productCities.has(id)) productCities.set(id, new Set());
    productCities.get(id).add(city);
  });
  console.log(`Read ${demandCount} demand rows covering ${cityNames.size} cities`);

  await mongoose.connect(uri);
  console.log(`Connected to ${mongoose.connection.name}`);

  // ---- Upsert cities ------------------------------------------------------
  const cityOps = [...cityNames].sort().map(name => ({
    updateOne: {
      filter: { name },
      update: { $set: { name, is_active: true } },
      upsert: true
    }
  }));
  const cityResult = await City.bulkWrite(cityOps);
  console.log(`Cities: ${cityResult.upsertedCount} inserted, ${cityResult.modifiedCount} updated`);

  // ---- Upsert products ----------------------------------------------------
  const productOps = [];
  const skipped = [];

  for (const [productId, rows] of pricingRows) {
    const first = rows[0];
    const prices = rows.map(r => parseFloat(r.current_price)).filter(Number.isFinite);
    const stocks = rows.map(r => parseInt(r.stock, 10)).filter(Number.isFinite);
    const scores = rows.map(r => parseInt(r.demand_score, 10)).filter(Number.isFinite);
    const daysLeft = rows.map(r => parseInt(r.days_left, 10)).filter(Number.isFinite);

    if (!prices.length || !stocks.length || !scores.length || !daysLeft.length) {
      skipped.push({ productId, reason: 'no usable numeric values' });
      continue;
    }

    // city_name only. The datasets carry no per-city stock figure, and
    // inventing one would put fabricated numbers back into the dashboard.
    const cities = [...(productCities.get(productId) || [])].sort()
      .map(city_name => ({ city_name, last_updated: new Date() }));

    productOps.push({
      updateOne: {
        filter: { product_id: productId },
        update: {
          $set: {
            product_id: productId,
            product_name: first.product,
            category: first.category,
            current_price: Math.round(median(prices) * 100) / 100,
            stock_level: Math.round(median(stocks)),
            days_left: Math.round(median(daysLeft)),
            demand_score: Math.round(median(scores)),
            cities,
            is_active: true,
            updated_at: new Date()
          },
          $setOnInsert: { created_at: new Date() }
        },
        upsert: true
      }
    });
  }

  const productResult = await Product.bulkWrite(productOps);
  console.log(`Products: ${productResult.upsertedCount} inserted, ${productResult.modifiedCount} updated`);

  if (skipped.length) {
    console.warn(`Skipped ${skipped.length} products:`);
    skipped.forEach(s => console.warn(`  ${s.productId}: ${s.reason}`));
  }

  // ---- Report -------------------------------------------------------------
  const [summary] = await Product.aggregate([
    {
      $group: {
        _id: null,
        products: { $sum: 1 },
        zero_price: { $sum: { $cond: [{ $eq: ['$current_price', 0] }, 1, 0] } },
        total_stock: { $sum: '$stock_level' },
        avg_price: { $avg: '$current_price' }
      }
    }
  ]);

  console.log('\nDatabase now holds:');
  console.log(`  products     ${summary.products} (${summary.zero_price} with price 0)`);
  console.log(`  total stock  ${summary.total_stock}`);
  console.log(`  avg price    ${Math.round(summary.avg_price * 100) / 100}`);
  console.log(`  cities       ${await City.countDocuments()}`);
}

seed()
  .then(() => { console.log('\nSeed complete.'); return mongoose.disconnect(); })
  .catch(async (err) => {
    console.error('\nSeed failed:', err.message);
    await mongoose.disconnect().catch(() => {});
    process.exitCode = 1;
  });
