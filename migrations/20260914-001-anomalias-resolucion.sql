-- Las dos columnas que la API de anomalías lee y escribe, y que nunca existieron.
--
-- `/api/analytics/anomalies` selecciona `resolved_at` y `resolution_notes` desde
-- `Anomalies` y las escribe al marcar una anomalía como resuelta. La tabla no
-- las tiene: las migraciones de MEJ-33 agregaron `status_changed_by/at` y las de
-- asignación `assigned_*`, pero estas dos quedaron sólo en el código.
--
-- Cómo se veía en producción, y por qué nadie lo notó: el SELECT muere con
--     Unknown column 'resolved_at' in 'field list'
-- dentro de un try que loguea "[API Anomalies] Live assembly error" y cae al
-- fallback. La pantalla muestra datos, así que parece funcionar -- pero NUNCA
-- son los reales, y el UPDATE de resolución tampoco persiste: el usuario marca
-- una anomalía como resuelta, la app responde `success: true` y no se guarda
-- nada.
--
-- `resolved_at` es DATETIME NULL porque una anomalía abierta no tiene fecha de
-- resolución, y `resolution_notes` TEXT porque es prosa de quien la cerró.
ALTER TABLE Anomalies
  ADD COLUMN resolved_at DATETIME NULL COMMENT 'Cuándo se cerró la anomalía (NULL = abierta)',
  ADD COLUMN resolution_notes TEXT NULL COMMENT 'Qué se hizo para cerrarla';
