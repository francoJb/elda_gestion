CREATE TABLE IF NOT EXISTS planes_ahorro (
    id INT AUTO_INCREMENT PRIMARY KEY,
    empresa_id INT NOT NULL,
    cliente_id INT NOT NULL,
    producto_id INT NOT NULL,
    estado ENUM('Activo', 'Adjudicado', 'Cancelado') NOT NULL DEFAULT 'Activo',
    observaciones TEXT NULL,
    fecha_creacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_planes_empresa_estado (empresa_id, estado),
    FOREIGN KEY (empresa_id) REFERENCES empresas(id),
    FOREIGN KEY (cliente_id) REFERENCES clientes(id),
    FOREIGN KEY (producto_id) REFERENCES productos(id)
);

CREATE TABLE IF NOT EXISTS anticipos_plan (
    id INT AUTO_INCREMENT PRIMARY KEY,
    empresa_id INT NOT NULL,
    plan_id INT NOT NULL,
    importe DECIMAL(12,2) NOT NULL,
    medio_pago ENUM('Efectivo', 'Transferencia', 'Tarjeta', 'QR') NOT NULL,
    estado ENUM('Confirmado', 'Anulado') NOT NULL DEFAULT 'Confirmado',
    fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    observaciones TEXT NULL,
    INDEX idx_anticipos_empresa_plan (empresa_id, plan_id),
    FOREIGN KEY (empresa_id) REFERENCES empresas(id),
    FOREIGN KEY (plan_id) REFERENCES planes_ahorro(id)
);