const mongoose = require('mongoose');

const citySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  is_active: {
    type: Boolean,
    default: true,
  },
});

// Guard against OverwriteModelError when this module is required more than once.
module.exports = mongoose.models.City || mongoose.model('City', citySchema);
