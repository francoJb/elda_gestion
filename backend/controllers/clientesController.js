const db = require('../database/database');
const { formatearFechaHoraArgentina, ahoraArgentinaDate } = require('../utils/time');
const { logAction } = require('../utils/audit');


exports.obtenerClientes = async (req, res) => {
    try {
        const empresaId = req.empresaId;
        const estado = req.query.estado === 'eliminados' ? 0 : 1;
        const [rows] = await db.query(
            "SELECT * FROM clientes WHERE empresa_id = ? AND estado = ? ORDER BY nombre, apellido",
            [empresaId, estado]
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.crearCliente = async (req, res) => {
    const p = req.body;
    
    if (!p.nombre?.trim() || !p.apellido?.trim() || !p.dni?.trim()) {
        return res.status(400).json({ error: "Nombre, apellido y DNI son obligatorios" });
    }

    const sql = `INSERT INTO clientes (empresa_id, nombre, apellido, telefono, direccion, dni, cuit, arca, email, habilitar_cc, estado)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`;
    const cuitLimpio = (p.cuit || "").trim();
    const cuitParaGuardar = cuitLimpio === "" ? null : cuitLimpio;             
    const params = [req.empresaId, p.nombre, p.apellido, p.telefono, p.direccion, p.dni, cuitParaGuardar, p.arca, p.email, p.habilitar_cc ? 1 : 0];

    try {
        const [result] = await db.query(sql, params);
        // En MySQL el ID generado está en result.insertId
        res.status(201).json({ id: result.insertId, ...p });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            const mensaje = (err.sqlMessage || err.message || '').toLowerCase();

            if (mensaje.includes('dni')) {
                const [clientesBorrados] = await db.query(
                    `SELECT id, nombre, apellido
                    FROM clientes
                    WHERE empresa_id = ? AND dni = ? AND estado = 0
                    LIMIT 1`,
                    [req.empresaId, p.dni.trim()]
                );

                if (clientesBorrados.length > 0) {
                    return res.status(409).json({
                        codigo: 'DNI_PERTENECE_A_CLIENTE_BORRADO',
                        cliente_id: clientesBorrados[0].id,
                        nombre: clientesBorrados[0].nombre,
                        apellido: clientesBorrados[0].apellido,
                        error: 'El DNI pertenece a un cliente borrado.'
                    });
                }

                return res.status(400).json({ error: 'El DNI ya está registrado.' });
            }

            if (mensaje.includes('cuit') || mensaje.includes('cuil')) {
                return res.status(400).json({ error: 'El CUIT/CUIL ya está registrado.' });
            }

            return res.status(400).json({ error: 'DNI o CUIT ya registrado.' });
        }
        // MySQL usa ENUM, si el valor no coincide daría error aquí
        if (err.code === 'ER_WARN_DATA_TRUNCATED') {
            return res.status(400).json({ error: "Condición fiscal inválida" });
        }
        res.status(500).json({ error: err.message });
    }
};

exports.editarCliente = async (req, res) => {
    const { id } = req.params;
    const empresaId = req.empresaId;
    const p = req.body;

    if (!p.nombre?.trim() || !p.apellido?.trim() || !p.dni?.trim()) {
        return res.status(400).json({ error: "Datos inválidos" });
    }

    const sql = `UPDATE clientes SET nombre=?, apellido=?, telefono=?, direccion=?, dni=?, cuit=?, arca=?, email=?, habilitar_cc=? WHERE empresa_id=? AND id=? AND estado = 1`;
    const cuitLimpio = (p.cuit || "").trim();
    const cuitParaGuardar = cuitLimpio === "" ? null : cuitLimpio;
    const params = [p.nombre, p.apellido, p.telefono, p.direccion, p.dni, cuitParaGuardar, p.arca, p.email, p.habilitar_cc ? 1 : 0, empresaId, id];

    try {
        const [result] = await db.query(sql, params);
        // En MySQL los cambios están en result.affectedRows
        if (result.affectedRows === 0) {
            return res.status(404).json({ mensaje: "Cliente no encontrado" });
        }
        res.json({ mensaje: "Actualizado", cambios: result.affectedRows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.eliminarCliente = async (req, res) => {
    const id = Number(req.params.id);
    const empresaId = req.empresaId;

    if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'El cliente indicado no es válido.' });
    }

    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        const [result] = await connection.query(
            `UPDATE clientes
             SET estado = 0, deleted_at = NOW(), deleted_by = ?
             WHERE empresa_id = ? AND id = ? AND estado = 1`,
            [req.usuarioId || null, empresaId, id]
        );

        if (result.affectedRows === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Cliente no encontrado o ya borrado.' });
        }

        await logAction(connection, {
            empresaId,
            usuarioId: req.usuarioId || null,
            accion: 'soft_delete_permanent',
            entidad: 'clientes',
            entidadId: id,
            descripcion: 'Cliente borrado desde la aplicación. Ventas y registros históricos conservados.'
        });

        await connection.commit();

        res.json({
            mensaje: 'Cliente borrado correctamente. Las ventas se conservaron.',
            id
        });
    } catch (err) {
        await connection.rollback();
        console.error('Error al borrar cliente:', err);
        res.status(500).json({ error: 'No se pudo borrar el cliente.' });
    } finally {
        connection.release();
    }
};

exports.reactivarCliente = async (req, res) => {
    const id = Number(req.params.id);
    const empresaId = req.empresaId;
    const p = req.body;

    if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'El cliente indicado no es válido.' });
    }

    if (!p.nombre?.trim() || !p.apellido?.trim() || !p.dni?.trim()) {
        return res.status(400).json({ error: 'Nombre, apellido y DNI son obligatorios.' });
    }

    const cuitLimpio = (p.cuit || '').trim();
    const cuit = cuitLimpio === '' ? null : cuitLimpio;
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        const [resultado] = await connection.query(
            `UPDATE clientes
             SET nombre = ?, apellido = ?, telefono = ?, direccion = ?, dni = ?,
                 cuit = ?, arca = ?, email = ?, habilitar_cc = ?,
                 estado = 1, deleted_at = NULL, deleted_by = NULL
             WHERE empresa_id = ? AND id = ? AND estado = 0`,
            [
                p.nombre.trim(),
                p.apellido.trim(),
                p.telefono || '',
                p.direccion || '',
                p.dni.trim(),
                cuit,
                p.arca || null,
                p.email || '',
                p.habilitar_cc ? 1 : 0,
                empresaId,
                id
            ]
        );

        if (resultado.affectedRows === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'No se encontró el cliente borrado.' });
        }

        await logAction(connection, {
            empresaId,
            usuarioId: req.usuarioId || null,
            accion: 'reactivate_by_dni',
            entidad: 'clientes',
            entidadId: id,
            descripcion: 'Cliente reactivado al intentar registrar nuevamente su DNI. Historial conservado.'
        });

        await connection.commit();
        res.json({ mensaje: 'Cliente reactivado correctamente.', id });
    } catch (error) {
        await connection.rollback();
        console.error('Error al reactivar cliente:', error);

        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({
                error: 'El CUIT/CUIL ingresado ya está registrado en otro cliente.'
            });
        }

        res.status(500).json({ error: 'No se pudo reactivar el cliente.' });
    } finally {
        connection.release();
    }
};

exports.obtenerCuentaCorriente = async (req, res) => {
    const { id } = req.params;
    try {
        const empresaId = req.empresaId;
        
        // CONSULTA MEJORADA: Usamos alias 'cc' y 'v' para evitar conflictos de columnas duplicadas
        const [rows] = await db.query(`
            SELECT 
                cc.id, 
                cc.fecha, 
                cc.descripcion, 
                cc.venta_id, 
                cc.debe, 
                cc.haber, 
                cc.saldo_acumulado,
                cc.observaciones,
                v.numero AS factura_numero -- <--- Traemos el número real de la factura
            FROM cuenta_corriente cc
            LEFT JOIN ventas v ON v.id = cc.venta_id AND v.empresa_id = cc.empresa_id
            WHERE cc.empresa_id = ? AND cc.cliente_id = ? AND cc.estado = 1
            ORDER BY cc.fecha DESC`, 
        [empresaId, id]);

        // También traemos el saldo total actual para mostrarlo arriba
        const [saldoTotal] = await db.query(
            "SELECT IFNULL(SUM(debe - haber), 0) as total FROM cuenta_corriente WHERE cliente_id = ? AND empresa_id = ? AND estado = 1",
            [id, empresaId]
        );

        res.json({
            movimientos: rows,
            saldoTotal: saldoTotal[0].total
        });
    } catch (error) {
        console.error("Error en obtenerCuentaCorriente:", error.message);
        res.status(500).json({ error: error.message });
    }
};
