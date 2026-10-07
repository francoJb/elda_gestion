const db = require('../database/database'); // Tu conexión a MySQL
const { logAction } = require('../utils/audit');

function redondear2(valor) {
    return Math.round(Number(valor) * 100) / 100;
}

function formatearFechaLocal(fecha) {
    const anio = fecha.getFullYear();
    const mes = String(fecha.getMonth() + 1).padStart(2, '0');
    const dia = String(fecha.getDate()).padStart(2, '0');
    return `${anio}-${mes}-${dia}`;
}

function ahoraArgentinaDate() {
    const d = new Date();
    const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
    const offsetHoras = -3; // Argentina UTC-3
    return new Date(utc + (3600000 * offsetHoras));
}

function formatearFechaHoraArgentina(fecha) {
    const anio = fecha.getFullYear();
    const mes = String(fecha.getMonth() + 1).padStart(2, '0');
    const dia = String(fecha.getDate()).padStart(2, '0');
    const hora = String(fecha.getHours()).padStart(2, '0');
    const min = String(fecha.getMinutes()).padStart(2, '0');
    const seg = String(fecha.getSeconds()).padStart(2, '0');
    return `${anio}-${mes}-${dia} ${hora}:${min}:${seg}`;
}

function obtenerUltimoDiaDelMes(anio, mesIndexadoDesdeCero) {
    return new Date(anio, mesIndexadoDesdeCero + 1, 0).getDate();
}

function generarCuotas(total, cantidadCuotas, diaVencimientoMensual) {
    const cantidad = Number(cantidadCuotas);
    const diaVencimiento = Number(diaVencimientoMensual);

    if (!Number.isInteger(cantidad) || cantidad <= 0) {
        throw new Error("La cantidad de cuotas debe ser mayor a 0.");
    }

    if (!Number.isInteger(diaVencimiento) || diaVencimiento < 1 || diaVencimiento > 31) {
        throw new Error("El día de vencimiento mensual debe estar entre 1 y 31.");
    }

    const totalCentavos = Math.round(Number(total) * 100);
    const baseCentavos = Math.floor(totalCentavos / cantidad);
    let restoCentavos = totalCentavos - (baseCentavos * cantidad);
    const hoy = ahoraArgentinaDate();
    const primerMesOffset = diaVencimiento > hoy.getDate() ? 0 : 1;

    return Array.from({ length: cantidad }, (_, index) => {
        const montoCentavos = baseCentavos + (restoCentavos > 0 ? 1 : 0);
        if (restoCentavos > 0) restoCentavos -= 1;

        const mesVencimiento = hoy.getMonth() + primerMesOffset + index;
        const vencimiento = new Date(hoy.getFullYear(), mesVencimiento, 1);
        const ultimoDia = obtenerUltimoDiaDelMes(vencimiento.getFullYear(), vencimiento.getMonth());
        vencimiento.setDate(Math.min(diaVencimiento, ultimoDia));

        return {
            numero: index + 1,
            monto: redondear2(montoCentavos / 100),
            fecha_vencimiento: formatearFechaLocal(vencimiento)
        };
    });
}

function imputarEntregaInicialACuotas(cuotas, entregaInicial, fechaPago, reciboNumero = null, reciboId = null) {
    let entregaRestante = redondear2(entregaInicial);

    return cuotas.map(cuota => {
        const monto = Number(cuota.monto);
        const pagoInicial = Math.min(entregaRestante, monto);
        entregaRestante = redondear2(entregaRestante - pagoInicial);
        const saldoPendiente = redondear2(monto - pagoInicial);

        return {
            ...cuota,
            pago_inicial: pagoInicial,
            saldo_pendiente: saldoPendiente,
            estado: saldoPendiente <= 0 ? 'Pagada' : (pagoInicial > 0 ? 'Parcial' : 'Pendiente'),
            fecha_pago: pagoInicial > 0 && saldoPendiente <= 0 ? fechaPago : null,
            recibo_numero: pagoInicial > 0 ? reciboNumero : null,
            recibo_id: pagoInicial > 0 ? reciboId : null
        };
    });
}

const DOCUMENTOS = {
    factura: { tabla: 'ventas', columna: 'numero' },
    recibo: { tabla: 'cuenta_corriente', columna: 'numero_recibo' },
    plan_pagos: { tabla: 'ventas', columna: 'numero_plan_pagos' }
};

async function obtenerSiguienteNumeroDocumento(connection, empresaId, tipo) {
    const config = DOCUMENTOS[tipo];
    if (!config) {
        throw new Error(`Tipo de documento inválido: ${tipo}`);
    }

    await connection.query(`
        INSERT IGNORE INTO documentos_contadores (empresa_id, tipo, proximo_numero)
        SELECT ?, ?, IFNULL(MAX(${config.columna}), 0) + 1
        FROM ${config.tabla}
        WHERE empresa_id = ?
    `, [empresaId, tipo, empresaId]);

    const [rows] = await connection.query(
        `SELECT proximo_numero FROM documentos_contadores WHERE empresa_id = ? AND tipo = ? FOR UPDATE`,
        [empresaId, tipo]
    );

    const proximoNumero = Number(rows[0]?.proximo_numero || 1);
    await connection.query(
        `UPDATE documentos_contadores SET proximo_numero = ? WHERE empresa_id = ? AND tipo = ?`,
        [proximoNumero + 1, empresaId, tipo]
    );

    return proximoNumero;
}

exports.crearVenta = async (req, res) => {
    
    const { cliente_id, total, metodo_pago, entrega_inicial, cuotas, items, observaciones } = req.body;
    const totalVenta = Number(total);
    const entregaInicial = Number(entrega_inicial || 0);
    const saldoFinanciado = redondear2(totalVenta - entregaInicial);
    
    if (['Cuenta Corriente', 'Cuotas'].includes(metodo_pago) && (!cliente_id || Number(cliente_id) === 0)) {
        return res.status(400).json({
            error: "Seleccioná un cliente registrado para vender a crédito o en cuotas."
        });
    }

    // Validar que el cliente tenga habilitado el crédito si el pago es a cuenta corriente
    if (metodo_pago === 'Cuenta Corriente' && cliente_id && Number(cliente_id) !== 0) {
        const empresaId = req.empresaId;
        const [clienteRows] = await db.query(
            "SELECT habilitar_cc, nombre, apellido FROM clientes WHERE empresa_id = ? AND id = ?",
            [empresaId, cliente_id]
        );
        const cliente = clienteRows[0];
        if (!cliente || !cliente.habilitar_cc) {
            return res.status(400).json({
                error: `El cliente ${cliente ? cliente.nombre + ' ' + cliente.apellido : 'seleccionado'} no tiene habilitado el crédito. No se puede registrar venta a cuenta corriente.`
            });
        }
    }

    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: "La venta debe tener al menos un ítem." });
    }
    const unidadesSeleccionadas = items
        .map(item => item.unidadSeleccionadaId)
        .filter(id => id !== null && id !== undefined && id !== "");

    const unidadesUnicas = new Set(unidadesSeleccionadas);

    if (unidadesSeleccionadas.length !== unidadesUnicas.size) {
        return res.status(400).json({
            error: "No se puede vender dos veces el mismo chasis/unidad en la misma venta."
        });
    }

    if (!Number.isFinite(totalVenta) || totalVenta <= 0) {
        return res.status(400).json({ error: "El total de la venta debe ser mayor a 0." });
    }

    if (!Number.isFinite(entregaInicial) || entregaInicial < 0) {
        return res.status(400).json({ error: "La entrega inicial no puede ser negativa." });
    }

    if (['Cuenta Corriente', 'Cuotas'].includes(metodo_pago) && entregaInicial >= totalVenta) {
        return res.status(400).json({ error: "La entrega inicial debe ser menor al total de la venta." });
    }

    let planCuotas = [];
    if (metodo_pago === 'Cuotas') {
        try {
            planCuotas = generarCuotas(totalVenta, cuotas?.cantidad, cuotas?.dia_vencimiento);
        } catch (error) {
            return res.status(400).json({ error: error.message });
        }
    }
    

    // Obtenemos una conexión del pool para la transacción
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        // 1. Insertar la Cabecera de la Venta
        // Si es Cta Cte o Cuotas, el saldo_pendiente queda abierto hasta cobrar.
        const saldoPendiente = ['Cuenta Corriente', 'Cuotas'].includes(metodo_pago) ? saldoFinanciado : 0;
        const estadoPago = (['Cuenta Corriente', 'Cuotas'].includes(metodo_pago) && saldoPendiente > 0)
            ? (entregaInicial > 0 ? 'Parcial' : 'Pendiente')
            : 'Pagado';

        const empresaId = req.empresaId;

        const nuevoNumero = await obtenerSiguienteNumeroDocumento(connection, empresaId, 'factura');
        const nuevoNumeroPlanPagos = metodo_pago === 'Cuotas'
            ? await obtenerSiguienteNumeroDocumento(connection, empresaId, 'plan_pagos')
            : null;

        // Fecha explícita en zona Argentina para evitar usar la zona del servidor
        const fechaArg = formatearFechaHoraArgentina(ahoraArgentinaDate());
        const [ventaRes] = await connection.query(
            `INSERT INTO ventas (empresa_id, cliente_id, fecha, total, metodo_pago, estado_pago, saldo_pendiente, observaciones, numero, numero_plan_pagos) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [empresaId, cliente_id === 0 ? null : cliente_id, fechaArg, totalVenta, metodo_pago, estadoPago, saldoPendiente, observaciones, nuevoNumero, nuevoNumeroPlanPagos]
        );
        const ventaId = ventaRes.insertId;

        // Localizá este bucle dentro de exports.crearVenta
        // 2. Procesar cada Producto (Detalle + Stock) - ADAPTADO PARA UNIDADES ÚNICAS
        for (const item of items) {
            // A. CONSULTA DE SEGURIDAD: Traemos los datos base del producto
            const [productoRows] = await connection.query(
                "SELECT stock, descripcion, control_stock FROM productos WHERE empresa_id=? AND id=?",
                [empresaId, item.id]
            );
            const producto = productoRows[0];
            
            if (!producto) {
                throw new Error(`Producto con ID ${item.id} no encontrado`);
            }

            // B. LOGICA SI ES UN VEHÍCULO INDIVIDUALIZADO
            if (item.unidadSeleccionadaId) {
                // Verificamos que la unidad específica esté disponible para la venta
                const [unidadRows] = await connection.query(
                    "SELECT id, estado_venta FROM vehiculos_unidades WHERE empresa_id=? AND id=? AND producto_id=?",
                    [empresaId, item.unidadSeleccionadaId, item.id]
                );
                const unidad = unidadRows[0];

                if (!unidad) {
                    throw new Error(`La unidad física seleccionada para "${producto.descripcion}" no existe.`);
                }
                if (unidad.estado_venta !== 'Disponible') {
                    throw new Error(`La unidad seleccionada para "${producto.descripcion}" ya no está disponible (Estado: ${unidad.estado_venta}).`);
                }

                // Cambiamos el estado de la unidad física a Vendido y la enlazamos a esta venta
                await connection.query(
                    "UPDATE vehiculos_unidades SET estado_venta = 'Vendido', venta_id = ? WHERE id = ?",
                    [ventaId, item.unidadSeleccionadaId]
                );

                // Opcional: También restamos 1 en el stock general del catálogo de productos para mantener sincronía
                if (producto.control_stock) {
                    await connection.query(
                        "UPDATE productos SET stock = GREATEST(stock - 1, 0) WHERE empresa_id=? AND id=?",
                        [empresaId, item.id]
                    );
                }

            } else {
                // C. LÓGICA TRADICIONAL PARA PRODUCTOS COMUNES (Repuestos, servicios, aceites)
                if (producto.control_stock && producto.stock < item.cantidad) {
                    throw new Error(`Stock insuficiente para "${producto.descripcion}". Disponible: ${producto.stock}`);
                }

                // Descuento de stock numérico estándar
                if (producto.control_stock) {
                    await connection.query(
                        "UPDATE productos SET stock = stock - ? WHERE empresa_id=? AND id=?",
                        [item.cantidad, empresaId, item.id]
                    );
                }
            }

            // D. REGISTRO DEL DETALLE DE LA VENTA
            // Guardamos el detalle tradicional. Si quieres guardar qué chasis se fue en el detalle, 
            // tu tabla detalle_ventas podría admitir opcionalmente la columna vehiculo_unidad_id en un futuro.
            await connection.query(
                "INSERT INTO detalle_ventas (empresa_id, venta_id, producto_id, cantidad, precio_unitario) VALUES (?, ?, ?, ?, ?)",
                [empresaId, ventaId, item.id, item.cantidad, item.precio]
            );
        }

        // 3. LÓGICA DE CUENTA CORRIENTE / CUOTAS (Si aplica)
        if (['Cuenta Corriente', 'Cuotas'].includes(metodo_pago) && cliente_id !== 0) {
    
            // A. Primero obtenemos el saldo actual del cliente
            const [rows] = await connection.query(
                "SELECT IFNULL(SUM(debe - haber), 0) as saldoActual FROM cuenta_corriente WHERE empresa_id = ? AND cliente_id = ? AND estado = 1",
                [empresaId, cliente_id]
            );
            let saldoCalculado = parseFloat(rows[0].saldoActual);

            // B. Registrar la DEUDA (El DEBE)
            saldoCalculado += totalVenta; // Sumamos lo que se lleva
            const descripcionDeuda = metodo_pago === 'Cuotas'
                ? `Factura #${nuevoNumero} en ${planCuotas.length} cuotas - ${observaciones || 'Sin obs.'}`
                : `Factura #${nuevoNumero} - ${observaciones || 'Sin obs.'}`;

            const fechaCuentaArg = formatearFechaHoraArgentina(ahoraArgentinaDate());
            await connection.query(
                `INSERT INTO cuenta_corriente (empresa_id, cliente_id, venta_id, fecha, descripcion, debe, haber, saldo_acumulado) 
                VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
                [empresaId, cliente_id, ventaId, fechaCuentaArg, descripcionDeuda, totalVenta, saldoCalculado]
            );

            let reciboEntregaId = null;
            let reciboEntregaNumero = null;

            // C. Si hubo ENTREGA INICIAL, registrar el pago (El HABER)
            if (entregaInicial > 0) {
                reciboEntregaNumero = await obtenerSiguienteNumeroDocumento(connection, empresaId, 'recibo');
                saldoCalculado -= entregaInicial; // Restamos lo que pagó
                const [reciboEntregaResult] = await connection.query(
                    `INSERT INTO cuenta_corriente (empresa_id, cliente_id, venta_id, fecha, descripcion, debe, haber, saldo_acumulado, numero_recibo) 
                    VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`,
                    [empresaId, cliente_id, ventaId, fechaCuentaArg, `Entrega inicial Factura #${nuevoNumero}`, entregaInicial, saldoCalculado, reciboEntregaNumero]
                );
                reciboEntregaId = reciboEntregaResult.insertId;
            }

            if (metodo_pago === 'Cuotas') {
                planCuotas = imputarEntregaInicialACuotas(
                    planCuotas,
                    entregaInicial,
                    fechaCuentaArg,
                    reciboEntregaNumero,
                    reciboEntregaId
                );

                for (const cuota of planCuotas) {
                    await connection.query(
                        `INSERT INTO venta_cuotas
                         (empresa_id, venta_id, cliente_id, numero_cuota, fecha_vencimiento, monto, saldo_pendiente, estado, recibo_id, recibo_numero, fecha_pago, observaciones)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            empresaId,
                            ventaId,
                            cliente_id,
                            cuota.numero,
                            cuota.fecha_vencimiento,
                            cuota.monto,
                            cuota.saldo_pendiente,
                            cuota.estado,
                            cuota.recibo_id,
                            cuota.recibo_numero,
                            cuota.fecha_pago,
                            cuota.pago_inicial > 0 ? `Entrega inicial imputada: ${cuota.pago_inicial}` : null
                        ]
                    );
                }
            }
        }
        //Recuperamos los detalles reales y completos con los datos del vehículo ensamblados
        const [detallesFinales] = await connection.query(`
            SELECT 
                dv.cantidad,
                dv.precio_unitario,
                p.descripcion,
                p.sku,
                -- Traemos las especificaciones del vehículo si es que fue enlazado en la venta
                vu.chasis as vehiculo_chasis,
                vu.motor as vehiculo_motor,
                vu.color,
                vu.anio as vehiculo_anio,
                vu.patente,
                p.marca,
                p.modelo
            FROM detalle_ventas dv
            JOIN productos p ON dv.producto_id = p.id
            -- Hacemos un LEFT JOIN dinámico cruzando por venta y producto para enganchar la unidad física vendida
            LEFT JOIN vehiculos_unidades vu ON vu.venta_id = dv.venta_id AND vu.producto_id = p.id
            WHERE dv.empresa_id = ? AND dv.venta_id = ?
        `, [empresaId, ventaId]);
        await connection.commit();
        res.json({
            success: true,
            mensaje: "Venta procesada con éxito",
            ventaId,
            numero: nuevoNumero,
            numeroPlanPagos: nuevoNumeroPlanPagos,
            cuotas: planCuotas,
            detalles: detallesFinales
        });


    } catch (error) {
        await connection.rollback();
        console.error("Error en la transacción:", error);
        res.status(500).json({ error: "Fallo en la base de datos: " + error.message });
    } finally {
        connection.release();
    }
};

exports.adjudicarPlanAhorro = async (req, res) => {
    const empresaId = req.empresaId;
    const planId = Number(req.params.id);
    const unidadId = Number(req.body.unidad_id);
    const metodoSolicitado = req.body.metodo_pago;
    const cantidadCuotas = Number(req.body.cuotas?.cantidad);
    const diaVencimiento = Number(req.body.cuotas?.dia_vencimiento);

    const metodosPagoInmediato = [
        'Efectivo',
        'Transferencia',
        'Tarjeta',
        'QR'
    ];

    if (!Number.isInteger(planId) || planId <= 0) {
        return res.status(400).json({ error: 'El plan indicado no es válido.' });
    }

    if (!Number.isInteger(unidadId) || unidadId <= 0) {
        return res.status(400).json({ error: 'Seleccioná una unidad física disponible.' });
    }

    if (
        metodoSolicitado !== 'Cuotas' &&
        !metodosPagoInmediato.includes(metodoSolicitado)
    ) {
        return res.status(400).json({ error: 'Seleccioná una forma de pago válida.' });
    }

    if (metodoSolicitado === 'Cuotas') {
        if (!Number.isInteger(cantidadCuotas) || cantidadCuotas <= 0) {
            return res.status(400).json({ error: 'La cantidad de cuotas debe ser mayor a cero.' });
        }

        if (!Number.isInteger(diaVencimiento) || diaVencimiento < 1 || diaVencimiento > 31) {
            return res.status(400).json({ error: 'El día de vencimiento debe estar entre 1 y 31.' });
        }
    }

    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        const [planes] = await connection.query(
            `SELECT id, cliente_id, producto_id, estado, observaciones
             FROM planes_ahorro
             WHERE empresa_id = ? AND id = ?
             FOR UPDATE`,
            [empresaId, planId]
        );

        if (planes.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'No se encontró el plan.' });
        }

        const plan = planes[0];

        if (plan.estado !== 'Activo') {
            await connection.rollback();
            return res.status(409).json({ error: 'El plan ya no está activo.' });
        }

        const [productos] = await connection.query(
            `SELECT id, descripcion, precio_neto, stock, control_stock
             FROM productos
             WHERE empresa_id = ? AND id = ? AND estado = 1
             FOR UPDATE`,
            [empresaId, plan.producto_id]
        );

        if (productos.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'No se encontró el modelo de moto del plan.' });
        }

        const producto = productos[0];
        const precioCentavos = Math.round(Number(producto.precio_neto) * 100);

        if (!Number.isSafeInteger(precioCentavos) || precioCentavos <= 0) {
            await connection.rollback();
            return res.status(400).json({ error: 'El producto no tiene un precio vigente válido.' });
        }

        const [unidades] = await connection.query(
            `SELECT id
             FROM vehiculos_unidades
             WHERE empresa_id = ?
               AND producto_id = ?
               AND id = ?
               AND estado_venta = 'Disponible'
               AND estado = 1
             FOR UPDATE`,
            [empresaId, plan.producto_id, unidadId]
        );

        if (unidades.length === 0) {
            await connection.rollback();
            return res.status(409).json({ error: 'La unidad no existe, no corresponde al modelo o ya no está disponible.' });
        }

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
            const recibido = Math.round(Number(anticipo.importe) * 100);
            const devuelto = Math.round(Number(anticipo.devuelto) * 100);
            const aplicado = Math.round(Number(anticipo.aplicado) * 100);

            return {
                id: anticipo.id,
                disponibleCentavos: Math.max(0, recibido - devuelto - aplicado)
            };
        });

        const totalAnticiposCentavos = anticiposDisponibles.reduce(
            (total, anticipo) => total + anticipo.disponibleCentavos,
            0
        );

        if (totalAnticiposCentavos > precioCentavos) {
            await connection.rollback();
            return res.status(409).json({
                error: 'Los anticipos superan el precio vigente. Registrá primero la devolución del excedente.'
            });
        }

        const saldoCentavos = precioCentavos - totalAnticiposCentavos;
        const saldoFinanciado = redondear2(saldoCentavos / 100);
        const esFinanciada = metodoSolicitado === 'Cuotas' && saldoCentavos > 0;
        const metodoPago = saldoCentavos === 0
            ? 'Anticipos'
            : metodoSolicitado;

        let cuotasGeneradas = [];

        if (esFinanciada) {
            cuotasGeneradas = generarCuotas(
                saldoFinanciado,
                cantidadCuotas,
                diaVencimiento
            );
        }

        const nuevoNumero = await obtenerSiguienteNumeroDocumento(
            connection,
            empresaId,
            'factura'
        );

        const nuevoNumeroPlanPagos = esFinanciada
            ? await obtenerSiguienteNumeroDocumento(connection, empresaId, 'plan_pagos')
            : null;

        const fechaArg = formatearFechaHoraArgentina(ahoraArgentinaDate());
        const estadoPago = esFinanciada ? 'Pendiente' : 'Pagado';
        const saldoPendiente = esFinanciada ? saldoFinanciado : 0;
        const observaciones = `Adjudicación del plan de ahorro #${planId}`;

        const [ventaResult] = await connection.query(
            `INSERT INTO ventas
                (empresa_id, cliente_id, plan_ahorro_id, fecha, total, metodo_pago,
                 estado_pago, saldo_pendiente, observaciones, numero, numero_plan_pagos)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                empresaId,
                plan.cliente_id,
                planId,
                fechaArg,
                redondear2(precioCentavos / 100),
                metodoPago,
                estadoPago,
                saldoPendiente,
                observaciones,
                nuevoNumero,
                nuevoNumeroPlanPagos
            ]
        );

        const ventaId = ventaResult.insertId;

        const [detalleResult] = await connection.query(
            `INSERT INTO detalle_ventas
                (empresa_id, venta_id, producto_id, cantidad, precio_unitario)
             VALUES (?, ?, ?, 1, ?)`,
            [
                empresaId,
                ventaId,
                plan.producto_id,
                redondear2(precioCentavos / 100)
            ]
        );

        await connection.query(
            `UPDATE vehiculos_unidades
             SET estado_venta = 'Vendido',
                 venta_id = ?,
                 venta_detalle_id = ?
             WHERE empresa_id = ? AND id = ?`,
            [ventaId, detalleResult.insertId, empresaId, unidadId]
        );

        if (producto.control_stock) {
            await connection.query(
                `UPDATE productos
                 SET stock = GREATEST(stock - 1, 0)
                 WHERE empresa_id = ? AND id = ?`,
                [empresaId, plan.producto_id]
            );
        }

        for (const anticipo of anticiposDisponibles) {
            if (anticipo.disponibleCentavos <= 0) continue;

            await connection.query(
                `INSERT INTO anticipos_plan_aplicaciones
                    (empresa_id, anticipo_id, venta_id, importe)
                 VALUES (?, ?, ?, ?)`,
                [
                    empresaId,
                    anticipo.id,
                    ventaId,
                    redondear2(anticipo.disponibleCentavos / 100)
                ]
            );
        }

        if (esFinanciada) {
            const [saldoRows] = await connection.query(
                `SELECT COALESCE(SUM(debe - haber), 0) AS saldo_actual
                 FROM cuenta_corriente
                 WHERE empresa_id = ? AND cliente_id = ? AND estado = 1`,
                [empresaId, plan.cliente_id]
            );

            const saldoActual = Number(saldoRows[0].saldo_actual || 0);
            const nuevoSaldo = redondear2(saldoActual + saldoFinanciado);

            await connection.query(
                `INSERT INTO cuenta_corriente
                    (empresa_id, cliente_id, venta_id, fecha, descripcion,
                     debe, haber, saldo_acumulado)
                 VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
                [
                    empresaId,
                    plan.cliente_id,
                    ventaId,
                    fechaArg,
                    `Saldo financiado de la adjudicación del plan #${planId}`,
                    saldoFinanciado,
                    nuevoSaldo
                ]
            );

            for (const cuota of cuotasGeneradas) {
                await connection.query(
                    `INSERT INTO venta_cuotas
                        (empresa_id, venta_id, cliente_id, numero_cuota,
                         fecha_vencimiento, monto, saldo_pendiente, estado)
                     VALUES (?, ?, ?, ?, ?, ?, ?, 'Pendiente')`,
                    [
                        empresaId,
                        ventaId,
                        plan.cliente_id,
                        cuota.numero,
                        cuota.fecha_vencimiento,
                        cuota.monto,
                        cuota.monto
                    ]
                );
            }
        }

        await connection.query(
            `UPDATE planes_ahorro
             SET estado = 'Adjudicado'
             WHERE empresa_id = ? AND id = ? AND estado = 'Activo'`,
            [empresaId, planId]
        );

        await connection.commit();

        res.status(201).json({
            mensaje: 'Plan adjudicado correctamente.',
            plan_id: planId,
            venta_id: ventaId,
            numero_venta: nuevoNumero,
            precio_vigente: redondear2(precioCentavos / 100),
            anticipos_aplicados: redondear2(totalAnticiposCentavos / 100),
            saldo_financiado: esFinanciada ? saldoFinanciado : 0,
            cuotas: cuotasGeneradas
        });
    } catch (error) {
        await connection.rollback();
        console.error('Error al adjudicar plan de ahorro:', error);
        res.status(500).json({ error: 'No se pudo adjudicar el plan de ahorro.' });
    } finally {
        connection.release();
    }
};

exports.obtenerVentas = async (req, res) => {
    try {
        const empresaId = req.empresaId;
        
        // Eliminamos las restricciones de 'estado = 1' y 'anulada = 0' 
        // para que la base de datos devuelva el historial completo al listado
        const [rows] = await db.query(`
            SELECT 
                v.id,
                v.numero,
                v.numero_plan_pagos,
                v.estado,
                v.anulada,
                v.cliente_id, 
                v.fecha, 
                v.total, 
                v.metodo_pago,
                v.saldo_pendiente, 
                v.estado_pago, -- Usaremos esto para saber si está "Finalizado" o "Pendiente" o "Anulado"
                c.nombre AS cliente_nombre, 
                c.apellido AS cliente_apellido
            FROM ventas v
            LEFT JOIN clientes c ON v.cliente_id = c.id AND c.empresa_id = ?
            WHERE v.empresa_id = ?
            ORDER BY v.fecha DESC
            `, [empresaId, empresaId] // Pasamos limpiamente los parámetros requeridos
        );
        
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.obtenerVenta = async (req, res) => {
    const { id } = req.params;
    try {
        const [rows] = await db.query(`
            SELECT 
                v.id, 
                v.numero,
                v.numero_plan_pagos,
                v.fecha, 
                v.total, 
                v.metodo_pago,
                v.saldo_pendiente, 
                v.estado_pago,
                v.cliente_id,
                v.observaciones,
                c.nombre AS cliente_nombre, 
                c.apellido AS cliente_apellido
            FROM ventas v
            LEFT JOIN clientes c ON v.cliente_id = c.id AND c.empresa_id = v.empresa_id
            WHERE v.id = ? AND v.empresa_id=? AND v.estado = 1 AND v.anulada = 0
        `, [id, req.empresaId]);
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Venta no encontrada' });
        }
        res.json(rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.obtenerTopProductosMasVendidos = async (req, res) => {
    try {
        const empresaId = req.empresaId; // Control multiempresa

        const query = `
            SELECT 
                p.id AS producto_id,
                p.descripcion AS nombre,
                SUM(dv.cantidad) AS cantidad_vendida,
                SUM(dv.cantidad * dv.precio_unitario) AS total_recaudado
            FROM detalle_ventas dv
            JOIN productos p ON dv.producto_id = p.id
            WHERE dv.empresa_id = ?
            GROUP BY p.id, p.descripcion
            ORDER BY cantidad_vendida DESC
            LIMIT 5
        `;

        const [rows] = await db.query(query, [empresaId]);
        res.json(rows);
    } catch (error) {
        console.error("❌ Error al calcular el top de productos:", error.message);
        res.status(500).json({ error: "No se pudo obtener las estadísticas de productos." });
    }
};

// En tu controlador de ventas para el detalle individual de una venta
exports.obtenerDetalleVenta = async (req, res) => {
    try {
        const { id } = req.params;
        const empresaId = req.empresaId;

        const query = `
            SELECT 
                dv.*,
                p.descripcion,
                p.sku,
                vu.chasis as vehiculo_chasis,
                vu.motor as vehiculo_motor,
                vu.color as vehiculo_color,
                vu.anio as vehiculo_anio,
                vu.patente,
                p.marca,
                p.modelo
            FROM detalle_ventas dv
            JOIN productos p ON dv.producto_id = p.id
            LEFT JOIN vehiculos_unidades vu 
                ON vu.venta_id = dv.venta_id 
                AND vu.producto_id = p.id
            WHERE dv.venta_id = ? AND dv.empresa_id = ?
        `;
        
        const [rows] = await db.query(query, [id, empresaId]);
        res.json(rows);
    } catch (error) {
        console.error("❌ Error al obtener detalle de la venta:", error.message);
        res.status(500).json({ error: "Error interno al obtener el detalle." });
    }
};

exports.obtenerCuotasPendientes = async (req, res) => {
    const { clienteId, ventaId } = req.query;
    const filtros = ['vc.empresa_id = ?', "vc.estado <> 'Pagada'", 'vc.saldo_pendiente > 0'];
    const params = [req.empresaId];

    if (clienteId) {
        filtros.push('vc.cliente_id = ?');
        params.push(clienteId);
    }

    if (ventaId) {
        filtros.push('vc.venta_id = ?');
        params.push(ventaId);
    }

    try {
        const [rows] = await db.query(`
            SELECT
                vc.id,
                vc.venta_id,
                vc.cliente_id,
                vc.numero_cuota,
                vc.fecha_vencimiento,
                vc.fecha_pago,
                vc.monto,
                vc.saldo_pendiente,
                vc.recibo_id,
                vc.recibo_numero,
                vc.estado,
                v.numero AS factura_numero,
                v.fecha AS venta_fecha,
                c.nombre AS cliente_nombre,
                c.apellido AS cliente_apellido
            FROM venta_cuotas vc
            INNER JOIN ventas v ON v.id = vc.venta_id AND v.empresa_id = vc.empresa_id
            INNER JOIN clientes c ON c.id = vc.cliente_id AND c.empresa_id = vc.empresa_id
            WHERE ${filtros.join(' AND ')} AND v.estado = 1 AND v.anulada = 0
            ORDER BY vc.fecha_vencimiento ASC, vc.numero_cuota ASC
        `, params);

        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.obtenerCuotasVenta = async (req, res) => {
    const { id } = req.params;

    try {
        const [rows] = await db.query(`
            SELECT
                vc.id,
                vc.venta_id,
                vc.cliente_id,
                vc.numero_cuota,
                vc.fecha_vencimiento,
                vc.fecha_pago,
                vc.monto,
                vc.saldo_pendiente,
                vc.recibo_id,
                vc.recibo_numero,
                vc.estado,
                v.fecha AS venta_fecha,
                c.nombre AS cliente_nombre,
                c.apellido AS cliente_apellido
            FROM venta_cuotas vc
            INNER JOIN ventas v ON v.id = vc.venta_id AND v.empresa_id = vc.empresa_id
            INNER JOIN clientes c ON c.id = vc.cliente_id AND c.empresa_id = vc.empresa_id
            WHERE vc.empresa_id = ? AND vc.venta_id = ? AND v.anulada = 0
            ORDER BY vc.numero_cuota ASC
        `, [req.empresaId, id]);

        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.anularVenta = async (req, res) => {
    const { id } = req.params;
    const { motivo, revertStock = false, revertCtaCte = false } = req.body || {};

    if (!id || Number(id) <= 0) return res.status(400).json({ error: 'ID de venta inválido' });

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        const [ventaRows] = await connection.query(
            'SELECT id, cliente_id, total, estado, anulada FROM ventas WHERE id = ? AND empresa_id = ? FOR UPDATE',
            [id, req.empresaId]
        );
        if (ventaRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Venta no encontrada' });
        }

        const venta = ventaRows[0];
        if (venta.anulada) {
            await connection.rollback();
            return res.status(400).json({ error: 'La venta ya está anulada' });
        }

        const fechaArg = formatearFechaHoraArgentina(ahoraArgentinaDate());

        await connection.query(
            `UPDATE ventas SET anulada = 1, motivo_anulacion = ?, anulado_por = ?, fecha_anulacion = ? WHERE id = ? AND empresa_id = ?`,
            [motivo || null, req.usuarioId || null, fechaArg, id, req.empresaId]
        );

        // Registrar auditoría de anulación
        await logAction(connection, { empresaId: req.empresaId, usuarioId: req.usuarioId || null, accion: 'anular', entidad: 'ventas', entidadId: id, descripcion: motivo || 'Venta anulada' });

        // Revertir stock si se solicita
        if (revertStock) {
            const [detalles] = await connection.query(
                'SELECT producto_id, cantidad FROM detalle_ventas WHERE empresa_id = ? AND venta_id = ?',
                [req.empresaId, id]
            );
            for (const d of detalles) {
                await connection.query(
                    'UPDATE productos SET stock = stock + ? WHERE empresa_id = ? AND id = ? AND control_stock = 1',
                    [d.cantidad, req.empresaId, d.producto_id]
                );
            }
        }

        // Revertir cuenta corriente (insertar asiento de haber) si se solicita
        let reversalCcId = null;
        if (revertCtaCte && venta.cliente_id) {
            // obtener saldo actual
            const [ccRows] = await connection.query(
                'SELECT IFNULL(SUM(debe - haber), 0) as saldoActual FROM cuenta_corriente WHERE empresa_id = ? AND cliente_id = ? AND estado = 1',
                [req.empresaId, venta.cliente_id]
            );
            const saldoActual = parseFloat(ccRows[0].saldoActual) || 0;
            const nuevoSaldo = redondear2(saldoActual - parseFloat(venta.total || 0));

            const descripcion = `Anulación Venta #${venta.id} - ${motivo || 'Sin motivo'}`;
            const fechaCuentaArg = fechaArg;

            const [ins] = await connection.query(
                `INSERT INTO cuenta_corriente (
                    empresa_id,
                    cliente_id,
                    venta_id,
                    fecha,
                    descripcion,
                    debe,
                    haber,
                    saldo_acumulado,
                    observaciones
                )
                 VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`,
                [req.empresaId, venta.cliente_id, venta.id, fechaCuentaArg, descripcion, parseFloat(venta.total || 0), nuevoSaldo, 'Reversión por anulación']
            );
            reversalCcId = ins.insertId;
        }

        await connection.commit();
        return res.json({ success: true, message: 'Venta anulada', reversalCcId });
    } catch (error) {
        await connection.rollback();
        console.error('ERROR AL ANULAR VENTA:', error.message);
        return res.status(500).json({ error: 'Error interno al anular la venta' });
    } finally {
        connection.release();
    }
};

exports.registrarPago = async (req, res) => {
    const { ventaId } = req.params;
    const { monto, observaciones, cuota_ids } = req.body;

    const ventaIdNum = Number(ventaId);
    if (!Number.isInteger(ventaIdNum) || ventaIdNum <= 0) {
        return res.status(400).json({ error: "ID de venta inválido." });
    }

    const montoNum = parseFloat(monto);
    if (isNaN(montoNum) || montoNum <= 0) {
        return res.status(400).json({ error: "Monto inválido. Debe ser mayor a 0." });
    }
    const empresaId = req.empresaId;
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        // 1) Buscar venta
        const [ventaRows] = await connection.query(
            "SELECT cliente_id, total, saldo_pendiente, metodo_pago, numero FROM ventas WHERE empresa_id = ? AND id = ? and estado = 1",
            [empresaId, ventaIdNum]
        );

        if (ventaRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: "Venta no encontrada" });
        }

        const venta = ventaRows[0];
        const idCliente = venta.cliente_id;

        if (!idCliente) {
            await connection.rollback();
            return res.status(400).json({ error: "La venta no tiene cliente asociado." });
        }

        const saldoPendienteNum = parseFloat(venta.saldo_pendiente);
        if (isNaN(saldoPendienteNum) || saldoPendienteNum <= 0) {
            await connection.rollback();
            return res.status(400).json({ error: "La venta no tiene saldo pendiente." });
        }

        if (montoNum > saldoPendienteNum) {
            await connection.rollback();
            return res.status(400).json({ error: "El monto supera el saldo pendiente" });
        }

        const nuevoSaldo = redondear2(saldoPendienteNum - montoNum);
        const nuevoEstado = nuevoSaldo <= 0 ? "Pagado" : "Parcial";

        const observacionesPago = observaciones && observaciones.trim()
            ? observaciones.trim()
            : null;

        const cuotasPagadasIds = [];
        if (venta.metodo_pago === 'Cuotas') {
            const filtrosCuotas = ['empresa_id = ?', 'venta_id = ?', "estado <> 'Pagada'", 'saldo_pendiente > 0'];
            const paramsCuotas = [empresaId, ventaIdNum];

            if (Array.isArray(cuota_ids) && cuota_ids.length > 0) {
                filtrosCuotas.push(`id IN (${cuota_ids.map(() => '?').join(',')})`);
                paramsCuotas.push(...cuota_ids.map(Number));
            }

            const [cuotasRows] = await connection.query(
                `SELECT id, saldo_pendiente FROM venta_cuotas WHERE ${filtrosCuotas.join(' AND ')} ORDER BY fecha_vencimiento ASC, numero_cuota ASC`,
                paramsCuotas
            );

            let montoRestanteCuotas = montoNum;
            for (const cuota of cuotasRows) {
                if (montoRestanteCuotas <= 0) break;
                const saldoCuota = parseFloat(cuota.saldo_pendiente);
                const pagoCuota = Math.min(montoRestanteCuotas, saldoCuota);
                const nuevoSaldoCuota = redondear2(saldoCuota - pagoCuota);
                const nuevoEstadoCuota = nuevoSaldoCuota <= 0 ? 'Pagada' : 'Parcial';

                const fechaPagoArg = nuevoEstadoCuota === 'Pagada' ? formatearFechaHoraArgentina(ahoraArgentinaDate()) : null;
                await connection.query(
                    `UPDATE venta_cuotas
                     SET saldo_pendiente = ?, estado = ?, fecha_pago = CASE WHEN ? = 'Pagada' THEN ? ELSE fecha_pago END, observaciones = ?
                     WHERE empresa_id = ? AND id = ?`,
                    [nuevoSaldoCuota, nuevoEstadoCuota, nuevoEstadoCuota, fechaPagoArg, observacionesPago, empresaId, cuota.id]
                );

                montoRestanteCuotas = redondear2(montoRestanteCuotas - pagoCuota);
                if (pagoCuota > 0) cuotasPagadasIds.push(cuota.id);
            }
        }

        // 2) Actualizar ventas
        await connection.query(
            "UPDATE ventas SET saldo_pendiente = ?, estado_pago = ? WHERE id = ? AND empresa_id=?",
            [nuevoSaldo, nuevoEstado, ventaIdNum, empresaId]
        );

        // 3) Registrar en cuenta corriente
        const [ccRows] = await connection.query(
            "SELECT IFNULL(SUM(debe - haber), 0) as saldoActual FROM cuenta_corriente WHERE empresa_id = ? AND cliente_id = ? AND estado = 1",
            [empresaId, idCliente]
        );
        const saldoActualNum = parseFloat(ccRows[0].saldoActual) || 0;
        const nuevoSaldoAcumulado = saldoActualNum - montoNum;
        const reciboNumero = await obtenerSiguienteNumeroDocumento(connection, empresaId, 'recibo');

        const fechaCuentaPagoArg = formatearFechaHoraArgentina(ahoraArgentinaDate());
        const [insertCcResult] = await connection.query(
            `INSERT INTO cuenta_corriente (empresa_id, cliente_id, venta_id, fecha, descripcion, debe, haber, saldo_acumulado, observaciones, numero_recibo) 
            VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
            [empresaId, idCliente, ventaIdNum, fechaCuentaPagoArg, `Pago Factura #${venta.numero}`, montoNum, nuevoSaldoAcumulado, observacionesPago, reciboNumero]
        );

        // Obtener el id del recibo (insertId de la inserción anterior)
        const reciboId = insertCcResult.insertId;

        // Si se pagaron cuotas, vincular el recibo a las cuotas afectadas
        if (Array.isArray(cuotasPagadasIds) && cuotasPagadasIds.length > 0) {
            await connection.query(
                `UPDATE venta_cuotas SET recibo_id = ?, recibo_numero = ? WHERE empresa_id = ? AND id IN (${cuotasPagadasIds.map(() => '?').join(',')})`,
                [reciboId, reciboNumero, empresaId, ...cuotasPagadasIds]
            );
        }

        await connection.commit();
        return res.json({ success: true, nuevoSaldo, reciboId, reciboNumero });

    } catch (error) {
        await connection.rollback();
        console.error("ERROR EN PAGO:", error.message);
        return res.status(500).json({ error: "Error interno del servidor" });
    } finally {
        connection.release();
    }
};