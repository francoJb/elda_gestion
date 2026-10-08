// backend/routes/clientesRoutes.js
const express = require('express');
const router = express.Router();
const clientesController = require('../controllers/clientesController');
const verificarToken = require('../middlewares/authMiddleware');
const verificarTenant = require('../middlewares/tenantMiddleware');

router.get('/', verificarToken, verificarTenant, clientesController.obtenerClientes);
router.post('/', verificarToken, verificarTenant, clientesController.crearCliente);
router.put('/:id', verificarToken, verificarTenant, clientesController.editarCliente);
router.put('/:id/reactivar', verificarToken, verificarTenant, clientesController.reactivarCliente);
router.delete('/:id', verificarToken, verificarTenant, clientesController.eliminarCliente);
router.get('/:id/cuenta-corriente', verificarToken, verificarTenant, clientesController.obtenerCuentaCorriente);

module.exports = router;
