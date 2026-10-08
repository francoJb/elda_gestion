const express = require('express');
const router = express.Router();
const controller = require('../controllers/planesAhorroController');
const verificarToken = require('../middlewares/authMiddleware');
const verificarTenant = require('../middlewares/tenantMiddleware');
const ventasController = require('../controllers/ventasController');

router.get('/historial', verificarToken, verificarTenant, controller.obtenerHistorialPlanes);
router.post('/', verificarToken, verificarTenant, controller.crearPlanAhorro);
router.post('/:id/anticipos', verificarToken, verificarTenant, controller.registrarAnticipo);
router.get('/', verificarToken, verificarTenant, controller.obtenerPlanesActivos);
router.post('/:id/adjudicar', verificarToken, verificarTenant, ventasController.adjudicarPlanAhorro);
router.post('/:id/devoluciones', verificarToken, verificarTenant, controller.registrarDevolucionPlan);
router.get('/:id/movimientos', verificarToken, verificarTenant, controller.obtenerMovimientosPlan);

module.exports = router;