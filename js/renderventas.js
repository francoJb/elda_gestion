import { API_BASE_URL } from "./config.js";
import { apiFetch } from "./apiClient.js";

export function actualizarTablaVenta(carritoVenta) {
    const body = document.getElementById("v-items-body");
    const labelTotal = document.getElementById("v-total-pantalla");
    const headerCantidad = document.querySelector("#pantallaGenerarVenta th:nth-child(4)");

    if (!body) return;

    if (carritoVenta.length === 0) {
        body.innerHTML = `<tr id="v-items-vacio"><td colspan="6" class="text-center py-12 text-gray-400 italic">No hay datos</td></tr>`;
        if (labelTotal) labelTotal.innerText = "$0.00";
        if (headerCantidad) headerCantidad.innerText = "Cantidad (0)";
        return;
    }

    body.innerHTML = carritoVenta.map((item, index) => {
        // Si el ítem es vehículo, deshabilitamos el campo numérico de cantidad para mantenerlo estrictamente en 1
        const inputCantidadHtml = item.esVehiculo 
            ? `<input type="number" value="1" disabled class="w-16 p-1 text-center border rounded bg-gray-100 dark:bg-slate-800 text-gray-500 cursor-not-allowed">`
            : `<input type="number" value="${item.cantidad}" min="1" class="input-cantidad w-16 p-1 text-center border rounded bg-transparent" data-index="${index}">`;

        // Contenedor del selector para vehículos individuales
        const selectorVehiculoHtml = item.esVehiculo
            ? `<div class="mt-2 text-xs">
                <label class="block text-slate-500 font-bold mb-1">Seleccionar Unidad (Motor/Chasis):</label>
                <select class="select-unidad-vehiculo w-full max-w-md p-1 border rounded bg-white dark:bg-slate-800" data-index="${index}" id="select-unidad-${index}">
                    <option value="">-- Buscando unidades disponibles... --</option>
                </select>
               </div>`
            : "";

        return `
            <tr class="border-b dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700/50">
                <td class="p-4 text-gray-500 dark:text-gray-400 font-mono">${item.sku}</td>
                <td class="p-4 font-medium text-gray-900 dark:text-white">
                    <div>${item.descripcion}</div>
                    ${selectorVehiculoHtml}
                </td>
                <td class="p-4 text-right font-mono">
                    <input 
                        type="number" 
                        value="${item.precio}" 
                        min="0" 
                        step="0.01" 
                        class="input-precio w-24 p-1 text-right border rounded bg-transparent" 
                        data-index="${index}"
                    >
                </td>
                <td class="p-4 text-center">
                    ${inputCantidadHtml}
                </td>
                <td class="p-4 text-right font-black text-gray-900 dark:text-white font-mono">$${item.subtotal.toFixed(2)}</td>
                <td class="p-4 text-center">
                    <button class="btn-quitar text-red-500 hover:scale-125 transition-transform" data-index="${index}" title="Quitar">🗑️
                </td>
            </tr>
        `;
    }).join("");

    // --- CARGA DINÁMICA DE LOS SELECTORES DE VEHÍCULOS (CON APIFETCH OFICIAL) ---
    carritoVenta.forEach((item, index) => {
        if (item.esVehiculo) {
            const combo = document.getElementById(`select-unidad-${index}`);
            if (combo) {
                // Usamos tu constante global API_BASE_URL y tu función apiFetch para que inyecte los headers del Tenant automáticamente
                const urlUnidades = `${API_BASE_URL}/api/productos/${item.id}/unidades-disponibles`;
                
                apiFetch(urlUnidades)
                .then(res => {
                    if (!res.ok) throw new Error("Error en la respuesta del servidor");
                    return res.json();
                })
                .then(unidades => {
                    if (unidades.length === 0) {
                        combo.innerHTML = `<option value="">⚠️ SIN UNIDADES DISPONIBLES EN STOCK</option>`;
                        return;
                    }
                    
                    let options = `<option value="">-- Seleccioná el Chasis / Motor --</option>`;
                    unidades.forEach(u => {
                        const seleccionado = item.unidadSeleccionadaId == u.id ? 'selected' : '';
                        options += `<option value="${u.id}" ${seleccionado}>Chasis: ${u.chasis || 'S/N'} | Motor: ${u.motor || 'S/N'} (${u.color || 'S/C'})</option>`;
                    });
                    combo.innerHTML = options;
                })
                .catch(err => {
                    console.error("Error exacto del fetch de unidades:", err);
                    combo.innerHTML = `<option value="">Error al cargar unidades</option>`;
                });

                // Registrar el evento change para actualizar el carrito en vivo
                combo.addEventListener("change", (e) => {
                    const unidadElegidaId = e.target.value ? parseInt(e.target.value, 10) : null;

                    if (!unidadElegidaId) {
                        carritoVenta[index].unidadSeleccionadaId = null;
                        return;
                    }

                    const unidadYaElegida = carritoVenta.some((item, i) => {
                        return i !== index && item.unidadSeleccionadaId === unidadElegidaId;
                    });

                    if (unidadYaElegida) {
                        alert("Ese chasis ya fue seleccionado en el carrito.");

                        carritoVenta[index].unidadSeleccionadaId = null;
                        e.target.value = "";
                        return;
                    }

                    carritoVenta[index].unidadSeleccionadaId = unidadElegidaId;
                });
            }
        }
    });

    const total = carritoVenta.reduce((sum, i) => sum + i.subtotal, 0);
    const cantItems = carritoVenta.reduce((sum, i) => sum + i.cantidad, 0);

    if (labelTotal) labelTotal.innerText = `$${total.toFixed(2)}`;
    if (headerCantidad) headerCantidad.innerText = `Cantidad (${cantItems})`;

    // Listeners habituales para productos estándar
    document.querySelectorAll(".input-cantidad").forEach(input => {
        input.addEventListener("change", (e) => {
            const index = e.target.dataset.index;
            const nuevaCantidad = parseInt(e.target.value, 10);

            if (nuevaCantidad > 0) {
                carritoVenta[index].cantidad = nuevaCantidad;
                carritoVenta[index].subtotal = nuevaCantidad * carritoVenta[index].precio;
                actualizarTablaVenta(carritoVenta);
            }
        });
    });
    document.querySelectorAll(".input-precio").forEach(input => {
        input.addEventListener("change", (e) => {
            const index = e.target.dataset.index;
            const nuevoPrecio = parseFloat(e.target.value);

            if (Number.isFinite(nuevoPrecio) && nuevoPrecio >= 0) {
                carritoVenta[index].precio = nuevoPrecio;
                carritoVenta[index].subtotal = carritoVenta[index].cantidad * nuevoPrecio;
                actualizarTablaVenta(carritoVenta);
            } else {
                alert("El precio ingresado no es válido.");
                e.target.value = carritoVenta[index].precio;
            }
        });
    });

    document.querySelectorAll(".btn-quitar").forEach(btn => {
        btn.addEventListener("click", (e) => {
            const index = e.target.dataset.index;
            carritoVenta.splice(index, 1);
            actualizarTablaVenta(carritoVenta);
        });
    });
}

export function renderTablaVentas(ventas) {
    const cuerpoTabla = document.getElementById("cuerpo-tabla-ventas");
    if (!cuerpoTabla) return;

    cuerpoTabla.innerHTML = "";

    // 1. Detectamos si el checkbox existe en el DOM y si está activo actualmente
    const checkboxOcultar = document.getElementById("toggleVentasFinalizadas");
    const ocultarActivo = checkboxOcultar ? checkboxOcultar.checked : false;

    ventas.forEach(v => {
        // CORRECCIÓN: Validamos usando la columna real de tu Base de Datos 'anulada'
        const isAnulada = Number(v.anulada) === 1; 
        const fechaFormateada = new Date(v.fecha).toLocaleString();
        const cliente = v.cliente_nombre ? `${v.cliente_nombre} ${v.cliente_apellido || ""}` : "Consumidor Final";
        
        // Cambiamos la leyenda visual por "Anulada" usando el badge estilizado
        const estadoEntrega = isAnulada
            ? '<span class="inline-flex items-center rounded-full bg-rose-100 px-2 py-1 text-xs font-bold text-rose-700 ring-1 ring-rose-200 dark:bg-rose-900/30 dark:text-rose-200 dark:ring-rose-500/30">Anulada</span>'
            : v.estado_pago === "Pagado"
                ? '<span class="text-cyan-600 font-bold">Finalizado</span>'
                : '<span class="text-orange-500 font-bold">Pendiente</span>';
                
        const numeroVenta = v.numero || v.id;
        
        // Si está anulada ocultamos las acciones de edición/anulación repetida
        const acciones = isAnulada ? "" : `
            <button onclick="verDetalleVenta(${v.id})" class="text-blue-500 hover:scale-150 transition-transform" title="Ver Detalle">👁️</button>
            <button onclick="imprimirVenta(${v.id})" class="text-blue-500 hover:scale-150 transition-transform" title="Imprimir">🖨️</button>
            ${v.metodo_pago === "Cuotas" ? `<button onclick="imprimirPlanPagosVenta(${v.id})" class="text-blue-500 hover:scale-150 transition-transform" title="Plan de pagos">📄</button>` : ""}
            <button onclick="anularVenta(${v.id})" class="text-rose-500 hover:scale-150 transition-transform" title="Anular Venta">🚫</button>
        `;

        // 2. Evaluamos si la venta actual está finalizada (y no anulada)
        const esFinalizado = v.estado_pago === "Pagado" && !isAnulada;
        
        // 3. Si está finalizada y el checkbox está activo, le asignamos la clase 'hidden' de Tailwind
        const claseOcultar = (esFinalizado && ocultarActivo) ? "hidden" : "";

        // 4. Agregamos el atributo 'data-finalizado' aplicando los estilos visuales de fila anulada (Fondo rosa suave y texto tachado)
        cuerpoTabla.innerHTML += `
            <tr data-finalizado="${esFinalizado}" class="transition-colors ${claseOcultar} ${isAnulada ? "bg-rose-50/80 text-slate-500 dark:bg-rose-950/20 dark:text-slate-400" : "hover:bg-gray-50 dark:hover:bg-slate-700/50"}">
                <td class="p-2 text-center font-mono ${isAnulada ? "line-through decoration-rose-400 decoration-2" : ""}">#${numeroVenta}</td>
                <td class="p-2">${fechaFormateada}</td>
                <td class="p-2 text-right">$${v.total}</td>
                <td class="p-2 text-right">$${v.saldo_pendiente}</td>
                <td class="p-2 text-center">${estadoEntrega}</td>
                <td class="p-2 text-center">${cliente}</td>
                <td class="p-2 flex gap-2 justify-center">${acciones}</td>
            </tr>
        `;
    });
}