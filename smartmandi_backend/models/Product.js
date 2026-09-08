module.exports = (mongoose) => {
  const { Schema } = mongoose;

  const productSchema = new Schema({
    product_id: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    product_name: {
      type: String,
      required: true
    },
    // 'Baby' (P026 Baby Formula) appears in both source CSVs but was missing
    // here, so that product could not be written through this model. Note the
    // pricing model has no category_Baby feature, so it scores Baby products
    // with all-zero category columns until it is retrained.
    category: {
      type: String,
      required: true,
      enum: ['Dairy', 'Bakery', 'Health', 'Fruit', 'Meat', 'Beverage', 'Canned', 'Cleaning', 'Frozen', 'Pet', 'Produce', 'Snacks', 'Baby']
    },
    current_price: {
      type: Number,
      required: true,
      min: 0
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
    demand_score: {
      type: Number,
      required: true,
      min: 0,
      max: 100
    },
    cities: [{
      city_name: String,
      stock_level: Number,
      last_updated: {
        type: Date,
        default: Date.now
      }
    }],
    is_active: {
      type: Boolean,
      default: true
    },
    created_at: {
      type: Date,
      default: Date.now
    },
    updated_at: {
      type: Date,
      default: Date.now
    }
  });

  productSchema.pre('save', function (next) {
    this.updated_at = Date.now();
    next();
  });

  productSchema.index({ category: 1 });
  productSchema.index({ 'cities.city_name': 1 });

  return mongoose.model('Product', productSchema);
};
