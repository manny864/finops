-- Migración 20260823-001: Ampliar ENUM de ai_anomaly_sensitivity en Tenants a ('low','medium','high','strict')
-- Permite el nivel de sensibilidad 'strict' (Z-score 1.0) sin degradar a 'high'.

ALTER TABLE Tenants 
    MODIFY COLUMN ai_anomaly_sensitivity ENUM('low', 'medium', 'high', 'strict') DEFAULT 'medium';
