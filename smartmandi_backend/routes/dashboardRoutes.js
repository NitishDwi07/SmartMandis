const express = require('express');
const { DemandForecast, PriceRecommendation, Product } = require('../models');
const { handleDbError } = require('../utils/dbGuard');

const router = express.Router();

/**
 * Round to 2dp, preserving null/undefined.
 *
 * $avg returns null when every input is null (which is now the case for
 * confidence, since no model emits a calibrated one). Math.round(null * 100)
 * is 0, which would render as "zero confidence" instead of "not measured".
 */
function round2(value) {
  return value === null || value === undefined ? null : Math.round(value * 100) / 100;
}

// Dashboard overview
router.get('/overview', async (req, res) => {
  try {
    const { days = 7 } = req.query;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));

    let overview = {};

    try {
      // Get demand forecasting stats
      const demandStats = await DemandForecast.aggregate([
        {
          $match: {
            forecast_date: { $gte: startDate }
          }
        },
        {
          $group: {
            _id: null,
            total_forecasts: { $sum: 1 },
            total_predicted_units: { $sum: '$predicted_units' },
            avg_confidence: { $avg: '$confidence_score' },
            unique_products: { $addToSet: '$product_id' },
            unique_cities: { $addToSet: '$city' }
          }
        }
      ]);

      overview.demand_forecasting = demandStats[0] ? {
        total_forecasts: demandStats[0].total_forecasts,
        total_predicted_units: demandStats[0].total_predicted_units,
        avg_confidence: round2(demandStats[0].avg_confidence),
        unique_products: demandStats[0].unique_products.length,
        unique_cities: demandStats[0].unique_cities.length
      } : {
        total_forecasts: 0,
        total_predicted_units: 0,
        avg_confidence: null,
        unique_products: 0,
        unique_cities: 0
      };

      // Get pricing stats
      const pricingStats = await PriceRecommendation.aggregate([
        {
          $match: {
            created_at: { $gte: startDate }
          }
        },
        {
          $group: {
            _id: null,
            total_recommendations: { $sum: 1 },
            applied_recommendations: {
              $sum: { $cond: ['$is_applied', 1, 0] }
            },
            avg_price_change: { $avg: '$price_change_percentage' },
            avg_confidence: { $avg: '$confidence_score' },
            unique_products: { $addToSet: '$product_id' }
          }
        }
      ]);

      overview.dynamic_pricing = pricingStats[0] ? {
        total_recommendations: pricingStats[0].total_recommendations,
        applied_recommendations: pricingStats[0].applied_recommendations,
        application_rate: pricingStats[0].total_recommendations > 0 ? 
          Math.round((pricingStats[0].applied_recommendations / pricingStats[0].total_recommendations) * 100) / 100 : 0,
        avg_price_change: round2(pricingStats[0].avg_price_change),
        avg_confidence: round2(pricingStats[0].avg_confidence),
        unique_products: pricingStats[0].unique_products.length
      } : {
        total_recommendations: 0,
        applied_recommendations: 0,
        application_rate: 0,
        avg_price_change: null,
        avg_confidence: null,
        unique_products: 0
      };

      // Get product stats
      const productStats = await Product.aggregate([
        {
          $group: {
            _id: null,
            total_products: { $sum: 1 },
            active_products: {
              $sum: { $cond: ['$is_active', 1, 0] }
            },
            total_stock: { $sum: '$stock_level' },
            avg_price: { $avg: '$current_price' },
            categories: { $addToSet: '$category' }
          }
        }
      ]);

      overview.inventory = productStats[0] ? {
        total_products: productStats[0].total_products,
        active_products: productStats[0].active_products,
        total_stock: productStats[0].total_stock,
        avg_price: round2(productStats[0].avg_price),
        categories: productStats[0].categories.length
      } : {
        total_products: 0,
        active_products: 0,
        total_stock: 0,
        avg_price: 0,
        categories: 0
      };

    } catch (dbError) {
      return handleDbError(res, dbError, 'dashboard overview');
    }

    overview.period_days = parseInt(days);
    overview.generated_at = new Date().toISOString();

    res.json({
      success: true,
      data: overview
    });

  } catch (error) {
    console.error('Error fetching dashboard overview:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch dashboard overview',
      message: error.message
    });
  }
});

// Performance metrics
router.get('/performance', async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));

    let performance = {};

    try {
      // Demand forecasting accuracy (mock calculation)
      const demandAccuracy = await DemandForecast.aggregate([
        {
          $match: {
            forecast_date: { $gte: startDate, $lte: endDate },
            actual_units: { $ne: null }
          }
        },
        {
          $addFields: {
            accuracy: {
              $subtract: [
                1,
                {
                  $abs: {
                    $divide: [
                      { $subtract: ['$predicted_units', '$actual_units'] },
                      { $add: ['$actual_units', 1] } // Add 1 to avoid division by zero
                    ]
                  }
                }
              ]
            }
          }
        },
        {
          $group: {
            _id: null,
            avg_accuracy: { $avg: '$accuracy' },
            total_forecasts: { $sum: 1 }
          }
        }
      ]);

      // Accuracy is only meaningful once forecasts have actuals to compare
      // against. With none on record it is unknown, not 0.78.
      performance.demand_accuracy = demandAccuracy[0] ? {
        avg_accuracy: Math.max(0, Math.min(1, demandAccuracy[0].avg_accuracy)),
        total_forecasts_with_actuals: demandAccuracy[0].total_forecasts
      } : {
        avg_accuracy: null,
        total_forecasts_with_actuals: 0
      };

      // Pricing effectiveness
      const pricingEffectiveness = await PriceRecommendation.aggregate([
        {
          $match: {
            created_at: { $gte: startDate, $lte: endDate },
            is_applied: true
          }
        },
        {
          $group: {
            _id: null,
            total_applied: { $sum: 1 },
            avg_price_impact: { $avg: '$price_change_percentage' },
            positive_changes: {
              $sum: { $cond: [{ $gt: ['$price_change_percentage', 0] }, 1, 0] }
            }
          }
        }
      ]);

      performance.pricing_effectiveness = pricingEffectiveness[0] ? {
        total_applied: pricingEffectiveness[0].total_applied,
        avg_price_impact: pricingEffectiveness[0].avg_price_impact,
        positive_changes_ratio: pricingEffectiveness[0].total_applied > 0 ?
          pricingEffectiveness[0].positive_changes / pricingEffectiveness[0].total_applied : 0
      } : {
        total_applied: 0,
        avg_price_impact: null,
        positive_changes_ratio: null
      };

    } catch (dbError) {
      return handleDbError(res, dbError, 'performance metrics');
    }

    performance.period_days = parseInt(days);
    performance.generated_at = new Date().toISOString();

    res.json({
      success: true,
      data: performance
    });

  } catch (error) {
    console.error('Error fetching performance metrics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch performance metrics',
      message: error.message
    });
  }
});

// Trends analysis
router.get('/trends', async (req, res) => {
  try {
    const { days = 30, interval = 'daily' } = req.query;
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));

    let groupByFormat;
    switch (interval) {
      case 'hourly':
        groupByFormat = {
          year: { $year: '$created_at' },
          month: { $month: '$created_at' },
          day: { $dayOfMonth: '$created_at' },
          hour: { $hour: '$created_at' }
        };
        break;
      case 'weekly':
        groupByFormat = {
          year: { $year: '$created_at' },
          week: { $week: '$created_at' }
        };
        break;
      case 'monthly':
        groupByFormat = {
          year: { $year: '$created_at' },
          month: { $month: '$created_at' }
        };
        break;
      default: // daily
        groupByFormat = {
          year: { $year: '$created_at' },
          month: { $month: '$created_at' },
          day: { $dayOfMonth: '$created_at' }
        };
    }

    let trends = {};

    try {
      // Demand trends
      const demandTrends = await DemandForecast.aggregate([
        {
          $match: {
            created_at: { $gte: startDate, $lte: endDate }
          }
        },
        {
          $group: {
            _id: groupByFormat,
            total_predicted_units: { $sum: '$predicted_units' },
            forecast_count: { $sum: 1 },
            avg_confidence: { $avg: '$confidence_score' }
          }
        },
        { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1, '_id.hour': 1 } }
      ]);

      // Pricing trends
      const pricingTrends = await PriceRecommendation.aggregate([
        {
          $match: {
            created_at: { $gte: startDate, $lte: endDate }
          }
        },
        {
          $group: {
            _id: groupByFormat,
            total_recommendations: { $sum: 1 },
            applied_recommendations: {
              $sum: { $cond: ['$is_applied', 1, 0] }
            },
            avg_price_change: { $avg: '$price_change_percentage' }
          }
        },
        { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1, '_id.hour': 1 } }
      ]);

      trends = {
        demand_trends: demandTrends,
        pricing_trends: pricingTrends
      };

    } catch (dbError) {
      return handleDbError(res, dbError, 'trends');
    }

    trends.period_days = parseInt(days);
    trends.interval = interval;
    trends.generated_at = new Date().toISOString();

    res.json({
      success: true,
      data: trends
    });

  } catch (error) {
    console.error('Error fetching trends:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch trends',
      message: error.message
    });
  }
});

// Top performers
router.get('/top-performers', async (req, res) => {
  try {
    const { days = 7, limit = 10 } = req.query;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));

    let topPerformers = {};

    try {
      // Top products by predicted demand
      const topDemandProducts = await DemandForecast.aggregate([
        {
          $match: {
            forecast_date: { $gte: startDate }
          }
        },
        {
          $group: {
            _id: {
              product_id: '$product_id',
              product_name: '$product_name',
              category: '$category'
            },
            total_predicted_units: { $sum: '$predicted_units' },
            avg_confidence: { $avg: '$confidence_score' },
            forecast_count: { $sum: 1 }
          }
        },
        { $sort: { total_predicted_units: -1 } },
        { $limit: parseInt(limit) }
      ]);

      // Top categories by pricing optimization
      const topPricingCategories = await PriceRecommendation.aggregate([
        {
          $match: {
            created_at: { $gte: startDate }
          }
        },
        {
          $group: {
            _id: '$category',
            total_recommendations: { $sum: 1 },
            applied_recommendations: {
              $sum: { $cond: ['$is_applied', 1, 0] }
            },
            avg_price_improvement: { $avg: '$price_change_percentage' }
          }
        },
        {
          $addFields: {
            application_rate: {
              $divide: ['$applied_recommendations', '$total_recommendations']
            }
          }
        },
        { $sort: { application_rate: -1, avg_price_improvement: -1 } },
        { $limit: parseInt(limit) }
      ]);

      topPerformers = {
        top_demand_products: topDemandProducts,
        top_pricing_categories: topPricingCategories
      };

    } catch (dbError) {
      return handleDbError(res, dbError, 'top performers');
    }

    topPerformers.period_days = parseInt(days);
    topPerformers.limit = parseInt(limit);
    topPerformers.generated_at = new Date().toISOString();

    res.json({
      success: true,
      data: topPerformers
    });

  } catch (error) {
    console.error('Error fetching top performers:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch top performers',
      message: error.message
    });
  }
});

module.exports = router;
