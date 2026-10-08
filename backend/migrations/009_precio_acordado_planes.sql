ALTER TABLE planes_ahorro
    ADD COLUMN IF NOT EXISTS precio_acordado DECIMAL(12,2) NULL
    AFTER producto_id;