#!/usr/bin/env python3
"""
Model Service for Smart Mandi Backend
Handles demand forecasting and dynamic pricing predictions.

Protocol: invoked as `modelService.py <operation>` with a JSON payload on stdin.
Exactly one line is written to stdout -- the JSON result. Every diagnostic goes
to stderr, because the Node caller parses stdout as the response.
"""

import json
import os
import pickle
import sys
from datetime import datetime, timedelta
import warnings

import numpy as np

warnings.filterwarnings('ignore')


def log(message):
    """Diagnostics go to stderr; stdout is reserved for the JSON result."""
    print(message, file=sys.stderr)
    sys.stderr.flush()


class SmartMandiModelService:
    DEMAND_METHOD = 'xgboost'
    DEMAND_VERSION = 'xgboost-demand-1.0'
    PRICING_VERSION = 'xgboost-1.0'

    # Indian public holidays present in the training data. The model has an
    # is_holiday feature, so serving has to be able to set it.
    HOLIDAYS_2024 = {
        '2024-08-15': 'Independence Day',
        '2024-10-02': 'Gandhi Jayanti',
        '2024-10-12': 'Dussehra',
        '2024-11-01': 'Diwali',
        '2024-11-03': 'Bhai Dooj',
    }
    # Month-day recurrence for the fixed-date holidays, so a 2026 request still
    # flags Independence Day / Gandhi Jayanti.
    FIXED_HOLIDAYS = {(8, 15), (10, 2)}

    def __init__(self):
        self.base_path = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        self.project_root = os.path.dirname(self.base_path)
        self.pricing_model = None
        self.model_features = None
        self.demand_model = None
        self.demand_features = None
        self.demand_metrics = None
        self.demand_quantiles = None

    # ------------------------------------------------------------------
    # Model loading
    # ------------------------------------------------------------------
    # Loaded lazily and only for the operation being run. Each request spawns a
    # fresh interpreter, so eagerly unpickling every artifact in __init__ meant
    # demand requests paid to read a 5.3 MB file they never touched.

    def load_pricing_model(self):
        """Load the XGBoost pricing model and its feature order."""
        if self.pricing_model is not None:
            return

        model_path = os.path.join(self.project_root, 'Model_for_Dynamic_Pricing', 'xgb_model.pkl')
        with open(model_path, 'rb') as f:
            self.pricing_model = pickle.load(f)

        # The feature order is part of the trained model's contract. If it is
        # missing we cannot build a valid input vector, so fail loudly rather
        # than guess -- a wrong order yields confident, silently wrong prices.
        features_path = os.path.join(self.project_root, 'Model_for_Dynamic_Pricing', 'model_features.json')
        try:
            with open(features_path, 'r') as f:
                self.model_features = json.load(f)
        except FileNotFoundError:
            raise RuntimeError(
                f'Required feature spec not found at {features_path}. '
                'It defines the exact input order xgb_model.pkl was trained on.'
            )

        log(f'Pricing model loaded ({len(self.model_features)} features)')

    def load_demand_model(self):
        """Load the trained demand regressor, its feature order and its scores."""
        if self.demand_model is not None:
            return

        base = os.path.join(self.project_root, 'Model_for_Demand_Forecasting')
        model_path = os.path.join(base, 'demand_model.pkl')
        features_path = os.path.join(base, 'demand_model_features.json')

        if not os.path.exists(model_path):
            raise RuntimeError(
                f'Demand model not found at {model_path}. '
                'Run: python Model_for_Demand_Forecasting/train_demand_model.py'
            )

        with open(model_path, 'rb') as f:
            self.demand_model = pickle.load(f)
        with open(features_path, 'r') as f:
            self.demand_features = json.load(f)

        # Optional: separate quantile fits giving each prediction a real
        # interval. Absent, rows simply carry no bounds — better than
        # substituting an invented confidence number.
        try:
            with open(os.path.join(base, 'demand_model_quantiles.pkl'), 'rb') as f:
                self.demand_quantiles = pickle.load(f)
        except FileNotFoundError:
            self.demand_quantiles = None

        # Held-out scores travel with every response so callers can see how much
        # to trust the number instead of assuming "it is a model, so it is right".
        try:
            with open(os.path.join(base, 'demand_model_metrics.json'), 'r') as f:
                self.demand_metrics = json.load(f)
        except FileNotFoundError:
            self.demand_metrics = None

        log(f'Demand model loaded ({len(self.demand_features)} features)')

    # ------------------------------------------------------------------
    # Demand forecasting
    # ------------------------------------------------------------------

    def predict_demand(self, input_data):
        """
        Forecast demand for each product / city / day using the trained model.

        Uses Model_for_Demand_Forecasting/demand_model.pkl -- an XGBRegressor
        fitted on the 17,019 historical sales rows with a chronological split
        (see train_demand_model.py). Its held-out scores ride along in the
        response: on this dataset the achievable ceiling is low, because
        product, city and category each explain well under 1% of the variance
        and the series carry no autocorrelation. Weekday (7.3%) and holiday
        (0.9%) are the only real effects, so the honest read is "a weekday and
        holiday shape", not a per-SKU crystal ball.
        """
        try:
            self.load_demand_model()

            products = input_data.get('products', [])
            forecast_days = int(input_data.get('forecast_days', 7))
            cities = input_data.get('cities') or ['Mumbai', 'Delhi', 'Bangalore', 'Chennai', 'Pune']

            rows = []
            meta = []
            today = datetime.now()

            for product in products:
                for city in cities:
                    for day in range(forecast_days):
                        forecast_date = today + timedelta(days=day + 1)
                        rows.append(self.prepare_demand_features(product, city, forecast_date))
                        meta.append((product, city, forecast_date))

            if not rows:
                return {
                    'success': True, 'predictions': [], 'total_predictions': 0,
                    'method': self.DEMAND_METHOD, 'is_trained_model': True
                }

            # One batched call rather than one per row.
            matrix = np.asarray(rows, dtype=float)
            raw = self.demand_model.predict(matrix)

            lower = upper = None
            if self.demand_quantiles:
                keys = sorted(self.demand_quantiles, key=float)
                lower = np.clip(self.demand_quantiles[keys[0]].predict(matrix), 0, None)
                upper = np.clip(self.demand_quantiles[keys[-1]].predict(matrix), 0, None)

            results = []
            for i, ((product, city, forecast_date), value) in enumerate(zip(meta, raw)):
                bounds = {}
                if lower is not None:
                    lo = int(max(0, round(float(lower[i]))))
                    hi = int(max(0, round(float(upper[i]))))
                    # Quantile fits are independent, so they can cross on rare
                    # rows; order them rather than emit a negative-width range.
                    bounds = {'lower_bound': min(lo, hi), 'upper_bound': max(lo, hi)}

                results.append({
                    **bounds,
                    'product_id': product.get('product_id'),
                    'product_name': product.get('product_name'),
                    'category': product.get('category'),
                    'city': city,
                    'forecast_date': forecast_date.strftime('%Y-%m-%d'),
                    'predicted_units': int(max(0, round(float(value)))),
                    # A point-estimate regressor emits no interval, so there is
                    # no per-row confidence to report. Accuracy is reported once,
                    # for the model, in `model_performance` below.
                    'confidence_score': None,
                    'day_of_week': forecast_date.strftime('%A'),
                    'month': forecast_date.month,
                    'year': forecast_date.year,
                    'holiday_flag': self.is_holiday(forecast_date),
                    'model_version': self.DEMAND_VERSION,
                })

            response = {
                'success': True,
                'predictions': results,
                'total_predictions': len(results),
                'forecast_period': f'{forecast_days} days',
                'method': self.DEMAND_METHOD,
                'is_trained_model': True,
            }

            if self.demand_metrics:
                m = self.demand_metrics.get('model', {})
                interval = self.demand_metrics.get('interval', {})
                response['model_performance'] = {
                    'mae': m.get('mae'),
                    'rmse': m.get('rmse'),
                    'r2': m.get('r2'),
                    'holdout_days': self.demand_metrics.get('holdout_days'),
                    'trained_rows': self.demand_metrics.get('rows_train'),
                    'interval_coverage_pct': interval.get('empirical_coverage_pct'),
                    'interval_nominal_pct': interval.get('nominal_coverage_pct'),
                    'note': (
                        f"Held-out MAE {m.get('mae')} units (R² {m.get('r2')}). The source data "
                        'has little learnable structure beyond weekday and holiday effects, so '
                        'treat these as a demand shape rather than precise per-SKU figures.'
                    )
                }

            return response

        except Exception as e:
            return {'success': False, 'error': str(e), 'predictions': []}

    def prepare_demand_features(self, product, city, forecast_date):
        """
        Build the demand feature vector in the exact order the model was fitted
        on, driven by demand_model_features.json so training and serving cannot
        drift apart.
        """
        numeric = {
            'day_of_week': forecast_date.weekday(),
            'day_of_month': forecast_date.day,
            'month': forecast_date.month,
            'week_of_year': forecast_date.isocalendar()[1],
            'is_weekend': 1 if forecast_date.weekday() >= 5 else 0,
            'is_holiday': 1 if self.is_holiday(forecast_date) else 0,
        }
        one_hot = {
            'product_': product.get('product_id'),
            'category_': product.get('category'),
            'city_': city,
        }

        vector = []
        for name in self.demand_features:
            if name in numeric:
                vector.append(float(numeric[name]))
                continue

            for prefix, value in one_hot.items():
                if name.startswith(prefix):
                    vector.append(1.0 if name[len(prefix):] == value else 0.0)
                    break
            else:
                raise ValueError(f'Unrecognised feature in demand_model_features.json: {name}')

        return vector

    def is_holiday(self, date):
        """
        True on the public holidays the model was trained with.

        The training data covers Jun-Nov 2024, so the movable festivals are
        matched on their exact 2024 dates and the fixed-date national holidays
        recur every year.
        """
        if date.strftime('%Y-%m-%d') in self.HOLIDAYS_2024:
            return True
        return (date.month, date.day) in self.FIXED_HOLIDAYS

    # ------------------------------------------------------------------
    # Dynamic pricing
    # ------------------------------------------------------------------

    def predict_pricing(self, input_data):
        """Predict optimal pricing for the given products using the XGBoost model."""
        try:
            self.load_pricing_model()

            results = []
            for product in input_data.get('products', []):
                features = self.prepare_pricing_features(product)
                predicted_price = float(max(0.0, self.pricing_model.predict([features])[0]))

                current_price = float(product.get('current_price', 25.0))
                price_change = (
                    ((predicted_price - current_price) / current_price * 100)
                    if current_price > 0 else 0.0
                )

                results.append({
                    'product_id': product.get('product_id'),
                    'product_name': product.get('product_name'),
                    'category': product.get('category'),
                    'current_price': current_price,
                    'recommended_price': round(predicted_price, 2),
                    'price_change_percentage': round(price_change, 2),
                    'demand_score': int(product.get('demand_score', 50)),
                    'stock_level': int(product.get('stock_level', 100)),
                    'days_left': int(product.get('days_left', 7)),
                    'weekday': product.get('weekday', datetime.now().strftime('%A')),
                    'season': product.get('season', 'Summer'),
                    # The regressor emits a point estimate with no interval, so
                    # there is no confidence to report.
                    'confidence_score': None,
                    'recommendation_reason': self.get_pricing_reason(
                        product, predicted_price, current_price
                    ),
                    'model_version': self.PRICING_VERSION,
                    'valid_until': (datetime.now() + timedelta(days=1)).strftime('%Y-%m-%d %H:%M:%S'),
                })

            return {
                'success': True,
                'recommendations': results,
                'total_recommendations': len(results),
                'method': 'xgboost',
                'is_trained_model': True,
            }

        except Exception as e:
            return {'success': False, 'error': str(e), 'recommendations': []}

    def prepare_pricing_features(self, product):
        """
        Build the feature vector in the exact order model_features.json declares.

        Derived from the spec rather than hardcoded lists, so retraining with new
        categories only requires regenerating that file. Note the spec omits
        weekday_Friday (dropped as the encoding baseline), so a Friday correctly
        produces all-zero weekday columns.
        """
        numeric = {
            'days_left': product.get('days_left', 7),
            'stock': product.get('stock_level', 100),
            'demand_score': product.get('demand_score', 50),
        }
        one_hot = {
            'category_': product.get('category', 'Dairy'),
            'season_': product.get('season', 'Summer'),
            'weekday_': product.get('weekday', 'Monday'),
        }

        vector = []
        for name in self.model_features:
            if name in numeric:
                vector.append(float(numeric[name]))
                continue

            for prefix, value in one_hot.items():
                if name.startswith(prefix):
                    vector.append(1.0 if name[len(prefix):] == value else 0.0)
                    break
            else:
                raise ValueError(f'Unrecognised feature in model_features.json: {name}')

        return vector

    def get_pricing_reason(self, product, predicted_price, current_price):
        """Generate reasoning for a price recommendation."""
        if predicted_price > current_price:
            if product.get('demand_score', 50) > 70:
                return 'High demand detected - price increase recommended'
            if product.get('stock_level', 100) < 50:
                return 'Low stock levels - price increase to manage demand'
            return 'Market conditions favor price increase'

        if predicted_price < current_price:
            if product.get('days_left', 7) <= 2:
                return 'Product nearing expiry - price reduction to clear stock'
            if product.get('stock_level', 100) > 200:
                return 'High inventory levels - price reduction to boost sales'
            return 'Market conditions favor price reduction'

        return 'Current price is optimal'


OPERATIONS = {
    'predict_demand': 'predict_demand',
    'predict_pricing': 'predict_pricing',
}


def read_input():
    """Read the JSON payload from stdin."""
    raw = sys.stdin.read().strip()
    if not raw:
        raise ValueError('No input data provided on stdin')
    return json.loads(raw)


def emit(payload):
    """Write the single JSON response line to stdout."""
    print(json.dumps(payload))
    sys.stdout.flush()


def main():
    """
    Always exits 0 once a well-formed JSON response has been written: the caller
    reads the `success` field to determine the outcome. A non-zero exit means the
    process died without producing a parseable response.
    """
    try:
        if len(sys.argv) < 2:
            emit({'success': False, 'error': 'No operation specified'})
            return 0

        operation = sys.argv[1]
        if operation not in OPERATIONS:
            emit({'success': False, 'error': f'Unknown operation: {operation}'})
            return 0

        log(f'Starting operation: {operation}')

        try:
            input_data = read_input()
        except (ValueError, json.JSONDecodeError) as e:
            emit({'success': False, 'error': 'Invalid input', 'message': str(e)})
            return 0

        service = SmartMandiModelService()
        emit(getattr(service, OPERATIONS[operation])(input_data))
        return 0

    except Exception as e:
        log(f'Unhandled exception: {e}')
        emit({'success': False, 'error': str(e), 'type': type(e).__name__})
        return 0


if __name__ == '__main__':
    sys.exit(main())
