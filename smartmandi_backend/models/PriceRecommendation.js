module.exports = (mongoose) => {
  const { Schema } = mongoose;

  const priceRecommendationSchema = new Schema({
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
    current_price: {
      type: Number,
      required: true,
      min: 0
    },
    recommended_price: {
      type: Number,
      required: true,
      min: 0
    },
    price_change_percentage: {
      type: Number,
      required: true
    },
    demand_score: {
      type: Number,
      required: true,
      min: 0,
      max: 100
    },
    stock_level: {
      type: Number,
      required: true,
      min: 0
    },
    days_left: {
      type: Number,
      required: true,
      min: 0
    },
    weekday: {
      type: String,
      required: true,
      enum: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    },
    season: {
      type: String,
      required: true,
      enum: ['Spring', 'Summer', 'Autumn', 'Winter', 'Rainy']
    },
    // null means "no calibrated confidence available" rather than a made-up
    // number. Averages over this field skip nulls, which is the correct
    // behaviour when the model does not emit an interval.
    confidence_score: {
      type: Number,
      min: 0,
      max: 1,
      default: null
    },
    recommendation_reason: {
      type: String,
      default: ''
    },
    model_version: {
      type: String,
      default: '1.0'
    },
    created_at: {
      type: Date,
      default: Date.now
    },
    valid_until: {
      type: Date,
      required: true
    },
    is_applied: {
      type: Boolean,
      default: false
    }
  });

  // Index for efficient querying
  priceRecommendationSchema.index({ product_id: 1, created_at: -1 });
  priceRecommendationSchema.index({ category: 1 });
  priceRecommendationSchema.index({ valid_until: 1 });

  return mongoose.model('PriceRecommendation', priceRecommendationSchema);
};
