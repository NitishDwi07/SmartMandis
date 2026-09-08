const mongoose = require('mongoose');

// Import model schemas
const ProductSchema = require('./Product');
const DemandForecast = require('./DemandForecast'); // This is already a model
const PriceRecommendationSchema = require('./PriceRecommendation');
const City = require('./City'); // This is already a model

// Initialize models only once
let models = {};

function initializeModels() {
  if (Object.keys(models).length === 0) {
    try {
      models.Product = ProductSchema(mongoose);
      models.DemandForecast = DemandForecast; // Use the imported model directly
      models.PriceRecommendation = PriceRecommendationSchema(mongoose);
      models.City = City; // Use the imported model directly
    } catch (error) {
      // Models might already be compiled, get them from mongoose
      models.Product = mongoose.models.Product || ProductSchema(mongoose);
      models.DemandForecast = DemandForecast; // Use the imported model directly
      models.PriceRecommendation = mongoose.models.PriceRecommendation || PriceRecommendationSchema(mongoose);
      models.City = City; // Use the imported model directly
    }
  }
  return models;
}

module.exports = initializeModels();
