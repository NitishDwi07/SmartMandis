const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
require('dotenv').config({ path: './smartmandi_backend/.env' });

const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/smartMandi';
const dbName = 'smartmandi'; // Assuming the db name is smartmandi
const csvPath = path.join(__dirname, 'Dataset_CSV_Files/demand_forecasting_data.csv');

const citySet = new Set();

async function seedCities() {
  // Step 1: Parse CSV and extract unique cities
  await new Promise((resolve, reject) => {
    fs.createReadStream(csvPath)
      .pipe(csv())
      .on('data', (row) => {
        const city = row.city?.trim();
        if (city) {
          citySet.add(city);
        }
      })
      .on('end', resolve)
      .on('error', reject);
  });

  const cities = Array.from(citySet).map((cityName) => ({
    name: cityName,
    is_active: true,
  }));

  console.log(`🏙️ Found ${cities.length} unique cities to insert.`);

  const client = new MongoClient(uri);

  try {
    // Step 2: Connect to MongoDB
    await client.connect();
    console.log('✅ Connected to MongoDB');

    const db = client.db(dbName);
    const collection = db.collection('cities');

    console.log(cities.slice(0, 5)); // log first 5 cities
    console.log(`Inserting ${cities.length} cities...`);

    // Step 3: Insert cities using upsert
    let insertedCount = 0;
    for (const city of cities) {
      try {
        const result = await collection.replaceOne(
          { name: city.name },
          city,
          { upsert: true }
        );
        if (result.upsertedCount > 0 || result.modifiedCount > 0) {
          insertedCount++;
          console.log(`✓ Processed city: ${city.name}`);
        }
      } catch (insertError) {
        console.log(`✗ Failed to insert ${city.name}: ${insertError.message}`);
      }
    }

    console.log(`✅ Successfully processed ${insertedCount} cities.`);
    
    // Step 4: Verify insertion
    const count = await collection.countDocuments();
    console.log(`📊 Total cities in database: ${count}`);
    
  } catch (err) {
    console.error('❌ Operation failed:', err.message);
  } finally {
    await client.close();
    console.log('🔌 Disconnected from MongoDB');
  }
}

seedCities();
