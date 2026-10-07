CREATE TABLE IF NOT EXISTS devoluciones_plan_operaciones (
    id INT AUTO_INCREMENT PRIMARY KEY,
    empresa_id INT NOT NULL,
    plan_id INT NOT NULL,
    importe_total DECIMAL(12,2) NOT NULL,
    medio_pago ENUM('Efectivo', 'Transferencia', 'Tarjeta', 'QR') NOT NULL,
    observaciones TEXT NULL,
    cancela_plan TINYINT(1) NOT NULL DEFAULT 0,
    fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_devoluciones_operacion_plan (empresa_id, plan_id),
    FOREIGN KEY (empresa_id) REFERENCES empresas(id),
    FOREIGN KEY (plan_id) REFERENCES planes_ahorro(id)
);

ALTER TABLE anticipos_plan_devoluciones
    ADD COLUMN IF NOT EXISTS operacion_id INT NULL;