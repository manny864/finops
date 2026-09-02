-- MEJ-33 paso 1: quién cambió el estado de una anomalía y cuándo.
--
-- `Anomalies.status` ya existía, pero nadie lo escribía: el dashboard cambiaba
-- el estado sólo en el `useState` del componente y no había endpoint PATCH. El
-- estado se veía en pantalla, se perdía al recargar y ningún otro usuario del
-- tenant se enteraba — que es peor que no tener el control, porque aparenta que
-- alguien tomó el desvío.
--
-- Sin estas dos columnas el estado sería anónimo: "Investigating" sin saber
-- quién lo tomó no cierra el lazo, sólo lo mueve de lugar.
ALTER TABLE Anomalies
    ADD COLUMN status_changed_by VARCHAR(320) NULL COMMENT 'MEJ-33: email de quien cambió el estado',
    ADD COLUMN status_changed_at DATETIME NULL COMMENT 'MEJ-33: cuándo se cambió';
