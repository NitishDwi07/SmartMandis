#!/usr/bin/env python3
"""
Train the demand forecasting model.

    python Model_for_Demand_Forecasting/train_demand_model.py

Reads Dataset_CSV_Files/demand_forecasting_data.csv (17,019 rows of daily
units_sold per product/city, 2024-06-01 to 2024-11-30) and writes:

    demand_model.pkl            fitted XGBRegressor
    demand_model_features.json  the exact feature order the model expects
    demand_model_metrics.json   held-out scores, so the claim is checkable

The split is chronological, not random: with time-series data a random split
leaks future information into training and reports a score the model cannot
reproduce in service. The last 30 days are held out.

Replaces autos_model.pkl, which was never a fitted estimator — it was a
(2, 166) object array of AutoTS model *names*, i.e. leaderboard metadata with
no predict() to call.
"""

import json
import os
import pickle

import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from xgboost import XGBRegressor

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(HERE)
CSV_PATH = os.path.join(PROJECT_ROOT, 'Dataset_CSV_Files', 'demand_forecasting_data.csv')

MODEL_PATH = os.path.join(HERE, 'demand_model.pkl')
QUANTILE_PATH = os.path.join(HERE, 'demand_model_quantiles.pkl')
FEATURES_PATH = os.path.join(HERE, 'demand_model_features.json')
METRICS_PATH = os.path.join(HERE, 'demand_model_metrics.json')

HOLD_OUT_DAYS = 30
TARGET = 'units_sold'

# Lower/upper quantiles for the prediction interval served alongside each
# point estimate. A point regressor carries no uncertainty of its own, so
# these are separate fits — an honest interval beats a fabricated confidence
# percentage.
QUANTILES = (0.1, 0.9)


def build_features(df, feature_names=None):
    """
    Turn raw rows into the model matrix.

    Kept in one place so training and serving cannot drift: modelService.py
    reads demand_model_features.json and fills the same columns by name.
    """
    date = pd.to_datetime(df['date'])

    out = pd.DataFrame(index=df.index)
    out['day_of_week'] = date.dt.dayofweek
    out['day_of_month'] = date.dt.day
    out['month'] = date.dt.month
    out['week_of_year'] = date.dt.isocalendar().week.astype(int)
    out['is_weekend'] = date.dt.dayofweek.isin([5, 6]).astype(int)
    out['is_holiday'] = (df['holiday'].fillna('None') != 'None').astype(int)

    # One-hot the categoricals. Column names carry the prefix so the serving
    # side can rebuild them from the feature spec alone.
    for prefix, column in (('product_', 'product_id'), ('category_', 'category'), ('city_', 'city')):
        dummies = pd.get_dummies(df[column].astype(str), prefix=prefix.rstrip('_'))
        out = pd.concat([out, dummies], axis=1)

    if feature_names is not None:
        # Align to the training column order, filling anything unseen with 0.
        out = out.reindex(columns=feature_names, fill_value=0)

    return out.astype(float)


def main():
    print(f'Reading {CSV_PATH}')
    df = pd.read_csv(CSV_PATH)
    df['date'] = pd.to_datetime(df['date'])
    df = df.sort_values('date').reset_index(drop=True)
    print(f'  {len(df):,} rows · {df["date"].min().date()} to {df["date"].max().date()}')

    cutoff = df['date'].max() - pd.Timedelta(days=HOLD_OUT_DAYS)
    train_df = df[df['date'] <= cutoff]
    test_df = df[df['date'] > cutoff]
    print(f'  train {len(train_df):,} rows (through {cutoff.date()}) · test {len(test_df):,} rows')

    X_train = build_features(train_df)
    feature_names = list(X_train.columns)
    X_test = build_features(test_df, feature_names)
    y_train = train_df[TARGET].values
    y_test = test_df[TARGET].values

    print(f'  {len(feature_names)} features')

    model = XGBRegressor(
        n_estimators=600,
        learning_rate=0.05,
        max_depth=6,
        subsample=0.9,
        colsample_bytree=0.9,
        min_child_weight=3,
        reg_lambda=1.0,
        objective='reg:squarederror',
        random_state=42,
        n_jobs=4
    )

    print('Training…')
    model.fit(X_train, y_train, eval_set=[(X_test, y_test)], verbose=False)

    pred = np.clip(model.predict(X_test), 0, None)

    # Baselines worth beating: the global mean, and the per product+city mean
    # (which is what a sensible non-ML heuristic would do).
    global_mean = float(y_train.mean())
    group_means = train_df.groupby(['product_id', 'city'])[TARGET].mean()
    group_baseline = test_df.apply(
        lambda r: group_means.get((r['product_id'], r['city']), global_mean), axis=1
    ).values

    def score(name, yhat):
        mae = mean_absolute_error(y_test, yhat)
        rmse = float(np.sqrt(mean_squared_error(y_test, yhat)))
        mape = float(np.mean(np.abs((y_test - yhat) / np.maximum(y_test, 1))) * 100)
        r2 = r2_score(y_test, yhat)
        print(f'  {name:<22} MAE {mae:6.2f}   RMSE {rmse:6.2f}   MAPE {mape:5.1f}%   R2 {r2:6.3f}')
        return {'mae': round(mae, 3), 'rmse': round(rmse, 3), 'mape': round(mape, 3), 'r2': round(r2, 4)}

    print('\nHeld-out performance (last %d days):' % HOLD_OUT_DAYS)
    metrics_model = score('XGBoost', pred)
    metrics_group = score('per product+city mean', group_baseline)
    metrics_global = score('global mean', np.full_like(y_test, global_mean, dtype=float))

    improvement = (1 - metrics_model['mae'] / metrics_group['mae']) * 100
    print(f'\n  MAE improvement over the per product+city mean: {improvement:.1f}%')

    # ---- prediction interval ------------------------------------------------
    print(f'\nFitting quantile models for the {int(QUANTILES[0]*100)}–{int(QUANTILES[1]*100)}% interval…')
    quantile_models = {}
    for q in QUANTILES:
        qm = XGBRegressor(
            objective='reg:quantileerror',
            quantile_alpha=q,
            n_estimators=400,
            learning_rate=0.05,
            max_depth=5,
            subsample=0.9,
            colsample_bytree=0.9,
            random_state=42,
            n_jobs=4
        )
        qm.fit(X_train, y_train, verbose=False)
        quantile_models[str(q)] = qm

    lo = np.clip(quantile_models[str(QUANTILES[0])].predict(X_test), 0, None)
    hi = np.clip(quantile_models[str(QUANTILES[1])].predict(X_test), 0, None)

    # Does the interval actually contain the truth as often as it claims?
    coverage = float(np.mean((y_test >= lo) & (y_test <= hi)) * 100)
    width = float(np.mean(hi - lo))
    nominal = (QUANTILES[1] - QUANTILES[0]) * 100
    print(f'  empirical coverage {coverage:.1f}%  (nominal {nominal:.0f}%)   mean width {width:.1f} units')

    with open(MODEL_PATH, 'wb') as f:
        pickle.dump(model, f)
    with open(QUANTILE_PATH, 'wb') as f:
        pickle.dump(quantile_models, f)
    with open(FEATURES_PATH, 'w') as f:
        json.dump(feature_names, f, indent=1)
    with open(METRICS_PATH, 'w') as f:
        json.dump({
            'trained_on': str(pd.Timestamp.now().date()),
            'rows_total': int(len(df)),
            'rows_train': int(len(train_df)),
            'rows_test': int(len(test_df)),
            'holdout_days': HOLD_OUT_DAYS,
            'split_cutoff': str(cutoff.date()),
            'n_features': len(feature_names),
            'model': metrics_model,
            'baseline_group_mean': metrics_group,
            'baseline_global_mean': metrics_global,
            'mae_improvement_pct_vs_group_mean': round(improvement, 2),
            'interval': {
                'quantiles': list(QUANTILES),
                'nominal_coverage_pct': nominal,
                'empirical_coverage_pct': round(coverage, 2),
                'mean_width_units': round(width, 2)
            }
        }, f, indent=2)

    print(f'\nWrote:\n  {MODEL_PATH}\n  {QUANTILE_PATH}\n  {FEATURES_PATH}\n  {METRICS_PATH}')


if __name__ == '__main__':
    main()
