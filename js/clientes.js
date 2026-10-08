import { dibujarClientes } from "./renderclientes.js";
import { cambiarSeccion, mostrarAlerta, mostrarConfirmacion } from "./ui.js";
import { API_BASE_URL } from "./config.js";
import { apiFetch } from "./apiClient.js";

const API_URL = `${API_BASE_URL}/api/clientes`;
let clientesEstado = 'activos';
let clientesCache = [];

// 1. OBTENER DATOS (API)
export async function fetchClientes(estado = 'activos') {
    try {
        const url = estado === 'eliminados' ? `${API_URL}?estado=eliminados` : API_URL;
        const res = await apiFetch(url);
        if (!res.ok) throw new Error("Error al obtener clientes");
        return await res.json();
    } catch (error) {
        console.error("Error en fetchClientes:", error);
        return [];
    }
}

// 2. LISTAR (Une API + RENDER)
export async function listarClientes(estado = 'activos') {
    clientesEstado = estado;
    clientesCache = await fetchClientes(estado);
    dibujarClientes(clientesCache, estado);
}

// 3. GUARDAR (API)
export async function guardarClienteAPI(datos, id = null) {
    const method = id ? "PUT" : "POST";
    const url = id ? `${API_URL}/${id}` : API_URL;
    try {
        const res = await apiFetch(url, {
            method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(datos)
        });
        const resultado = await res.json();

        if (!res.ok) {
            return { ok: false, ...resultado };
        }

        return { ok: false, error: error.message };
    } catch (error) {
        mostrarAlerta("❌ " + error.message, "Error", "error");
        return false;
    }
}

// 4. LÓGICA DE FORMULARIO (Mantenimiento de Clientes)
export function configurarFormularioCliente() {
    const formCliente = document.getElementById("formCliente");
    if (!formCliente) return;

    formCliente.onsubmit = async (e) => {
        e.preventDefault();
        const id = document.getElementById("formClienteId").value; // Ajustado según tu modal de edición
        
        const datos = {
            nombre: document.getElementById("nombre").value.trim(),
            apellido: document.getElementById("apellido").value.trim(),
            dni: document.getElementById("dni").value.trim(),
            direccion: document.getElementById("direccion").value.trim(),
            email: document.getElementById("email").value.trim(),
            telefono: document.getElementById("telefono").value.trim(),
            cuit: document.getElementById("cuit").value.trim(),
            arca: document.getElementById("arca").value.trim(),
            habilitar_cc: document.getElementById("clienteHabilitarCC").checked ? 1 : 0
        };

        if (!datos.nombre || !datos.apellido) {
            mostrarAlerta("Nombre y Apellido son obligatorios", "Campos requeridos", "warning");
            return;
        }
        
        let resultado = await guardarClienteAPI(datos, id || null);

        if (!resultado.ok && resultado.codigo === 'DNI_PERTENECE_A_CLIENTE_BORRADO') {
            const nombreAnterior = `${resultado.nombre} ${resultado.apellido}`.trim();
            const confirmado = await mostrarConfirmacion({
                title: 'Reactivar cliente',
                message:
                    `El DNI pertenece al cliente borrado ${nombreAnterior}. ` +
                    '¿Desea reactivar su ficha y actualizarla con los datos ingresados? ' +
                    'Las ventas realizadas a este cliente no se borrarán.',
                confirmText: 'Reactivar',
                cancelText: 'Cancelar'
            });

            if (!confirmado) return;

            try {
                const respuesta = await apiFetch(
                    `${API_URL}/${resultado.cliente_id}/reactivar`,
                    {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(datos)
                    }
                );

                resultado = await respuesta.json();

                if (!respuesta.ok) {
                    throw new Error(resultado.error || 'No se pudo reactivar el cliente.');
                }

                resultado.ok = true;
            } catch (error) {
                mostrarAlerta(error.message, 'Error al reactivar', 'error');
                return;
            }
        }

        if (!resultado.ok) {
            mostrarAlerta(resultado.error || 'No se pudo guardar el cliente.', 'Error', 'error');
            return;
        }

        mostrarAlerta(
            resultado.mensaje || 'Cliente guardado correctamente.',
            '¡Éxito!',
            'success'
        );
        formCliente.reset();
        await listarClientes('activos');

        if (typeof window.cargarDatosParaVenta === 'function') {
            await window.cargarDatosParaVenta();
        }

        cambiarSeccion('seccionClientes');
    };
}

// 5. BUSCADOR DE CLIENTES (Sección Clientes)
export function configurarBuscadorClientes() {
    const inputBusqueda = document.getElementById("buscarCliente");
    if (inputBusqueda) {
        inputBusqueda.oninput = async (e) => {
            const termino = e.target.value.toLowerCase();
            const filtrados = clientesCache.filter(c => 
                (c.nombre || "").toLowerCase().includes(termino) || 
                (c.apellido || "").toLowerCase().includes(termino) ||
                (c.dni || "").toLowerCase().includes(termino)
            );
            dibujarClientes(filtrados, clientesEstado);
        };
    }
}

// 6. PREPARAR EDICIÓN
export async function prepararEdicionCliente(id) {
    const cliente = await fetchClientes();
    const c = cliente.find(cli => cli.id == id);
    if (!c) return;
    // Llenamos el formulario con los datos guardados
    document.getElementById("formClienteId").value = c.id;
    document.getElementById("nombre").value = c.nombre;
    document.getElementById("apellido").value = c.apellido;
    document.getElementById("dni").value = c.dni;
    document.getElementById("direccion").value = c.direccion;
    document.getElementById("email").value = c.email;
    document.getElementById("telefono").value = c.telefono;
    document.getElementById("cuit").value = c.cuit;
    document.getElementById("arca").value = c.arca;
    document.getElementById("clienteHabilitarCC").checked = c.habilitar_cc == 1;
    // Abrimos el modal
    cambiarSeccion('pantallaCliente');
};

export async function eliminarCliente(id, nombre){
    const rta = await mostrarConfirmacion({
        title: "Borrar cliente",
        message: `¿Está seguro de que desea borrar el cliente: ${nombre}? Las ventas realizadas a este cliente no se borrarán.`,
        confirmText: "Borrar",
        cancelText: "Cancelar"
    });
    if (!rta) return;

    try {
        const response = await apiFetch(`${API_BASE_URL}/api/clientes/${id}`, {
            method: 'DELETE'
        });
        if (response.ok) {
            mostrarAlerta("Cliente borrado correctamente. Sus ventas se conservaron.", "¡Éxito!", "success");
            await listarClientes(clientesEstado);
            if (typeof window.cargarDatosParaVenta === "function") {
                await window.cargarDatosParaVenta();
            }
        } else {
            mostrarAlerta("No se pudo eliminar el cliente.", "Error", "error");
        }
    } catch (error) {
        console.error("Error en la conexión:", error);
        mostrarAlerta("Error de conexión al eliminar el cliente.", "Error de conexión", "error");
    }
};

export async function cargarDatosBalance(clienteId) {
    try {
        const res = await apiFetch(`${API_BASE_URL}/api/clientes/${clienteId}/cuenta-corriente`);
        const data = await res.json();
        window.balanceClienteMovimientos = data.movimientos || [];
        window.balanceClienteSaldoTotal = data.saldoTotal || 0;

        document.getElementById("ba-saldo-total").innerText = `$${parseFloat(data.saldoTotal).toFixed(2)}`;
        const totalPagado = data.movimientos.reduce((sum, m) => sum + parseFloat(m.haber), 0);
        document.getElementById("ba-total-pagos").innerText = `$${totalPagado.toFixed(2)}`;

        const body = document.getElementById("ba-tabla-body");
        body.innerHTML = data.movimientos.map(m => `
            <tr class="hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors text-sm">
                <td class="p-3 md:p-4 text-gray-500 whitespace-nowrap">${new Date(m.fecha).toLocaleString('es-AR')}</td>
                <td class="p-3 md:p-4">
                    <span class="font-bold dark:text-white">${m.descripcion}</span>
                    ${m.observaciones ? `<br><span class="text-[11px] text-slate-500 italic">${m.observaciones}</span>` : ''}
                    ${m.venta_id ? `<br><span class="text-[10px] text-blue-500 font-mono italic">REF: Factura #${m.factura_numero || m.venta_id}</span>` : ''}
                </td>
                <td class="p-3 md:p-4 text-right font-mono text-red-500 whitespace-nowrap">${m.debe > 0 ? `+$${parseFloat(m.debe).toFixed(2)}` : '-'}</td>
                <td class="p-3 md:p-4 text-right font-mono text-green-500 whitespace-nowrap">${m.haber > 0 ? `-$${parseFloat(m.haber).toFixed(2)}` : '-'}</td>
                <td class="p-3 md:p-4 text-right font-black font-mono dark:text-white bg-blue-50/30 dark:bg-blue-900/10 whitespace-nowrap">$${parseFloat(m.saldo_acumulado).toFixed(2)}</td>
                <td class="p-3 md:p-4 text-center">
                    ${m.haber > 0 && m.venta_id ? `<button onclick="imprimirReciboPagoMov(${m.venta_id}, ${parseFloat(m.haber)}, ${parseFloat(m.saldo_acumulado)}, '${encodeURIComponent(m.observaciones || "")}')" class="hover:scale-150 transition-transform" title="Imprimir Recibo">🖨️</button>` : '-'}
                </td>
            </tr>
        `).join('');

    } catch (error) {
        console.error("Error al cargar balance:", error);
    }
}

// 1. Función que dispara el botón "Balance" desde la tabla de clientes
export async function irABalanceCliente(id, nombre, apellido) {
    // Guardamos el cliente actual para usar desde la pantalla de balance
    window.currentBalanceClienteId = id;
    window.currentBalanceClienteNombre = `${nombre} ${apellido}`;

    // Ocultamos Clientes (Asegurate que este ID coincida con tu div de clientes)
    document.getElementById("seccionClientes").classList.add("hidden");
    
    // Mostramos Balance
    const pantallaBalance = document.getElementById("pantalla-balance-cliente");
    pantallaBalance.classList.remove("hidden");

    // Actualizamos el nombre en la cabecera
    document.getElementById("ba-nombre-cliente").innerText = `Balance: ${nombre} ${apellido}`;

    // Cargamos los datos reales
    await cargarDatosBalance(id);
};

export async function abrirBuscadorClientes() {
    const clientes = await fetchClientes(); // Trae los clientes de la DB
    const modal = document.getElementById("modalBuscadorClientes");
    const tbody = document.getElementById("tablaBuscadorClientes");
    tbody.innerHTML = clientes.map(c => `
        <tr
            class="border-b dark:border-slate-700 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors cursor-pointer"
            onclick="seleccionarClienteDesdeModal('${c.id}')"
        >
            <td class="p-3">${c.nombre}</td>
            <td class="p-3">${c.apellido}</td>
            <td class="p-3">${c.direccion}</td>
            <td class="p-3 text-right">${c.dni}</td>
            <td class="p-3 text-right">${c.cuit}</td>
        </tr>
    `).join('');
    modal.classList.remove("hidden");
    document.getElementById("inputFiltroClientes").focus();
};

export async function cerrarBuscadorClientes() {
    document.getElementById("modalBuscadorClientes").classList.add("hidden");
};

export async function filtrarClientesModal() {
    const texto = document.getElementById("inputFiltroClientes").value.toLowerCase();
    const filas = document.querySelectorAll("#tablaBuscadorClientes tr");

    filas.forEach(fila => {
        const contenido = fila.textContent.toLowerCase();
        fila.style.display = contenido.includes(texto) ? "" : "none";
    });
};

export async function seleccionarClienteDesdeModal(id) {
    // Buscar el cliente seleccionado
    const clientes = await fetchClientes();
    const cliente = clientes.find(c => String(c.id) === String(id));

    if (cliente) {
        // Actualizar el campo de cliente en la pantalla de venta
        const inputCliente = document.getElementById("v-cliente-input");
        if (inputCliente) {
            inputCliente.value = `${cliente.nombre} ${cliente.apellido}`;
            // Guardar el ID del cliente seleccionado para la venta
            window.clienteSeleccionadoVenta = cliente.id;
        }

        // Actualizar opciones de pago según si el cliente tiene crédito habilitado
        actualizarOpcionesPago(cliente.habilitar_cc);
    }

    // Cerrar el modal
    cerrarBuscadorClientes();
};

export async function initClientes() {
    // 1. Cargar y mostrar clientes
    await listarClientes();
    
    // 2. Configurar el formulario
    configurarFormularioCliente();
    
    // 3. Configurar buscador
    configurarBuscadorClientes();
    
    // 4. Botones abrir/cerrar modal de cliente
    const btnAbrirModalCliente = document.getElementById("btnAbrirModalCliente");
    if (btnAbrirModalCliente) {
        btnAbrirModalCliente.onclick = () => {
            document.getElementById("formCliente").reset();
            document.getElementById("formClienteId").value = "";
            cambiarSeccion("pantallaCliente");
        };
    }

    const btnCerrarModalCliente = document.getElementById("btnCerrarModalCliente");
    if (btnCerrarModalCliente) {
        btnCerrarModalCliente.onclick = () => cambiarSeccion("seccionClientes");
    }

    document.addEventListener("click", (ec) => {
        const btn = ec.target.closest(".btn-eliminarCli");
        if (!btn) return;
        const id = btn.dataset.id;
        const desc = `${btn.dataset.desc || ''} ${btn.dataset.apellido || ''}`.trim();
        eliminarCliente(id, desc);
    });
}

function movimientoEstaEnRango(movimiento, fechaDesde, fechaHasta) {
    const fechaMovimiento = new Date(movimiento.fecha);

    if (fechaDesde) {
        const desde = new Date(`${fechaDesde}T00:00:00`);
        if (fechaMovimiento < desde) return false;
    }

    if (fechaHasta) {
        const hasta = new Date(`${fechaHasta}T23:59:59`);
        if (fechaMovimiento > hasta) return false;
    }

    return true;
}

function abrirPreviewBalancePDF(doc, nombreArchivo = "balance-cliente.pdf") {
    const blob = doc.output("blob");
    const url = URL.createObjectURL(blob);

    const win = window.open(url, "_blank");
    if (!win) {
        mostrarAlerta("El navegador bloqueó la ventana emergente. Permití popups para este sitio.", "Popup bloqueado", "warning");
        return;
    }

    win.addEventListener("load", () => {
        win.document.title = nombreArchivo;
    });

    setTimeout(() => URL.revokeObjectURL(url), 60000);
}

window.imprimirBalanceClientePDF = () => {
    const movimientos = window.balanceClienteMovimientos || [];
    const nombreCliente = window.currentBalanceClienteNombre || "Cliente";
    const fechaDesde = document.getElementById("ba-fecha-desde")?.value;
    const fechaHasta = document.getElementById("ba-fecha-hasta")?.value;

    if (movimientos.length === 0) {
        mostrarAlerta("No hay movimientos para imprimir.", "Sin datos", "info");
        return;
    }

    if (fechaDesde && fechaHasta && fechaDesde > fechaHasta) {
        mostrarAlerta("La fecha desde no puede ser mayor que la fecha hasta.", "Fechas inválidas", "warning");
        return;
    }

    const movimientosFiltrados = movimientos
    .filter((movimiento) => movimientoEstaEnRango(movimiento, fechaDesde, fechaHasta))
    .sort((a, b) => new Date(a.fecha) - new Date(b.fecha));

    if (movimientosFiltrados.length === 0) {
        mostrarAlerta("No hay movimientos en el rango de fechas seleccionado.", "Sin datos", "info");
        return;
    }

    const totalDebe = movimientosFiltrados.reduce((sum, movimiento) => {
        return sum + Number(movimiento.debe || 0);
    }, 0);

    const totalHaber = movimientosFiltrados.reduce((sum, movimiento) => {
        return sum + Number(movimiento.haber || 0);
    }, 0);

    const saldoFinal = Number(movimientosFiltrados[movimientosFiltrados.length - 1].saldo_acumulado || 0);

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF("landscape");
    
    if (typeof doc.autoTable !== "function") {
        mostrarAlerta("No se pudo cargar el generador de tablas PDF. Revisá la conexión a internet o el script de AutoTable.", "Error de PDF", "error");
        return;
    }

    const pageWidth = doc.internal.pageSize.getWidth();
    const fechaEmision = new Date().toLocaleString("es-AR");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("Balance de Cliente", 14, 15);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(`Cliente: ${nombreCliente}`, 14, 24);
    doc.text(`Emitido: ${fechaEmision}`, pageWidth - 14, 24, { align: "right" });

    const textoRango = fechaDesde || fechaHasta
        ? `Período: ${fechaDesde || "Inicio"} al ${fechaHasta || "Hoy"}`
        : "Período: Todos los movimientos";

    doc.text(textoRango, 14, 31);
    
    doc.autoTable({
        startY: 38,
        head: [[
            "Fecha / Hora",
            "Concepto",
            "Debe (+)",
            "Haber (-)",
            "Saldo acumulado",
            "Recibo"
        ]],
        body: movimientosFiltrados.map((movimiento) => [
            new Date(movimiento.fecha).toLocaleString("es-AR"),
            movimiento.observaciones
            ? `${movimiento.descripcion || "-"}\nObs: ${movimiento.observaciones}`
            : movimiento.descripcion || "-",
            Number(movimiento.debe || 0) > 0 ? `$${Number(movimiento.debe).toFixed(2)}` : "-",
            Number(movimiento.haber || 0) > 0 ? `$${Number(movimiento.haber).toFixed(2)}` : "-",
            `$${Number(movimiento.saldo_acumulado || 0).toFixed(2)}`,
            movimiento.haber > 0 && movimiento.venta_id ? `Venta #${movimiento.venta_id}` : "-"
        ]),
        styles: {
            fontSize: 8,
            cellPadding: 2
        },
        headStyles: {
            fillColor: [0, 168, 168],
            textColor: 255
        },
        columnStyles: {
            2: { halign: "right" },
            3: { halign: "right" },
            4: { halign: "right" },
            5: { halign: "center" }
        },
        margin: { left: 14, right: 14 }
    });

    const finalY = doc.lastAutoTable.finalY + 10;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(`Total Debe: $${totalDebe.toFixed(2)}`, 14, finalY);
    doc.text(`Total Haber: $${totalHaber.toFixed(2)}`, 90, finalY);
    doc.text(`Saldo final del período: $${saldoFinal.toFixed(2)}`, 170, finalY);

    abrirPreviewBalancePDF(doc, `Balance_${nombreCliente.replaceAll(" ", "_")}.pdf`);
};

// Función para actualizar las opciones de pago según el cliente seleccionado
function actualizarOpcionesPago(habilitarCredito = false) {
    const optCtaCte = document.getElementById("opt-cta-cte");
    const selectMetodoPago = document.getElementById("v-metodo-pago");

    if (optCtaCte && selectMetodoPago) {
        if (habilitarCredito) {
            // Mostrar opción de cuenta corriente
            optCtaCte.style.display = "block";
            optCtaCte.innerText = "Cuenta Corriente";
        } else {
            // Ocultar opción de cuenta corriente
            optCtaCte.style.display = "none";
            // Si estaba seleccionado cuenta corriente, cambiar a efectivo
            if (selectMetodoPago.value === "Cuenta Corriente") {
                selectMetodoPago.value = "Efectivo";
            }
        }
    }
}

window.prepararEdicionCliente = prepararEdicionCliente;
window.eliminarCliente = eliminarCliente;
window.listarClientes = listarClientes;
window.irABalanceCliente = irABalanceCliente;
window.abrirBuscadorClientes = abrirBuscadorClientes;
window.cerrarBuscadorClientes = cerrarBuscadorClientes;
window.filtrarClientesModal = filtrarClientesModal;
window.seleccionarClienteDesdeModal = seleccionarClienteDesdeModal;
window.actualizarOpcionesPago = actualizarOpcionesPago;
