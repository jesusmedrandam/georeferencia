const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Permite recibir datos en formato JSON y conectar con el frontend
app.use(cors());
app.use(express.json());

// Conexión a PostgreSQL en Render
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false // Requerido por Render para conexiones seguras
    }
});

// Probar conexión a la Base de Datos
pool.connect((err, client, release) => {
    if (err) {
        return console.error('Error adquiriendo el cliente de la BD', err.stack);
    }
    console.log('Conexión exitosa a PostgreSQL en Render 🚀');
    release();
});

// ==========================================
// RUTA 1: REGISTRO MANUAL DE USUARIOS
// ==========================================
app.post('/api/auth/register', async (req, res) => {
    const { nombre, apellido, email, fecha_nacimiento, password } = req.body;

    try {
        // 1. Verificar si el correo ya está registrado en la base de datos
        const usuarioExiste = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
        if (usuarioExiste.rows.length > 0) {
            return res.status(400).json({ mensaje: 'El correo electrónico ya está registrado.' });
        }

        // 2. Encriptar la contraseña por seguridad (Regla de oro)
        const salt = await bcrypt.genSalt(10);
        const passwordHasheada = await bcrypt.hash(password, salt);

        // 3. Insertar el nuevo usuario en la tabla de Postgres
        const nuevoUsuario = await pool.query(
            `INSERT INTO usuarios (nombre, apellido, email, fecha_nacimiento, password, auth_provider) 
             VALUES ($1, $2, $3, $4, $5, 'manual') RETURNING id, email`,
            [nombre, apellido, email, fecha_nacimiento, passwordHasheada]
        );

        // 4. (Opcional por ahora) Aquí es donde dispararíamos el código de verificación por correo
        console.log(`Enviar código de verificación a: ${email}`);

        res.status(201).json({
            mensaje: 'Usuario registrado con éxito. Se requiere verificación.',
            usuario: nuevoUsuario.rows[0]
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ mensaje: 'Error interno del servidor.' });
    }
});

// Iniciar Servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
});
