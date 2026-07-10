const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs'); 
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const cors = require('cors');
const multer = require('multer'); 
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static('public'));

const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 3 * 1024 * 1024 } // Límite de 3MB
});

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'mi_clave_secreta_geoalerta';

console.log("===== VARIABLES SMTP =====");
console.log("BREVO_SMTP_USER:", process.env.BREVO_SMTP_USER);
console.log("BREVO_API_KEY:", process.env.BREVO_API_KEY ? "Cargada" : "NO CARGADA");
console.log("==========================");

const transporter = nodemailer.createTransport({
    host: "smtp-relay.brevo.com",
    port: 587,
    secure: false,
    auth: {
        user: process.env.BREVO_SMTP_USER,
        pass: process.env.BREVO_API_KEY
    }
});

transporter.verify((error, success) => {
    if (error) {
        console.error("❌ Error SMTP:", error);
    } else {
        console.log("✅ SMTP conectado correctamente");
    }
});

// Inicializar tabla asegurando que exista la columna foto_perfil
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
        await pool.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS foto_perfil BYTEA;`);
        console.log("Base de datos sincronizada correctamente.");
    } catch (err) {
        console.error("Error al inicializar DB:", err);
    }
};
initDB();

// Middleware de autenticación
const verificarToken = (req, res, next) => {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) return res.status(403).json({ mensaje: 'Acceso no autorizado.' });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.usuarioId = decoded.id;
        next();
    } catch (err) {
        return res.status(401).json({ mensaje: 'Sesión expirada.' });
    }
};

// Validar sesión activa (F5)
app.get('/api/auth/me', verificarToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM usuarios WHERE id = $1', [req.usuarioId]);
        if (result.rows.length === 0) return res.status(404).json({ mensaje: 'Usuario no encontrado.' });

        const usuario = result.rows[0];
        let fotoBase64 = null;
        if (usuario.foto_perfil) {
            fotoBase64 = `data:image/jpeg;base64,${usuario.foto_perfil.toString('base64')}`;
        }

        return res.json({
            usuario: {
                nombre: usuario.nombre,
                apellido: usuario.apellido,
                email: usuario.email,
                telefono: usuario.telefono,
                foto_url: fotoBase64
            }
        });
    } catch (err) {
        return res.status(500).json({ mensaje: 'Error al recuperar la sesión.' });
    }
});

// 1. REGISTRO
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

        // CORREGIDO: Remitente estricto para evitar bloqueos de Brevo
try {
    const info = await transporter.sendMail({
        from: '"GeoAlerta" <jesusmedrandam@gmail.com>',
        to: email,
        subject: 'Código de Verificación - GeoAlerta',
        text: `Tu código de verificación es: ${codigo}`
    });

    console.log("✅ Correo enviado correctamente:", info.response);

} catch (err) {
    console.error("❌ Error enviando correo de verificación:");
    console.error(err);
}


        return res.status(201).json({ mensaje: 'Usuario creado. Introduce el código enviado a tu correo.' });
    } catch (err) {
        console.error("Error en registro:", err);
        return res.status(500).json({ mensaje: 'Error interno en el servidor al registrar.' });
    }
});

// 2. VERIFICACIÓN DE CÓDIGO
app.post('/api/auth/verify', async (req, res) => {
    const { email, codigo } = req.body;
    try {
        const result = await pool.query('SELECT * FROM usuarios WHERE email = $1 AND codigo_verificacion = $2', [email, codigo]);
        if (result.rows.length === 0) {
            return res.status(400).json({ mensaje: 'El código introducido es incorrecto.' });
        }

        await pool.query('UPDATE usuarios SET verificado = true, codigo_verificacion = NULL WHERE email = $1', [email]);
        return res.json({ mensaje: '¡Cuenta verificada con éxito! Ya puedes iniciar sesión.' });
    } catch (err) {
        return res.status(500).json({ mensaje: 'Error al verificar el código.' });
    }
});

// 3. INICIO DE SESIÓN
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
        if (result.rows.length === 0) return res.status(400).json({ mensaje: 'Usuario no encontrado.' });

        const usuario = result.rows[0];
        if (!usuario.verificado) return res.status(401).json({ mensaje: 'Por favor, verifica tu cuenta primero.' });

        const validPassword = await bcrypt.compare(password, usuario.password);
        if (!validPassword) return res.status(400).json({ mensaje: 'Contraseña incorrecta.' });

        const token = jwt.sign({ id: usuario.id }, JWT_SECRET, { expiresIn: '7d' });
        
        let fotoBase64 = null;
        if (usuario.foto_perfil) {
            fotoBase64 = `data:image/jpeg;base64,${usuario.foto_perfil.toString('base64')}`;
        }

        return res.json({
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
        return res.status(500).json({ mensaje: 'Error en el inicio de sesión.' });
    }
});

// 4. SOLICITAR RECUPERACIÓN DE CONTRASEÑA
app.post('/api/auth/forgot-password', async (req, res) => {
    const { email } = req.body;

    try {
        const result = await pool.query(
            'SELECT * FROM usuarios WHERE email = $1',
            [email]
        );

        if (result.rows.length === 0) {
            return res.status(400).json({
                mensaje: 'Este correo electrónico no está registrado.'
            });
        }

        const codigo = Math.floor(100000 + Math.random() * 900000).toString();

        await pool.query(
            'UPDATE usuarios SET codigo_verificacion = $1 WHERE email = $2',
            [codigo, email]
        );

        // Enviar correo
        const info = await transporter.sendMail({
            from: '"GeoAlerta" <jesusmedrandam@gmail.com>',
            to: email,
            subject: 'Restablecer Contraseña - GeoAlerta',
            text: `Tu código para cambiar la contraseña es: ${codigo}`
        });

        console.log("✅ Correo enviado correctamente:", info.response);

        return res.json({
            mensaje: 'Código de recuperación enviado correctamente.'
        });

    } catch (err) {
        console.error("❌ Error al enviar correo de recuperación:");
        console.error(err);

        return res.status(500).json({
            mensaje: 'Error en el servidor al procesar la solicitud.'
        });
    }
});

// 5. RESTABLECER CONTRASEÑA FINAL
app.post('/api/auth/reset-password', async (req, res) => {
    const { email, codigo, nuevaPassword } = req.body;
    try {
        const result = await pool.query('SELECT * FROM usuarios WHERE email = $1 AND codigo_verificacion = $2', [email, codigo]);
        if (result.rows.length === 0) {
            return res.status(400).json({ mensaje: 'Código inválido o vencido.' });
        }

        const hashedNewPassword = await bcrypt.hash(nuevaPassword, 10);
        await pool.query(
            'UPDATE usuarios SET password = $1, codigo_verificacion = NULL WHERE email = $2',
            [hashedNewPassword, email]
        );

        return res.json({ mensaje: 'Tu contraseña ha sido actualizada correctamente.' });
    } catch (err) {
        return res.status(500).json({ mensaje: 'Error al cambiar la contraseña.' });
    }
});

// 6. ACTUALIZAR PERFIL (FOTO EN BLOB/BYTEA)
app.put('/api/usuario/perfil', verificarToken, upload.single('foto_perfil'), async (req, res) => {
    const { nombre, apellido, telefono } = req.body;
    try {
        if (req.file) {
            await pool.query(
                'UPDATE usuarios SET nombre = $1, apellido = $2, telefono = $3, foto_perfil = $4 WHERE id = $5',
                [nombre, apellido, telefono, req.file.buffer, req.usuarioId]
            );
        } else {
            await pool.query(
                'UPDATE usuarios SET nombre = $1, apellido = $2, telefono = $3 WHERE id = $4',
                [nombre, apellido, telefono, req.usuarioId]
            );
        }

        const updated = await pool.query('SELECT * FROM usuarios WHERE id = $1', [req.usuarioId]);
        const user = updated.rows[0];
        
        let fotoBase64 = null;
        if (user.foto_perfil) {
            fotoBase64 = `data:image/jpeg;base64,${user.foto_perfil.toString('base64')}`;
        }

        return res.json({
            mensaje: 'Perfil actualizado correctamente.',
            usuario: { nombre: user.nombre, apellido: user.apellido, email: user.email, telefono: user.telefono, foto_url: fotoBase64 }
        });
    } catch (err) {
        console.error("Error al guardar perfil:", err);
        return res.status(500).json({ mensaje: 'Error al guardar la información en el perfil.' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor activo en el puerto ${PORT}`));
