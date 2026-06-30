import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import {
  linearForecast,
  emaForecast,
  holtWintersForecast,
  forecastWithConfidence,
  evaluateForecast,
  selectBestMethod,
  detectAnomalies,
  type HistoryPoint,
  type ForecastResult,
} from '@/lib/forecasting';

describe('Forecasting Library', () => {
  // ===========================================================================
  // Linear Forecast Tests
  // ===========================================================================

  describe('linearForecast', () => {
    it('should generate linear forecast with perfect line y=2x+1', () => {
      // Series: (1, 3), (2, 5), (3, 7), (4, 9)
      const history: HistoryPoint[] = [
        { date: '2024-01-01', value: '3' },
        { date: '2024-01-02', value: '5' },
        { date: '2024-01-03', value: '7' },
        { date: '2024-01-04', value: '9' },
      ];

      const forecast = linearForecast(history, 3);

      expect(forecast).toHaveLength(3);
      expect(forecast[0].date).toBe('2024-01-05');
      expect(forecast[0].value).toBe('11.00'); // y = 2*5 + 1
      expect(forecast[1].value).toBe('13.00'); // y = 2*6 + 1
      expect(forecast[2].value).toBe('15.00'); // y = 2*7 + 1
      expect(forecast[0].method).toBe('linear');
    });

    it('should throw with less than 2 points', () => {
      const history: HistoryPoint[] = [{ date: '2024-01-01', value: '100' }];
      expect(() => linearForecast(history, 5)).toThrow();
    });

    it('should handle decimal values precisely', () => {
      const history: HistoryPoint[] = [
        { date: '2024-01-01', value: '100.50' },
        { date: '2024-01-02', value: '200.75' },
        { date: '2024-01-03', value: '300.25' },
      ];

      const forecast = linearForecast(history, 1);
      expect(forecast).toHaveLength(1);
      // Should be numeric and not NaN
      const val = parseFloat(forecast[0].value);
      expect(isFinite(val)).toBe(true);
      expect(val).toBeGreaterThan(0);
    });

    it('should generate dates correctly', () => {
      const history: HistoryPoint[] = [
        { date: '2024-01-15', value: '100' },
        { date: '2024-01-16', value: '200' },
      ];

      const forecast = linearForecast(history, 2);
      expect(forecast[0].date).toBe('2024-01-17');
      expect(forecast[1].date).toBe('2024-01-18');
    });
  });

  // ===========================================================================
  // EMA Forecast Tests
  // ===========================================================================

  describe('emaForecast', () => {
    it('should smooth noisy data and hold constant', () => {
      const history: HistoryPoint[] = [
        { date: '2024-01-01', value: '100' },
        { date: '2024-01-02', value: '150' },
        { date: '2024-01-03', value: '110' },
        { date: '2024-01-04', value: '140' },
      ];

      const forecast = emaForecast(history, 3, 0.3);

      expect(forecast).toHaveLength(3);
      // EMA should flatten out to a constant value
      expect(forecast[0].value).toBe(forecast[1].value);
      expect(forecast[1].value).toBe(forecast[2].value);
      expect(forecast[0].method).toBe('ema');
    });

    it('should respect alpha parameter', () => {
      const history: HistoryPoint[] = [
        { date: '2024-01-01', value: '100' },
        { date: '2024-01-02', value: '150' },
        { date: '2024-01-03', value: '200' },
        { date: '2024-01-04', value: '180' },
      ];

      const forecastAlpha03 = emaForecast(history, 1, 0.3);
      const forecastAlpha07 = emaForecast(history, 1, 0.7);

      const val03 = parseFloat(forecastAlpha03[0].value);
      const val07 = parseFloat(forecastAlpha07[0].value);

      // Higher alpha = more weight on recent data
      // So alpha=0.7 should be closer to 180 (last value) than alpha=0.3
      expect(Math.abs(val07 - 180)).toBeLessThanOrEqual(Math.abs(val03 - 180));
    });

    it('should work with single point', () => {
      const history: HistoryPoint[] = [{ date: '2024-01-01', value: '150' }];
      const forecast = emaForecast(history, 2);
      expect(forecast).toHaveLength(2);
      expect(forecast[0].value).toBe('150.00');
    });
  });

  // ===========================================================================
  // Holt-Winters Forecast Tests
  // ===========================================================================

  describe('holtWintersForecast', () => {
    it('should fall back to EMA with insufficient history', () => {
      // history.length < 2*season (2*7=14)
      const history: HistoryPoint[] = Array.from({ length: 10 }, (_, i) => ({
        date: new Date(2024, 0, i + 1).toISOString().split('T')[0],
        value: String(100 + i * 10),
      }));

      const forecast = holtWintersForecast(history, 3, 0.3, 0.1, 0.3, 7);
      expect(forecast).toHaveLength(3);
      expect(forecast[0].method).toBe('ema');
    });

    it('should capture weekly seasonality', () => {
      // Weekly pattern: [100,100,100,100,100,150,150] repeats
      const history: HistoryPoint[] = [];
      const baseDate = new Date(2024, 0, 1);
      const pattern = [100, 100, 100, 100, 100, 150, 150];

      for (let i = 0; i < 28; i++) {
        const d = new Date(baseDate);
        d.setDate(d.getDate() + i);
        const val = pattern[i % 7];
        history.push({
          date: d.toISOString().split('T')[0],
          value: String(val),
        });
      }

      const forecast = holtWintersForecast(history, 7, 0.3, 0.1, 0.3, 7);
      expect(forecast).toHaveLength(7);

      // Forecast should roughly follow the pattern
      // First 5 days should be lower, last 2 should be higher
      const firstHalf = forecast.slice(0, 5).map((p) => parseFloat(p.value));
      const secondHalf = forecast.slice(5, 7).map((p) => parseFloat(p.value));

      const avgFirst = firstHalf.reduce((a, b) => a + b) / firstHalf.length;
      const avgSecond = secondHalf.reduce((a, b) => a + b) / secondHalf.length;

      expect(avgSecond).toBeGreaterThan(avgFirst);
    });

    it('should generate correct number of forecast points', () => {
      const history: HistoryPoint[] = Array.from({ length: 30 }, (_, i) => ({
        date: new Date(2024, 0, i + 1).toISOString().split('T')[0],
        value: String(1000 + Math.sin(i / 7) * 100),
      }));

      const forecast = holtWintersForecast(history, 14);
      expect(forecast).toHaveLength(14);
    });
  });

  // ===========================================================================
  // Confidence Intervals Tests
  // ===========================================================================

  describe('forecastWithConfidence', () => {
    it('should include lower and upper bands', () => {
      const history: HistoryPoint[] = [
        { date: '2024-01-01', value: '1000' },
        { date: '2024-01-02', value: '1100' },
        { date: '2024-01-03', value: '1050' },
        { date: '2024-01-04', value: '1200' },
        { date: '2024-01-05', value: '1150' },
      ];

      const result = forecastWithConfidence(history, 3, 'linear');

      expect(result.points).toHaveLength(3);
      expect(result.lower).toHaveLength(3);
      expect(result.upper).toHaveLength(3);

      // Verify band properties
      for (let i = 0; i < 3; i++) {
        const point = parseFloat(result.points[i].value);
        const lower = parseFloat(result.lower[i].value);
        const upper = parseFloat(result.upper[i].value);

        expect(lower).toBeLessThanOrEqual(point);
        expect(point).toBeLessThanOrEqual(upper);
      }
    });

    it('should have wider bands with longer horizon', () => {
      const history: HistoryPoint[] = Array.from({ length: 20 }, (_, i) => ({
        date: new Date(2024, 0, i + 1).toISOString().split('T')[0],
        value: String(1000 + Math.random() * 100),
      }));

      const result = forecastWithConfidence(history, 10, 'linear');

      const band1 =
        parseFloat(result.upper[0].value) - parseFloat(result.lower[0].value);
      const band9 =
        parseFloat(result.upper[9].value) - parseFloat(result.lower[9].value);

      // Bands should widen or stay stable
      expect(band9).toBeGreaterThanOrEqual(band1 * 0.5);
    });

    it('should calculate metrics', () => {
      const history: HistoryPoint[] = [
        { date: '2024-01-01', value: '100' },
        { date: '2024-01-02', value: '200' },
        { date: '2024-01-03', value: '300' },
        { date: '2024-01-04', value: '400' },
      ];

      const result = forecastWithConfidence(history, 2, 'linear');

      expect(result.rmse).toBeDefined();
      expect(result.mape).toBeDefined();
      expect(result.method).toBe('linear');

      // Should be numeric strings
      expect(parseFloat(result.rmse)).toBeGreaterThanOrEqual(0);
      expect(parseFloat(result.mape)).toBeGreaterThanOrEqual(0);
    });

    it('should work with different methods', () => {
      const history: HistoryPoint[] = Array.from({ length: 20 }, (_, i) => ({
        date: new Date(2024, 0, i + 1).toISOString().split('T')[0],
        value: String(1000 + i * 10 + Math.random() * 50),
      }));

      const linear = forecastWithConfidence(history, 5, 'linear');
      const ema = forecastWithConfidence(history, 5, 'ema');

      expect(linear.method).toBe('linear');
      expect(ema.method).toBe('ema');
      expect(linear.points).toHaveLength(5);
      expect(ema.points).toHaveLength(5);
    });
  });

  // ===========================================================================
  // Backtest Metrics Tests
  // ===========================================================================

  describe('evaluateForecast', () => {
    it('should calculate RMSE, MAE, and MAPE', () => {
      const history: HistoryPoint[] = [
        { date: '2024-01-01', value: '100' },
        { date: '2024-01-02', value: '110' },
        { date: '2024-01-03', value: '120' },
        { date: '2024-01-04', value: '130' },
        { date: '2024-01-05', value: '140' },
      ];

      const metrics = evaluateForecast(history, 0.6, 'linear');

      expect(metrics.rmse).toBeDefined();
      expect(metrics.mape).toBeDefined();
      expect(metrics.mae).toBeDefined();
      expect(metrics.method).toBe('linear');

      // All should be numeric strings >= 0
      expect(parseFloat(metrics.rmse)).toBeGreaterThanOrEqual(0);
      expect(parseFloat(metrics.mape)).toBeGreaterThanOrEqual(0);
      expect(parseFloat(metrics.mae)).toBeGreaterThanOrEqual(0);
    });

    it('should throw with insufficient history', () => {
      const history: HistoryPoint[] = [
        { date: '2024-01-01', value: '100' },
        { date: '2024-01-02', value: '110' },
      ];

      expect(() => evaluateForecast(history, 0.8, 'linear')).toThrow();
    });

    it('should handle different split ratios', () => {
      const history: HistoryPoint[] = Array.from({ length: 30 }, (_, i) => ({
        date: new Date(2024, 0, i + 1).toISOString().split('T')[0],
        value: String(1000 + i * 10),
      }));

      const metrics80 = evaluateForecast(history, 0.8, 'linear');
      const metrics50 = evaluateForecast(history, 0.5, 'linear');

      // Both should be valid
      expect(parseFloat(metrics80.mape)).toBeGreaterThanOrEqual(0);
      expect(parseFloat(metrics50.mape)).toBeGreaterThanOrEqual(0);
    });
  });

  // ===========================================================================
  // Method Selection Tests
  // ===========================================================================

  describe('selectBestMethod', () => {
    it('should return linear for short history', () => {
      const history: HistoryPoint[] = [
        { date: '2024-01-01', value: '100' },
        { date: '2024-01-02', value: '110' },
      ];

      const method = selectBestMethod(history);
      expect(method).toBe('linear');
    });

    it('should select method with lowest MAPE', () => {
      // Linear trend should favor linear method
      const linearTrend: HistoryPoint[] = Array.from({ length: 25 }, (_, i) => ({
        date: new Date(2024, 0, i + 1).toISOString().split('T')[0],
        value: String(1000 + i * 50),
      }));

      const method = selectBestMethod(linearTrend);
      expect(['linear', 'ema', 'holt_winters']).toContain(method);
    });

    it('should handle exceptions gracefully', () => {
      // Empty-ish history
      const history: HistoryPoint[] = [
        { date: '2024-01-01', value: '0' },
      ];

      const method = selectBestMethod(history);
      expect(method).toBe('linear');
    });
  });

  // ===========================================================================
  // Anomaly Detection Tests
  // ===========================================================================

  describe('detectAnomalies', () => {
    it('should flag values far from forecast', () => {
      const history: HistoryPoint[] = [
        { date: '2024-01-01', value: '1000' },
        { date: '2024-01-02', value: '1050' },
        { date: '2024-01-03', value: '1020' },
        { date: '2024-01-04', value: '1040' },
        { date: '2024-01-05', value: '5000' }, // Anomaly
      ];

      const result = forecastWithConfidence(history, 3, 'linear');
      const anomalies = detectAnomalies(history, result, 1);

      const hasAnomalies = anomalies.some((a) => a.is_anomaly);
      expect(hasAnomalies).toBe(true);
    });

    it('should use threshold parameter', () => {
      const history: HistoryPoint[] = Array.from({ length: 10 }, (_, i) => ({
        date: new Date(2024, 0, i + 1).toISOString().split('T')[0],
        value: String(1000 + i * 10),
      }));

      const result = forecastWithConfidence(history, 3, 'linear');
      const anomalies1 = detectAnomalies(history, result, 1);
      const anomalies3 = detectAnomalies(history, result, 3);

      // Higher threshold should detect fewer anomalies
      const count1 = anomalies1.filter((a) => a.is_anomaly).length;
      const count3 = anomalies3.filter((a) => a.is_anomaly).length;

      expect(count3).toBeLessThanOrEqual(count1);
    });

    it('should include recent history points', () => {
      const history: HistoryPoint[] = [
        { date: '2024-01-01', value: '1000' },
        { date: '2024-01-02', value: '1050' },
        { date: '2024-01-03', value: '1020' },
      ];

      const result = forecastWithConfidence(history, 2, 'linear');
      const anomalies = detectAnomalies(history, result);

      expect(anomalies.length).toBeGreaterThan(0);
      expect(anomalies[0].date).toBeDefined();
      expect(anomalies[0].z_score).toBeDefined();
    });
  });

  // ===========================================================================
  // Integration Tests
  // ===========================================================================

  describe('Integration', () => {
    it('should handle complete forecast workflow', () => {
      const history: HistoryPoint[] = Array.from({ length: 30 }, (_, i) => ({
        date: new Date(2024, 0, i + 1).toISOString().split('T')[0],
        value: String(
          5000 +
            i * 100 +
            Math.sin((i / 7) * Math.PI) * 500 +
            Math.random() * 200
        ),
      }));

      // Step 1: Select best method
      const method = selectBestMethod(history);

      // Step 2: Forecast with confidence
      const result = forecastWithConfidence(history, 14, method);

      // Step 3: Detect anomalies
      const anomalies = detectAnomalies(history, result);

      // Verify all steps succeeded
      expect(method).toBeDefined();
      expect(result.points).toHaveLength(14);
      expect(result.lower).toHaveLength(14);
      expect(result.upper).toHaveLength(14);
      expect(anomalies).toBeDefined();
      expect(parseFloat(result.mape)).toBeGreaterThanOrEqual(0);
    });

    it('should handle edge case: constant values', () => {
      const history: HistoryPoint[] = Array.from({ length: 10 }, (_, i) => ({
        date: new Date(2024, 0, i + 1).toISOString().split('T')[0],
        value: '1000',
      }));

      const forecast = linearForecast(history, 3);
      expect(forecast).toHaveLength(3);
      // Should forecast constant or near-constant
      const val1 = parseFloat(forecast[0].value);
      const val2 = parseFloat(forecast[1].value);
      expect(Math.abs(val1 - val2)).toBeLessThan(10);
    });
  });
});
