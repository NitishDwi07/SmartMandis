const express = require('express');
const mongoose = require('mongoose');
const { Product, City } = require('../models');
const productMappingService = require('../services/productMappingService');
const { handleDbError } = require('../utils/dbGuard');

const router = express.Router();

/**
 * Match a product by either its business id ("P001") or its Mongo _id.
 *
 * _id is only included when the value really is an ObjectId: putting an
 * arbitrary string there makes Mongoose throw a CastError that fails the entire
 * $or, so lookups by product_id never worked.
 */
function productIdFilter(productId) {
  const conditions = [{ product_id: productId }];
  if (mongoose.isValidObjectId(productId)) {
    conditions.push({ _id: productId });
  }
  return { $or: conditions };
}

// Get all products
router.get('/', async (req, res) => {
  try {
    const {
      category,
      city,
      is_active,
      min_price,
      max_price,
      min_stock,
      search,
      limit = 50,
      page = 1,
      sort_by = 'created_at',
      sort_order = 'desc'
    } = req.query;

    // Build query filter
    const filter = {};
    if (category) filter.category = category;
    if (is_active !== undefined) filter.is_active = is_active === 'true';
    if (min_price || max_price) {
      filter.current_price = {};
      if (min_price) filter.current_price.$gte = parseFloat(min_price);
      if (max_price) filter.current_price.$lte = parseFloat(max_price);
    }
    if (min_stock) filter.stock_level = { $gte: parseInt(min_stock) };
    if (city) filter['cities.city_name'] = city;
    if (search) {
      filter.$or = [
        { product_name: { $regex: search, $options: 'i' } },
        { product_id: { $regex: search, $options: 'i' } },
        { category: { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (page - 1) * limit;
    const sortOptions = {};
    sortOptions[sort_by] = sort_order === 'desc' ? -1 : 1;

    const products = await Product.find(filter)
      .sort(sortOptions)
      .limit(parseInt(limit))
      .skip(skip);

    const total = await Product.countDocuments(filter);

    res.json({
      success: true,
      data: products,
      pagination: {
        current_page: parseInt(page),
        total_pages: Math.ceil(total / limit),
        total_records: total,
        limit: parseInt(limit)
      }
    });

  } catch (error) {
    return handleDbError(res, error, 'products');
  }
});

// Search products by name
router.get('/search/:searchTerm', async (req, res) => {
  try {
    const { searchTerm } = req.params;
    const { limit = 10 } = req.query;

    const results = await productMappingService.searchProducts(searchTerm, parseInt(limit));

    res.json({
      success: true,
      data: results,
      search_term: searchTerm,
      total_results: results.length
    });

  } catch (error) {
    console.error('Error searching products:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to search products',
      message: error.message
    });
  }
});

// Get product by name (exact match)
router.get('/by-name/:productName', async (req, res) => {
  try {
    const { productName } = req.params;

    const product = await productMappingService.getProductByName(productName);

    if (!product) {
      return res.status(404).json({
        success: false,
        error: 'Product not found',
        product_name: productName
      });
    }

    res.json({
      success: true,
      data: product
    });

  } catch (error) {
    console.error('Error fetching product by name:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch product by name',
      message: error.message
    });
  }
});

// Get product categories
router.get('/meta/categories', async (req, res) => {
  try {
    const categories = await Product.distinct('category');
    
    res.json({
      success: true,
      data: categories.sort()
    });

  } catch (error) {
    return handleDbError(res, error, 'categories');
  }
});

// Get cities
router.get('/meta/cities', async (req, res) => {
  try {
    const cities = await City.distinct('name');
    
    res.json({
      success: true,
      data: cities.sort()
    });

  } catch (error) {
    return handleDbError(res, error, 'cities');
  }
});

// Get all unique cities from products
router.get('/cities', async (req, res) => {
  try {
    const cities = await Product.distinct('cities.city_name');
    
    res.json({
      success: true,
      data: cities.sort()
    });

  } catch (error) {
    return handleDbError(res, error, 'cities');
  }
});

// Get products by category
router.get('/category/:category', async (req, res) => {
  try {
    const { category } = req.params;
    const {
      city,
      is_active,
      min_price,
      max_price,
      min_stock,
      search,
      limit = 50,
      page = 1,
      sort_by = 'created_at',
      sort_order = 'desc'
    } = req.query;

    // Build query filter
    const filter = { category: { $regex: new RegExp(`^${category}$`, 'i') } };
    if (is_active !== undefined) filter.is_active = is_active === 'true';
    if (min_price || max_price) {
      filter.current_price = {};
      if (min_price) filter.current_price.$gte = parseFloat(min_price);
      if (max_price) filter.current_price.$lte = parseFloat(max_price);
    }
    if (min_stock) filter.stock_level = { $gte: parseInt(min_stock) };
    if (city) filter['cities.city_name'] = city;
    if (search) {
      filter.$and = [
        { category: { $regex: new RegExp(`^${category}$`, 'i') } },
        {
          $or: [
            { product_name: { $regex: search, $options: 'i' } },
            { product_id: { $regex: search, $options: 'i' } }
          ]
        }
      ];
      delete filter.category; // Remove the simple category filter since we're using $and
    }

    const skip = (page - 1) * limit;
    const sortOptions = {};
    sortOptions[sort_by] = sort_order === 'desc' ? -1 : 1;

    const products = await Product.find(filter)
      .sort(sortOptions)
      .limit(parseInt(limit))
      .skip(skip);

    const total = await Product.countDocuments(filter);

    res.json({
      success: true,
      data: products,
      category: category,
      pagination: {
        current_page: parseInt(page),
        total_pages: Math.ceil(total / limit),
        total_records: total,
        limit: parseInt(limit)
      }
    });

  } catch (error) {
    return handleDbError(res, error, `products in category ${req.params.category}`);
  }
});

// Get product details with category mapping
router.get('/details/:productName', async (req, res) => {
  try {
    const { productName } = req.params;
    
    const product = await Product.findOne({ 
      product_name: { $regex: new RegExp(`^${productName}$`, 'i') } 
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        error: 'Product not found',
        product_name: productName
      });
    }

    res.json({
      success: true,
      data: {
        product_id: product.product_id,
        product_name: product.product_name,
        category: product.category,
        current_price: product.current_price,
        stock_level: product.stock_level,
        days_left: product.days_left,
        demand_score: product.demand_score,
        cities: product.cities,
        is_active: product.is_active
      }
    });

  } catch (error) {
    console.error('Error fetching product details:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch product details',
      message: error.message
    });
  }
});

// Get single product
router.get('/:productId', async (req, res) => {
  try {
    const { productId } = req.params;

    const product = await Product.findOne(productIdFilter(productId));

    if (!product) {
      return res.status(404).json({
        success: false,
        error: 'Product not found'
      });
    }

    res.json({
      success: true,
      data: product
    });

  } catch (error) {
    return handleDbError(res, error, `product ${req.params.productId}`);
  }
});

// Create new product
router.post('/', async (req, res) => {
  try {
    const productData = req.body;

    // Validate required fields
    const requiredFields = ['product_id', 'product_name', 'category', 'current_price'];
    for (const field of requiredFields) {
      if (!productData[field]) {
        return res.status(400).json({
          success: false,
          error: `${field} is required`
        });
      }
    }

    // Set defaults
    productData.stock_level = productData.stock_level || 0;
    productData.days_left = productData.days_left || 7;
    productData.demand_score = productData.demand_score || 50;
    productData.cities = productData.cities || [];
    productData.is_active = productData.is_active !== false;

    const product = new Product(productData);
    await product.save();

    res.status(201).json({
      success: true,
      data: product,
      message: 'Product created successfully'
    });

  } catch (error) {
    console.error('Error creating product:', error);
    
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        error: 'Product ID already exists'
      });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to create product',
      message: error.message
    });
  }
});

// Update product
router.put('/:productId', async (req, res) => {
  try {
    const { productId } = req.params;
    const updateData = req.body;

    // Remove fields that shouldn't be updated directly
    delete updateData._id;
    delete updateData.created_at;
    updateData.updated_at = new Date();

    const product = await Product.findOneAndUpdate(
      productIdFilter(productId),
      updateData,
      { new: true, runValidators: true }
    );

    if (!product) {
      return res.status(404).json({
        success: false,
        error: 'Product not found'
      });
    }

    res.json({
      success: true,
      data: product,
      message: 'Product updated successfully'
    });

  } catch (error) {
    console.error('Error updating product:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update product',
      message: error.message
    });
  }
});

// Update product stock for specific city
router.patch('/:productId/stock/:cityName', async (req, res) => {
  try {
    const { productId, cityName } = req.params;
    const { stock_level } = req.body;

    if (stock_level === undefined || stock_level < 0) {
      return res.status(400).json({
        success: false,
        error: 'Valid stock_level is required'
      });
    }

    const product = await Product.findOne(productIdFilter(productId));

    if (!product) {
      return res.status(404).json({
        success: false,
        error: 'Product not found'
      });
    }

    // Update city stock or add new city
    const cityIndex = product.cities.findIndex(city => city.city_name === cityName);
    
    if (cityIndex >= 0) {
      product.cities[cityIndex].stock_level = parseInt(stock_level);
      product.cities[cityIndex].last_updated = new Date();
    } else {
      product.cities.push({
        city_name: cityName,
        stock_level: parseInt(stock_level),
        last_updated: new Date()
      });
    }

    // Update overall stock level (sum of all cities)
    product.stock_level = product.cities.reduce((total, city) => total + city.stock_level, 0);
    product.updated_at = new Date();

    await product.save();

    res.json({
      success: true,
      data: product,
      message: `Stock updated for ${cityName}`
    });

  } catch (error) {
    console.error('Error updating product stock:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update product stock',
      message: error.message
    });
  }
});

// Delete product
router.delete('/:productId', async (req, res) => {
  try {
    const { productId } = req.params;

    const product = await Product.findOneAndDelete(productIdFilter(productId));

    if (!product) {
      return res.status(404).json({
        success: false,
        error: 'Product not found'
      });
    }

    res.json({
      success: true,
      message: 'Product deleted successfully',
      data: { product_id: product.product_id }
    });

  } catch (error) {
    console.error('Error deleting product:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete product',
      message: error.message
    });
  }
});


// Map product input (auto-fill product_id from product_name)
router.post('/map', async (req, res) => {
  try {
    const productInput = req.body;

    if (!productInput.product_name && !productInput.product_id) {
      return res.status(400).json({
        success: false,
        error: 'Either product_name or product_id must be provided'
      });
    }

    const mappedProduct = await productMappingService.mapProductInput(productInput);

    res.json({
      success: true,
      data: mappedProduct,
      message: 'Product mapped successfully'
    });

  } catch (error) {
    console.error('Error mapping product:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to map product',
      message: error.message
    });
  }
});

// Batch map multiple products
router.post('/map/batch', async (req, res) => {
  try {
    const { products } = req.body;

    if (!products || !Array.isArray(products) || products.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Products array is required'
      });
    }

    const mappedProducts = await productMappingService.mapProductInputs(products);

    res.json({
      success: true,
      data: mappedProducts,
      total_mapped: mappedProducts.length,
      message: `${mappedProducts.length} products mapped successfully`
    });

  } catch (error) {
    console.error('Error batch mapping products:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to batch map products',
      message: error.message
    });
  }
});

// Refresh product cache
router.post('/cache/refresh', async (req, res) => {
  try {
    await productMappingService.refreshCache();

    res.json({
      success: true,
      message: 'Product cache refreshed successfully'
    });

  } catch (error) {
    console.error('Error refreshing cache:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to refresh cache',
      message: error.message
    });
  }
});

// Bulk operations
router.post('/bulk/create', async (req, res) => {
  try {
    const { products } = req.body;

    if (!products || !Array.isArray(products) || products.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Products array is required'
      });
    }

    // Add defaults to each product
    const processedProducts = products.map(product => ({
      ...product,
      stock_level: product.stock_level || 0,
      days_left: product.days_left || 7,
      demand_score: product.demand_score || 50,
      cities: product.cities || [],
      is_active: product.is_active !== false
    }));

    const result = await Product.insertMany(processedProducts, { ordered: false });

    res.status(201).json({
      success: true,
      data: result,
      message: `${result.length} products created successfully`
    });

  } catch (error) {
    console.error('Error bulk creating products:', error);
    
    // Handle partial success
    if (error.writeErrors) {
      const successCount = error.result.insertedCount || 0;
      const errorCount = error.writeErrors.length;
      
      return res.status(207).json({
        success: true,
        message: `${successCount} products created, ${errorCount} failed`,
        inserted_count: successCount,
        error_count: errorCount,
        errors: error.writeErrors.map(err => ({
          index: err.index,
          error: err.errmsg
        }))
      });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to create products',
      message: error.message
    });
  }
});

module.exports = router;
