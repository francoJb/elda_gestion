const db = require('../database/database');

const MEDIOS_PAGO = ['Efectivo', 'Transferencia', 'Tarjeta', 'QR'];

exports.obtenerHistorialPlanes = async (req, res) => {
    try {
        const empresaId = req.empresaId;

        const [planes] = await db.query(
            `SELECT
                pa.id AS plan_id,
                pa.estado,
                pa.fecha_creacion,
                CONCAT(c.nombre, ' ', c.apellido) AS cliente,
                p.descripcion AS producto,
                COALESCE((
                    SELECT SUM(ap.importe)
                    FROM anticipos_plan ap
                    WHERE ap.empresa_id = pa.empresa_id
                      AND ap.plan_id = pa.id
                      AND ap.estado = 'Confirmado'
                ), 0) AS total_recibido,
                COALESCE((
                    SELECT SUM(d.importe)
                    FROM anticipos_plan ap
                    JOIN anticipos_plan_devoluciones d
                      ON d.empresa_id = ap.empresa_id
                     AND d.anticipo_id = ap.id
                    WHERE ap.empresa_id = pa.empresa_id
                      AND ap.plan_id = pa.id
                      AND ap.estado = 'Confirmado'
                ), 0) AS total_devuelto,
                COALESCE((
                    SELECT SUM(a.importe)
                    FROM anticipos_plan ap
                    JOIN anticipos_plan_aplicaciones a
                      ON a.empresa_id = ap.empresa_id
                     AND a.anticipo_id = ap.id
                    WHERE ap.empresa_id = pa.empresa_id
                      AND ap.plan_id = pa.id
                      AND ap.estado = 'Confirmado'
                ), 0) AS total_aplicado
             FROM planes_ahorro pa
             JOIN clientes c
               ON c.id = pa.cliente_id
              AND c.empresa_id = pa.empresa_id
             JOIN productos p
               ON p.id = pa.producto_id
              AND p.empresa_id = pa.empresa_id
             WHERE pa.empresa_id = ?
             ORDER BY pa.fecha_creacion DESC`,
            [empresaId]
        );

        res.json(planes.map(plan => ({
            ...plan,
            saldo_disponible:
                Number(plan.total_recibido) -
                Number(plan.total_devuelto) -
                Number(plan.total_aplicado)
        })));
    } catch (error) {
        console.error('Error al obtener historial de planes:', error);
        res.status(500).json({ error: 'No se pudo cargar el historial de planes.' });
    }
};

exports.obtenerPlanesActivos = async (req, res) => {
    try {
        const empresaId = req.empresaId;

        const [planes] = await db.query(
            `SELECT
                pa.id AS plan_id,
                pa.fecha_creacion,
                pa.producto_id,
                CONCAT(c.nombre, ' ', c.apellido) AS cliente,
                p.descripcion AS producto,
                p.precio_neto AS precio_actual,
                (
                    COALESCE(
                        (
                            SELECT SUM(ap.importe)
                            FROM anticipos_plan ap
                            WHERE ap.empresa_id = pa.empresa_id
                            AND ap.plan_id = pa.id
                            AND ap.estado = 'Confirmado'
                        ),
                        0
                    )
                    -
                    COALESCE(
                        (
                            SELECT SUM(d.importe)
                            FROM anticipos_plan ap
                            JOIN anticipos_plan_devoluciones d
                            ON d.empresa_id = ap.empresa_id
                            AND d.anticipo_id = ap.id
                            WHERE ap.empresa_id = pa.empresa_id
                            AND ap.plan_id = pa.id
                            AND ap.estado = 'Confirmado'
                        ),
                        0
                    )
                    -
                    COALESCE(
                        (
                            SELECT SUM(a.importe)
                            FROM anticipos_plan ap
                            JOIN anticipos_plan_aplicaciones a
                            ON a.empresa_id = ap.empresa_id
                            AND a.anticipo_id = ap.id
                            WHERE ap.empresa_id = pa.empresa_id
                            AND ap.plan_id = pa.id
                            AND ap.estado = 'Confirmado'
                        ),
                        0
                    )
                ) AS saldo_a_favor
             FROM planes_ahorro pa
             JOIN clientes c
               ON c.id = pa.cliente_id
              AND c.empresa_id = pa.empresa_id
             JOIN productos p
               ON p.id = pa.producto_id
              AND p.empresa_id = pa.empresa_id
             WHERE pa.empresa_id = ?
               AND pa.estado = 'Activo'
             ORDER BY pa.fecha_creacion DESC`,
            [empresaId]
        );

        res.json(planes);
    } catch (error) {
        console.error('Error al obtener planes de ahorro activos:', error);
        res.status(500).json({ error: 'No se pudieron cargar los planes de ahorro.' });
    }
};

exports.crearPlanAhorro = async (req, res) => {
    const empresaId = req.empresaId;
    const clienteId = Number(req.body.cliente_id);
    const productoId = Number(req.body.producto_id);
    const importeInicial = Number(req.body.anticipo_inicial || 0);
    const medioPago = req.body.medio_pago || null;
    const observaciones = req.body.observaciones || null;

    if (!Number.isInteger(clienteId) || clienteId <= 0) {
        return res.status(400).json({ error: 'Seleccioná un cliente registrado.' });
    }

    if (!Number.isInteger(productoId) || productoId <= 0) {
        return res.status(400).json({ error: 'Seleccioná un modelo de moto.' });
    }

    if (!Number.isFinite(importeInicial) || importeInicial < 0) {
        return res.status(400).json({ error: 'El anticipo no puede ser negativo.' });
    }

    if (importeInicial > 0 && !MEDIOS_PAGO.includes(medioPago)) {
        return res.status(400).json({ error: 'Seleccioná un medio de pago válido.' });
    }

    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        const [clientes] = await connection.query(
            `SELECT id
             FROM clientes
             WHERE empresa_id = ? AND id = ? AND estado = 1`,
            [empresaId, clienteId]
        );

        if (clientes.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'No se encontró el cliente.' });
        }

        // Acepta productos marcados como vehículo o asignados a una categoría VEHICULO.
        const [productos] = await connection.query(
            `SELECT p.id
             FROM productos p
             LEFT JOIN categorias c
               ON c.id = p.categoria_id AND c.empresa_id = p.empresa_id
             WHERE p.empresa_id = ?
               AND p.id = ?
               AND p.estado = 1
               AND (
                   COALESCE(p.vehiculo_tipo, '') <> ''
                   OR UPPER(c.nombre) LIKE 'VEHICULO%'
               )`,
            [empresaId, productoId]
        );

        if (productos.length === 0) {
            await connection.rollback();
            return res.status(400).json({ error: 'El producto seleccionado no está configurado como vehículo.' });
        }

        const [planResult] = await connection.query(
            `INSERT INTO planes_ahorro
                (empresa_id, cliente_id, producto_id, estado, observaciones)
             VALUES (?, ?, ?, 'Activo', ?)`,
            [empresaId, clienteId, productoId, observaciones]
        );

        let anticipoId = null;
        let comprobante = null;

        if (importeInicial > 0) {
            const [anticipoResult] = await connection.query(
                `INSERT INTO anticipos_plan
                    (empresa_id, plan_id, importe, medio_pago, observaciones)
                 VALUES (?, ?, ?, ?, ?)`,
                [empresaId, planResult.insertId, importeInicial, medioPago, 'Anticipo inicial']
            );

            anticipoId = anticipoResult.insertId;

            const [comprobanteRows] = await connection.query(
                `SELECT
                    ap.id AS anticipo_id,
                    ap.plan_id,
                    ap.importe,
                    ap.medio_pago,
                    ap.fecha,
                    CONCAT(c.nombre, ' ', c.apellido) AS cliente,
                    c.dni,
                    c.cuit,
                    c.direccion,
                    p.descripcion AS producto
                FROM anticipos_plan ap
                JOIN planes_ahorro pa
                ON pa.id = ap.plan_id AND pa.empresa_id = ap.empresa_id
                JOIN clientes c
                ON c.id = pa.cliente_id AND c.empresa_id = pa.empresa_id
                JOIN productos p
                ON p.id = pa.producto_id AND p.empresa_id = pa.empresa_id
                WHERE ap.empresa_id = ? AND ap.id = ?`,
                [empresaId, anticipoId]
            );

           comprobante = comprobanteRows[0];
        }

        await connection.commit();

        if (comprobante) {
            comprobante.saldo_acumulado = importeInicial;
        }

        res.status(201).json({
            mensaje: 'Plan de ahorro creado correctamente.',
            plan_id: planResult.insertId,
            anticipo_id: anticipoId,
            saldo_a_favor: importeInicial,
            comprobante
        });


    } catch (error) {
        await connection.rollback();
        console.error('Error al crear plan de ahorro:', error);
        res.status(500).json({ error: 'No se pudo crear el plan de ahorro.' });
    } finally {
        connection.release();
    }
};

exports.registrarAnticipo = async (req, res) => {
    const empresaId = req.empresaId;
    const planId = Number(req.params.id);
    const importe = Number(req.body.importe);
    const medioPago = req.body.medio_pago;
    const observaciones = req.body.observaciones || null;

    if (!Number.isInteger(planId) || planId <= 0) {
        return res.status(400).json({ error: 'El plan indicado no es válido.' });
    }

    if (!Number.isFinite(importe) || importe <= 0) {
        return res.status(400).json({ error: 'El importe debe ser mayor a cero.' });
    }

    if (!MEDIOS_PAGO.includes(medioPago)) {
        return res.status(400).json({ error: 'Seleccioná un medio de pago válido.' });
    }

    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        const [planes] = await connection.query(
            `SELECT id, estado
             FROM planes_ahorro
             WHERE empresa_id = ? AND id = ?
             FOR UPDATE`,
            [empresaId, planId]
        );

        if (planes.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'No se encontró el plan de ahorro.' });
        }

        if (planes[0].estado !== 'Activo') {
            await connection.rollback();
            return res.status(409).json({ error: 'El plan ya no está activo y no acepta anticipos.' });
        }

        const [anticipoResult] = await connection.query(
            `INSERT INTO anticipos_plan
                (empresa_id, plan_id, importe, medio_pago, observaciones)
             VALUES (?, ?, ?, ?, ?)`,
            [empresaId, planId, importe, medioPago, observaciones]
        );

        const [saldoRows] = await connection.query(
            `SELECT COALESCE(SUM(importe), 0) AS saldo
             FROM anticipos_plan
             WHERE empresa_id = ?
               AND plan_id = ?
               AND estado = 'Confirmado'`,
            [empresaId, planId]
        );

        const [comprobanteRows] = await connection.query(
            `SELECT
                ap.id AS anticipo_id,
                ap.plan_id,
                ap.importe,
                ap.medio_pago,
                ap.fecha,
                CONCAT(c.nombre, ' ', c.apellido) AS cliente,
                c.dni,
                c.cuit,
                c.direccion,
                p.descripcion AS producto
            FROM anticipos_plan ap
            JOIN planes_ahorro pa
            ON pa.id = ap.plan_id AND pa.empresa_id = ap.empresa_id
            JOIN clientes c
            ON c.id = pa.cliente_id AND c.empresa_id = pa.empresa_id
            JOIN productos p
            ON p.id = pa.producto_id AND p.empresa_id = pa.empresa_id
            WHERE ap.empresa_id = ? AND ap.id = ?`,
            [empresaId, anticipoResult.insertId]
        );

        const comprobante = comprobanteRows[0];
        comprobante.saldo_acumulado = Number(saldoRows[0].saldo);
        await connection.commit();

        res.status(201).json({
            comprobante: comprobante,
            mensaje: 'Anticipo registrado correctamente.',
            anticipo_id: anticipoResult.insertId,
            saldo_a_favor: Number(saldoRows[0].saldo)
        });
    } catch (error) {
        await connection.rollback();
        console.error('Error al registrar anticipo:', error);
        res.status(500).json({ error: 'No se pudo registrar el anticipo.' });
    } finally {
        connection.release();
    }
};

exports.registrarDevolucionPlan = async (req, res) => {
    const empresaId = req.empresaId;
    const planId = Number(req.params.id);
    const importe = Number(req.body.importe);
    const medioPago = req.body.medio_pago;
    const observaciones = req.body.observaciones || null;
    const cancelarPlan = req.body.cancelar_plan === true;

    if (!Number.isInteger(planId) || planId <= 0) {
        return res.status(400).json({ error: 'El plan indicado no es válido.' });
    }

    if (!Number.isFinite(importe) || importe < 0) {
        return res.status(400).json({ error: 'El importe de la devolución no puede ser negativo.' });
    }

    if (!cancelarPlan && importe <= 0) {
        return res.status(400).json({ error: 'La devolución debe ser mayor que cero.' });
    }

    if (importe > 0 && !MEDIOS_PAGO.includes(medioPago)) {
        return res.status(400).json({ error: 'Seleccioná un medio de pago válido.' });
    }

    const importeCentavos = Math.round(importe * 100);

    if (!Number.isSafeInteger(importeCentavos)) {
        return res.status(400).json({ error: 'El importe de la devolución no es válido.' });
    }

    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        // Bloquea el plan para evitar que otra operación agregue pagos al mismo tiempo.
        const [planes] = await connection.query(
            `SELECT id, estado
             FROM planes_ahorro
             WHERE empresa_id = ? AND id = ?
             FOR UPDATE`,
            [empresaId, planId]
        );

        if (planes.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'No se encontró el plan de ahorro.' });
        }

        if (planes[0].estado !== 'Activo') {
            await connection.rollback();
            return res.status(409).json({ error: 'Solo se pueden devolver anticipos de un plan activo.' });
        }

        // Calcula cuánto queda disponible de cada anticipo, descontando devoluciones y aplicaciones.
        const [anticipos] = await connection.query(
            `SELECT
                ap.id,
                ap.importe,
                COALESCE(
                    (
                        SELECT SUM(d.importe)
                        FROM anticipos_plan_devoluciones d
                        WHERE d.empresa_id = ap.empresa_id
                          AND d.anticipo_id = ap.id
                    ),
                    0
                ) AS devuelto,
                COALESCE(
                    (
                        SELECT SUM(a.importe)
                        FROM anticipos_plan_aplicaciones a
                        WHERE a.empresa_id = ap.empresa_id
                          AND a.anticipo_id = ap.id
                    ),
                    0
                ) AS aplicado
             FROM anticipos_plan ap
             WHERE ap.empresa_id = ?
               AND ap.plan_id = ?
               AND ap.estado = 'Confirmado'
             ORDER BY ap.id
             FOR UPDATE`,
            [empresaId, planId]
        );

        const anticiposDisponibles = anticipos.map(anticipo => {
            const recibidoCentavos = Math.round(Number(anticipo.importe) * 100);
            const devueltoCentavos = Math.round(Number(anticipo.devuelto) * 100);
            const aplicadoCentavos = Math.round(Number(anticipo.aplicado) * 100);

            return {
                id: anticipo.id,
                disponibleCentavos: Math.max(
                    0,
                    recibidoCentavos - devueltoCentavos - aplicadoCentavos
                ),
                aplicadoCentavos
            };
        });

        const totalDisponibleCentavos = anticiposDisponibles.reduce(
            (total, anticipo) => total + anticipo.disponibleCentavos,
            0
        );

        const totalAplicadoCentavos = anticiposDisponibles.reduce(
            (total, anticipo) => total + anticipo.aplicadoCentavos,
            0
        );

        if (importeCentavos > totalDisponibleCentavos) {
            await connection.rollback();
            return res.status(409).json({
                error: 'La devolución supera el saldo disponible del plan.'
            });
        }

        if (cancelarPlan) {
            if (totalAplicadoCentavos > 0) {
                await connection.rollback();
                return res.status(409).json({
                    error: 'No se puede cancelar el plan porque ya tiene anticipos aplicados a una venta.'
                });
            }

            if (importeCentavos !== totalDisponibleCentavos) {
                await connection.rollback();
                return res.status(409).json({
                    error: 'Para cancelar el plan, la devolución debe cubrir todo el saldo disponible.'
                });
            }
        }
        const [operacionResult] = await connection.query(
            `INSERT INTO devoluciones_plan_operaciones
                (empresa_id, plan_id, importe_total, medio_pago, observaciones, cancela_plan)
            VALUES (?, ?, ?, ?, ?, ?)`,
            [
                empresaId,
                planId,
                importeCentavos / 100,
                medioPago,
                observaciones,
                cancelarPlan ? 1 : 0
            ]
        );

        const operacionId = operacionResult.insertId;

        // Distribuye la devolución entre los anticipos más antiguos primero.
        let restanteCentavos = importeCentavos;

        for (const anticipo of anticiposDisponibles) {
            if (restanteCentavos <= 0) break;

            const devolverCentavos = Math.min(
                restanteCentavos,
                anticipo.disponibleCentavos
            );

            if (devolverCentavos <= 0) continue;

            await connection.query(
                `INSERT INTO anticipos_plan_devoluciones
                    (empresa_id, anticipo_id, importe, medio_pago, observaciones, operacion_id)
                VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    empresaId,
                    anticipo.id,
                    devolverCentavos / 100,
                    medioPago,
                    observaciones,
                    operacionId
                ]
            );

            restanteCentavos -= devolverCentavos;
        }

        if (cancelarPlan) {
            await connection.query(
                `UPDATE planes_ahorro
                 SET estado = 'Cancelado'
                 WHERE empresa_id = ? AND id = ? AND estado = 'Activo'`,
                [empresaId, planId]
            );
        }

        const [comprobanteRows] = await connection.query(
            `SELECT
                dpo.id AS devolucion_id,
                dpo.plan_id,
                dpo.importe_total,
                dpo.medio_pago,
                dpo.observaciones,
                dpo.cancela_plan,
                dpo.fecha,
                CONCAT(c.nombre, ' ', c.apellido) AS cliente,
                c.dni,
                c.cuit,
                c.direccion,
                p.descripcion AS producto
            FROM devoluciones_plan_operaciones dpo
            JOIN planes_ahorro pa
            ON pa.id = dpo.plan_id AND pa.empresa_id = dpo.empresa_id
            JOIN clientes c
            ON c.id = pa.cliente_id AND c.empresa_id = pa.empresa_id
            JOIN productos p
            ON p.id = pa.producto_id AND p.empresa_id = pa.empresa_id
            WHERE dpo.empresa_id = ? AND dpo.id = ?`,
            [empresaId, operacionId]
        );

        const comprobante = comprobanteRows[0];

        await connection.commit();

        res.status(201).json({
            mensaje: cancelarPlan
                ? 'Se registró la devolución y se canceló el plan.'
                : 'Se registró la devolución.',
            plan_id: planId,
            importe_devuelto: importeCentavos / 100,
            saldo_a_favor: (totalDisponibleCentavos - importeCentavos) / 100,
            estado: cancelarPlan ? 'Cancelado' : 'Activo',
            comprobante
        });
    } catch (error) {
        await connection.rollback();
        console.error('Error al registrar devolución del plan:', error);
        res.status(500).json({ error: 'No se pudo registrar la devolución.' });
    } finally {
        connection.release();
    }
};