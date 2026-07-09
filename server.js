const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path'); // Módulo integrado de Node para manejar rutas de archivos
require('dotenv').config();

const app = express();

// Middleware: Permite recibir datos en formato JSON y conectar con el frontend sin bloqueos de seguridad
app.use(cors());
app.use(express.json());

// Servir archivos estáticos (como styles.css o imágenes) que estén en la raíz
app.use(express.static(__dirname));

// Conexión a PostgreSQL en Render usando la URL externa
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false // Requerido por Render para conexiones cifradas SSL
    }
});

// Probar que la conexión con PostgreSQL sea exitosa
pool.connect((err, client, release) => {
    if (err) {
        return console.error('Error adquiriendo el cliente de la BD:', err.stack);
    }
    console.log('Conexión exitosa a PostgreSQL en Render 🚀');
    release();
});

// =========================================================================
// RUTA DE INICIO (FRONTEND): Carga tu index.html al entrar a https://geoalerta.onrender.com
// =========================================================================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// =========================================================================
// RUTA DE API: REGISTRO MANUAL DE USUARIOS
// =========================================================================
app.post('/api/auth/register', async (req, res) => {
    const { nombre, apellido, email, fecha_nacimiento, password } = req.body;

    try {
        // 1. Verificar si el correo ya está registrado en la base de datos
        const usuarioExiste = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
        if (usuarioExiste.rows.length > 0) {
            return res.status(400).json({ mensaje: 'El correo electrónico ya está registrado.' });
        }

        // 2. Encriptar la contraseña por seguridad usando bcrypt (nunca texto plano)
        const salt = await bcrypt.genSalt(10);
        const passwordHasheada = await bcrypt.hash(password, salt);

        // 3. Insertar el nuevo usuario en la tabla de Postgres
        const nuevoUsuario = await pool.query(
            `INSERT INTO usuarios (nombre, apellido, email, fecha_nacimiento, password, auth_provider) 
             VALUES ($1, $2, $3, $4, $5, 'manual') RETURNING id, email`,
            [nombre, apellido, email, fecha_nacimiento, passwordHasheada]
        );

        // 4. (Paso posterior) Aquí programaremos el envío del código por correo
        console.log(`Enviar código de verificación a: ${email}`);

        res.status(201).json({
            mensaje: 'Usuario registrado con éxito. Se requiere verificación por correo.',
            usuario: nuevoUsuario.rows[0]
        });

    } catch (error) {
        console.error('Error en el registro:', error);
        res.status(500).json({ mensaje: 'Error interno del servidor al procesar el registro.' });
    }
});

// Iniciar Servidor (Render asigna automáticamente un puerto en la variable process.env.PORT, que suele ser 10000)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor corriendo con éxito en el puerto ${PORT}`);
});
