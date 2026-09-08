const express = require('express');
const { DemandForecast } = require('../models');
const productMappingService = require('../services/productMappingService');
const { handleDbError } = require('../utils/dbGuard');
const { runModelService } = require('../utils/runModelService');

const router = express.Router();

// Get demand forecasts
router.get('/', async (req, res) => {
  try {
    const {
      product_id,
      city,
      category,
      start_date,
      end_date,
      limit = 100,
      page = 1
    } = req.query;

    // Build query filter
    const filter = {};
    if (product_id) filter.product_id = product_id;
    if (city) filter.city = city;
    if (category) filter.category = category;
    if (start_date || end_date) {
      filter.forecast_date = {};
      if (start_date) filter.forecast_date.$gte = new Date(start_date);
      if (end_date) filter.forecast_date.$lte = new Date(end_date);
    }

    const skip = (page - 1) * limit;

    const forecasts = await DemandForecast.find(filter)
      .sort({ forecast_date: -1 })
      .limit(parseInt(limit))
      .skip(skip);

    const total = await DemandForecast.countDocuments(filter);

    res.json({
      success: true,
      data: forecasts,
      pagination: {
        current_page: parseInt(page),
        total_pages: Math.ceil(total / limit),
        total_records: total,
        limit: parseInt(limit)
      }
    });

  } catch (error) {
    console.error('Error fetching demand forecasts:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch demand forecasts',
      message: error.message
    });
  }
});

// Generate new demand forecasts
router.post('/predict', async (req, res) => {
  try {
    const { products, forecast_days = 7, cities } = req.body;

    if (!products || !Array.isArray(products) || products.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Products array is required'
      });
    }

    // Map product names to IDs if needed with timeout protection
    let mappedProducts;
    try {
      console.log('Starting product mapping for', products.length, 'products');
      const mappingStart = Date.now();
      
      mappedProducts = await Promise.race([
        productMappingService.mapProductInputs(products),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Product mapping timeout')), 5000)
        )
      ]);
      
      const mappingEnd = Date.now();
      console.log('Product mapping completed in', mappingEnd - mappingStart, 'ms');
      
    } catch (error) {
      console.error('Product mapping failed:', error.message);
      return res.status(400).json({
        success: false,
        error: 'Product mapping failed',
        message: error.message
      });
    }

    if (mappedProducts.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No valid products found after mapping'
      });
    }

    // Prepare input for Python model
    const inputData = {
      products: mappedProducts,
      forecast_days,
      cities
    };

    let prediction;
    try {
      prediction = await runModelService('predict_demand', inputData, { timeoutMs: 60000 });
    } catch (error) {
      const status = error.kind === 'timeout' ? 504 : 502;
      console.error('Demand model service failed:', error.message, error.details || '');
      return res.status(status).json({
        success: false,
        error: 'Demand model service failed',
        message: error.message,
        kind: error.kind
      });
    }

    if (!prediction.success) {
      return res.status(502).json({
        success: false,
        error: 'Model prediction failed',
        message: prediction.error
      });
    }

    // Persist is best-effort: the caller still gets its forecast if the write
    // fails, but the failure is reported rather than silently swallowed.
    let persisted = null;
    if (prediction.predictions && prediction.predictions.length > 0) {
      const documents = prediction.predictions.map(pred => ({
        ...pred,
        forecast_date: new Date(pred.forecast_date)
      }));

      try {
        const inserted = await DemandForecast.insertMany(documents, { ordered: false });
        persisted = { saved: inserted.length };
      } catch (dbError) {
        console.error('Failed to save demand forecasts:', dbError.message);
        persisted = { saved: 0, error: dbError.message };
      }
    }

    res.json({
      success: true,
      data: prediction,
      persisted,
      message: `Generated ${prediction.total_predictions} demand forecasts`
    });

  } catch (error) {
    console.error('Error generating demand forecast:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate demand forecast',
      message: error.message
    });
  }
});

// Get demand analytics
router.get('/analytics', async (req, res) => {
  try {
    const { 
      category, 
      city, 
      start_date, 
      end_date,
      group_by = 'category' 
    } = req.query;

    // Build match filter
    const matchFilter = {};
    if (category) matchFilter.category = category;
    if (city) matchFilter.city = city;
    if (start_date || end_date) {
      matchFilter.forecast_date = {};
      if (start_date) matchFilter.forecast_date.$gte = new Date(start_date);
      if (end_date) matchFilter.forecast_date.$lte = new Date(end_date);
    }

    // Modified aggregation to show day-wise predictions by category
    const analytics = await DemandForecast.aggregate([
      { $match: matchFilter },
      {
        $group: {
          _id: {
            category: '$category',
            day_of_week: '$day_of_week'
          },
          predicted_units: { $sum: '$predicted_units' },
          forecast_count: { $sum: 1 },
          avg_confidence: { $avg: '$confidence_score' }
        }
      },
      {
        $group: {
          _id: '$_id.category',
          daily_predictions: {
            $push: {
              day: '$_id.day_of_week',
              predicted_units: '$predicted_units',
              forecast_count: '$forecast_count',
              avg_confidence: '$avg_confidence'
            }
          },
          total_predicted_units: { $sum: '$predicted_units' },
          total_forecasts: { $sum: '$forecast_count' }
        }
      },
      {
        $project: {
          _id: 1,
          total_predicted_units: 1,
          total_forecasts: 1,
          average_predicted_units: { $divide: ['$total_predicted_units', '$total_forecasts'] },
          daily_predictions: {
            $arrayToObject: {
              $map: {
                input: '$daily_predictions',
                as: 'day_data',
                in: {
                  k: '$$day_data.day',
                  v: {
                    predicted_units: '$$day_data.predicted_units',
                    forecast_count: '$$day_data.forecast_count',
                    avg_confidence: '$$day_data.avg_confidence'
                  }
                }
              }
            }
          }
        }
      },
      { $sort: { total_predicted_units: -1 } }
    ]);

    res.json({
      success: true,
      data: analytics,
      group_by: 'category_with_days',
      total_groups: analytics.length
    });
    

  } catch (error) {
    return handleDbError(res, error, 'demand analytics');
  }
});

// Delete old forecasts
router.delete('/cleanup', async (req, res) => {
  try {
    const { days_old = 30 } = req.query;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - parseInt(days_old));

    const result = await DemandForecast.deleteMany({
      created_at: { $lt: cutoffDate }
    });

    res.json({
      success: true,
      message: `Deleted ${result.deletedCount} old forecast records`,
      deleted_count: result.deletedCount
    });

  } catch (error) {
    console.error('Error cleaning up forecasts:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to cleanup old forecasts',
      message: error.message
    });
  }
});

module.exports = router;
