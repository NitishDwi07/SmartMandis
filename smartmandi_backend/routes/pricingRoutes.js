const express = require('express');
const { PriceRecommendation } = require('../models');
const productMappingService = require('../services/productMappingService');
const { handleDbError } = require('../utils/dbGuard');
const { runModelService } = require('../utils/runModelService');

const router = express.Router();

// Get price recommendations
router.get('/', async (req, res) => {
  try {
    const {
      product_id,
      category,
      start_date,
      end_date,
      is_applied,
      limit = 100,
      page = 1
    } = req.query;

    // Build query filter
    const filter = {};
    if (product_id) filter.product_id = product_id;
    if (category) filter.category = category;
    if (is_applied !== undefined) filter.is_applied = is_applied === 'true';
    if (start_date || end_date) {
      filter.created_at = {};
      if (start_date) filter.created_at.$gte = new Date(start_date);
      if (end_date) filter.created_at.$lte = new Date(end_date);
    }

    const skip = (page - 1) * limit;

    const recommendations = await PriceRecommendation.find(filter)
      .sort({ created_at: -1 })
      .limit(parseInt(limit))
      .skip(skip);

    const total = await PriceRecommendation.countDocuments(filter);

    res.json({
      success: true,
      data: recommendations,
      pagination: {
        current_page: parseInt(page),
        total_pages: Math.ceil(total / limit),
        total_records: total,
        limit: parseInt(limit)
      }
    });

  } catch (error) {
    console.error('Error fetching price recommendations:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch price recommendations',
      message: error.message
    });
  }
});

// Generate new price recommendations
router.post('/recommend', async (req, res) => {
  try {
    const { products } = req.body;

    if (!products || !Array.isArray(products) || products.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Products array is required'
      });
    }

    // Map product names to IDs if needed
    const mappedProducts = await productMappingService.mapProductInputs(products);

    if (mappedProducts.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No valid products found after mapping'
      });
    }

    // Add current date context to products
    const enrichedProducts = mappedProducts.map(product => ({
      ...product,
      weekday: product.weekday || new Date().toLocaleDateString('en-US', { weekday: 'long' }),
      season: product.season || getCurrentSeason()
    }));

    // Prepare input for Python model
    const inputData = { products: enrichedProducts };

    let prediction = null;
    try {
      prediction = await runModelService('predict_pricing', inputData, { timeoutMs: 30000 });
    } catch (error) {
      console.error('Pricing model service failed:', error.message, error.details || '');
    }

    // The rule-based fallback keeps pricing available when the model is down.
    if (!prediction || !prediction.success) {
      if (prediction && !prediction.success) {
        console.error('Pricing model returned failure:', prediction.error);
      }
      return generateFallbackRecommendations(enrichedProducts, res);
    }

    let persisted = null;
    if (prediction.recommendations && prediction.recommendations.length > 0) {
      try {
        const inserted = await PriceRecommendation.insertMany(
          prediction.recommendations,
          { ordered: false }
        );
        persisted = { saved: inserted.length };
      } catch (dbError) {
        console.error('Failed to save price recommendations:', dbError.message);
        persisted = { saved: 0, error: dbError.message };
      }
    }

    res.json({
      success: true,
      data: prediction,
      persisted,
      message: `Generated ${prediction.total_recommendations} price recommendations`
    });

  } catch (error) {
    console.error('Error generating price recommendations:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate price recommendations',
      message: error.message
    });
  }
});

// Apply price recommendation
router.patch('/:recommendationId/apply', async (req, res) => {
  try {
    const { recommendationId } = req.params;

    const recommendation = await PriceRecommendation.findByIdAndUpdate(
      recommendationId,
      { is_applied: true },
      { new: true }
    );

    if (!recommendation) {
      return res.status(404).json({
        success: false,
        error: 'Recommendation not found'
      });
    }

    res.json({
      success: true,
      data: recommendation,
      message: 'Price recommendation applied successfully'
    });

  } catch (error) {
    console.error('Error applying price recommendation:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to apply price recommendation',
      message: error.message
    });
  }
});

// Get pricing analytics
router.get('/analytics', async (req, res) => {
  try {
    const { 
      category, 
      start_date, 
      end_date,
      group_by = 'category' 
    } = req.query;

    // Build match filter
    const matchFilter = {};
    if (category) matchFilter.category = category;
    if (start_date || end_date) {
      matchFilter.created_at = {};
      if (start_date) matchFilter.created_at.$gte = new Date(start_date);
      if (end_date) matchFilter.created_at.$lte = new Date(end_date);
    }

    let groupField;
    switch (group_by) {
      case 'category':
        groupField = '$category';
        break;
      case 'product':
        groupField = '$product_id';
        break;
      default:
        groupField = '$category';
    }

    const analytics = await PriceRecommendation.aggregate([
      { $match: matchFilter },
      {
        $group: {
          _id: groupField,
          total_recommendations: { $sum: 1 },
          applied_recommendations: {
            $sum: { $cond: ['$is_applied', 1, 0] }
          },
          avg_price_change: { $avg: '$price_change_percentage' },
          avg_current_price: { $avg: '$current_price' },
          avg_recommended_price: { $avg: '$recommended_price' },
          avg_confidence: { $avg: '$confidence_score' }
        }
      },
      {
        $addFields: {
          application_rate: {
            $cond: [
              { $eq: ['$total_recommendations', 0] },
              0,
              { $divide: ['$applied_recommendations', '$total_recommendations'] }
            ]
          }
        }
      },
      { $sort: { total_recommendations: -1 } }
    ]);

    res.json({
      success: true,
      data: analytics,
      group_by,
      total_groups: analytics.length
    });

  } catch (error) {
    return handleDbError(res, error, 'pricing analytics');
  }
});

// Get price optimization summary
router.get('/optimization-summary', async (req, res) => {
  try {
    const { category, days = 7 } = req.query;
    
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));

    const matchFilter = {
      created_at: { $gte: startDate }
    };
    if (category) matchFilter.category = category;

    const summary = await PriceRecommendation.aggregate([
      { $match: matchFilter },
      {
        $group: {
          _id: null,
          total_products: { $sum: 1 },
          products_with_increase: {
            $sum: { $cond: [{ $gt: ['$price_change_percentage', 0] }, 1, 0] }
          },
          products_with_decrease: {
            $sum: { $cond: [{ $lt: ['$price_change_percentage', 0] }, 1, 0] }
          },
          products_no_change: {
            $sum: { $cond: [{ $eq: ['$price_change_percentage', 0] }, 1, 0] }
          },
          avg_price_change: { $avg: '$price_change_percentage' },
          max_price_increase: { $max: '$price_change_percentage' },
          max_price_decrease: { $min: '$price_change_percentage' },
          total_applied: {
            $sum: { $cond: ['$is_applied', 1, 0] }
          }
        }
      }
    ]);

    const result = summary[0] || {
      total_products: 0,
      products_with_increase: 0,
      products_with_decrease: 0,
      products_no_change: 0,
      avg_price_change: 0,
      max_price_increase: 0,
      max_price_decrease: 0,
      total_applied: 0
    };

    result.application_rate = result.total_products > 0 ? 
      (result.total_applied / result.total_products) : 0;

    res.json({
      success: true,
      data: result,
      period_days: parseInt(days),
      category: category || 'all'
    });

  } catch (error) {
    return handleDbError(res, error, 'optimization summary');
  }
});

// Helper function to get current season
function getCurrentSeason() {
  const month = new Date().getMonth() + 1; // 1-12
  if (month >= 3 && month <= 5) return 'Spring';
  if (month >= 6 && month <= 8) return 'Summer';
  if (month >= 9 && month <= 11) return 'Autumn';
  return 'Winter';
}

// Fallback pricing logic when Python model fails
async function generateFallbackRecommendations(products, res) {
  try {
    const recommendations = products.map(product => {
      const currentPrice = product.current_price || 25.0;
      const stockLevel = product.stock_level || 100;
      const demandScore = product.demand_score || 50;
      const daysLeft = product.days_left || 7;
      
      // Rule-based pricing logic
      let priceMultiplier = 1.0;
      let reason = 'Current price is optimal';
      
      // High demand adjustment
      if (demandScore > 70) {
        priceMultiplier *= 1.05; // 5% increase
        reason = 'High demand detected - price increase recommended';
      } else if (demandScore < 30) {
        priceMultiplier *= 0.95; // 5% decrease
        reason = 'Low demand - price reduction to boost sales';
      }
      
      // Stock level adjustment
      if (stockLevel < 50) {
        priceMultiplier *= 1.03; // 3% increase for low stock
        reason = 'Low stock levels - price increase to manage demand';
      } else if (stockLevel > 200) {
        priceMultiplier *= 0.97; // 3% decrease for high stock
        reason = 'High inventory levels - price reduction to clear stock';
      }
      
      // Expiry adjustment
      if (daysLeft <= 2) {
        priceMultiplier *= 0.80; // 20% decrease for near expiry
        reason = 'Product nearing expiry - urgent price reduction';
      } else if (daysLeft <= 5) {
        priceMultiplier *= 0.90; // 10% decrease
        reason = 'Product nearing expiry - price reduction to clear stock';
      }
      
      const recommendedPrice = currentPrice * priceMultiplier;
      const priceChange = ((recommendedPrice - currentPrice) / currentPrice * 100);
      
      return {
        product_id: product.product_id,
        product_name: product.product_name,
        category: product.category,
        current_price: currentPrice,
        recommended_price: Math.round(recommendedPrice * 100) / 100,
        price_change_percentage: Math.round(priceChange * 100) / 100,
        demand_score: demandScore,
        stock_level: stockLevel,
        days_left: daysLeft,
        weekday: product.weekday || new Date().toLocaleDateString('en-US', { weekday: 'long' }),
        season: product.season || getCurrentSeason(),
        confidence_score: null, // Rule-based: no calibrated confidence to report
        recommendation_reason: reason,
        model_version: 'fallback-1.0',
        created_at: new Date(),
        valid_until: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
        is_applied: false
      };
    });
    
    // Try to save to database if available
    try {
      await PriceRecommendation.insertMany(recommendations);
    } catch (dbError) {
      console.log('Database not available, continuing without saving:', dbError.message);
    }
    
    res.json({
      success: true,
      data: {
        success: true,
        recommendations: recommendations,
        total_recommendations: recommendations.length
      },
      message: `Generated ${recommendations.length} price recommendations using fallback logic`,
      note: 'Generated using fallback pricing algorithm'
    });
    
  } catch (error) {
    console.error('Error in fallback recommendations:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate fallback recommendations',
      message: error.message
    });
  }
}

module.exports = router;
