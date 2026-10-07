// backend/server.js
require('dotenv').config({
  path: require('path').resolve(__dirname, `../.env.${process.env.NODE_ENV || 'local'}`)
});

// Fallback a .env.local si el archivo no existe
const fs = require('fs');
const path = require('path');
if (!fs.existsSync(path.resolve(__dirname, `../.env.${process.env.NODE_ENV || 'local'}`))) {
  require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') });
}

const planesAhorroRoutes = require('./routes/planesAhorroRoutes');

const cors = require('cors');
const express = require('express');
const app = express();
const db = require('./database/database');

const allowedOrigins = [
  'https://elda-gestion.pages.dev',          // producción
  'https://elda-gestion-staging.pages.dev',             // staging
  
  // Desarrollo local
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:3000',
  'http://127.0.0.1:3000'
];

const corsOptions = {
  origin: function (origin, callback) {
    // Permitir requests sin origin (curl, health checks, uptime checks)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error(`Not allowed by CORS: ${origin}`));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

const productosRoutes = require('./routes/productosRoutes');
const clientesRoutes = require('./routes/clientesRoutes');
const ventasRoutes = require('./routes/ventasRoutes');
const proveedoresRoutes = require('./routes/proveedoresRoutes');
const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');

app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/ventas', ventasRoutes);
app.use('/api/productos', productosRoutes);
app.use('/api/proveedores', proveedoresRoutes);
app.use('/api/clientes', clientesRoutes);
app.use('/api/planes-ahorro', planesAhorroRoutes);

const PORT = Number(process.env.PORT) || 3000;
db.ready
  .catch((error) => {
    console.error('No se pudo preparar la base de datos antes de iniciar:', error);
    process.exit(1);
  })
  .then(() => {
    app.listen(PORT, () => {
      console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
    });
  });
