-- Atribución de causa raíz para anomalías de gasto: junto con la detección
-- (Z-Score sobre el costo total diario), ahora se calcula y persiste qué
-- resource group + servicio explican la mayor parte del delta vs. el
-- promedio esperado, para que la tarjeta de anomalía y la notificación no
-- solo digan "hubo un pico" sino "el pico lo generó X".
ALTER TABLE Anomalies
    ADD COLUMN top_contributors JSON NULL AFTER z_score;
