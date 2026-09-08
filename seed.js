const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
require('dotenv').config({ path: './smartmandi_backend/.env' });

// MongoDB URI
const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/smartMandi';

// CSV file path
const csvPath = path.join(__dirname, 'Dataset_CSV_Files/demand_forecasting_data.csv');

// Store unique products
const productMap = new Map();

/* ---------------------- PRODUCT SCHEMA ---------------------- */
const productSchema = new mongoose.Schema(
  {
    product_id: { type: String, required: true, unique: true },
    product_name: { type: String },
    category: { type: String },
    current_price: { type: Number, default: 0 },
    stock_level: { type: Number, default: 0 },
    days_left: { type: Number, default: 0 },
    demand_score: { type: Number, default: 0 },
    is_active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const Product = mongoose.model('Product', productSchema);

/* ---------------------- SEED FUNCTION ---------------------- */
async function seedProducts() {
  try {
    /* ---------- STEP 1: Parse CSV ---------- */
    await new Promise((resolve, reject) => {
      fs.createReadStream(csvPath)
        .pipe(csv())
        .on('data', (row) => {
          const id = row.product_id?.trim();
          if (id && !productMap.has(id)) {
            productMap.set(id, {
              product_id: id,
              product_name: row.product?.trim(),
              category: row.category?.trim(),
            });
          }
        })
        .on('end', resolve)
        .on('error', reject);
    });

    const products = Array.from(productMap.values());
    console.log(`📦 Found ${products.length} unique products`);

    /* ---------- STEP 2: Connect MongoDB ---------- */
    await mongoose.connect(uri);
    console.log('✅ Connected to MongoDB');

    /* ---------- STEP 3: Insert Products ---------- */
    const result = await Product.insertMany(products, {
      ordered: false, // continue on duplicates
    });

    console.log(`✅ Successfully inserted ${result.length} products`);
  } catch (err) {
    console.error('❌ Seeding failed:', err.message);
  } finally {
    /* ---------- STEP 4: Disconnect ---------- */
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
}

/* ---------------------- RUN SEEDER ---------------------- */
seedProducts();
