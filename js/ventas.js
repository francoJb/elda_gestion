import { fetchClientes, cargarDatosBalance } from "./clientes.js";
import { fetchProductos } from "./productos.js";
import { actualizarTablaVenta, renderTablaVentas } from "./renderventas.js";
import { cambiarSeccion, mostrarAlerta, mostrarConfirmacion } from "./ui.js";
import { API_BASE_URL } from "./config.js";
import { apiFetch } from "./apiClient.js";

const URL_API = `${API_BASE_URL}/api/ventas`;
const URL_PLANES_AHORRO = `${API_BASE_URL}/api/planes-ahorro`;
let planesAhorroCache = [];
let planAhorroSeleccionado = null;
let historialPlanesAhorroCache = [];
const PUNTO_VENTA_DEFAULT = "0001";


// 5. BUSCADOR DE VENTAS (Seccion Ventas)
export function configurarBuscadorVentas() {
    const inputBusqueda = document.getElementById("buscarVentas");
    if (inputBusqueda) {
        inputBusqueda.oninput = async (e) => {
            const termino = e.target.value.toLowerCase().trim();
            
            const filtrados = ventasCache.filter(v => {
                const nombre = (v.cliente_nombre || "").toLowerCase();
                const apellido = (v.cliente_apellido || "").toLowerCase();
                const nombreCompleto = `${nombre} ${apellido}`;
                const numeroVenta = String(v.numero || "").toLowerCase();

                return nombreCompleto.includes(termino) || numeroVenta.includes(termino);
            });

            renderTablaVentas(filtrados);
        };
    }
}



function formatearNumeroDocumento(numero, puntoVenta = PUNTO_VENTA_DEFAULT) {
    const numeroNormalizado = Number(numero);
    const numeroComprobante = Number.isFinite(numeroNormalizado) && numeroNormalizado > 0
        ? Math.trunc(numeroNormalizado)
        : 1;

    return `${puntoVenta}-${String(numeroComprobante).padStart(8, "0")}`;
}

async function obtenerDatosEmpresaActual() {
    try {
        const response = await apiFetch(`${API_BASE_URL}/api/auth/empresa-actual`);

        if (!response.ok) {
            throw new Error("No se pudieron obtener los datos de la empresa actual");
        }

        const data = await response.json();
        const empresa = data.empresa || {};

        return {
            razonSocial: empresa.razon_social || empresa.nombre || "Empresa sin razón social",
            nombreFantasia: empresa.nombre || "Empresa sin nombre comercial",
            domicilio: empresa.domicilio || "Domicilio no configurado",
            cuit: empresa.cuit || "CUIT no configurado"
        };
    } catch (error) {
        console.error("Error obteniendo datos de empresa:", error);

        return {
            razonSocial: "Empresa no configurada",
            nombreFantasia: "Empresa no configurada",
            domicilio: "Domicilio no configurado",
            cuit: "CUIT no configurado"
        };
    }
}

let carritoVenta = [];
let productosVenta = [];
let ventasEstado = 'todos';
let ventasCache = [];

export async function enviarVentaAlServidor(datos) {
    const response = await apiFetch(URL_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(datos)
    });
    return await response.json();
}

async function cargarDatosParaVenta() {
    try {
        const [clientes, productos] = await Promise.all([
            fetchClientes(),
            fetchProductos()
        ]);

        // Guardar clientes para el buscador
        window.clientesVenta = clientes;
        productosVenta = productos;
        window.productosVenta = productos;

        console.log("✅ Datos para venta cargados correctamente");
    } catch (error) {
        console.error("❌ Error al cargar datos para la venta:", error);
    }
}

function setSkuFocus() {
    const inputSku = document.getElementById("v-sku-directo");
    if (inputSku) {
        inputSku.value = "";
        // Asegurar que el elemento sea visible antes de enfocar
        if (inputSku.offsetParent !== null) {
            inputSku.focus();
        } else {
            console.warn("El input de SKU no es visible aún");
        }
    } else {
        console.warn("No se encontró 'v-sku-directo'. Asegúrate de que el input de SKU tenga ese ID.");
    }
}

function addPagoEntregaListener() {
    document.getElementById("pago-entrega")?.addEventListener("input", calcularSaldoCtaCte);
    document.getElementById("pago-cuotas-entrega")?.addEventListener("input", actualizarResumenCuotas);
    document.getElementById("pago-cuotas-cantidad")?.addEventListener("input", actualizarResumenCuotas);
    document.getElementById("pago-cuotas-dia-vencimiento")?.addEventListener("input", actualizarResumenCuotas);
}

window.volverALista = () => {
    if (carritoVenta.length > 0) {
        // Usar modal personalizado en lugar de confirm
        const confirmar = window.confirm ? confirm("⚠️ Tenés productos cargados. ¿Seguro que querés cancelar la venta y volver?") : true;
        if (!confirmar) return;
    }
    carritoVenta = [];
    // Resetear campo de cliente
    const inputCliente = document.getElementById("v-cliente-input");
    if (inputCliente) inputCliente.value = "Consumidor Final";
    window.clienteSeleccionadoVenta = null;
    // Ocultar opción de cuenta corriente para consumidor final
    if (typeof window.actualizarOpcionesPago === "function") {
        window.actualizarOpcionesPago(false);
    }
    actualizarTablaVenta(carritoVenta);
    cambiarSeccion('seccionVentas');
};

window.cargarDatosParaVenta = cargarDatosParaVenta;

function esProductoVehiculo(p) {
    return (
        (p.categoria && p.categoria.toUpperCase().startsWith("VEHICULO")) ||
        (p.vehiculo_tipo && p.vehiculo_tipo.trim() !== "") ||
        (p.vehiculo_motor && p.vehiculo_motor.trim() !== "") ||
        (p.vehiculo_chasis && p.vehiculo_chasis.trim() !== "")
    );
}

window.checkEnterVenta = async (e) => {
    if (e.key === 'Enter' || e.keyCode === 13) {
        const skuIngresado = e.target.value.trim().toUpperCase();
        if (!skuIngresado) return;

        const productos = await fetchProductos();
        const p = productos.find(item => item.sku.toUpperCase() === skuIngresado);
        
        const esVehiculo = esProductoVehiculo(p);
        if (p) {
            const nuevoItem = {
                id: p.id,
                sku: p.sku,
                descripcion: p.descripcion,
                precio: parseFloat(p.precio_neto),
                cantidad: 1,
                subtotal: parseFloat(p.precio_neto),
                esVehiculo: esVehiculo,
                unidadSeleccionadaId: null
            };

            carritoVenta.push(nuevoItem);
            actualizarTablaVenta(carritoVenta);
            e.target.value = "";
            console.log("Producto cargado con éxito vía SKU");
        } else {
            mostrarAlerta("El SKU no existe. Abriendo buscador avanzado...", "Producto no encontrado", "warning");
            abrirBuscadorProductos();
            document.getElementById("inputFiltroProductos").value = skuIngresado;
            filtrarProductosModal();
        }
    }
};

window.abrirBuscadorProductos = async () => {
    const productos = await fetchProductos();
    const modal = document.getElementById("modalBuscadorProductos");
    const tbody = document.getElementById("tablaBuscadorProductos");

    tbody.innerHTML = productos.map(p => `
        <tr data-sku="${p.sku}" data-selected="false" onclick="toggleSeleccionProductoFila(this)"
            class="border-b dark:border-slate-700 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors cursor-pointer">
            <td class="p-3">${p.sku}</td>
            <td class="p-3">${p.descripcion}</td>
            <td class="p-3">${p.marca}</td>
            <td class="p-3 text-right ${p.control_stock && p.stock <= p.stock_minimo ? 'text-red-500 font-bold' : ''}">${p.stock}</td>
            <td class="p-3 text-right">${p.precio_neto}</td>
        </tr>
    `).join('');

    modal.classList.remove("hidden");
    document.getElementById("inputFiltroProductos").focus();
};

window.agregarProductosSeleccionados = async () => {
    const filasSeleccionadas = Array.from(document.querySelectorAll("#tablaBuscadorProductos tr[data-selected='true']"));
    if (filasSeleccionadas.length === 0) {
        mostrarAlerta("Seleccione al menos un producto para agregar.", "Atención", "warning");
        return;
    }

    const productos = await fetchProductos();
    filasSeleccionadas.forEach(fila => {
        const sku = fila.dataset.sku;
        const p = productos.find(item => item.sku === sku);

        if (p) {
            const esVehiculo = esProductoVehiculo(p);
            
            const existing = carritoVenta.find(item => item.sku === sku);
            
            if (existing && !esVehiculo) {
                // Si es un producto común, acumulamos cantidad de forma habitual
                existing.cantidad += 1;
                existing.subtotal = existing.precio * existing.cantidad;
            } else {
                // Si es un vehículo o un ítem nuevo, insertamos una unidad individualizada
                carritoVenta.push({
                    id: p.id,
                    sku: p.sku,
                    descripcion: p.descripcion,
                    precio: parseFloat(p.precio_neto),
                    cantidad: 1,
                    subtotal: parseFloat(p.precio_neto),
                    esVehiculo: esVehiculo,
                    unidadSeleccionadaId: null // Se definirá dinámicamente en el select
                });
            }
        }
    });

    actualizarTablaVenta(carritoVenta); // Asegurar renderizado al cerrar/agregar
    cerrarBuscadorProductos();
};

window.toggleSeleccionProductoFila = (row) => {
    const seleccionada = row.dataset.selected === "true";
    row.dataset.selected = seleccionada ? "false" : "true";
    row.classList.toggle("bg-cyan-100", !seleccionada);
    row.classList.toggle("dark:bg-cyan-900/80", !seleccionada);
};

window.filtrarProductosModal = () => {
    const texto = document.getElementById("inputFiltroProductos").value.toLowerCase();
    const filas = document.querySelectorAll("#tablaBuscadorProductos tr");

    filas.forEach(fila => {
        const contenido = fila.textContent.toLowerCase();
        fila.style.display = contenido.includes(texto) ? "" : "none";
    });
};

window.cerrarBuscadorProductos = () => {
    document.getElementById("modalBuscadorProductos").classList.add("hidden");
};

window.agregarItemVenta = () => {
    const select = document.getElementById("v-producto-select");
    if (!select || !select.value) return;

    const opt = select.options[select.selectedIndex];
    const item = {
        id: select.value,
        sku: opt.dataset.sku,
        desc: opt.dataset.descripcion,
        precio: parseFloat(opt.dataset.precio),
        cantidad: 1,
    };
    item.subtotal = item.precio * item.cantidad;

    carritoVenta.push(item);
    actualizarTablaVenta(carritoVenta);
    select.value = "";
};

window.quitarItemVenta = (index) => {
    carritoVenta.splice(index, 1);
    actualizarTablaVenta(carritoVenta);
    console.log("Producto eliminado del carrito local");
};

window.cambiarCantidad = (index, nuevaCantidad) => {
    const cant = parseInt(nuevaCantidad);
    if (cant > 0) {
        carritoVenta[index].cantidad = cant;
        carritoVenta[index].subtotal = carritoVenta[index].precio * cant;
        actualizarTablaVenta(carritoVenta);
    }
};

window.abrirModalPago = () => {
    if (carritoVenta.length === 0) {
        mostrarAlerta("No hay productos cargados.", "Carrito vacío", "warning");
        return;
    }
    const total = carritoVenta.reduce((sum, i) => sum + i.subtotal, 0);
    
    // Determinar si es consumidor final o cliente registrado
    const inputCliente = document.getElementById("v-cliente-input");
    const clienteTexto = inputCliente ? inputCliente.value.trim() : "Consumidor Final";
    const esConsumidorFinal = clienteTexto === "Consumidor Final" || !window.clienteSeleccionadoVenta;
    const idCliente = esConsumidorFinal ? 0 : window.clienteSeleccionadoVenta;
    
    document.getElementById("pago-total-monto").innerText = `$${total.toFixed(2)}`;
    document.getElementById("pago-entrega").value = 0;
    document.getElementById("pago-cuotas-entrega").value = 0;

    const optCtaCte = document.getElementById("opt-cta-cte");
    const optCuotas = document.getElementById("opt-cuotas");
    const selectMetodo = document.getElementById("pago-metodo");
    if (esConsumidorFinal) {
        optCtaCte.disabled = true;
        optCtaCte.innerText = "Cuenta Corriente (Solo clientes reg.)";
        optCuotas.disabled = true;
        optCuotas.innerText = "Cuotas (Solo clientes reg.)";
        selectMetodo.value = "Efectivo";
    } else {
        optCtaCte.disabled = false;
        optCtaCte.innerText = "Cuenta Corriente";
        optCuotas.disabled = false;
        optCuotas.innerText = "Cuotas";
    }
    toggleCamposCtaCte();

    document.getElementById("modalPago").classList.remove("hidden");
};

window.abrirModalPlanAhorro = async () => {
    try {
        const [clientes, productos] = await Promise.all([
            fetchClientes(),
            fetchProductos()
        ]);

        const clienteSelect = document.getElementById('planAhorroCliente');
        const modeloSelect = document.getElementById('planAhorroModelo');

        clienteSelect.replaceChildren();
        modeloSelect.replaceChildren();

        for (const cliente of clientes) {
            const opcion = document.createElement('option');
            opcion.value = cliente.id;
            opcion.textContent = `${cliente.nombre} ${cliente.apellido}`;
            clienteSelect.appendChild(opcion);
        }

        const motos = productos.filter(esProductoVehiculo);

        for (const moto of motos) {
            const opcion = document.createElement('option');
            opcion.value = moto.id;
            opcion.textContent = `${moto.descripcion} (${moto.sku})`;
            modeloSelect.appendChild(opcion);
        }

        if (clientes.length === 0 || motos.length === 0) {
            mostrarAlerta(
                clientes.length === 0
                    ? 'Primero registrá un cliente.'
                    : 'No hay modelos configurados como vehículos.',
                'No se puede crear el plan',
                'warning'
            );
            return;
        }

        document.getElementById('planAhorroAnticipo').value = '0';
        document.getElementById('planAhorroMedioPago').value = 'Efectivo';
        document.getElementById('modalPlanAhorro').classList.remove('hidden');
    } catch (error) {
        mostrarAlerta(error.message, 'Error al abrir el plan', 'error');
    }
};

window.guardarPlanAhorro = async () => {
    const boton = document.getElementById('btnGuardarPlanAhorro');
    const anticipo = Number(document.getElementById('planAhorroAnticipo').value || 0);

    if (!Number.isFinite(anticipo) || anticipo < 0) {
        mostrarAlerta('El anticipo no puede ser negativo.', 'Importe inválido', 'warning');
        return;
    }

    boton.disabled = true;
    boton.textContent = 'Guardando...';

    try {
        const respuesta = await apiFetch(`${API_BASE_URL}/api/planes-ahorro`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                cliente_id: Number(document.getElementById('planAhorroCliente').value),
                producto_id: Number(document.getElementById('planAhorroModelo').value),
                anticipo_inicial: anticipo,
                medio_pago: document.getElementById('planAhorroMedioPago').value,
                observaciones: document.getElementById('v-observaciones').value
            })
        });

        const resultado = await respuesta.json();

        if (!respuesta.ok) {
            throw new Error(resultado.error || 'No se pudo guardar el plan.');
        }

        document.getElementById('modalPlanAhorro').classList.add('hidden');
        document.getElementById('v-observaciones').value = '';
        boton.disabled = false;
        boton.textContent = 'Guardar plan';

        await window.abrirHistorialPlanesAhorro();

        if (resultado.comprobante) {
            const imprimir = await mostrarConfirmacion({
                title: 'Imprimir comprobante de anticipo',
                message: 'El plan se creó con un anticipo. ¿Querés abrir el comprobante?',
                confirmText: 'Imprimir',
                cancelText: 'No imprimir'
            });

            if (imprimir) {
                try {
                    const doc = await generarReciboAnticipoPDF(resultado.comprobante);
                    abrirPreviewPDF(
                        doc,
                        `AnticipoPlan_${resultado.comprobante.plan_id}_${resultado.comprobante.anticipo_id}.pdf`
                    );
                } catch (error) {
                    console.error('Error al generar el comprobante del anticipo:', error);
                    await mostrarAlerta(
                        'El plan y el anticipo se guardaron, pero no se pudo generar el comprobante.',
                        'Error al imprimir',
                        'error'
                    );
                }
            }
        }

        await mostrarAlerta(
            `Plan creado. Número ${resultado.plan_id}. Anticipo registrado: $${Number(resultado.saldo_a_favor).toFixed(2)}.`,
            'Plan de ahorro creado',
            'success'
        );
    } catch (error) {
        mostrarAlerta(error.message, 'Error', 'error');
    } finally {
        boton.disabled = false;
        boton.textContent = 'Guardar plan';
    }
};

window.abrirSeccionPlanesAhorro = async () => {
    cambiarSeccion('seccionPlanesAhorro');
    await window.abrirHistorialPlanesAhorro();
};

window.abrirHistorialPlanesAhorro = async () => {
    try {
        const respuesta = await apiFetch(`${URL_PLANES_AHORRO}/historial`);
        const datos = await respuesta.json();

        if (!respuesta.ok) {
            throw new Error(datos.error || 'No se pudo cargar el historial.');
        }

        historialPlanesAhorroCache = datos;
        renderizarHistorialPlanesAhorro(datos);
    } catch (error) {
        mostrarAlerta(error.message, 'Error al cargar historial', 'error');
    }
};

window.filtrarHistorialPlanesAhorro = () => {
    const texto = document
        .getElementById('filtroHistorialPlanes')
        .value
        .trim()
        .toLowerCase();

    const filtrados = historialPlanesAhorroCache.filter(plan =>
        [
            plan.plan_id,
            plan.cliente,
            plan.producto,
            plan.estado
        ].join(' ').toLowerCase().includes(texto)
    );

    renderizarHistorialPlanesAhorro(filtrados);
};

function renderizarHistorialPlanesAhorro(planes) {
    const tbody = document.getElementById('tablaHistorialPlanesAhorro');
    tbody.replaceChildren();

    if (planes.length === 0) {
        const fila = document.createElement('tr');
        const celda = document.createElement('td');
        celda.colSpan = 9;
        celda.className = 'p-4 text-center text-gray-500';
        celda.textContent = 'No hay planes que coincidan con la búsqueda.';
        fila.appendChild(celda);
        tbody.appendChild(fila);
        return;
    }

    const dinero = valor => Number(valor || 0).toLocaleString('es-AR', {
        style: 'currency',
        currency: 'ARS'
    });

    for (const plan of planes) {
        const fila = document.createElement('tr');
        fila.className = 'border-b dark:border-slate-700';

        const valores = [
            `#${plan.plan_id}`,
            plan.cliente || '',
            plan.producto || '',
            plan.estado || '',
            dinero(plan.total_recibido),
            dinero(plan.total_devuelto),
            dinero(plan.total_aplicado),
            dinero(plan.saldo_disponible)
        ];

        valores.forEach((valor, indice) => {
            const celda = document.createElement('td');
            celda.className = indice >= 4 ? 'p-3 text-right' : 'p-3';
            celda.textContent = valor;
            fila.appendChild(celda);
        });

        const celdaAcciones = document.createElement('td');
        celdaAcciones.className = 'p-3 whitespace-nowrap';

        if (plan.estado === 'Activo') {
            const acciones = [
                ['💰', 'Registrar anticipo', 'anticipo'],
                ['↩️', 'Devolver / cancelar', 'devolucion'],
                ['🏍️', 'Adjudicar moto', 'adjudicar']
            ];

            for (const [emoji, titulo, accion] of acciones) {
                const boton = document.createElement('button');
                boton.type = 'button';
                boton.textContent = emoji;
                boton.title = titulo;
                boton.setAttribute('aria-label', titulo);
                boton.className = 'text-blue-500 hover:scale-150 transition-transform mr-2';
                boton.addEventListener('click', () => {
                    window.abrirAccionPlanAhorro(plan.plan_id, accion);
                });
                celdaAcciones.appendChild(boton);
            }
        } else {
            celdaAcciones.textContent = '—';
        }

        fila.appendChild(celdaAcciones);

        tbody.appendChild(fila);
    }
}


window.abrirAdjudicacionPlan = async () => {
    const plan = planAhorroSeleccionado;

    if (!plan) {
        mostrarAlerta('Seleccioná un plan activo.', 'Falta el plan', 'warning');
        return;
    }

    const planId = plan.plan_id;
    const productoId = plan.producto_id;
    const unidadSelect = document.getElementById('adjudicarUnidad');
    const botonAdjudicar = document.getElementById('btnConfirmarAdjudicacion');

    try {
        botonAdjudicar.disabled = true;
        unidadSelect.replaceChildren();

        const respuesta = await apiFetch(
            `${API_BASE_URL}/api/productos/${productoId}/unidades-disponibles`
        );

        if (!respuesta.ok) {
            throw new Error('No se pudieron cargar las unidades disponibles.');
        }

        const unidades = await respuesta.json();

        if (unidades.length === 0) {
            mostrarAlerta(
                'No hay unidades físicas disponibles para este modelo. Registrá la moto con su chasis y motor antes de adjudicar.',
                'Sin unidades disponibles',
                'warning'
            );
            return;
        }

        for (const unidad of unidades) {
            const opcion = document.createElement('option');
            opcion.value = unidad.id;
            opcion.textContent =
                `Chasis ${unidad.chasis} — Motor ${unidad.motor}` +
                `${unidad.color ? ` — ${unidad.color}` : ''}`;
            unidadSelect.appendChild(opcion);
        }

        document.getElementById('adjudicarPlanResumen').textContent =
        `Plan #${planId} — ${plan.cliente} — ${plan.producto}`

        document.getElementById('adjudicarPrecioActual').textContent =
            `Precio de referencia actual: $${Number(plan.precio_actual || 0).toFixed(2)}. El servidor lo verificará nuevamente al confirmar.`;

        document.getElementById('adjudicarMetodoPago').value = 'Efectivo';
        document.getElementById('adjudicarCamposCuotas').classList.add('hidden');

        document.getElementById('modalAnticipoPlan').classList.add('hidden');
        document.getElementById('modalAdjudicarPlan').classList.remove('hidden');
    } catch (error) {
        mostrarAlerta(error.message, 'Error al cargar unidades', 'error');
    } finally {
        botonAdjudicar.disabled = false;
    }
};

document.getElementById('adjudicarMetodoPago').addEventListener('change', (event) => {
    const camposCuotas = document.getElementById('adjudicarCamposCuotas');

    if (event.target.value === 'Cuotas') {
        camposCuotas.classList.remove('hidden');
    } else {
        camposCuotas.classList.add('hidden');
    }
});

window.abrirDevolucionPlan = () => {
    const plan = planAhorroSeleccionado;

    if (!plan) {
        mostrarAlerta('Seleccioná un plan activo.', 'Falta el plan', 'warning');
        return;
    }

    const saldo = Number(plan.saldo_a_favor || 0);

    document.getElementById('devolucionPlanResumen').textContent =
        `Plan #${plan.plan_id} — ${plan.cliente} — ${plan.producto}`;

    document.getElementById('devolucionPlanSaldo').textContent =
        `Saldo disponible para devolver: $${saldo.toFixed(2)}`;

    document.getElementById('devolucionPlanImporte').value = '';
    document.getElementById('devolucionPlanImporte').max = saldo.toFixed(2);
    document.getElementById('devolucionPlanImporte').disabled = false;
    document.getElementById('devolucionPlanMedioPago').value = 'Efectivo';
    document.getElementById('devolucionPlanObservaciones').value = '';
    document.getElementById('devolucionCancelarPlan').checked = false;

    document.getElementById('modalAnticipoPlan').classList.add('hidden');
    document.getElementById('modalDevolucionPlan').classList.remove('hidden');
};

document.getElementById('devolucionCancelarPlan').addEventListener('change', event => {
    const campoImporte = document.getElementById('devolucionPlanImporte');
    const saldo = Number(planAhorroSeleccionado?.saldo_a_favor || 0);

    if (event.target.checked) {
        campoImporte.value = saldo.toFixed(2);
        campoImporte.disabled = true;
    } else {
        campoImporte.value = '';
        campoImporte.disabled = false;
    }
});

window.confirmarDevolucionPlan = async () => {
    const plan = planAhorroSeleccionado;

    if (!plan) {
        mostrarAlerta('Seleccioná un plan activo.', 'Falta el plan', 'warning');
        return;
    }

    const boton = document.getElementById('btnConfirmarDevolucionPlan');
    const importe = Number(document.getElementById('devolucionPlanImporte').value || 0);
    const cancelarPlan = document.getElementById('devolucionCancelarPlan').checked;
    const saldoDisponible = Number(plan.saldo_a_favor || 0);

    if (importe < 0 || importe > saldoDisponible) {
        mostrarAlerta(
            'El importe debe estar entre cero y el saldo disponible del plan.',
            'Importe inválido',
            'warning'
        );
        return;
    }

    if (!cancelarPlan && importe <= 0) {
        mostrarAlerta('La devolución debe ser mayor que cero.', 'Importe inválido', 'warning');
        return;
    }

    boton.disabled = true;
    boton.textContent = 'Procesando...';

    try {
        const respuesta = await apiFetch(
            `${URL_PLANES_AHORRO}/${plan.plan_id}/devoluciones`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    importe,
                    medio_pago: document.getElementById('devolucionPlanMedioPago').value,
                    observaciones: document.getElementById('devolucionPlanObservaciones').value,
                    cancelar_plan: cancelarPlan
                })
            }
        );

        const resultado = await respuesta.json();

        if (!respuesta.ok) {
            throw new Error(resultado.error || 'No se pudo registrar la devolución.');
        }

        await window.abrirHistorialPlanesAhorro();

        document.getElementById('modalDevolucionPlan').classList.add('hidden');

        if (resultado.comprobante) {
            const imprimir = await mostrarConfirmacion({
                title: 'Imprimir comprobante de devolución',
                message: `Se registró la devolución del plan #${plan.plan_id}. ¿Querés abrir el comprobante?`,
                confirmText: 'Imprimir',
                cancelText: 'No imprimir'
            });

            if (imprimir) {
                try {
                    const doc = await generarReciboDevolucionPlanPDF(resultado.comprobante);
                    abrirPreviewPDF(
                        doc,
                        `DevolucionPlan_${plan.plan_id}_${resultado.comprobante.devolucion_id}.pdf`
                    );
                } catch (error) {
                    console.error('Error al generar el comprobante de devolución:', error);
                    await mostrarAlerta(
                        'La devolución se guardó, pero no se pudo generar el comprobante.',
                        'Error al imprimir',
                        'error'
                    );
                }
            }
        }

        await mostrarAlerta(
            resultado.mensaje,
            cancelarPlan ? 'Plan cancelado' : 'Devolución registrada',
            'success'
        );

    } catch (error) {
        mostrarAlerta(error.message, 'Error en la devolución', 'error');
    } finally {
        boton.disabled = false;
        boton.textContent = 'Confirmar devolución';
    }
};

window.confirmarAdjudicacionPlan = async () => {
    const planId = planAhorroSeleccionado?.plan_id;
    const unidadId = document.getElementById('adjudicarUnidad').value;
    const metodoPago = document.getElementById('adjudicarMetodoPago').value;
    const boton = document.getElementById('btnConfirmarAdjudicacion');

    if (!planId || !unidadId) {
        mostrarAlerta('Seleccioná el plan y la unidad física.', 'Datos incompletos', 'warning');
        return;
    }

    const datos = {
        unidad_id: Number(unidadId),
        metodo_pago: metodoPago
    };

    if (metodoPago === 'Cuotas') {
        const cantidad = Number(document.getElementById('adjudicarCantidadCuotas').value);
        const dia = Number(document.getElementById('adjudicarDiaVencimiento').value);

        if (!Number.isInteger(cantidad) || cantidad <= 0) {
            mostrarAlerta('La cantidad de cuotas debe ser mayor que cero.', 'Cuotas inválidas', 'warning');
            return;
        }

        if (!Number.isInteger(dia) || dia < 1 || dia > 31) {
            mostrarAlerta('El día de vencimiento debe estar entre 1 y 31.', 'Día inválido', 'warning');
            return;
        }

        datos.cuotas = {
            cantidad,
            dia_vencimiento: dia
        };
    }

    boton.disabled = true;
    boton.textContent = 'Adjudicando...';

    try {
        const respuesta = await apiFetch(
            `${URL_PLANES_AHORRO}/${planId}/adjudicar`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(datos)
            }
        );

        const resultado = await respuesta.json();

        if (!respuesta.ok) {
            throw new Error(resultado.error || 'No se pudo adjudicar el plan.');
        }
        
        await window.abrirHistorialPlanesAhorro();
        document.getElementById('modalAdjudicarPlan').classList.add('hidden');

        let mensaje =
            `Venta #${resultado.numero_venta} creada. ` +
            `Precio: $${Number(resultado.precio_vigente).toFixed(2)}. ` +
            `Anticipos aplicados: $${Number(resultado.anticipos_aplicados).toFixed(2)}.`;

        if (Number(resultado.saldo_financiado) > 0) {
            mensaje += ` Saldo financiado: $${Number(resultado.saldo_financiado).toFixed(2)}.`;
        }

        await mostrarAlerta(mensaje, 'Plan adjudicado', 'success');
        await listarVentas();
        if (typeof window.renderDashboard === 'function') {
            await window.renderDashboard();
        }
    } catch (error) {
        mostrarAlerta(error.message, 'Error al adjudicar', 'error');
    } finally {
        boton.disabled = false;
        boton.textContent = 'Confirmar adjudicación';
    }
};

window.guardarAnticipoPlan = async () => {
    
    const boton = document.getElementById('btnGuardarAnticipoPlan');
    const planId = planAhorroSeleccionado?.plan_id;
    const importe = Number(document.getElementById('anticipoPlanImporte').value);

    if (!planId) {
        mostrarAlerta('Seleccioná un plan activo.', 'Falta el plan', 'warning');
        return;
    }

    if (!Number.isFinite(importe) || importe <= 0) {
        mostrarAlerta('El importe debe ser mayor que cero.', 'Importe inválido', 'warning');
        return;
    }

    boton.disabled = true;
    boton.textContent = 'Guardando...';

    try {
        const respuesta = await apiFetch(`${URL_PLANES_AHORRO}/${planId}/anticipos`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                importe,
                medio_pago: document.getElementById('anticipoPlanMedioPago').value,
                observaciones: document.getElementById('anticipoPlanObservaciones').value
            })
        });

        const resultado = await respuesta.json();

        if (!respuesta.ok) {
            throw new Error(resultado.error || 'No se pudo registrar el anticipo.');
        }

        document.getElementById('modalAnticipoPlan').classList.add('hidden');
        boton.disabled = false;
        boton.textContent = 'Guardar anticipo';

        if (resultado.comprobante) {
            const imprimir = await mostrarConfirmacion({
                title: 'Imprimir comprobante de anticipo',
                message: `Se registró el anticipo del plan #${planId}. ¿Querés abrir el comprobante?`,
                confirmText: 'Imprimir',
                cancelText: 'No imprimir'
            });

            if (imprimir) {
                try {
                    const doc = await generarReciboAnticipoPDF(resultado.comprobante);
                    abrirPreviewPDF(
                        doc,
                        `AnticipoPlan_${planId}_${resultado.anticipo_id}.pdf`
                    );
                } catch (error) {
                    console.error('Error al generar el comprobante del anticipo:', error);
                    mostrarAlerta(
                        'El anticipo se guardó, pero no se pudo generar el comprobante.',
                        'Error al imprimir',
                        'error'
                    );
                }
            }
        } else {
            mostrarAlerta(
                'El anticipo se guardó, pero el servidor no devolvió los datos del comprobante.',
                'Anticipo registrado',
                'warning'
            );
        }
    } catch (error) {
        mostrarAlerta(error.message, 'Error', 'error');
    } finally {
        boton.disabled = false;
        boton.textContent = 'Guardar anticipo';
    }
};

async function cargarPlanActivoParaAccion(planId) {
    const respuesta = await apiFetch(URL_PLANES_AHORRO);
    const planes = await respuesta.json();

    if (!respuesta.ok) {
        throw new Error(planes.error || 'No se pudieron cargar los planes activos.');
    }

    const plan = planes.find(item => String(item.plan_id) === String(planId));

    if (!plan) {
        throw new Error('El plan ya no está activo o no se encontró.');
    }

    planAhorroSeleccionado = plan;
    return plan;
}

window.abrirAccionPlanAhorro = async (planId, accion) => {
    try {
        const plan = await cargarPlanActivoParaAccion(planId);

        if (accion === 'anticipo') {
            document.getElementById('anticipoPlanSaldo').textContent =
                `Anticipos acumulados: $${Number(plan.saldo_a_favor || 0).toFixed(2)}`;
            document.getElementById('anticipoPlanImporte').value = '';
            document.getElementById('anticipoPlanMedioPago').value = 'Efectivo';
            document.getElementById('anticipoPlanObservaciones').value = '';
            document.getElementById('btnGuardarAnticipoPlan').disabled = false;
            document.getElementById('modalAnticipoPlan').classList.remove('hidden');
            return;
        }

        if (accion === 'devolucion') {
            window.abrirDevolucionPlan();
            return;
        }

        if (accion === 'adjudicar') {
            await window.abrirAdjudicacionPlan();
        }
    } catch (error) {
        mostrarAlerta(error.message, 'Error al abrir la acción', 'error');
    }
};

window.toggleCamposCtaCte = () => {
    const metodo = document.getElementById("pago-metodo").value;
    const divCtaCte = document.getElementById("campos-ctacte");
    const divCuotas = document.getElementById("campos-cuotas");
    if (metodo === "Cuenta Corriente") {
        divCtaCte.classList.remove("hidden");
        calcularSaldoCtaCte();
    } else {
        divCtaCte.classList.add("hidden");
    }

    if (metodo === "Cuotas") {
        divCuotas.classList.remove("hidden");
        actualizarResumenCuotas();
    } else {
        divCuotas.classList.add("hidden");
    }
};

window.calcularSaldoCtaCte = () => {
    const total = carritoVenta.reduce((sum, i) => sum + i.subtotal, 0);
    const entrega = parseFloat(document.getElementById("pago-entrega").value) || 0;
    const saldo = total - entrega;
    document.getElementById("pago-saldo-final").innerText = `$${saldo.toFixed(2)}`;
};

function actualizarResumenCuotas() {
    const total = carritoVenta.reduce((sum, i) => sum + i.subtotal, 0);
    const entrega = parseFloat(document.getElementById("pago-cuotas-entrega")?.value) || 0;
    const cantidad = parseInt(document.getElementById("pago-cuotas-cantidad")?.value, 10) || 1;
    const diaVencimiento = parseInt(document.getElementById("pago-cuotas-dia-vencimiento")?.value, 10) || 1;
    const montoCuota = cantidad > 0 ? total / cantidad : 0;
    const saldoPendiente = Math.max(total - entrega, 0);
    const cuotasCubiertas = montoCuota > 0 ? Math.floor(entrega / montoCuota) : 0;
    const entregaTexto = entrega > 0
        ? ` Entrega $${entrega.toFixed(2)} imputada a ${cuotasCubiertas > 0 ? `${cuotasCubiertas} cuota${cuotasCubiertas > 1 ? 's' : ''}` : 'la primera cuota'}.`
        : "";
    const resumen = document.getElementById("pago-cuotas-resumen");
    if (resumen) {
        resumen.innerText = `${cantidad} cuotas de $${montoCuota.toFixed(2)} con vencimiento el día ${diaVencimiento} de cada mes.${entregaTexto} Saldo pendiente $${saldoPendiente.toFixed(2)}.`;
    }
}

window.procesarVentaFinal = async () => {
    const btnConfirmar = document.getElementById("btn-confirmar-final");
    
    // Determinar si es consumidor final o cliente registrado
    const inputCliente = document.getElementById("v-cliente-input");
    const clienteTexto = inputCliente ? inputCliente.value.trim() : "Consumidor Final";
    const esConsumidorFinal = clienteTexto === "Consumidor Final" || !window.clienteSeleccionadoVenta;
    const idCliente = esConsumidorFinal ? 0 : window.clienteSeleccionadoVenta;
    
    const metodoPago = document.getElementById("pago-metodo").value;
    const entregaInicial = metodoPago === "Cuotas"
        ? (parseFloat(document.getElementById("pago-cuotas-entrega").value) || 0)
        : (parseFloat(document.getElementById("pago-entrega").value) || 0);
    const observaciones = document.getElementById("v-observaciones").value;

    const totalVenta = carritoVenta.reduce((sum, i) => sum + i.subtotal, 0);

    if (carritoVenta.length === 0) {
        mostrarAlerta("El carrito está vacío.", "Sin productos", "warning");
        return;
    }
    if (metodoPago === "Cuenta Corriente" && esConsumidorFinal) {
        mostrarAlerta("No se puede fiar a un Consumidor Final.", "Método de pago inválido", "error");
        return;
    }
    if (metodoPago === "Cuotas" && esConsumidorFinal) {
        mostrarAlerta("Seleccioná un cliente registrado para vender en cuotas.", "Método de pago inválido", "error");
        return;
    }
    if (metodoPago === "Cuotas") {
        const diaVencimiento = parseInt(document.getElementById("pago-cuotas-dia-vencimiento").value, 10);
        if (!Number.isInteger(diaVencimiento) || diaVencimiento < 1 || diaVencimiento > 31) {
            mostrarAlerta("Ingresá un día de vencimiento entre 1 y 31.", "Plan de cuotas inválido", "error");
            return;
        }
    }
    if (['Cuenta Corriente', 'Cuotas'].includes(metodoPago) && (entregaInicial < 0 || entregaInicial >= totalVenta)) {
        mostrarAlerta("La entrega debe ser menor al total de la venta.", "Entrega inválida", "warning");
        return;
    }

    // Validar si el vehículo tiene su chasis/motor seleccionado antes de enviar
    const vehiculoSinUnidad = carritoVenta.find(item => item.esVehiculo && !item.unidadSeleccionadaId);
    if (vehiculoSinUnidad) {
        mostrarAlerta(`Por favor, seleccioná el Chasis/Motor para el vehículo: "${vehiculoSinUnidad.descripcion}".`, "Falta seleccionar unidad", "warning");
        return;
    }

    // Validar que el cliente tenga crédito habilitado para cuenta corriente
    if (metodoPago === "Cuenta Corriente" && !esConsumidorFinal && window.clienteSeleccionadoVenta) {
        try {
            const clientes = await fetchClientes();
            const cliente = clientes.find(c => c.id == window.clienteSeleccionadoVenta);
            if (!cliente || !cliente.habilitar_cc) {
                mostrarAlerta(`El cliente ${cliente ? cliente.nombre + ' ' + cliente.apellido : 'seleccionado'} no tiene habilitado el crédito.`, "Crédito no habilitado", "error");
                btnConfirmar.disabled = false;
                btnConfirmar.innerText = "CONFIRMAR VENTA";
                return;
            }
        } catch (error) {
            console.error("Error al validar crédito del cliente:", error);
            mostrarAlerta("Error al validar el crédito del cliente.", "Error", "error");
            btnConfirmar.disabled = false;
            btnConfirmar.innerText = "CONFIRMAR VENTA";
            return;
        }
    }

    btnConfirmar.disabled = true;
    btnConfirmar.innerText = "Procesando...";

    const datosVenta = {
        cliente_id: idCliente,
        total: totalVenta,
        metodo_pago: metodoPago,
        entrega_inicial: entregaInicial,
        observaciones: observaciones,
        cuotas: metodoPago === "Cuotas"
            ? {
                cantidad: parseInt(document.getElementById("pago-cuotas-cantidad").value, 10),
                dia_vencimiento: parseInt(document.getElementById("pago-cuotas-dia-vencimiento").value, 10)
            }
            : null,
        items: carritoVenta.map(item => ({
            id: item.id,
            cantidad: item.cantidad,
            precio: item.precio,
            unidadSeleccionadaId: item.unidadSeleccionadaId || null // <-- NUEVO: Enviamos el ID técnico elegido
        }))
    };

    try {
        const respuesta = await apiFetch(URL_API, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(datosVenta)
        });

        const resultado = await respuesta.json();

        if (respuesta.ok) {
            const ventaSimulada = {
                id: resultado.ventaId,
                numero: resultado.numero,
                numero_plan_pagos: resultado.numeroPlanPagos,
                fecha: new Date(),
                cliente_id: idCliente,
                total: totalVenta,
                saldo_pendiente: totalVenta - entregaInicial,
                metodo_pago: metodoPago,
                entrega_inicial: entregaInicial,
                observaciones: observaciones
            };

            // CORRECCIÓN HISTÓRICA: Usamos los detalles oficiales devueltos por el backend con los datos del vehículo ya cargados
            const detallesReales = resultado.detalles || []; 
            const cuotasGeneradas = Array.isArray(resultado.cuotas) ? resultado.cuotas : [];
            const esVentaEnCuotas = metodoPago === "Cuotas";

            await mostrarAlerta("Venta realizada con éxito.", "¡Éxito!", "success");
            const imprimirComprobante = await mostrarConfirmacion({
                title: esVentaEnCuotas ? "Imprimir plan de pagos" : "Imprimir comprobante",
                message: esVentaEnCuotas
                    ? "¿Querés imprimir el plan de pagos de esta venta?"
                    : "¿Querés imprimir el comprobante de esta venta?",
                confirmText: esVentaEnCuotas ? "Imprimir plan" : "Imprimir",
                cancelText: "No imprimir"
            });

            if (imprimirComprobante) {
                // Al pasarle 'detallesReales', el generador de PDF tendrá acceso directo a chasis, motor, marca y modelo
                const doc = esVentaEnCuotas
                    ? await generarPlanPagosPDF(ventaSimulada, detallesReales, cuotasGeneradas)
                    : await generarFacturaPDFExistente(ventaSimulada, detallesReales);
                const numeroArchivo = esVentaEnCuotas
                    ? (ventaSimulada.numero_plan_pagos || ventaSimulada.numero || ventaSimulada.id)
                    : (ventaSimulada.numero || ventaSimulada.id);
                abrirPreviewPDF(doc, `${esVentaEnCuotas ? 'PlanPagos' : 'Factura'}_${formatearNumeroDocumento(numeroArchivo)}.pdf`);
            }

            cerrarModalPago();
            // Resetear para nueva venta
            carritoVenta = [];
            document.getElementById("v-observaciones").value = "";
            document.getElementById("v-cliente-input").value = "Consumidor Final";
            window.clienteSeleccionadoVenta = null;
            actualizarTablaVenta(carritoVenta);
            cambiarSeccion('pantallaGenerarVenta');
            
            setTimeout(() => {
                setSkuFocus();
                setTimeout(() => setSkuFocus(), 300);
                setTimeout(() => setSkuFocus(), 600);
            }, 1500);
        } else {
            throw new Error(resultado.error || "Error desconocido al guardar.");
        }
    } catch (error) {
        mostrarAlerta("Error al procesar venta: " + error.message, "Error", "error");
    } finally {
        btnConfirmar.disabled = false;
        btnConfirmar.innerText = "Confirmar Venta";
    }
};

window.cerrarModalPago = () => document.getElementById("modalPago").classList.add("hidden");

async function cargarDatosVenta(id) {
    const resVenta = await apiFetch(`${URL_API}/${id}`);
    const venta = await resVenta.json();
    const resDetalle = await apiFetch(`${URL_API}/${id}/detalle`);
    const detalles = await resDetalle.json();
    const cuotas = venta.metodo_pago === "Cuotas" ? await fetchCuotasVenta(id) : [];
    window.ventaActual = venta;
    window.detallesActual = detalles;
    window.cuotasActual = cuotas;
    return { venta, detalles, cuotas };
}

async function fetchCuotasVenta(id) {
    const response = await apiFetch(`${URL_API}/${id}/cuotas`);
    if (!response.ok) return [];
    return await response.json();
}

window.verDetalleVenta = async (id) => {
    const { venta, detalles } = await cargarDatosVenta(id);

    if (!venta) {
        mostrarAlerta("Venta no encontrada", "Error", "error");
        return;
    }

    document.getElementById("md-titulo").innerText = `Detalle de Venta #${venta.numero || venta.id}`;
    document.getElementById("md-fecha").innerText = new Date(venta.fecha).toLocaleString('es-AR');
    document.getElementById("md-cliente").innerText = venta.cliente_nombre ? `${venta.cliente_nombre} ${venta.cliente_apellido}` : "Consumidor Final";
    document.getElementById("md-total-final").innerText = `$${parseFloat(venta.total).toFixed(2)}`;
    document.getElementById("md-pendiente").innerText = `$${parseFloat(venta.saldo_pendiente).toFixed(2)}`;
    document.getElementById("md-observaciones").innerText = venta.observaciones || "Sin observaciones.";

    const saldo = parseFloat(venta.saldo_pendiente);
    const contenedorEstado = document.getElementById("md-estado");
    const txtPendiente = document.getElementById("md-pendiente");
    if (saldo > 0) {
        txtPendiente.classList.add("text-red-600", "animate-pulse");
    } else {
        txtPendiente.classList.remove("text-red-600", "animate-pulse");
        txtPendiente.classList.add("text-gray-400");
    }

    const btnCobrar = document.getElementById("btn-md-cobrar");
    const btnPlanPagos = document.getElementById("btn-md-plan-pagos");
    btnPlanPagos?.classList.toggle("hidden", venta.metodo_pago !== "Cuotas");

    if (saldo > 0) {
        btnCobrar.classList.remove("hidden");
        const idDelCliente = venta.cliente_id;
        btnCobrar.onclick = () => {
            cambiarSeccion('seccionVentas');
            abrirPantallaCobranza(venta.id, idDelCliente, saldo);
        };
    } else {
        btnCobrar.classList.add("hidden");
    }

    cambiarSeccion('pantalla-detalle-venta');

    if (saldo <= 0) {
        contenedorEstado.innerHTML = `
            <div class="flex flex-col items-center">
                <span class="px-4 py-1 bg-green-500 text-white rounded-full text-xs font-black uppercase tracking-widest shadow-sm">
                    FINALIZADA
                </span>
                <span class="text-[10px] text-green-600 mt-1 font-bold">Cobro Total</span>
            </div>`;
    } else if (saldo < parseFloat(venta.total)) {
        contenedorEstado.innerHTML = `
            <div class="flex flex-col items-center">
                <span class="px-4 py-1 bg-orange-500 text-white rounded-full text-xs font-black uppercase tracking-widest shadow-sm">
                    PAGO PARCIAL
                </span>
                <span class="text-[10px] text-orange-600 mt-1 font-bold">Pendiente de Cobro</span>
            </div>`;
    } else {
        contenedorEstado.innerHTML = `
            <div class="flex flex-col items-center">
                <span class="px-4 py-1 bg-red-500 text-white rounded-full text-xs font-black uppercase tracking-widest shadow-sm">
                    PENDIENTE
                </span>
                <span class="text-[10px] text-red-600 mt-1 font-bold">Cuenta Corriente</span>
            </div>`;
    }

    const body = document.getElementById("md-items-body");
    body.innerHTML = detalles.map(d => `
        <tr class="text-sm">
            <td class="py-4 font-mono text-gray-500">${d.sku}</td>
            <td class="py-4 font-medium dark:text-white">
                <div>${d.descripcion}</div>
                ${(d.vehiculo_chasis || d.vehiculo_motor) ? `
                    <div class="mt-1 text-xs text-gray-500 dark:text-gray-400 font-normal space-y-0.5">
                        ${d.marca || d.modelo ? `<div>Marca/Modelo: ${d.marca || ''} ${d.modelo || ''}</div>` : ''}
                        ${d.vehiculo_chasis ? `<div>Chasis: ${d.vehiculo_chasis}</div>` : ''}
                        ${d.vehiculo_motor ? `<div>Motor: ${d.vehiculo_motor}</div>` : ''}
                        ${d.vehiculo_color ? `<div>Color: ${d.vehiculo_color}</div>` : ''}
                        ${d.vehiculo_anio ? `<div>Año: ${d.vehiculo_anio}</div>` : ''}
                        ${d.patente ? `<div>Patente: ${d.patente}</div>` : ''}
                    </div>
                ` : ''}
            </td>
            <td class="py-4 text-right font-mono">$${parseFloat(d.precio_unitario).toFixed(2)}</td>
            <td class="py-4 text-center font-bold text-blue-600">x${d.cantidad}</td>
            <td class="py-4 text-right font-black dark:text-white font-mono">$${(d.cantidad * d.precio_unitario).toFixed(2)}</td>
        </tr>
    `).join('');
};

// 1. Variables para guardar temporalmente los datos de la venta activa
let ventaIdActual = null;
let saldoActual = 0;

let clienteIdActualCobranza = null;
let ventasPendientesModal = [];
let ventasSeleccionadasModal = new Set();
let modoCobranzaCuotas = false;

function formatearMoneda(valor) {
    return `$${parseFloat(valor || 0).toFixed(2)}`;
}

function obtenerTotalSeleccionadoModal() {
    return ventasPendientesModal
        .filter(v => ventasSeleccionadasModal.has(v.id))
        .reduce((acc, v) => acc + parseFloat(v.saldo_pendiente || 0), 0);
}

function actualizarResumenPagoModal() {
    const totalSeleccionado = obtenerTotalSeleccionadoModal();
    const montoInput = document.getElementById('modalPago-monto');
    const saldoEl = document.getElementById('modalPago-saldo');
    const totalEl = document.getElementById('modalPago-totalSeleccionado');
    const monto = parseFloat(montoInput.value) || 0;
    const saldo = totalSeleccionado - monto;

    totalEl.textContent = formatearMoneda(totalSeleccionado);
    saldoEl.textContent = formatearMoneda(saldo);
    saldoEl.classList.toggle("text-red-600", saldo > 0);
    saldoEl.classList.toggle("text-green-600", saldo <= 0);
}

function renderVentasPendientesModal() {
    // DIAGNÓSTICO: Esta línea nos mostrará en la consola exactamente qué propiedades tiene cada fila
    console.log("CONTENIDO DE VENTAS/CUOTAS EN MODAL:", ventasPendientesModal);

    const tbody = document.getElementById('modalPago-ventasPendientes');
    const titulo = document.getElementById('modalPago-listaTitulo');
    const todasSeleccionadas = ventasPendientesModal.length > 0 && ventasPendientesModal.every(v => ventasSeleccionadasModal.has(v.id));
    
    if (titulo) {
        titulo.textContent = modoCobranzaCuotas ? "Cuotas pendientes" : "Ventas pendientes del cliente";
    }
    
    const headerSeleccionarTodos = `
    <tr class="bg-gray-50 dark:bg-slate-800">
        <td class="p-2">
            <input 
                type="checkbox"
                id="modalPago-check-todos"
                class="h-4 w-4"
                ${todasSeleccionadas ? "checked" : ""}
            >
        </td>
        <td class="p-2 font-bold" colspan="3">Seleccionar todos</td>
    </tr>
`;

    tbody.innerHTML = headerSeleccionarTodos + ventasPendientesModal.map(v => {
        let textoIdentificador = v.label || `#${v.id}`;
        
        // Simplificamos la condición: Si la propiedad existe en el objeto, la usamos directamente
        if (v.factura_numero) {
            textoIdentificador = `Factura #${v.factura_numero} (Cuota ${v.numero_cuota})`;
        } else if (v.numero) {
            textoIdentificador = `Factura #${v.numero}`;
        }

        return `
            <tr>
                <td class="p-2">
                    <input 
                        type="checkbox"
                        class="modalPago-check-venta h-4 w-4"
                        data-venta-id="${v.id}"
                        ${ventasSeleccionadasModal.has(v.id) ? "checked" : ""}
                    >
                </td>
                <td class="p-2 font-semibold">${textoIdentificador}</td>
                <td class="p-2">${new Date(v.fecha || v.fecha_vencimiento).toLocaleDateString('es-AR')}</td>
                <td class="p-2 text-right font-mono text-red-600">${formatearMoneda(v.saldo_pendiente)}</td>
            </tr>
        `;
    }).join('');

    const checkTodos = document.getElementById('modalPago-check-todos');

    if (checkTodos) {
        checkTodos.addEventListener('change', (e) => {
            if (e.target.checked) {
                ventasSeleccionadasModal = new Set(ventasPendientesModal.map(v => v.id));
            } else {
                ventasSeleccionadasModal.clear();
            }

            const totalSeleccionado = obtenerTotalSeleccionadoModal();
            const inputMonto = document.getElementById('modalPago-monto');

            if (e.target.checked) {
                inputMonto.value = totalSeleccionado.toFixed(2);
            } else {
                inputMonto.value = "0.00";
            }

            renderVentasPendientesModal();
            actualizarResumenPagoModal();
        });
    }

    document.querySelectorAll('.modalPago-check-venta').forEach(check => {
        check.addEventListener('change', (e) => {
            const id = Number(e.target.dataset.ventaId);
            if (e.target.checked) {
                ventasSeleccionadasModal.add(id);
            } else {
                ventasSeleccionadasModal.delete(id);
            }

            const totalSeleccionado = obtenerTotalSeleccionadoModal();
            const inputMonto = document.getElementById('modalPago-monto');
            if ((parseFloat(inputMonto.value) || 0) > totalSeleccionado) {
                inputMonto.value = totalSeleccionado.toFixed(2);
            }
            actualizarResumenPagoModal();
        });
    });
}

// 2. Adaptación de la función para ABRIR el modal
window.abrirPantallaCobranza = async (ventaId, clienteId, saldoPendiente, ventasPendientes = null) => {
    // Guardamos los IDs para usarlos luego al presionar "Aceptar"
    ventaIdActual = ventaId;
    saldoActual = saldoPendiente;
    clienteIdActualCobranza = clienteId;

    // Referencias a los elementos del modal que me pasaste
    const modal = document.getElementById('modalRegistroPago');
    const inputMonto = document.getElementById('modalPago-monto');
    const inputObs = document.getElementById('modalPago-observaciones');
    const metodoInput = document.getElementById('modalPago-metodo');

    const params = new URLSearchParams();
    if (ventaId) params.set("ventaId", ventaId);
    if (clienteId) params.set("clienteId", clienteId);

    try {
        const response = await apiFetch(`${URL_API}/cuotas-pendientes?${params.toString()}`);
        const cuotas = response.ok ? await response.json() : [];
        modoCobranzaCuotas = cuotas.length > 0;
        if (modoCobranzaCuotas) {
            ventasPendientesModal = cuotas.map(c => ({
                id: c.id,
                venta_id: c.venta_id,
                label: `Factura #${c.factura_numero || c.venta_id} - Cuota ${c.numero_cuota}`,
                fecha: c.fecha_vencimiento,
                saldo_pendiente: c.saldo_pendiente
            }));
            ventasSeleccionadasModal = new Set([ventasPendientesModal[0].id]);
        } else {
            ventasPendientesModal = Array.isArray(ventasPendientes) && ventasPendientes.length > 0
                ? ventasPendientes
                : [{ id: ventaId, fecha: new Date().toISOString(), saldo_pendiente: saldoPendiente }];
            ventasSeleccionadasModal = new Set([ventaId]);
        }
    } catch (error) {
        console.error("Error cargando cuotas pendientes:", error);
        modoCobranzaCuotas = false;
        ventasPendientesModal = Array.isArray(ventasPendientes) && ventasPendientes.length > 0
            ? ventasPendientes
            : [{ id: ventaId, fecha: new Date().toISOString(), saldo_pendiente: saldoPendiente }];
        ventasSeleccionadasModal = new Set([ventaId]);
    }

    renderVentasPendientesModal();
    inputMonto.value = obtenerTotalSeleccionadoModal().toFixed(2);
    inputObs.value = "";
    metodoInput.value = "Efectivo";
    actualizarResumenPagoModal();

    inputMonto.oninput = () => actualizarResumenPagoModal();

    // Mostramos el modal quitando la clase 'hidden' de Tailwind
    modal.classList.remove('hidden');
};

// 2. Adaptación de la función para ABRIR el modal
window.abrirPantallaCobranza = async (ventaId, clienteId, saldoPendiente, ventasPendientes = null) => {
    // Guardamos los IDs para usarlos luego al presionar "Aceptar"
    ventaIdActual = ventaId;
    saldoActual = saldoPendiente;
    clienteIdActualCobranza = clienteId;

    // Referencias a los elementos del modal que me pasaste
    const modal = document.getElementById('modalRegistroPago');
    const inputMonto = document.getElementById('modalPago-monto');
    const inputObs = document.getElementById('modalPago-observaciones');
    const metodoInput = document.getElementById('modalPago-metodo');

    const params = new URLSearchParams();
    if (ventaId) params.set("ventaId", ventaId);
    if (clienteId) params.set("clienteId", clienteId);

    try {
        const response = await apiFetch(`${URL_API}/cuotas-pendientes?${params.toString()}`);
        const cuotas = response.ok ? await response.json() : [];
        modoCobranzaCuotas = cuotas.length > 0;
        if (modoCobranzaCuotas) {
            ventasPendientesModal = cuotas.map(c => ({
                id: c.id,
                venta_id: c.venta_id,
                label: `Factura #${c.factura_numero || c.venta_id} - Cuota ${c.numero_cuota}`,
                fecha: c.fecha_vencimiento,
                saldo_pendiente: c.saldo_pendiente
            }));
            ventasSeleccionadasModal = new Set([ventasPendientesModal[0].id]);
        } else {
            ventasPendientesModal = Array.isArray(ventasPendientes) && ventasPendientes.length > 0
                ? ventasPendientes
                : [{ id: ventaId, fecha: new Date().toISOString(), saldo_pendiente: saldoPendiente }];
            ventasSeleccionadasModal = new Set([ventaId]);
        }
    } catch (error) {
        console.error("Error cargando :", error);
        modoCobranzaCuotas = false;
        ventasPendientesModal = Array.isArray(ventasPendientes) && ventasPendientes.length > 0
            ? ventasPendientes
            : [{ id: ventaId, fecha: new Date().toISOString(), saldo_pendiente: saldoPendiente }];
        ventasSeleccionadasModal = new Set([ventaId]);
    }

    renderVentasPendientesModal();
    inputMonto.value = obtenerTotalSeleccionadoModal().toFixed(2);
    inputObs.value = "";
    metodoInput.value = "Efectivo";
    actualizarResumenPagoModal();

    inputMonto.oninput = () => actualizarResumenPagoModal();

    // Mostramos el modal quitando la clase 'hidden' de Tailwind
    modal.classList.remove('hidden');
};

// 3. Lógica para el botón CANCELAR
document.getElementById('btnCancelRegistroPago').addEventListener('click', () => {
    document.getElementById('modalRegistroPago').classList.add('hidden');
    // Limpiamos las variables de control por seguridad
    ventaIdActual = null;
    clienteIdActualCobranza = null;
    saldoActual = 0;
    ventasPendientesModal = [];
    ventasSeleccionadasModal.clear();
    modoCobranzaCuotas = false;
});

// 4. Lógica para el botón ACEPTAR (Procesar el pago)
document.getElementById('btnAcceptRegistroPago').addEventListener('click', async () => {
    // Referencias a los inputs del modal
    const montoInput = document.getElementById('modalPago-monto');
    const metodoInput = document.getElementById('modalPago-metodo');
    const obsInput = document.getElementById('modalPago-observaciones');
    
    const monto = parseFloat(montoInput.value);
    const metodo = metodoInput.value;
    const observaciones = obsInput.value;
    const totalSeleccionado = obtenerTotalSeleccionadoModal();

    // --- VALIDACIONES BÁSICAS ---
    if (ventasSeleccionadasModal.size === 0) {
        mostrarAlerta("Seleccioná al menos una venta pendiente.", "Sin selección", "warning");
        return;
    }
    if (!monto || monto <= 0) {
        mostrarAlerta("Por favor, ingrese un monto válido.", "Monto inválido", "warning");
        return;
    }

    if (monto > totalSeleccionado) {
        mostrarAlerta("El monto no puede ser mayor al total seleccionado (" + formatearMoneda(totalSeleccionado) + ").", "Monto excedido", "error");
        return;
    }

    // --- ENVÍO DE DATOS AL BACKEND ---
    try {
        // Bloqueamos el botón para evitar doble clic accidental
        const btnAceptar = document.getElementById('btnAcceptRegistroPago');
        btnAceptar.disabled = true;
        btnAceptar.textContent = "Procesando...";

        const ventasSeleccionadas = ventasPendientesModal
            .filter(v => ventasSeleccionadasModal.has(v.id))
            .sort((a, b) => new Date(a.fecha) - new Date(b.fecha));

        let montoRestante = monto;
        const pagosRealizados = [];

        if (modoCobranzaCuotas) {
            const gruposPorVenta = {};

            ventasSeleccionadas.forEach(cuota => {
                const ventaId = cuota.venta_id;

                if (!gruposPorVenta[ventaId]) {
                    gruposPorVenta[ventaId] = {
                        ventaId: ventaId,
                        montoTotal: 0,
                        cuotaIds: [],
                        cuotas: []
                    };
                }

                gruposPorVenta[ventaId].montoTotal += parseFloat(cuota.saldo_pendiente || 0);
                gruposPorVenta[ventaId].cuotaIds.push(cuota.id);
                gruposPorVenta[ventaId].cuotas.push(cuota);
            });

            for (const grupo of Object.values(gruposPorVenta)) {
                const response = await apiFetch(`${URL_API}/${grupo.ventaId}/pago`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        monto: grupo.montoTotal,
                        metodo: metodo,
                        observaciones: observaciones,
                        cuota_ids: grupo.cuotaIds
                    })
                });

                const data = await response.json();

                if (!response.ok || !data.success) {
                    throw new Error(data.error || `No se pudo registrar el pago de la venta #${grupo.ventaId}`);
                }

                pagosRealizados.push({
                    ventaId: grupo.ventaId,
                    montoPagado: grupo.montoTotal,
                    nuevoSaldo: data.nuevoSaldo,
                    reciboId: data.reciboId || null,
                    reciboNumero: data.reciboNumero || null,
                    cuotasCanceladas: grupo.cuotas
                });
            }
        } else {
            let montoRestante = monto;

            for (const venta of ventasSeleccionadas) {
                if (montoRestante <= 0) break;

                const saldoVenta = parseFloat(venta.saldo_pendiente);
                const montoParaVenta = Math.min(montoRestante, saldoVenta);

                const response = await apiFetch(`${URL_API}/${venta.id}/pago`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        monto: montoParaVenta,
                        metodo: metodo,
                        observaciones: observaciones
                    })
                });

                const data = await response.json();

                if (!response.ok || !data.success) {
                    throw new Error(data.error || `No se pudo registrar el pago de la venta #${venta.id}`);
                }

                pagosRealizados.push({
                    ventaId: venta.id,
                    montoPagado: montoParaVenta,
                    nuevoSaldo: data.nuevoSaldo,
                    reciboId: data.reciboId || null,
                    reciboNumero: data.reciboNumero || null,
                    cuotasCanceladas: []
                });

                montoRestante -= montoParaVenta;
            }
        }

        if (pagosRealizados.length === 0) {
            mostrarAlerta("No se registraron pagos.", "Sin pagos", "warning");
            return;
        }

        mostrarAlerta(`¡Pago registrado con éxito! Ventas afectadas: ${pagosRealizados.length}`, "¡Éxito!", "success");

        document.getElementById('modalRegistroPago').classList.add('hidden');
        const comprobantesCancelados = pagosRealizados
            .filter(p => parseFloat(p.nuevoSaldo) <= 0)
            .map(p => Number(p.ventaId));

        const imprimirRecibo = await mostrarConfirmacion({
            title: 'Imprimir recibo',
            message: '¿Deseas imprimir el recibo de pago?',
            confirmText: 'Sí, imprimir',
            cancelText: 'No'
        });

        if (imprimirRecibo) {
            for (const pago of pagosRealizados) {
                const ventaActualizada = await fetchVentaPorId(pago.ventaId);
                const comprobantesCanceladosNumeros = parseFloat(pago.nuevoSaldo) <= 0 && ventaActualizada
                    ? [ventaActualizada.numero || ventaActualizada.id]
                    : [];
                const doc = await generarReciboPagoPDF(
                    ventaActualizada,
                    pago.montoPagado,
                    pago.nuevoSaldo,
                    comprobantesCanceladosNumeros,
                    observaciones,
                    metodo,
                    pago.reciboNumero,
                    pago.cuotasCanceladas || []
                );
                abrirPreviewPDF(doc, `ReciboPago_${pago.reciboNumero || (ventaActualizada ? (ventaActualizada.numero || ventaActualizada.id) : 'sin-id')}.pdf`);
            }
        }
        // 5. Si hay cliente de balance seleccionado, volver a esa pantalla y refrescar datos
        if (window.currentBalanceClienteId) {
            cambiarSeccion("pantalla-balance-cliente");
            await cargarDatosBalance(window.currentBalanceClienteId);
        }

        await listarVentas();

    } catch (error) {
        console.error("Error en la petición:", error);
        mostrarAlerta("Hubo un error de conexión con el servidor.", "Error de conexión", "error");
    } finally {
        // Reestablecemos el botón pase lo que pase
        const btnAceptar = document.getElementById('btnAcceptRegistroPago');
        btnAceptar.disabled = false;
        btnAceptar.textContent = "Aceptar";
    }
});

window.cerrarModalDetalle = () => {
    cambiarSeccion('seccionVentas');
};

window.abrirPagoDesdeBalance = async () => {
    const clienteId = window.currentBalanceClienteId;
    if (!clienteId) {
        mostrarAlerta("No hay cliente seleccionado en el balance.", "Cliente no seleccionado", "warning");
        return;
    }

    try {
        const response = await apiFetch(URL_API);
        if (!response.ok) throw new Error("No se pudieron cargar las ventas");
        const ventas = await response.json();
        const cuotasResponse = await apiFetch(`${URL_API}/cuotas-pendientes?clienteId=${clienteId}`);
        const cuotasPendientes = cuotasResponse.ok ? await cuotasResponse.json() : [];
        if (cuotasPendientes.length > 0) {
            const primera = cuotasPendientes[0];
            abrirPantallaCobranza(
                primera.venta_id,
                clienteId,
                cuotasPendientes.reduce((sum, c) => sum + parseFloat(c.saldo_pendiente || 0), 0)
            );
            return;
        }

        const ventasPendientes = ventas.filter(v => v.cliente_id == clienteId && parseFloat(v.saldo_pendiente) > 0);

        if (ventasPendientes.length === 0) {
            mostrarAlerta("No hay facturas pendientes para este cliente.", "Sin deudas pendientes", "info");
            return;
        }

        const primeraVenta = ventasPendientes[0];
        abrirPantallaCobranza(
            primeraVenta.id,
            clienteId,
            parseFloat(primeraVenta.saldo_pendiente),
            ventasPendientes
        );
    } catch (error) {
        console.error(error);
        mostrarAlerta("Error al cargar las ventas para el balance.", "Error", "error");
    }
};

function abrirPreviewPDF(doc, nombreArchivo = "documento.pdf") {
    const blob = doc.output("blob");
    const url = URL.createObjectURL(blob);

    const win = window.open(url, "_blank");
    if (!win) {
        mostrarAlerta("El navegador bloqueó la ventana emergente. Permití popups para este sitio.", "Popup bloqueado", "warning");
        return;
    }

    // Guardado opcional programático (si después querés botón aparte)
    win.addEventListener("load", () => {
        // Nota: el visor nativo del navegador ya ofrece guardar/imprimir.
        // Dejamos el nombre disponible por si luego agregás descarga manual.
        win.document.title = nombreArchivo;
    });

    // Limpieza de memoria
    setTimeout(() => URL.revokeObjectURL(url), 60000);
}


window.imprimirReciboPagoMov = async (ventaId, monto, saldo, observacionesCodificadas = "") => {
    try {
        const venta = await fetchVentaPorId(ventaId);
        if (!venta) {
            mostrarAlerta("No se encontró la venta para generar el recibo.", "Venta no encontrada", "error");
            return;
        }
        const comprobantesCancelados = parseFloat(saldo) <= 0 ? [ventaId] : [];
        const observacionesPago = observacionesCodificadas
            ? decodeURIComponent(observacionesCodificadas)
            : "";
        const doc = await generarReciboPagoPDF(venta, monto, saldo, comprobantesCancelados, observacionesPago, venta.metodo_pago);
        abrirPreviewPDF(doc, `ReciboPago_${venta ? (venta.numero || venta.id) : 'sin-id'}.pdf`);
    } catch (error) {
        console.error("Error generando recibo de pago:", error);
        mostrarAlerta("No se pudo generar el recibo de pago.", "Error", "error");
    }
};

async function fetchVentaPorId(ventaId) {
    const response = await apiFetch(URL_API);
    if (!response.ok) throw new Error("No se pudieron cargar las ventas");
    const ventas = await response.json();
    return ventas.find(v => v.id == ventaId);
}

async function generarReciboPagoPDF(venta, montoPagado, nuevoSaldo, comprobantesCancelados = [], observacionesPago = "", metodoPago = null, reciboNumero = null, cuotasCanceladas = []) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 20;
    let y = margin;

    doc.setFontSize(20);
    doc.setFont("helvetica", "bold");
    doc.text("RECIBO DE PAGO", pageWidth / 2, y, { align: "center" });
    y += 12;

    const datosEmpresa = await obtenerDatosEmpresaActual();
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(datosEmpresa.razonSocial, margin, y);
    y += 5;
    doc.text(`CUIT: ${datosEmpresa.cuit}`, margin, y);
    y += 5;
    doc.text(`Domicilio: ${datosEmpresa.domicilio}`, margin, y);
    y += 10;

    doc.text(`Fecha: ${new Date().toLocaleDateString('es-AR')}`, pageWidth - margin, y, { align: "right" });
    y += 5;
    doc.text(`Recibo N°: ${formatearNumeroDocumento(reciboNumero || venta?.recibo_numero || venta?.reciboId || 1)}`, pageWidth - margin, y, { align: "right" });
    y += 10;

    doc.setFont("helvetica", "bold");
    doc.text("Cliente:", margin, y);
    doc.setFont("helvetica", "normal");
    y += 5;

    let clienteData = "Consumidor Final";
    if (venta && venta.cliente_id > 0) {
        const clientes = await fetchClientes();
        const cliente = clientes.find(c => c.id == venta.cliente_id);
        if (cliente) {
            clienteData = `${cliente.nombre} ${cliente.apellido}\nDNI: ${cliente.dni || 'N/A'}\nCUIT: ${cliente.cuit || 'N/A'}\nDirección: ${cliente.direccion || 'N/A'}`;
        }
    }
    const clienteLines = doc.splitTextToSize(clienteData, pageWidth - 2 * margin);
    doc.text(clienteLines, margin, y);
    y += clienteLines.length * 5 + 10;

    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("Detalle:", margin, y);
    y += 8;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text (`Recibi la suma de: $${parseFloat(montoPagado).toFixed(2)}.`, margin, y);
    y += 7;
    doc.text(`en concepto de pago de Factura N° ${venta ? formatearNumeroDocumento(venta.numero || venta.id) : '---'}.`, margin, y);
    y += 7;
    const metodoPagoTexto = metodoPago || venta?.metodo_pago || "No especificado";
    doc.text(`Método de pago: ${metodoPagoTexto}`, margin, y);
    y += 7;
    doc.text(`Saldo de cuenta corriente después del pago: $${parseFloat(nuevoSaldo).toFixed(2)}.`, margin, y);
    y += 15;

    if (cuotasCanceladas.length > 0) {
        doc.setFont("helvetica", "bold");
        doc.text("Cuotas canceladas:", margin, y);
        y += 6;

        doc.setFont("helvetica", "normal");

        cuotasCanceladas.forEach(cuota => {
            doc.text(
                `${cuota.label} - Importe: $${parseFloat(cuota.saldo_pendiente || 0).toFixed(2)}`,
                margin,
                y
            );
            y += 6;
        });

        y += 6;
    }

    if (comprobantesCancelados.length > 0) {
        const comprobantesFormateados = comprobantesCancelados.map(numero => formatearNumeroDocumento(numero));
        doc.setFont("helvetica", "bold");
        doc.text("Comprobantes cancelados:", margin, y);
        y += 5;
        doc.setFont("helvetica", "normal");
        const comprobantesTexto = doc.splitTextToSize(comprobantesFormateados.join(", "), pageWidth - 2 * margin);
        doc.text(comprobantesTexto, margin, y);
        y += comprobantesTexto.length * 5 + 8;
    }

    const observaciones = observacionesPago?.trim() || venta?.observaciones || "Sin observaciones";
    doc.text("Observaciones:", margin, y);
    y += 5;
    const obsLines = doc.splitTextToSize(observaciones, pageWidth - 2 * margin);
    doc.text(obsLines, margin, y);
    y += obsLines.length * 5 + 10;

    doc.setFontSize(8);
    doc.text("Este recibo documenta el pago de la factura indicada y el saldo de la cuenta corriente.", pageWidth / 2, y, { align: "center" });

    return doc;
}
async function generarReciboAnticipoPDF(anticipo) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 20;
    let y = margin;

    const datosEmpresa = await obtenerDatosEmpresaActual();
    const fecha = new Date(anticipo.fecha).toLocaleString('es-AR');
    const importe = Number(anticipo.importe).toLocaleString('es-AR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });

    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text('COMPROBANTE INTERNO DE ANTICIPO', pageWidth / 2, y, { align: 'center' });
    y += 12;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(datosEmpresa.razonSocial, margin, y);
    y += 5;
    doc.text(`CUIT: ${datosEmpresa.cuit}`, margin, y);
    y += 5;
    doc.text(`Domicilio: ${datosEmpresa.domicilio}`, margin, y);
    y += 10;

    doc.text(`Anticipo interno N°: ${anticipo.anticipo_id}`, margin, y);
    y += 5;
    doc.text(`Fecha: ${fecha}`, margin, y);
    y += 10;

    doc.setFont('helvetica', 'bold');
    doc.text('Cliente:', margin, y);
    y += 5;

    doc.setFont('helvetica', 'normal');
    doc.text(anticipo.cliente || 'Sin nombre', margin, y);
    y += 5;
    doc.text(`DNI: ${anticipo.dni || 'No informado'}`, margin, y);
    y += 5;
    doc.text(`CUIT: ${anticipo.cuit || 'No informado'}`, margin, y);
    y += 10;

    doc.setFont('helvetica', 'bold');
    doc.text('Detalle del pago:', margin, y);
    y += 7;

    doc.setFont('helvetica', 'normal');
    doc.text(`Plan de ahorro N°: ${anticipo.plan_id}`, margin, y);
    y += 6;
    doc.text(`Modelo solicitado: ${anticipo.producto || 'No informado'}`, margin, y);
    y += 6;
    doc.text(`Importe recibido: $${importe}`, margin, y);
    y += 6;
    doc.text(`Total acumulado del plan después de este pago: $${Number(anticipo.saldo_acumulado || 0).toFixed(2)}`, margin, y);
    y += 6;
    doc.text(`Medio de pago: ${anticipo.medio_pago}`, margin, y);
    y += 12;

    const aclaracion =
        'Este pago se registra a cuenta del plan de ahorro. No constituye una venta ni congela el precio de la moto. El precio se determinará al momento de la adjudicación.';

    const lineasAclaracion = doc.splitTextToSize(aclaracion, pageWidth - 2 * margin);
    doc.setFontSize(9);
    doc.text(lineasAclaracion, margin, y);

    return doc;
}

async function generarReciboDevolucionPlanPDF(devolucion) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 20;
    let y = margin;

    const empresa = await obtenerDatosEmpresaActual();
    const fecha = new Date(devolucion.fecha).toLocaleString('es-AR');
    const importe = Number(devolucion.importe_total).toLocaleString('es-AR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });

    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text('COMPROBANTE INTERNO DE DEVOLUCIÓN', pageWidth / 2, y, {
        align: 'center'
    });
    y += 12;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(empresa.razonSocial, margin, y);
    y += 5;
    doc.text(`CUIT: ${empresa.cuit}`, margin, y);
    y += 5;
    doc.text(`Domicilio: ${empresa.domicilio}`, margin, y);
    y += 10;

    doc.text(`Devolución interna N°: ${devolucion.devolucion_id}`, margin, y);
    y += 5;
    doc.text(`Fecha: ${fecha}`, margin, y);
    y += 10;

    doc.setFont('helvetica', 'bold');
    doc.text('Cliente:', margin, y);
    y += 5;

    doc.setFont('helvetica', 'normal');
    doc.text(devolucion.cliente || 'Sin nombre', margin, y);
    y += 5;
    doc.text(`DNI: ${devolucion.dni || 'No informado'}`, margin, y);
    y += 10;

    doc.setFont('helvetica', 'bold');
    doc.text('Detalle:', margin, y);
    y += 7;

    doc.setFont('helvetica', 'normal');
    doc.text(`Plan de ahorro N°: ${devolucion.plan_id}`, margin, y);
    y += 6;
    doc.text(`Modelo: ${devolucion.producto || 'No informado'}`, margin, y);
    y += 6;
    doc.text(`Importe devuelto: $${importe}`, margin, y);
    y += 6;
    doc.text(`Medio de devolución: ${devolucion.medio_pago}`, margin, y);
    y += 6;

    if (Number(devolucion.cancela_plan) === 1) {
        doc.text('El plan quedó cancelado.', margin, y);
        y += 6;
    }

    y += 4;
    doc.text('Observaciones:', margin, y);
    y += 5;

    const observaciones = devolucion.observaciones || 'Sin observaciones';
    const lineas = doc.splitTextToSize(observaciones, pageWidth - 2 * margin);
    doc.text(lineas, margin, y);

    y += lineas.length * 5 + 10;
    doc.setFontSize(8);
    doc.text(
        'Comprobante interno de devolución. No es un comprobante fiscal.',
        pageWidth / 2,
        y,
        { align: 'center' }
    );

    return doc;
}

window.imprimirVenta = (id) => {
    mostrarAlerta("Generando PDF para la venta " + id, "Generando PDF", "info");
};

// Función para anular una venta de forma segura
window.anularVenta = async (id) => {
    const confirmacion = await mostrarConfirmacion({
        title: "Anular venta",
        message: `¿Estás seguro de que querés anular la venta? Esta acción no se puede deshacer y revertirá los movimientos asociados a stock y caja.`,
        confirmText: "Anular"
    });
    if (!confirmacion) return;

    // 2. Solicitamos un motivo para la anulación (importante para auditorías)
    const motivo = prompt("Por favor, ingresa el motivo de la anulación:");
    if (motivo === null) return; // Si cancela el prompt
    if (!motivo.trim()) {
        mostrarAlerta("Debes ingresar un motivo válido para anular la venta.", "Motivo requerido", "error");
        return;
    }

    try {
        // 3. Llamamos al endpoint de anulación que ya tienes en tu backend
        const response = await apiFetch(`${API_BASE_URL}/api/ventas/${id}/anular`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                motivo: motivo.trim(),
                revertStock: true,      // Revertimos automáticamente las existencias de productos
                revertCtaCte: true       // Revertimos el balance de la cuenta corriente del cliente
            })
        });

        const resultado = await response.json();

        if (response.ok && resultado.success) {
        mostrarAlerta("La venta ha sido anulada correctamente.", "Venta Anulada", "success");
        
        // 4. Refrescamos y re-renderizamos la tabla automáticamente
        if (typeof obtenerHistorialVentas === "function") {
            // Almacenamos el array actualizado de ventas que devuelve tu función
            const ventasActualizadas = await obtenerHistorialVentas(); 
            
            // Si la función devuelve las filas (o si están globales), forzamos el re-renderizado
            if (ventasActualizadas && typeof renderTablaVentas === "function") {
                renderTablaVentas(ventasActualizadas);
                if (typeof window.renderDashboard === "function") {
                    await window.renderDashboard();
                }
            } else {
                // Alternativa segura: Si tu función 'obtenerHistorialVentas' no retorna el array directamente
                // simplemente recargamos la sección emulando el clic de forma automática:
                const linkVentas = document.getElementById("linkVentas");
                if (linkVentas) linkVentas.click();
            }
        }
        } else {
                throw new Error(resultado.error || "No se pudo anular la venta.");
            }
    } catch (error) {
        mostrarAlerta("Error al anular la venta: " + error.message, "Error", "error");
    }
};


export async function initVentas() {
    carritoVenta = [];

    const btnNuevaVenta = document.getElementById("btn-nueva-venta");
    if (btnNuevaVenta) {
        btnNuevaVenta.addEventListener("click", () => {
            carritoVenta = [];
            document.getElementById("v-observaciones").value = "";
            document.getElementById("v-cliente-input").value = "Consumidor Final";
            window.clienteSeleccionadoVenta = null;
            actualizarTablaVenta(carritoVenta);
            cambiarSeccion('pantallaGenerarVenta');
            setSkuFocus();
        });
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === "Escape" || e.keyCode === 27) {
            const modalBusqueda = document.getElementById("modalBuscadorProductos");
            if (modalBusqueda && !modalBusqueda.classList.contains("hidden")) {
                cerrarBuscadorProductos();
                return;
            }

            const modalBusquedaClientes = document.getElementById("modalBuscadorClientes");
            if (modalBusquedaClientes && !modalBusquedaClientes.classList.contains("hidden")) {
                cerrarBuscadorClientes();
                return;
            }

            const modalPago = document.getElementById("modalPago");
            if (modalPago && !modalPago.classList.contains("hidden")) {
                cerrarModalPago();
                return;
            }

            const pantallaVenta = document.getElementById("pantallaGenerarVenta");
            if (pantallaVenta && !pantallaVenta.classList.contains("hidden")) {
                volverALista();
            }
        }
    });

    setSkuFocus();
    addPagoEntregaListener();
    await cargarDatosParaVenta();

}

export async function listarVentas(estado = 'todos') {
    ventasEstado = estado;
    const cuerpoTabla = document.getElementById("cuerpo-tabla-ventas");
    if (!cuerpoTabla) return;

    try {
        const url = `${URL_API}?estado=${estado}`;
        const respuesta = await apiFetch(url);
        if (!respuesta.ok) throw new Error("Error al obtener ventas");
        const ventas = await respuesta.json();
        ventasCache = ventas;
        renderTablaVentas(ventas);
    } catch (error) {
        console.error("Error al listar ventas:", error);
    }
}

function formatearFechaDocumento(fecha) {
    if (!fecha) return "-";
    if (typeof fecha === 'string') {
        const match = fecha.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (match) {
            const [, anio, mes, dia] = match;
            return new Date(Number(anio), Number(mes) - 1, Number(dia)).toLocaleDateString('es-AR');
        }
    }
    const parsed = new Date(fecha);
    if (Number.isNaN(parsed.getTime())) return "-";
    return parsed.toLocaleDateString('es-AR');
}

async function obtenerDatosClienteDocumento(venta) {
    if (!venta?.cliente_id || Number(venta.cliente_id) <= 0) {
        return ["Consumidor Final"];
    }

    if (venta.cliente_nombre || venta.cliente_apellido) {
        return [`${venta.cliente_nombre || ''} ${venta.cliente_apellido || ''}`.trim()];
    }

    const clientes = await fetchClientes();
    const cliente = clientes.find(c => c.id == venta.cliente_id);
    if (!cliente) return ["Cliente registrado"];

    return [
        `${cliente.nombre || ''} ${cliente.apellido || ''}`.trim(),
        cliente.dni ? `DNI: ${cliente.dni}` : '',
        cliente.cuit ? `CUIT: ${cliente.cuit}` : '',
        cliente.direccion ? `Dirección: ${cliente.direccion}` : '',
        cliente.telefono ? `Teléfono: ${cliente.telefono}` : ''
    ].filter(Boolean);
}

async function generarPlanPagosPDF(venta, detalles, cuotas) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF("p", "mm", "a4");
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 20;
    let y = margin;

    const datosEmpresa = await obtenerDatosEmpresaActual();
    const cuotasNormalizadas = (cuotas || []).map((cuota, index) => ({
        numero: cuota.numero_cuota || cuota.numero || index + 1,
        fecha_vencimiento: cuota.fecha_vencimiento,
        fecha_pago: cuota.fecha_pago,
        monto: parseFloat(cuota.monto || 0),
        saldo_pendiente: cuota.saldo_pendiente !== undefined ? parseFloat(cuota.saldo_pendiente || 0) : parseFloat(cuota.monto || 0),
        recibo_id: cuota.recibo_id || null,
        recibo_numero: cuota.recibo_numero || null,
        estado: cuota.estado || 'Pendiente'
    }));
    const totalCuotas = cuotasNormalizadas.reduce((sum, cuota) => sum + cuota.monto, 0);
    const saldoPendientePlan = cuotasNormalizadas.reduce((sum, cuota) => sum + cuota.saldo_pendiente, 0);
    const totalOperacion = parseFloat(venta.total || 0);
    const totalPlan = totalCuotas || totalOperacion;
    const entregaInicial = venta.entrega_inicial !== undefined
        ? parseFloat(venta.entrega_inicial || 0)
        : Math.max(totalOperacion - saldoPendientePlan, 0);

    const nuevaPaginaSiHaceFalta = (altoNecesario = 20) => {
        if (y + altoNecesario <= pageHeight - margin) return;
        doc.addPage();
        y = margin;
    };

    doc.setFontSize(18);
    doc.setFont("helvetica", "bold");
    doc.text("PLAN DE PAGOS", pageWidth / 2, y, { align: "center" });
    y += 8;

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`N°: ${formatearNumeroDocumento(venta.numero_plan_pagos || venta.numero || venta.id)}`, pageWidth / 2, y, { align: "center" });
    y += 12;

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`Factura N°: ${formatearNumeroDocumento(venta.numero || venta.id)}`, pageWidth - margin, y - 12, { align: "right" });

    doc.setLineWidth(0.5);
    doc.line(margin, y, pageWidth - margin, y);
    y += 6;

    doc.setFont("helvetica", "bold");
    doc.text(datosEmpresa.razonSocial, margin, y);
    doc.setFont("helvetica", "normal");
    doc.text(`Fecha: ${formatearFechaDocumento(venta.fecha)}`, pageWidth - margin, y, { align: "right" });
    y += 5;
    doc.text(`CUIT: ${datosEmpresa.cuit}`, margin, y);
    y += 5;
    doc.text(`Domicilio: ${datosEmpresa.domicilio}`, margin, y);
    y += 10;

    doc.setFont("helvetica", "bold");
    doc.text("Cliente", margin, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    const clienteLines = await obtenerDatosClienteDocumento(venta);
    doc.text(clienteLines, margin, y);
    y += clienteLines.length * 5 + 8;

    doc.setFont("helvetica", "bold");
    doc.text("Resumen de la operación", margin, y);
    y += 6;
    doc.setFont("helvetica", "normal");
    doc.text(`Total de la operación: $${totalOperacion.toFixed(2)}`, margin, y);
    doc.text(`Cantidad de cuotas: ${cuotasNormalizadas.length}`, pageWidth - margin, y, { align: "right" });
    y += 5;
    doc.text(`Entrega inicial: $${entregaInicial.toFixed(2)}`, margin, y);
    doc.text(`Total del plan: $${totalPlan.toFixed(2)}`, pageWidth - margin, y, { align: "right" });
    y += 5;
    doc.text(`Método de pago: ${venta.metodo_pago || 'Cuotas'}`, margin, y);
    doc.text(`Saldo pendiente: $${parseFloat(venta.saldo_pendiente ?? saldoPendientePlan).toFixed(2)}`, pageWidth - margin, y, { align: "right" });
    y += 10;

    nuevaPaginaSiHaceFalta(35);
    doc.setFont("helvetica", "bold");
    doc.text("Detalle de productos", margin, y);
    y += 8;
    doc.setFontSize(9);
    doc.text("Cant.", margin, y);
    doc.text("Descripción", margin + 20, y);
    doc.text("P.Unit.", pageWidth - 70, y, { align: "right" });
    doc.text("Subtotal", pageWidth - margin, y, { align: "right" });
    y += 4;
    doc.line(margin, y, pageWidth - margin, y);
    y += 5;
    doc.setFont("helvetica", "normal");

    detalles.forEach(item => {
        // Calculamos cuántas líneas va a ocupar el bloque para prever el salto de página exacto
        let lineasAdicionalesVehiculo = 0;
        let textoEspecificaciones = "";
        // Verificamos si el ítem tiene cargadas las características técnicas del vehículo
        if (item.vehiculo_chasis || item.vehiculo_motor) {
            let datosInteres = [];
            if (item.marca || item.modelo) datosInteres.push(`Marca/Mod: ${item.marca || ''} ${item.modelo || ''}`);
            if (item.vehiculo_año) datosInteres.push(`Año: ${item.vehiculo_año}`);
            if (item.patente || item.dominio) datosInteres.push(`Patente: ${item.patente || item.dominio}`);
            if (item.vehiculo_motor) datosInteres.push(`Motor: ${item.vehiculo_motor}`);
            if (item.vehiculo_chasis) datosInteres.push(`Chasis: ${item.vehiculo_chasis}`);
            
            // Concatenamos las propiedades en una sola línea elegante separada por barras
            textoEspecificaciones = `> ${datosInteres.join(" | ")}`;
            lineasAdicionalesVehiculo = 1;
        }
        // Validación dinámica de salto de página considerando la descripción y el bloque técnico
        const descLines = doc.splitTextToSize(item.descripcion || item.descripcion || "-", 150);
        const altoNecesario = (descLines.length * 5) + (lineasAdicionalesVehiculo * 4.5) + 4;
        nuevaPaginaSiHaceFalta(altoNecesario);

        // Imprimimos los datos principales del producto
        doc.text(String(item.cantidad), margin, y);
        doc.text(descLines, margin + 20, y);
        doc.text(`$${parseFloat(item.precio_unitario || item.precio || 0).toFixed(2)}`, pageWidth - 70, y, { align: "right" });
        doc.text(`$${(parseFloat(item.cantidad || 0) * parseFloat(item.precio_unitario || item.precio || 0)).toFixed(2)}`, pageWidth - margin, y, { align: "right" });
        
        // Desplazamos la coordenada 'y' según las líneas del nombre del producto
        y += descLines.length * 5 + 1;

        // Si es un vehículo, imprimimos la línea secundaria de especificaciones
        if (lineasAdicionalesVehiculo > 0) {
            doc.setFont("helvetica", "italic");
            doc.setFontSize(8);
            
            // Le damos una sangría horizontal (margin + 23) para que quede ordenado debajo del título
            doc.text(textoEspecificaciones, margin + 23, y);
            
            y += 4.5; // Espacio que consume la línea técnica

            // Restablecemos la tipografía original para el siguiente producto de la lista
            doc.setFont("helvetica", "normal");
            doc.setFontSize(9);
        }

        y += 2; // Margen de separación extra para el siguiente ítem
    });

    y += 6;
    nuevaPaginaSiHaceFalta(40);
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text("Cronograma de vencimientos", margin, y);
    y += 8;
    doc.setFontSize(8);
    const columnasCuotas = {
        cuota: margin,
        vencimiento: margin + 15,
        pago: margin + 45,
        recibo: margin + 75,
        monto: pageWidth - 75,
        saldo: pageWidth - 45,
        estado: pageWidth - margin
    };
    doc.text("Cuota", columnasCuotas.cuota, y);
    doc.text("Vence", columnasCuotas.vencimiento, y);
    doc.text("Pago", columnasCuotas.pago, y);
    doc.text("Recibo", columnasCuotas.recibo, y);
    doc.text("Monto", columnasCuotas.monto, y, { align: "right" });
    doc.text("Saldo", columnasCuotas.saldo, y, { align: "right" });
    doc.text("Estado", columnasCuotas.estado, y, { align: "right" });
    y += 4;
    doc.line(margin, y, pageWidth - margin, y);
    y += 6;
    doc.setFont("helvetica", "normal");

    cuotasNormalizadas.forEach(cuota => {
        nuevaPaginaSiHaceFalta(10);
        doc.text(String(cuota.numero), columnasCuotas.cuota, y);
        doc.text(formatearFechaDocumento(cuota.fecha_vencimiento), columnasCuotas.vencimiento, y);
        doc.text(cuota.fecha_pago ? formatearFechaDocumento(cuota.fecha_pago) : "-", columnasCuotas.pago, y);
        const reciboTexto = cuota.recibo_numero ? formatearNumeroDocumento(cuota.recibo_numero) : '-';
        doc.text(reciboTexto, columnasCuotas.recibo, y);
        doc.text(`$${cuota.monto.toFixed(2)}`, columnasCuotas.monto, y, { align: "right" });
        doc.text(`$${cuota.saldo_pendiente.toFixed(2)}`, columnasCuotas.saldo, y, { align: "right" });
        doc.text(cuota.estado, columnasCuotas.estado, y, { align: "right" });
        y += 6;
    });

    y += 6;
    nuevaPaginaSiHaceFalta(25);
    doc.setFont("helvetica", "bold");
    doc.text(`TOTAL PLAN: $${totalPlan.toFixed(2)}`, pageWidth - margin, y, { align: "right" });
    y += 10;

    if (venta.observaciones) {
        doc.setFont("helvetica", "normal");
        doc.text("Observaciones:", margin, y);
        y += 5;
        const obsLines = doc.splitTextToSize(venta.observaciones, pageWidth - 2 * margin);
        doc.text(obsLines, margin, y);
    }

    doc.setFontSize(8);
    doc.text("Este documento detalla las condiciones y vencimientos del plan de pagos asociado a la operación.", pageWidth / 2, pageHeight - 20, { align: "center" });

    return doc;
}

async function generarFacturaPDFExistente(venta, detalles) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    // Configuración de página A4
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 20;
    let y = margin;
    const tipoComprobante = "C";
    const codigoComprobante = "011";
    const numeroFactura = formatearNumeroDocumento(venta.numero || venta.id);

    // Encabezado principal
    doc.setFontSize(20);
    doc.setFont("helvetica", "bold");
    doc.text(`FACTURA ${tipoComprobante}`, pageWidth / 2, y, { align: "center" });
    y += 10;

    doc.setFontSize(14);
    doc.text(tipoComprobante, pageWidth / 2, y, { align: "center" });
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.text(`COD. ${codigoComprobante}`, pageWidth / 2, y + 5, { align: "center" });
    y += 15;

    // Línea separadora
    doc.setLineWidth(0.5);
    doc.line(margin, y, pageWidth - margin, y);
    y += 10;

    // Datos del emisor (izquierda)
    const datosEmpresa = await obtenerDatosEmpresaActual();
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(datosEmpresa.razonSocial, margin, y);
    y += 5;
    doc.text(`CUIT: ${datosEmpresa.cuit}`, margin, y);
    y += 5;
    doc.text(`Domicilio: ${datosEmpresa.domicilio}`, margin, y);
    y += 10;

    // Número y fecha (derecha)
    doc.text(`Fecha de emisión: ${new Date(venta.fecha).toLocaleDateString('es-AR')}`, pageWidth - margin, y, { align: "right" });
    y += 5;

    doc.text(`Factura N°: ${numeroFactura}`, pageWidth - margin, y, { align: "right" });
    y += 15;

    // Datos del cliente
    doc.setFont("helvetica", "bold");
    doc.text("Cliente:", margin, y);
    doc.setFont("helvetica", "normal");
    y += 5;

    let clienteData = "Consumidor Final";
    if (venta.cliente_id > 0) {
        const clientes = await fetchClientes();
        const cliente = clientes.find(c => c.id == venta.cliente_id);
        if (cliente) {
            clienteData = `${cliente.nombre} ${cliente.apellido}\nDNI: ${cliente.dni}\nCUIT: ${cliente.cuit}\nDirección: ${cliente.direccion}`;
        }
    }
    const clienteLines = doc.splitTextToSize(clienteData, 80);
    doc.text(clienteLines, margin, y);
    y += clienteLines.length * 5 + 10;

    const metodoPagoTexto = venta.metodo_pago ? `Método de pago: ${venta.metodo_pago}` : "Método de pago: No especificado";
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(metodoPagoTexto, margin, y);
    y += 8;

    // Tabla de detalles
    doc.setFont("helvetica", "bold");
    doc.text("Detalle de la Venta:", margin, y);
    y += 10;

    // Encabezados de tabla
    const tableStartY = y;
    doc.setFontSize(9);
    doc.text("Cant.", margin, y);
    doc.text("Descripción", margin + 20, y);
    doc.text("P.Unit.", pageWidth - 60, y, { align: "right" });
    doc.text("Subtotal", pageWidth - margin, y, { align: "right" });
    y += 5;

    // Línea bajo encabezados
    doc.line(margin, y, pageWidth - margin, y);
    y += 5;

    // Items
    doc.setFont("helvetica", "normal");
    detalles.forEach(item => {
        if (y > pageHeight - 50) {
            doc.addPage();
            y = margin + 10;
        }
        doc.text(item.cantidad.toString(), margin, y);
        const descLines = doc.splitTextToSize(item.descripcion, 80);
        doc.text(descLines, margin + 20, y);
        const precioUnitario = parseFloat(item.precio_unitario || item.precio || 0);
        const cantidad = parseFloat(item.cantidad || 0);

        doc.text(`$${precioUnitario.toFixed(2)}`, pageWidth - 60, y, { align: "right" });
        doc.text(`$${(cantidad * precioUnitario).toFixed(2)}`, pageWidth - margin, y, { align: "right" });
        y += descLines.length * 5 + 2;

        if (item.vehiculo_chasis || item.vehiculo_motor) {
            doc.setFont("helvetica", "italic");
            doc.setFontSize(8.5);
            doc.text("> Características del Vehículo:", margin + 20, y);
            y += 4.5;
            
            // Construimos las líneas de texto técnico según las columnas que traiga tu BD
            let lineasVehiculo = [];
            if (item.marca || item.modelo)lineasVehiculo.push(`Marca/Mod: ${item.marca || ''} ${item.modelo || ''}`);
            if (item.vehiculo_anio) lineasVehiculo.push(`Año: ${item.vehiculo_anio}`);
            if (item.patente || item.dominio) lineasVehiculo.push(`Dominio/Patente: ${item.patente || item.dominio}`);
            if (item.vehiculo_motor) lineasVehiculo.push(`Motor N°: ${item.vehiculo_motor}`);
            if (item.vehiculo_chasis || item.vehiculo_vin) lineasVehiculo.push(`Chasis N°: ${item.vehiculo_chasis || item.vehiculo_vin}`);
            if (item.vehiculo_color) lineasVehiculo.push(`Color: ${item.vehiculo_color}`);
            if (item.vehiculo_anio) lineasVehiculo.push(`Año: ${item.vehiculo_anio}`);

            lineasVehiculo.forEach(linea => {
                // Control preventivo por si las filas hacen que se pase de página
                if (y > pageHeight - 35) {
                    doc.addPage();
                    y = margin + 10;
                }
                doc.text(linea, margin + 25, y);
                y += 4.5;
                });
            // Reestablecemos el tamaño de fuente original para el próximo ítem
            doc.setFontSize(9);
            doc.setFont("helvetica", "normal");
        }
    });
    // Control preventivo de salto de página antes del Total y las Observaciones
    if (y > pageHeight - 60) {
        doc.addPage();
        y = margin + 10;
    }
    // Línea final de tabla
    doc.line(margin, y, pageWidth - margin, y);
    y += 10;

    // Total
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(`TOTAL: $${parseFloat(venta.total).toFixed(2)}`, pageWidth - margin, y, { align: "right" });
    y += 15;

    // Observaciones
    if (venta.observaciones) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.text("Observaciones:", margin, y);
        y += 5;
        const obsLines = doc.splitTextToSize(venta.observaciones, pageWidth - 2 * margin);
        doc.text(obsLines, margin, y);
    }

    // Pie de página
    y = pageHeight - 30;
    doc.setFontSize(8);
    doc.text("Comprobante interno no autorizado electrónicamente por ARCA. No incluye CAE.", pageWidth / 2, y, { align: "center" });

    
    return doc;
}

window.imprimirFactura = async () => {
    if (!window.ventaActual || !window.detallesActual) {
        mostrarAlerta("No hay datos de venta para imprimir.", "Sin datos", "warning");
        return;
    }
    const doc = await generarFacturaPDFExistente(window.ventaActual, window.detallesActual);
    abrirPreviewPDF(doc, `Factura_${formatearNumeroDocumento(window.ventaActual.numero || window.ventaActual.id)}.pdf`);
};

window.imprimirPlanPagosActual = async () => {
    if (!window.ventaActual || window.ventaActual.metodo_pago !== "Cuotas") {
        mostrarAlerta("Esta venta no tiene un plan de pagos asociado.", "Sin plan de pagos", "warning");
        return;
    }

    const cuotas = window.cuotasActual?.length ? window.cuotasActual : await fetchCuotasVenta(window.ventaActual.id);
    const doc = await generarPlanPagosPDF(window.ventaActual, window.detallesActual || [], cuotas);
    abrirPreviewPDF(doc, `PlanPagos_${formatearNumeroDocumento(window.ventaActual.numero_plan_pagos || window.ventaActual.numero || window.ventaActual.id)}.pdf`);
};

window.imprimirVenta = async (id) => {
    await cargarDatosVenta(id);
    await imprimirFactura();
};

window.imprimirPlanPagosVenta = async (id) => {
    await cargarDatosVenta(id);
    await imprimirPlanPagosActual();
};

export async function obtenerHistorialVentas() {
    try {
        const response = await apiFetch(URL_API);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Error al obtener ventas");
        }

        if (!Array.isArray(data)) {
            throw new Error("La respuesta de ventas no tiene el formato esperado");
        }

        return data;
    } catch (error) {
        console.error("Error en obtenerHistorialVentas:", error);
        return [];
    }
}
