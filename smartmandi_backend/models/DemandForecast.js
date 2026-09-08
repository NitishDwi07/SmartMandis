const mongoose = require('mongoose');

const demandForecastSchema = new mongoose.Schema({
  product_id: {
    type: String,
    required: true
  },
  product_name: {
    type: String,
    required: true
  },
  category: {
    type: String,
    required: true
  },
  city: {
    type: String,
    required: true
  },
  forecast_date: {
    type: Date,
    required: true
  },
  predicted_units: {
    type: Number,
    required: true,
    min: 0
  },
  actual_units: {
    type: Number,
    min: 0,
    default: null
  },
  // null means "no calibrated confidence available" rather than a made-up
  // number. The current demand baseline is rule-based and emits no interval.
  confidence_score: {
    type: Number,
    min: 0,
    max: 1,
    default: null
  },
  holiday_flag: {
    type: Boolean,
    default: false
  },
  day_of_week: {
    type: String,
    enum: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
  },
  month: {
    type: Number,
    min: 1,
    max: 12
  },
  year: {
    type: Number
  },
  model_version: {
    type: String,
    default: '1.0'
  },
  created_at: {
    type: Date,
    default: Date.now
  }
});

// Compound index for efficient querying
demandForecastSchema.index({ product_id: 1, city: 1, forecast_date: 1 });
demandForecastSchema.index({ forecast_date: 1 });
demandForecastSchema.index({ category: 1, city: 1 });

module.exports = mongoose.model('DemandForecast', demandForecastSchema);
