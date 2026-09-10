// ==========================================
// 1. IMPORTACIONES Y CONFIGURACIÓN INICIAL
// ==========================================
import { configurarBuscadorVentas } from "./ventas.js";
import { initClientes, fetchClientes } from "./clientes.js";
import { initProductos, fetchProductos, listarProductos } from "./productos.js";
import { initProveedores, listarProveedores } from "./proveedores.js";
import { initVentas, listarVentas, obtenerHistorialVentas } from "./ventas.js";
import { initImportarProductos } from "./importarProductos.js";
import { cambiarSeccion, mostrarLoader, ocultarLoader, mostrarAlerta } from "./ui.js";
import { load, save } from "./storage.js";
import { API_BASE_URL } from "./config.js";
import { apiFetch } from "./apiClient.js";


const URL_API_VENTAS = `${API_BASE_URL}/api/ventas`;
let chartVentasDashboard = null;
let currentSessionUser = null;
let editingCompanyId = null;
let editingUserId = null;

// ==========================================
// FUNCIONES DE UTILIDAD GLOBAL
// ==========================================

function esPlatformAdmin() {
    return currentSessionUser?.role === 'platform_admin';
}

function esUsuarioEmpresa() {
    return ['tenant_admin', 'user'].includes(currentSessionUser?.role);
}

function escapeHTML(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function aplicarPermisosUsuario() {
    const linksOperativos = [
        'linkDashboard',
        'linkVentas',
        'linkClientes',
        'linkProductos',
        'linkProveedores'
    ];

    const linkConfig = document.getElementById('linkConfig');
    const mostrarConfig = esPlatformAdmin();
    const mostrarOperativos = esUsuarioEmpresa();

    linksOperativos.forEach(id => {
        document.getElementById(id)?.classList.toggle('hidden', !mostrarOperativos);
    });

    linkConfig?.classList.toggle('hidden', !mostrarConfig);
}

function resetEmpresaForm() {
    const form = document.getElementById('formNuevaEmpresa');
    if (form) form.reset();
    editingCompanyId = null;
    const empresaSubmitButton = document.getElementById('empresaSubmitButton');
    if (empresaSubmitButton) empresaSubmitButton.textContent = 'Crear Empresa';
    document.getElementById('cancelarEdicionEmpresa')?.classList.add('hidden');
}

function resetUsuarioForm() {
    const form = document.getElementById('formNuevoUsuario');
    if (form) form.reset();
    editingUserId = null;
    const usuarioSubmitButton = document.getElementById('usuarioSubmitButton');
    if (usuarioSubmitButton) usuarioSubmitButton.textContent = 'Crear Usuario';
    document.getElementById('cancelarEdicionUsuario')?.classList.add('hidden');
    const empresaSelect = document.getElementById('nuevoUsuarioEmpresa');
    if (empresaSelect) empresaSelect.disabled = false;
}

function actualizarInfoSesion() {
    const empresa = document.getElementById('sessionEmpresa');
    const usuario = document.getElementById('sessionUsuario');

    if (empresa) {
        empresa.textContent = currentSessionUser?.empresa || 'Empresa';
        empresa.title = currentSessionUser?.empresa || '';
    }

    if (usuario) {
        usuario.textContent = currentSessionUser?.usuario ? `Usuario: ${currentSessionUser.usuario}` : 'Usuario';
        usuario.title = currentSessionUser?.usuario || '';
    }
}

async function validarSesionActual() {
    const token = sessionStorage.getItem('authToken');

    if (!token) {
        return false;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
            headers: {
                Authorization: `Bearer ${token}`
            }
        });

        if (!response.ok) {
            return false;
        }

        const data = await response.json();
        currentSessionUser = data;
        window.currentSessionUser = data;
        sessionStorage.setItem('empresaId', data.empresaId);
        return data;
    } catch (error) {
        console.error('Error validando sesión:', error);
        return false;
    }
}



// ==========================================
// ADMINISTRACIÓN DE EMPRESAS Y USUARIOS
// ==========================================
async function fetchEmpresasAdmin() {
    const response = await apiFetch(`${API_BASE_URL}/api/admin/companies`);
    return response.ok ? await response.json() : [];
}

async function fetchUsuariosAdmin() {
    const response = await apiFetch(`${API_BASE_URL}/api/admin/users`);
    return response.ok ? await response.json() : [];
}

function popularEmpresasAdmin(empresas) {
    const select = document.getElementById('nuevoUsuarioEmpresa');
    const lista = document.getElementById('empresasLista');
    if (select) {
        select.innerHTML = empresas.map(e => `<option value="${e.id}">${e.nombre}</option>`).join('');
    }
    if (lista) {
        lista.innerHTML = empresas.map(e => `
            <tr class="hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors">
                <td class="p-3">${escapeHTML(e.nombre)}</td>
                <td class="p-3">${escapeHTML(e.razon_social || '-')}</td>
                <td class="p-3 text-right">${escapeHTML(e.cuit || '-')}</td>
                <td class="p-3">${escapeHTML(e.domicilio || '-')}</td>
                <td class="p-3 text-center">
                    <button type="button" onclick="prepararEdicionEmpresa(${e.id})" class="text-blue-600 hover:text-blue-800">✏️</button>
                </td>
            </tr>
        `).join('');
    }
}

function popularUsuariosAdmin(usuarios) {
    const lista = document.getElementById('usuariosLista');
    if (!lista) return;
    lista.innerHTML = usuarios.map(u => `
        <tr class="hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors">
            <td class="p-3">${escapeHTML(u.nombre || '-')}</td>
            <td class="p-3">${escapeHTML(u.apellido || '-')}</td>
            <td class="p-3">${escapeHTML(u.usuario)}</td>
            <td class="p-3">${escapeHTML(u.empresa_nombre)}</td>
            <td class="p-3 text-center uppercase">${escapeHTML(u.role)}</td>
            <td class="p-3 text-center">
                <button type="button" onclick="prepararEdicionUsuario(${u.id})" class="text-blue-600 hover:text-blue-800">✏️</button>
            </td>
        </tr>
    `).join('');
}

async function cargarAdminData() {
    if (!esPlatformAdmin()) return;
    const [empresas, usuarios] = await Promise.all([fetchEmpresasAdmin(), fetchUsuariosAdmin()]);
    popularEmpresasAdmin(empresas);
    popularUsuariosAdmin(usuarios);
}

async function prepararEdicionEmpresa(id) {
    const response = await apiFetch(`${API_BASE_URL}/api/admin/companies/${id}`);
    if (!response.ok) {
        mostrarAlerta('No se pudo cargar la empresa para edición.', 'Error', 'error');
        return;
    }
    const empresa = await response.json();
    document.getElementById('nuevaEmpresaNombre').value = empresa.nombre || '';
    document.getElementById('nuevaEmpresaRazonSocial').value = empresa.razon_social || '';
    document.getElementById('nuevaEmpresaCuit').value = empresa.cuit || '';
    document.getElementById('nuevaEmpresaDomicilio').value = empresa.domicilio || '';
    document.getElementById('nuevaEmpresaEmail').value = empresa.email || '';
    document.getElementById('nuevaEmpresaTelefono').value = empresa.telefono || '';
    document.getElementById('nuevaEmpresaWebsite').value = empresa.website || '';
    document.getElementById('nuevaEmpresaCondicionIva').value = empresa.condicion_iva || '';
    editingCompanyId = id;
    document.getElementById('empresaSubmitButton').textContent = 'Guardar Cambios';
    document.getElementById('cancelarEdicionEmpresa')?.classList.remove('hidden');
}

async function prepararEdicionUsuario(id) {
    const response = await apiFetch(`${API_BASE_URL}/api/admin/users/${id}`);
    if (!response.ok) {
        mostrarAlerta('No se pudo cargar el usuario para edición.', 'Error', 'error');
        return;
    }
    const usuario = await response.json();
    document.getElementById('nuevoUsuarioEmpresa').value = usuario.empresa_id || '';
    document.getElementById('nuevoUsuarioEmpresa').disabled = true;
    document.getElementById('nuevoUsuarioUsuario').value = usuario.usuario || '';
    document.getElementById('nuevoUsuarioPassword').value = '';
    document.getElementById('nuevoUsuarioRole').value = usuario.role || 'user';
    document.getElementById('nuevoUsuarioNombre').value = usuario.nombre || '';
    document.getElementById('nuevoUsuarioApellido').value = usuario.apellido || '';
    editingUserId = id;
    document.getElementById('usuarioSubmitButton').textContent = 'Guardar Cambios';
    document.getElementById('cancelarEdicionUsuario')?.classList.remove('hidden');
}

async function crearEmpresa(event) {
    event.preventDefault();
    const nombre = document.getElementById('nuevaEmpresaNombre').value.trim();
    const razon_social = document.getElementById('nuevaEmpresaRazonSocial').value.trim();
    const cuit = document.getElementById('nuevaEmpresaCuit').value.trim();
    const domicilio = document.getElementById('nuevaEmpresaDomicilio').value.trim();
    const email = document.getElementById('nuevaEmpresaEmail').value.trim();
    const telefono = document.getElementById('nuevaEmpresaTelefono').value.trim();
    const website = document.getElementById('nuevaEmpresaWebsite').value.trim();
    const condicion_iva = document.getElementById('nuevaEmpresaCondicionIva').value.trim();

    if (!nombre) {
        mostrarAlerta('El nombre de la empresa es obligatorio.', 'Error', 'warning');
        return;
    }

    const payload = { nombre, razon_social, cuit, domicilio, email, telefono, website, condicion_iva };
    const url = editingCompanyId ? `${API_BASE_URL}/api/admin/companies/${editingCompanyId}` : `${API_BASE_URL}/api/admin/companies`;
    const method = editingCompanyId ? 'PUT' : 'POST';

    const response = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok) {
        mostrarAlerta(data.error || 'No se pudo guardar la empresa.', 'Error', 'error');
        return;
    }

    mostrarAlerta(editingCompanyId ? 'Empresa actualizada correctamente.' : 'Empresa creada correctamente.', '¡Éxito!', 'success');
    resetEmpresaForm();
    cargarAdminData();
}  

async function crearUsuario(event) {
    event.preventDefault();
    const empresa_id = Number(document.getElementById('nuevoUsuarioEmpresa').value);
    const usuario = document.getElementById('nuevoUsuarioUsuario').value.trim();
    const password = document.getElementById('nuevoUsuarioPassword').value;
    const role = document.getElementById('nuevoUsuarioRole').value;
    const nombre = document.getElementById('nuevoUsuarioNombre').value.trim();
    const apellido = document.getElementById('nuevoUsuarioApellido').value.trim();

    if (!usuario || (!editingUserId && !password)) {
        mostrarAlerta('El usuario y la contraseña son obligatorios al crear un usuario.', 'Error', 'warning');
        return;
    }

    const payload = {
        usuario,
        role,
        nombre,
        apellido
    };

    let url = `${API_BASE_URL}/api/admin/users`;
    let method = 'POST';

    if (editingUserId) {
        if (password) payload.password = password;
        url = `${API_BASE_URL}/api/admin/users/${editingUserId}`;
        method = 'PUT';
    } else {
        payload.empresa_id = empresa_id;
        payload.password = password;
    }

    const response = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok) {
        mostrarAlerta(data.error || 'No se pudo guardar el usuario.', 'Error', 'error');
        return;
    }

    mostrarAlerta(editingUserId ? 'Usuario actualizado correctamente.' : 'Usuario creado correctamente.', '¡Éxito!', 'success');
    resetUsuarioForm();
    cargarAdminData();
}

window.prepararEdicionEmpresa = prepararEdicionEmpresa;
window.prepararEdicionUsuario = prepararEdicionUsuario;
window.resetEmpresaForm = resetEmpresaForm;
window.resetUsuarioForm = resetUsuarioForm;

function formatMoney(value) {
    return `$${Number(value || 0).toFixed(2)}`;
}

function fechaValida(fecha) {
    const parsed = new Date(fecha);
    return !Number.isNaN(parsed.getTime()) ? parsed : null;
}

// ==========================================
// FUNCIONES DEL DASHBOARD
// ==========================================
async function obtenerTopProductosMasVendidos() {
    try {
        // Hacemos UNA SOLA petición al nuevo endpoint optimizado
        const response = await apiFetch(`${API_BASE_URL}/api/ventas/top-productos`);
        if (!response.ok) throw new Error("Error en la respuesta del servidor");
        
        const topProductos = await response.json();
        
        // Aquí mandas los datos directamente a tu función que dibuja el gráfico del Dashboard
        // Ej: actualizarGraficoProductos(topProductos);
        
        return topProductos;
    } catch (error) {
        console.error("❌ Error al cargar el top de productos para el dashboard:", error);
        return [];
    }
}

function generarListaStockBajo(productos) {
    const bajos = productos
        .filter(p => Number(p.stock) <= Number(p.stock_minimo))
        .slice(0, 5);

    if (bajos.length === 0) {
        return `<p class="text-sm text-gray-500 dark:text-gray-400">No hay productos en alerta de stock bajo.</p>`;
    }

    return bajos.map(p => `
        <div class="rounded-2xl border border-orange-100 dark:border-orange-900/40 bg-orange-50/70 dark:bg-orange-950/20 p-4">
            <p class="font-bold text-gray-900 dark:text-white">${escapeHTML(p.descripcion || p.sku)}</p>
            <p class="text-sm text-gray-600 dark:text-gray-400">Stock: ${p.stock} / Min: ${p.stock_minimo}</p>
        </div>
    `).join('');
}

function crearGraficoVentas(ventas) {
    const canvas = document.getElementById("dashboardVentasChart");
    if (!canvas) return;

    const ultimasVentas = ventas.slice(0, 7).reverse();
    const labels = ultimasVentas.map(v => fechaValida(v.fecha)?.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }) || '-');
    const data = ultimasVentas.map(v => Number(v.total || 0));

    if (chartVentasDashboard) {
        chartVentasDashboard.destroy();
    }

    chartVentasDashboard = new Chart(canvas, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'Monto por Venta',
                data,
                borderColor: '#2563EB',
                backgroundColor: 'rgba(37, 99, 235, 0.2)',
                fill: true,
                tension: 0.3,
                pointRadius: 4,
                pointBackgroundColor: '#1D4ED8'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: { ticks: { color: '#6B7280' } },
                y: {
                    ticks: {
                        color: '#6B7280',
                        callback: value => `$${value}`
                    }
                }
            }
        }
    });
}
window.renderDashboard = renderDashboard;
async function renderDashboard() {
    if (!esUsuarioEmpresa()) {
        return;
    }

    mostrarLoader();

    try {
        const [clientes, productos, ventas] = await Promise.all([
            fetchClientes(),
            fetchProductos(),
            obtenerHistorialVentas()
        ]);

        const ahora = new Date();
        const primerDiaMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
        const hace30Dias = new Date(ahora);
        hace30Dias.setDate(hace30Dias.getDate() - 30);

        const ventasValidas = ventas.filter(v => Number(v.anulada) !== 1);
        const ventasMes = ventasValidas.filter(v => {
            const fecha = fechaValida(v.fecha);
            return fecha && fecha >= primerDiaMes && fecha <= ahora;
        });

        const totalMes = ventasMes.reduce((sum, v) => sum + Number(v.total || 0), 0);
        const saldoPendiente = ventasValidas.reduce((sum, v) => sum + Number(v.saldo_pendiente || 0), 0);
        const nuevosClientes = clientes.filter(c => {
            const fecha = fechaValida(c.fecha_alta);
            return fecha && fecha >= hace30Dias && fecha <= ahora;
        }).length;
        const stockBajo = productos.filter(p => Number(p.stock) <= Number(p.stock_minimo)).length;

        document.getElementById("dashboardVentasMes").innerText = formatMoney(totalMes);
        document.getElementById("dashboardSaldoPendiente").innerText = formatMoney(saldoPendiente);
        document.getElementById("dashboardClientesNuevos").innerText = nuevosClientes;
        document.getElementById("dashboardProductosStockBajo").innerText = stockBajo;
        document.getElementById("dashboardLowStockList").innerHTML = generarListaStockBajo(productos);

        const ultimas5 = ventasValidas.slice(0, 5);
        document.getElementById("dashboardUltimasVentasBody").innerHTML = ultimas5.map(v => {
            const fecha = fechaValida(v.fecha);
            const cliente = v.cliente_nombre
            ? `${v.cliente_nombre} ${v.cliente_apellido || ''}`: 'Consumidor Final';
            return `
                <tr class="hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors">
                    <td class="p-3 font-mono text-gray-700 dark:text-gray-200">#${v.id}</td>
                    <td class="p-3 text-gray-600 dark:text-gray-300">${escapeHTML(cliente)}</td>
                    <td class="p-3 text-right font-bold text-slate-900 dark:text-white">${formatMoney(v.total)}</td>
                    <td class="p-3 text-sm font-semibold ${v.estado_pago && v.estado_pago.toLowerCase().includes('pagado') ? 'text-green-600' : 'text-orange-500'}">${v.estado_pago || 'Pendiente'}</td>
                    <td class="p-3">${fecha ? fecha.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '-'}</td>
                </tr>
            `;
        }).join('');

        const topProductos = await obtenerTopProductosMasVendidos(ventasValidas);
        document.getElementById("dashboardTopProductosBody").innerHTML = topProductos.map(p => `
            <tr class="hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors">
                <td class="p-3 text-gray-700 dark:text-gray-200">${escapeHTML(p.descripcion)}</td>
                <td class="p-3 text-right font-bold text-slate-900 dark:text-white">${p.cantidad}</td>
            </tr>
        `).join('');

        crearGraficoVentas(ventas);
    } catch (error) {
        console.error("Error al cargar dashboard:", error);
        mostrarAlerta("No se pudo cargar el dashboard. Revisá la consola para más detalle.", "Error", "error");
    } finally {
        ocultarLoader();
    }
}


// ==========================================
// INICIALIZACIÓN DE LA APLICACIÓN
// ==========================================

async function initApp() {
    if (esPlatformAdmin()) {
        cambiarSeccion('seccionConfig');
    } else if (esUsuarioEmpresa()) {
        // Inicializar módulos operativos solo para usuarios de empresa.
        await initClientes();
        await initProductos();
        initImportarProductos();
        await initProveedores();
        await initVentas();

        cambiarSeccion('seccionDashboard');
        await renderDashboard();
    }

    const sidebar = document.getElementById("sidebar");
    const btnMenuMobile = document.getElementById("btnMenuMobile");
    const mobileMenuOverlay = document.getElementById("mobileMenuOverlay");

    const abrirMenuMobile = () => {
        if (!sidebar || !mobileMenuOverlay) return;
        sidebar.classList.remove("-translate-x-full");
        mobileMenuOverlay.classList.remove("hidden");
    };

    const cerrarMenuMobile = () => {
        if (!sidebar || !mobileMenuOverlay) return;
        sidebar.classList.add("-translate-x-full");
        mobileMenuOverlay.classList.add("hidden");
    };

    btnMenuMobile?.addEventListener("click", abrirMenuMobile);
    mobileMenuOverlay?.addEventListener("click", cerrarMenuMobile);

    // cerrar al elegir opción
    ["linkDashboard", "linkClientes", "linkVentas", "linkProductos", "linkProveedores", "linkConfig"].forEach((id) => {
        document.getElementById(id)?.addEventListener("click", () => {
            if (window.innerWidth < 768) cerrarMenuMobile();
        });
    });

    // --- CONFIGURACIÓN DE CLICS DEL MENÚ LATERAL ---

    // 1. Cuando hagan clic en Dashboard
    document.getElementById("linkDashboard").addEventListener("click", (e) => {
        e.preventDefault(); // Esto evita que la página salte al principio por el href="#"
        if (!esUsuarioEmpresa()) return;
        cambiarSeccion('seccionDashboard');
        renderDashboard();
    });

    // 2. Cuando hagan clic en Clientes
    document.getElementById("linkClientes").addEventListener("click", (e) => {
        e.preventDefault();
        if (!esUsuarioEmpresa()) return;
        cambiarSeccion('seccionClientes');
    });

    // 3. Cuando hagan clic en Ventas
    document.getElementById("linkVentas").addEventListener("click", (e) => {
        e.preventDefault();
        if (!esUsuarioEmpresa()) return;
        cambiarSeccion('seccionVentas');
        configurarBuscadorVentas();
        listarVentas();
    });

    // 4. Cuando hagan clic en Contratos
    document.getElementById("linkContratos").addEventListener("click", (e) => {
        e.preventDefault();
        if (!esUsuarioEmpresa()) return;
        cambiarSeccion('seccionContratos');
        configurarBuscadorContratos();
        listarContratos();
    });

    // === INTERACTIVIDAD DEL SWITCH DE VENTAS FINALIZADAS ===
    const checkboxOcultar = document.getElementById("toggleVentasFinalizadas");
    if (checkboxOcultar) {
        checkboxOcultar.addEventListener("change", (evento) => {
            const cuerpoTabla = document.getElementById("cuerpo-tabla-ventas");
            if (!cuerpoTabla) return; // Si la tabla no está en pantalla, no hace nada

            const ocultarActivo = evento.target.checked;
            const filas = cuerpoTabla.querySelectorAll("tr");

            filas.forEach(fila => {
                // Leemos el atributo que configuramos en renderventas.js
                const esFinalizado = fila.getAttribute("data-finalizado") === "true";

                if (esFinalizado) {
                    if (ocultarActivo) {
                        fila.classList.add("hidden"); // Oculta con Tailwind
                    } else {
                        fila.classList.remove("hidden"); // Muestra con Tailwind
                    }
                }
            });
        });
    }

    // 5. Cuando hagan clic en Productos
    document.getElementById("linkProductos").addEventListener("click", async (e) => {
        e.preventDefault();
        if (!esUsuarioEmpresa()) return;
        cambiarSeccion('seccionProductos');
        await listarProductos();
    });

    // 6. Cuando hagan clic en Proveedores
    document.getElementById("linkProveedores").addEventListener("click", (e) => {
        e.preventDefault();
        if (!esUsuarioEmpresa()) return;
        cambiarSeccion('seccionProveedores');
        listarProveedores();
    });

    // 6. Cuando hagan clic en Configuracion
    document.getElementById("linkConfig").addEventListener("click", (e) => {
        e.preventDefault();
        if (!esPlatformAdmin()) return;
        cambiarSeccion('seccionConfig');
    });

    const dashboardRefresh = document.getElementById("dashboardRefresh");
    if (dashboardRefresh) {
        dashboardRefresh.addEventListener("click", renderDashboard);
    }

    const formNuevaEmpresa = document.getElementById("formNuevaEmpresa");
    if (formNuevaEmpresa) {
        formNuevaEmpresa.addEventListener("submit", crearEmpresa);
    }

    const botonCancelarEmpresa = document.getElementById('cancelarEdicionEmpresa');
    if (botonCancelarEmpresa) {
        botonCancelarEmpresa.addEventListener('click', resetEmpresaForm);
    }

    const formNuevoUsuario = document.getElementById("formNuevoUsuario");
    if (formNuevoUsuario) {
        formNuevoUsuario.addEventListener("submit", crearUsuario);
    }

    const botonCancelarUsuario = document.getElementById('cancelarEdicionUsuario');
    if (botonCancelarUsuario) {
        botonCancelarUsuario.addEventListener('click', resetUsuarioForm);
    }

    

    // 1. Reloj profesional
    if(document.getElementById("pantallaGenerarVenta")){
        setInterval(() => {
            const reloj = document.getElementById("reloj-venta");
            if(reloj) reloj.innerText = new Date().toLocaleTimeString();
        }, 1000);
    }

    // 5. MODO OSCURO (Básico para que no te moleste la vista)
    const btnDarkMode = document.getElementById("btnDarkMode");
    if (btnDarkMode) {
        btnDarkMode.onclick = () => document.documentElement.classList.toggle("dark");
    }

    // 6. CERRAR SESIÓN
    const btnLogout = document.getElementById("btnLogout");
    if (btnLogout) {
        btnLogout.onclick = openLogoutConfirm;
    }
}

function openLogoutConfirm() {
    const modal = document.getElementById('modalLogoutConfirm');
    if (modal) modal.classList.remove('hidden');
}

function closeLogoutConfirm() {
    const modal = document.getElementById('modalLogoutConfirm');
    if (modal) modal.classList.add('hidden');
}

function confirmLogout() {
    sessionStorage.removeItem('loggedIn');
    sessionStorage.removeItem('authToken');
    sessionStorage.removeItem('empresaId');
    currentSessionUser = null;
    window.currentSessionUser = null;
    closeLogoutConfirm();
    location.reload();
}

// ==========================================
// LÓGICA DE LOGIN
// ==========================================

function showLogin() {
    document.getElementById('pantallaLogin').classList.remove('hidden');
    document.getElementById('app').classList.add('hidden');
}

function showApp() {
    document.getElementById('pantallaLogin').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
}

async function iniciarApp() {
    showApp();
    actualizarInfoSesion();
    await initApp();
    aplicarPermisosUsuario();
    await cargarAdminData();
}

// ==========================================
// 6. CARGA INICIAL (DOMContentLoaded)
// ==========================================
document.addEventListener("DOMContentLoaded", async () => {
    const togglePassword = document.getElementById('togglePassword');
    if (togglePassword) {
        togglePassword.addEventListener('click', () => {
            const input = document.getElementById('password');
            if (input) {
                input.type = input.type === 'password' ? 'text' : 'password';
            }
        });
    }

    const formLogin = document.getElementById('formLogin');
    if (formLogin) {
        formLogin.addEventListener('submit', async (e) => {
            e.preventDefault();
            const empresa = document.getElementById('empresa').value;
            const usuario = document.getElementById('usuario').value;
            const password = document.getElementById('password').value;
            try {
                const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        empresa,
                        usuario,
                        password
                    })
                });

                const data = await response.json();

                if (!response.ok) {
                    mostrarAlerta(data.error || 'Credenciales incorrectas. Intente nuevamente.', "Error de autenticación", "error");
                    return;
                }

                sessionStorage.setItem('authToken', data.token);
                sessionStorage.setItem('loggedIn', 'true');
                sessionStorage.setItem('empresaId', data.empresaId);
                currentSessionUser = data;
                window.currentSessionUser = data;

                await iniciarApp();
            } catch (error) {
                console.error('Error al iniciar sesión:', error);
                mostrarAlerta('No se pudo conectar con el servidor. Intente nuevamente.', "Error de conexión", "error");
            }
        });
    }

    const btnLogout = document.getElementById('btnLogout');
    if (btnLogout) {
        btnLogout.addEventListener('click', openLogoutConfirm);
    }

    const btnConfirmLogout = document.getElementById('btnConfirmLogout');
    if (btnConfirmLogout) {
        btnConfirmLogout.addEventListener('click', confirmLogout);
    }

    const btnCancelLogout = document.getElementById('btnCancelLogout');
    if (btnCancelLogout) {
        btnCancelLogout.addEventListener('click', closeLogoutConfirm);
    }

    if (sessionStorage.getItem('loggedIn') !== 'true') {
        showLogin();
        return;
    }

    const sesionValida = await validarSesionActual();

    if (!sesionValida) {
        sessionStorage.removeItem('loggedIn');
        sessionStorage.removeItem('authToken');
        showLogin();
        return;
    }

    await iniciarApp();
});
