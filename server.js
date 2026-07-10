const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jwt-simple');
const nodemailer = require('nodemailer');
const cors = require('cors');
const multer = require('multer'); // Para procesar la subida de fotos
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static('public'));

// Configuración de almacenamiento para fotos de perfil (en memoria para Railway)
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 2 * 1024 * 1024 } // Máximo 2MB
});

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'mi_clave_secreta_geoalerta';

// Configuración de Brevo (Nodemailer)
const transporter = nodemailer.createTransport({
    host: 'smtp-relay.brevo.com',
    port: 587,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});

// Inicializar base de datos y añadir columnas si no existen
const initDB = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS usuarios (
                id SERIAL PRIMARY KEY,
                nombre VARCHAR(100),
                apellido VARCHAR(100),
                email VARCHAR(100) UNIQUE,
                fecha_nacimiento DATE,
                password VARCHAR(255),
                verificado BOOLEAN DEFAULT FALSE,
                codigo_verificacion VARCHAR(6),
                telefono VARCHAR(20),
                foto_perfil BYTEA
            );
        `);
        console.log("Base de datos verificada y lista.");
    } catch (err) {
        console.error("Error al inicializar DB:", err);
    }
};
initDB();

// RUTAS DE AUTENTICACIÓN

// 1. Registro
app.post('/api/auth/register', async (req, res) => {
    const { nombre, apellido, email, fecha_nacimiento, password } = req.body;
    try {
        const userCheck = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
        if (userCheck.rows.length > 0) {
            return res.status(400).json({ mensaje: 'El correo ya está registrado.' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const codigo = Math.floor(100000 + Math.random() * 900000).toString();

        await pool.query(
            'INSERT INTO usuarios (nombre, apellido, email, fecha_nacimiento, password, codigo_verificacion) VALUES ($1, $2, $3, $4, $5, $6)',
            [nombre, apellido, email, fecha_nacimiento, hashedPassword, codigo]
        );

        await transporter.sendMail({
            from: '"GeoAlerta" <no-reply@geoalerta.com>',
            to: email,
            subject: 'Código de Verificación - GeoAlerta',
            text: `Tu código de verificación es: ${codigo}`
        });

        res.status(201).json({ mensaje: 'Usuario registrado. Código enviado al correo.' });
    } catch (err) {
        res.status(500).json({ mensaje: 'Error en el servidor.' });
    }
});

// 2. Verificar Código (Registro o Recuperación)
app.post('/api/auth/verify', async (req, res) => {
    const { email, codigo } = req.body;
    try {
        const result = await pool.query('SELECT * FROM usuarios WHERE email = $1 AND codigo_verificacion = $2', [email, codigo]);
        if (result.rows.length === 0) {
            return res.status(400).json({ mensaje: 'Código incorrecto o expirado.' });
        }

        await pool.query('UPDATE usuarios SET verificado = true, codigo_verificacion = NULL WHERE email = $1', [email]);
        res.json({ mensaje: 'Código verificado con éxito.' });
    } catch (err) {
        res.status(500).json({ mensaje: 'Error al verificar.' });
    }
});

// 3. Login
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
        if (result.rows.length === 0) return res.status(400).json({ mensaje: 'Usuario no encontrado.' });

        const usuario = result.rows[0];
        if (!usuario.verificado) return res.status(401).json({ mensaje: 'Por favor, verifica tu cuenta primero.' });

        const validPassword = await bcrypt.compare(password, usuario.password);
        if (!validPassword) return res.status(400).json({ mensaje: 'Contraseña incorrecta.' });

        const token = jwt.encode({ id: usuario.id }, JWT_SECRET);
        
        // Convertir foto de binario a Base64 para enviarla al navegador de forma segura
        let fotoBase64 = null;
        if (usuario.foto_perfil) {
            fotoBase64 = `data:image/jpeg;base64,${usuario.foto_perfil.toString('base64')}`;
        }

        res.json({
            token,
            usuario: {
                nombre: usuario.nombre,
                apellido: usuario.apellido,
                email: usuario.email,
                telefono: usuario.telefono,
                foto_url: fotoBase64
            }
        });
    } catch (err) {
        res.status(500).json({ mensaje: 'Error en el login.' });
    }
});

// 4. Olvidó Contraseña - Paso 1: Generar y enviar código
app.post('/api/auth/forgot-password', async (req, res) => {
    const { email } = req.body;
    try {
        const result = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
        if (result.rows.length === 0) return res.status(400).json({ mensaje: 'El correo no está registrado.' });

        const codigo = Math.floor(100000 + Math.random() * 900000).toString();
        await pool.query('UPDATE usuarios SET codigo_verificacion = $1 WHERE email = $2', [codigo, email]);

        await transporter.sendMail({
            from: '"GeoAlerta" <no-reply@geoalerta.com>',
            to: email,
            subject: 'Restablecer Contraseña - GeoAlerta',
            text: `Tu código temporal para cambiar tu contraseña es: ${codigo}`
        });

        res.json({ mensaje: 'Código de recuperación enviado al correo.' });
    } catch (err) {
        res.status(500).json({ mensaje: 'Error al procesar la solicitud.' });
    }
});

// 5. Olvidó Contraseña - Paso 2: Actualizar contraseña real
app.post('/api/auth/reset-password', async (req, res) => {
    const { email, codigo, nuevaPassword } = req.body;
    try {
        const result = await pool.query('SELECT * FROM usuarios WHERE email = $1 AND codigo_verificacion = $2', [email, codigo]);
        if (result.rows.length === 0) {
            return res.status(400).json({ mensaje: 'El código es inválido o no corresponde a esta solicitud.' });
        }

        const hashedNewPassword = await bcrypt.hash(nuevaPassword, 10);
        await pool.query(
            'UPDATE usuarios SET password = $1, codigo_verificacion = NULL WHERE email = $2',
            [hashedNewPassword, email]
        );

        res.json({ mensaje: 'Contraseña actualizada correctamente. Ya puedes iniciar sesión.' });
    } catch (err) {
        res.status(500).json({ mensaje: 'Error al cambiar la contraseña.' });
    }
});

// Middleware de seguridad para proteger rutas del Dashboard
const verificarToken = (req, res, next) => {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) return res.status(403).json({ mensaje: 'Acceso denegado.' });

    try {
        const decoded = jwt.decode(token, JWT_SECRET);
        req.usuarioId = decoded.id;
        next();
    } catch (err) {
        res.status(401).json({ mensaje: 'Token inválido.' });
    }
};

// 6. Dashboard: Guardar Perfil con Archivo de Imagen Real
app.put('/api/usuario/perfil', verificarToken, upload.single('foto_perfil'), async (req, res) => {
    const { nombre, apellido, telefono } = req.body;
    try {
        if (req.file) {
            // Si el usuario subió un archivo desde su equipo, lo guardamos como datos binarios (BYTEA)
            await pool.query(
                'UPDATE usuarios SET nombre = $1, apellido = $2, telefono = $3, foto_perfil = $4 WHERE id = $5',
                [nombre, apellido, telefono, req.file.buffer, req.usuarioId]
            );
        } else {
            // Si no cambió la foto, solo actualizamos los campos de texto
            await pool.query(
                'UPDATE usuarios SET nombre = $1, apellido = $2, telefono = $3 WHERE id = $4',
                [nombre, apellido, telefono, req.usuarioId]
            );
        }

        // Volver a obtener el usuario actualizado para enviarlo de vuelta al front
        const updated = await pool.query('SELECT * FROM usuarios WHERE id = $1', [req.usuarioId]);
        const user = updated.rows[0];
        
        let fotoBase64 = null;
        if (user.foto_perfil) {
            fotoBase64 = `data:image/jpeg;base64,${user.foto_perfil.toString('base64')}`;
        }

        res.json({
            mensaje: 'Perfil guardado con éxito.',
            usuario: { nombre: user.nombre, apellido: user.apellido, email: user.email, telefono: user.telefono, foto_url: fotoBase64 }
        });
    } catch (err) {
        res.status(500).json({ mensaje: 'Error al actualizar el perfil.' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor GeoAlerta corriendo en puerto ${PORT}`));
