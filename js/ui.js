// ==========================================
// 2. UTILIDADES GENERALES (UI Y NAVEGACIÓN)
// ==========================================
export const toggleModal = (id, mostrar = true) => {
    const modal = document.getElementById(id);
    modal.classList.toggle("hidden", !mostrar);
    modal.classList.toggle("flex", mostrar);
};

export const mostrarLoader = () => {
    const loader = document.getElementById("globalLoader");
    if (!loader) return;

    loader.classList.remove("hidden");
    loader.classList.add("flex");
};

export const ocultarLoader = () => {
    const loader = document.getElementById("globalLoader");
    if (!loader) return;

    loader.classList.add("hidden");
    loader.classList.remove("flex");
};

const LINKS_POR_SECCION = {
    seccionDashboard: "linkDashboard",
    seccionVentas: "linkVentas",
    pantallaGenerarVenta: "linkVentas",
    "pantalla-detalle-venta": "linkVentas",
    "pantalla-balance-cliente": "linkVentas",
    seccionContratos: "linkContratos",
    pantallaGenerarContrato: "linkContratos",
    seccionClientes: "linkClientes",
    pantallaCliente: "linkClientes",
    seccionProductos: "linkProductos",
    pantallaProducto: "linkProductos",
    seccionProveedores: "linkProveedores",
    seccionConfig: "linkConfig"
};

function actualizarNavegacionActiva(idSeccionDestino) {
    const idLinkActivo = LINKS_POR_SECCION[idSeccionDestino];
    const links = Object.values(LINKS_POR_SECCION);

    [...new Set(links)].forEach(id => {
        const link = document.getElementById(id);
        if (!link) return;

        const activo = id === idLinkActivo;
        link.classList.toggle("sidebar-link-active", activo);

        if (activo) {
            link.setAttribute("aria-current", "page");
        } else {
            link.removeAttribute("aria-current");
        }
    });
}


export const cambiarSeccion = (idSeccionDestino) => {

    const pantallas = [
        "seccionDashboard", 
        "seccionProductos", 
        "seccionClientes", 
        "seccionVentas",
        "seccionContratos",
        "seccionProveedores",
        "seccionConfig",
        "pantallaGenerarVenta",
        "pantallaGenerarContrato",
        "pantalla-balance-cliente",
        "pantallaCliente",
        "pantallaProducto",
        "pantalla-detalle-venta"
    ];
    pantallas.forEach(id => {
        const elemento = document.getElementById(id);
        if (elemento) {
            elemento.classList.add("hidden");
        }
    });
  
    const pantallaActiva = document.getElementById(idSeccionDestino);
    if (pantallaActiva) {
        pantallaActiva.classList.remove("hidden");
    }

    actualizarNavegacionActiva(idSeccionDestino);
    
    window.scrollTo({
        top: 0,
        behavior: "smooth"
    });
   
    const headerVentas = document.getElementById("headerVentas");
    if (headerVentas) {
        if (idSeccionDestino === "pantallaGenerarVenta") {
            headerVentas.classList.add("hidden");
        } else {
            headerVentas.classList.remove("hidden");
        }
    }

    // Inicializar opciones de pago cuando se entra a la sección de ventas
    if (idSeccionDestino === "seccionVentas" || idSeccionDestino === "pantallaGenerarVenta") {
        if (typeof window.actualizarOpcionesPago === "function") {
            // Por defecto, ocultar cuenta corriente (consumidor final)
            window.actualizarOpcionesPago(false);
        }
    }
};

window.cambiarSeccion = cambiarSeccion;
window.toggleModal = toggleModal;

// ==========================================
// 3. SISTEMA DE ALERTAS/MODALES
// ==========================================

/**
 * Muestra un modal de alerta personalizado
 * @param {string} message - Mensaje a mostrar
 * @param {string} title - Título del modal (opcional)
 * @param {string} type - Tipo de alerta: 'success', 'error', 'warning', 'info'
 */
export const mostrarAlerta = (message, title = '', type = 'info') => {
    const modal = document.getElementById('modalAlerta');
    const content = document.getElementById('modalAlertaContent');
    const icon = document.getElementById('modalAlertaIcon');
    const titleEl = document.getElementById('modalAlertaTitle');
    const messageEl = document.getElementById('modalAlertaMessage');
    const btn = document.getElementById('modalAlertaBtn');

    if (!modal || !content || !icon || !titleEl || !messageEl || !btn) {
        return Promise.resolve();
    }

    // Configurar icono y colores según el tipo
    const config = {
        success: { icon: '✅', title: title || '¡Éxito!' },
        error: { icon: '❌', title: title || 'Error' },
        warning: { icon: '⚠️', title: title || 'Advertencia' },
        info: { icon: 'ℹ️', title: title || 'Información' }
    };

    const { icon: iconText, title: defaultTitle } = config[type] || config.info;

    icon.textContent = iconText;
    titleEl.textContent = title || defaultTitle;
    messageEl.textContent = message;

    // Mostrar modal con animación
    modal.classList.remove('hidden');
    modal.classList.add('flex');

    // Animación de entrada
    setTimeout(() => {
        content.classList.remove('scale-95', 'opacity-0');
        content.classList.add('scale-100', 'opacity-100');
    }, 10);

    return new Promise((resolve) => {
        const cerrarModal = () => {
            content.classList.remove('scale-100', 'opacity-100');
            content.classList.add('scale-95', 'opacity-0');

            setTimeout(() => {
                modal.classList.add('hidden');
                modal.classList.remove('flex');
            }, 300);

            btn.removeEventListener('click', handleClick);
            modal.removeEventListener('click', handleOutsideClick);
            document.removeEventListener('keydown', handleEscape);
            resolve();
        };

        const handleClick = () => cerrarModal();
        const handleOutsideClick = (e) => {
            if (e.target === modal) {
                cerrarModal();
            }
        };
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                cerrarModal();
            }
        };

        btn.addEventListener('click', handleClick);
        modal.addEventListener('click', handleOutsideClick);
        document.addEventListener('keydown', handleEscape);
    });
};

export const mostrarConfirmacion = ({
    title = 'Confirmar acción',
    message = '¿Deseas continuar?',
    confirmText = 'Confirmar',
    cancelText = 'Cancelar'
} = {}) => {
    const modal = document.getElementById('modalConfirmacion');
    const content = document.getElementById('modalConfirmacionContent');
    const titleEl = document.getElementById('modalConfirmacionTitle');
    const messageEl = document.getElementById('modalConfirmacionMessage');
    const btnCancel = document.getElementById('modalConfirmacionCancel');
    const btnAccept = document.getElementById('modalConfirmacionAccept');

    if (!modal || !content || !titleEl || !messageEl || !btnCancel || !btnAccept) {
        return Promise.resolve(window.confirm(message));
    }

    titleEl.textContent = title;
    messageEl.textContent = message;
    btnCancel.textContent = cancelText;
    btnAccept.textContent = confirmText;

    modal.classList.remove('hidden');
    modal.classList.add('flex');

    setTimeout(() => {
        content.classList.remove('scale-95', 'opacity-0');
        content.classList.add('scale-100', 'opacity-100');
    }, 10);

    return new Promise((resolve) => {
        const cerrar = (confirmado) => {
            content.classList.remove('scale-100', 'opacity-100');
            content.classList.add('scale-95', 'opacity-0');

            setTimeout(() => {
                modal.classList.add('hidden');
                modal.classList.remove('flex');
            }, 300);

            btnCancel.removeEventListener('click', cancelar);
            btnAccept.removeEventListener('click', confirmar);
            modal.removeEventListener('click', clickFuera);
            document.removeEventListener('keydown', escape);
            resolve(confirmado);
        };

        const cancelar = () => cerrar(false);
        const confirmar = () => cerrar(true);
        const clickFuera = (e) => {
            if (e.target === modal) cerrar(false);
        };
        const escape = (e) => {
            if (e.key === 'Escape') cerrar(false);
        };

        btnCancel.addEventListener('click', cancelar);
        btnAccept.addEventListener('click', confirmar);
        modal.addEventListener('click', clickFuera);
        document.addEventListener('keydown', escape);
    });
};

/**
 * Función global para reemplazar alert() - mantiene compatibilidad
 * @param {string} message - Mensaje a mostrar
 */
window.mostrarAlerta = mostrarAlerta;
window.mostrarConfirmacion = mostrarConfirmacion;

// Función de compatibilidad para reemplazar alert()
window.alert = (message) => {
    mostrarAlerta(message, '', 'info');
};
