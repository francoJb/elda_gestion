ALTER TABLE ventas
    ADD COLUMN IF NOT EXISTS plan_ahorro_id INT NULL AFTER cliente_id;

ALTER TABLE ventas
    MODIFY metodo_pago ENUM(
        'Efectivo',
        'Transferencia',
        'Tarjeta',
        'QR',
        'Cuenta Corriente',
        'Cuotas',
        'Anticipos'
    ) NOT NULL;

CREATE TABLE IF NOT EXISTS anticipos_plan_aplicaciones (
    id INT AUTO_INCREMENT PRIMARY KEY,
    empresa_id INT NOT NULL,
    anticipo_id INT NOT NULL,
    venta_id INT NOT NULL,
    importe DECIMAL(12,2) NOT NULL,
    fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_aplicacion_anticipo (empresa_id, anticipo_id),
    FOREIGN KEY (empresa_id) REFERENCES empresas(id),
    FOREIGN KEY (anticipo_id) REFERENCES anticipos_plan(id),
    FOREIGN KEY (venta_id) REFERENCES ventas(id)
);

CREATE TABLE IF NOT EXISTS anticipos_plan_devoluciones (
    id INT AUTO_INCREMENT PRIMARY KEY,
    empresa_id INT NOT NULL,
    anticipo_id INT NOT NULL,
    importe DECIMAL(12,2) NOT NULL,
    medio_pago ENUM('Efectivo', 'Transferencia', 'Tarjeta', 'QR') NOT NULL,
    observaciones TEXT NULL,
    fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (empresa_id) REFERENCES empresas(id),
    FOREIGN KEY (anticipo_id) REFERENCES anticipos_plan(id)
);