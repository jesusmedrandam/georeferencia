const axios = require('axios');
const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs'); 
const jwt = require('jsonwebtoken');
const cors = require('cors');
const multer = require('multer'); 
require('dotenv').config();
const { initializeDatabase } = require('./src/schema');
const { getUserAccess, mountInstitutionRoutes } = require('./src/institutions');
const { crearCodigo, verificarCodigo, consumirCodigo } = require('./src/auth-codes');

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

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
    throw new Error('Configura JWT_SECRET con al menos 32 caracteres en las variables de entorno.');
}

// === FUNCIÓN DE ENVÍO POR API DE BREVO ===
async function enviarCorreo(destinatario, asunto, mensaje) {
    try {
        const response = await axios.post(
            "https://api.brevo.com/v3/smtp/email",
            {
                sender: { name: "GeoAlerta", email: "jesusmedrandam@gmail.com" },
                to: [{ email: destinatario }],
                subject: asunto,
                textContent: mensaje
            },
            {
                headers: {
                    "api-key": process.env.BREVO_API_KEY,
                    "Content-Type": "application/json"
                }
            }
        );
        console.log("✅ API Brevo - Correo enviado correctamente:", response.data);
        return true;
    } catch (error) {
        console.error("❌ API Brevo - Error al enviar el correo:");
        if (error.response) console.error(error.response.data);
        else console.error(error.message);
        return false;
    }
}

// Cada solicitud protegida valida en la base de datos el estado y versión de sesión.
const verificarToken = async (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ mensaje: 'Necesitas iniciar sesión.' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const { rows } = await pool.query(
            'SELECT id, activo, verificado, es_superadmin, password_version FROM usuarios WHERE id = $1',
            [decoded.id]
        );
        const usuario = rows[0];
        if (!usuario || !usuario.activo || !usuario.verificado ||
            Number(decoded.v ?? 0) !== usuario.password_version) {
            return res.status(401).json({ mensaje: 'Tu sesión ya no es válida.' });
        }
        req.usuarioId = usuario.id;
        req.usuario = usuario;
        next();
    } catch (err) {
        if (err.name === 'TokenExpiredError' || err.name === 'JsonWebTokenError') {
            return res.status(401).json({ mensaje: 'Sesión expirada o inválida.' });
        }
        console.error('Error al verificar sesión:', err);
        return res.status(500).json({ mensaje: 'No se pudo verificar la sesión.' });
    }
};

// Validar sesión activa (F5) - ACTUALIZADO: Retorna fecha_nacimiento
app.get('/api/auth/me', verificarToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM usuarios WHERE id = $1', [req.usuarioId]);
        if (result.rows.length === 0) return res.status(404).json({ mensaje: 'Usuario no encontrado.' });

        const usuario = result.rows[0];
        let fotoBase64 = null;
        if (usuario.foto_perfil) {
            fotoBase64 = `data:${usuario.foto_perfil_mime || 'image/jpeg'};base64,${usuario.foto_perfil.toString('base64')}`;
        }

        return res.json({
            usuario: {
                nombre: usuario.nombre,
                apellido: usuario.apellido,
                email: usuario.email,
                telefono: usuario.telefono,
                fecha_nacimiento: usuario.fecha_nacimiento, // Agregado para persistencia en front
                foto_url: fotoBase64,
                rol_global: usuario.es_superadmin ? 'superadministrador' : 'ciudadano',
                instituciones: await getUserAccess(pool, usuario.id)
            }
        });
    } catch (err) {
        console.error('Error al recuperar sesión:', err);
        return res.status(500).json({ mensaje: 'Error al recuperar la sesión.' });
    }
});

// 1. REGISTRO: toda cuenta nueva comienza como ciudadano.
app.post('/api/auth/register', async (req, res) => {
    const { nombre, apellido, fecha_nacimiento, password } = req.body;
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (typeof nombre !== 'string' || !nombre.trim() || nombre.length > 100 ||
        typeof apellido !== 'string' || !apellido.trim() || apellido.length > 100 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 100 ||
        typeof password !== 'string' || password.length < 8 || password.length > 72 ||
        typeof fecha_nacimiento !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fecha_nacimiento)) {
        return res.status(400).json({ mensaje: 'Revisa tus datos. La contraseña debe tener al menos 8 caracteres.' });
    }
    try {
        const existente = await pool.query('SELECT id FROM usuarios WHERE LOWER(email) = $1', [email]);
        if (existente.rowCount) return res.status(409).json({ mensaje: 'El correo ya está registrado.' });
        const hashedPassword = await bcrypt.hash(password, 10);
        const { rows } = await pool.query(
            'INSERT INTO usuarios (nombre, apellido, email, fecha_nacimiento, password) VALUES ($1, $2, $3, $4, $5) RETURNING id, email',
            [nombre.trim(), apellido.trim(), email, fecha_nacimiento, hashedPassword]
        );
        const codigo = await crearCodigo(pool, rows[0], 'registro');
        const enviado = await enviarCorreo(email, 'Código de Verificación - GeoAlerta',
            'Tu código de verificación es: ' + codigo + '. Caduca en 15 minutos.');
        if (!enviado) return res.status(503).json({ mensaje: 'Cuenta creada, pero no se pudo enviar el código. Solicita un reenvío.' });
        return res.status(201).json({ mensaje: 'Usuario creado. Introduce el código enviado a tu correo.' });
    } catch (error) {
        console.error('Error en registro:', error);
        if (error.code === '23505') return res.status(409).json({ mensaje: 'El correo ya está registrado.' });
        return res.status(500).json({ mensaje: 'Error interno al registrar.' });
    }
});

// 2. VERIFICACIÓN DE CÓDIGO
app.post('/api/auth/verify', async (req, res) => {
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    try {
        const { rows } = await pool.query('SELECT * FROM usuarios WHERE LOWER(email) = $1', [email]);
        const usuario = rows[0];
        if (!usuario || usuario.verificado || !usuario.activo ||
            !(await verificarCodigo(pool, usuario, 'registro', req.body.codigo))) {
            return res.status(400).json({ mensaje: 'Código inválido, caducado o sin intentos restantes.' });
        }
        await pool.query('UPDATE usuarios SET verificado = TRUE WHERE id = $1', [usuario.id]);
        await consumirCodigo(pool, usuario.id);
        return res.json({ mensaje: '¡Cuenta verificada con éxito! Ya puedes iniciar sesión.' });
    } catch (error) {
        console.error('Error al verificar:', error);
        return res.status(500).json({ mensaje: 'Error al verificar el código.' });
    }
});

app.post('/api/auth/resend-verification', async (req, res) => {
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    try {
        const { rows } = await pool.query('SELECT id, email, verificado, activo FROM usuarios WHERE LOWER(email) = $1', [email]);
        const usuario = rows[0];
        if (!usuario || usuario.verificado || !usuario.activo) {
            return res.json({ mensaje: 'Si la cuenta necesita verificación, recibirás un correo.' });
        }
        const codigo = await crearCodigo(pool, usuario, 'registro');
        const enviado = await enviarCorreo(usuario.email, 'Verificación de GeoAlerta',
            'Tu código es: ' + codigo + '. Caduca en 15 minutos.');
        if (!enviado) return res.status(503).json({ mensaje: 'No se pudo enviar el correo. Intenta más tarde.' });
        res.json({ mensaje: 'Si la cuenta necesita verificación, recibirás un correo.' });
    } catch (error) {
        if (error.status === 429) return res.status(429).json({ mensaje: error.message });
        console.error('Error de reenvío:', error);
        res.status(500).json({ mensaje: 'Error al solicitar otro código.' });
    }
});

// 3. INICIO DE SESIÓN
app.post('/api/auth/login', async (req, res) => {
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = req.body.password;
    if (!email || typeof password !== 'string') return res.status(400).json({ mensaje: 'Credenciales inválidas.' });
    try {
        const { rows } = await pool.query('SELECT * FROM usuarios WHERE LOWER(email) = $1', [email]);
        const usuario = rows[0];
        if (!usuario) return res.status(401).json({ mensaje: 'Credenciales incorrectas.' });
        if (!usuario.activo) return res.status(403).json({ mensaje: 'La cuenta está desactivada.' });
        if (!usuario.verificado) return res.status(403).json({ mensaje: 'Por favor, verifica tu cuenta primero.' });
        if (usuario.bloqueado_hasta && new Date(usuario.bloqueado_hasta) > new Date()) {
            return res.status(429).json({ mensaje: 'Demasiados intentos. Prueba dentro de 5 minutos.' });
        }
        if (!(await bcrypt.compare(password, usuario.password))) {
            await pool.query(
                "UPDATE usuarios SET intentos_login = CASE WHEN intentos_login >= 4 THEN 0 ELSE intentos_login + 1 END, bloqueado_hasta = CASE WHEN intentos_login >= 4 THEN NOW() + INTERVAL '5 minutes' ELSE NULL END WHERE id = $1",
                [usuario.id]
            );
            return res.status(401).json({ mensaje: 'Credenciales incorrectas.' });
        }
        await pool.query('UPDATE usuarios SET intentos_login = 0, bloqueado_hasta = NULL WHERE id = $1', [usuario.id]);
        const token = jwt.sign({ id: usuario.id, v: usuario.password_version }, JWT_SECRET, { expiresIn: '7d' });
        const fotoBase64 = usuario.foto_perfil
            ? 'data:' + (usuario.foto_perfil_mime || 'image/jpeg') + ';base64,' + usuario.foto_perfil.toString('base64') : null;
        const instituciones = await getUserAccess(pool, usuario.id);
        res.json({
            token,
            usuario: {
                nombre: usuario.nombre, apellido: usuario.apellido, email: usuario.email,
                telefono: usuario.telefono, fecha_nacimiento: usuario.fecha_nacimiento,
                foto_url: fotoBase64, rol_global: usuario.es_superadmin ? 'superadministrador' : 'ciudadano',
                instituciones
            }
        });
    } catch (error) {
        console.error('Error en login:', error);
        res.status(500).json({ mensaje: 'Error en el inicio de sesión.' });
    }
});

// 4. SOLICITAR RECUPERACIÓN DE CONTRASEÑA
app.post('/api/auth/forgot-password', async (req, res) => {
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!email) return res.status(400).json({ mensaje: 'Indica un correo electrónico.' });
    try {
        const { rows } = await pool.query('SELECT id, email, activo FROM usuarios WHERE LOWER(email) = $1', [email]);
        if (rows[0]?.activo) {
            const codigo = await crearCodigo(pool, rows[0], 'recuperacion');
            const enviado = await enviarCorreo(rows[0].email, 'Restablecer Contraseña - GeoAlerta',
                'Tu código de recuperación es: ' + codigo + '. Caduca en 15 minutos.');
            if (!enviado) return res.status(503).json({ mensaje: 'No se pudo enviar el correo. Intenta más tarde.' });
        }
        res.json({ mensaje: 'Si el correo está registrado, recibirás un código de recuperación.' });
    } catch (error) {
        if (error.status === 429) return res.status(429).json({ mensaje: error.message });
        console.error('Error al recuperar contraseña:', error);
        res.status(500).json({ mensaje: 'Error al procesar la solicitud.' });
    }
});

// 5. RESTABLECER CONTRASEÑA FINAL
app.post('/api/auth/reset-password', async (req, res) => {
    const { codigo, nuevaPassword } = req.body;
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (typeof nuevaPassword !== 'string' || nuevaPassword.length < 8 || nuevaPassword.length > 72) {
        return res.status(400).json({ mensaje: 'La contraseña debe tener entre 8 y 72 caracteres.' });
    }
    try {
        const { rows } = await pool.query('SELECT * FROM usuarios WHERE LOWER(email) = $1', [email]);
        const usuario = rows[0];
        if (!usuario || !usuario.activo || !(await verificarCodigo(pool, usuario, 'recuperacion', codigo))) {
            return res.status(400).json({ mensaje: 'Código inválido, caducado o sin intentos restantes.' });
        }
        const hash = await bcrypt.hash(nuevaPassword, 10);
        await pool.query(
            'UPDATE usuarios SET password = $1, password_version = password_version + 1 WHERE id = $2',
            [hash, usuario.id]
        );
        await consumirCodigo(pool, usuario.id);
        res.json({ mensaje: 'Tu contraseña ha sido actualizada correctamente.' });
    } catch (error) {
        console.error('Error al restablecer contraseña:', error);
        res.status(500).json({ mensaje: 'Error al cambiar la contraseña.' });
    }
});

// 6. ACTUALIZAR PERFIL (CON VALIDACIÓN DE CONTRASEÑA ACTUAL Y FECHA DE NACIMIENTO)
app.put('/api/usuario/perfil', verificarToken, upload.single('foto_perfil'), async (req, res) => {
    const { nombre, apellido, telefono, fecha_nacimiento, passwordActual, passwordNueva } = req.body;
    if (typeof nombre !== 'string' || !nombre.trim() || typeof apellido !== 'string' || !apellido.trim() || nombre.length > 100 || apellido.length > 100 ||
        (telefono && telefono.length > 20) || (passwordNueva && (passwordNueva.length < 8 || passwordNueva.length > 72)) ||
        (!!passwordActual !== !!passwordNueva)) {
        return res.status(400).json({ mensaje: 'Datos inválidos. Para cambiar la contraseña indica la actual y una nueva de al menos 8 caracteres.' });
    }
    if (req.file && !['image/jpeg', 'image/png', 'image/webp'].includes(req.file.mimetype)) {
        return res.status(400).json({ mensaje: 'La foto debe ser JPEG, PNG o WebP.' });
    }
    
    try {
        // 1. Buscar al usuario actual en la base de datos para validar credenciales e información previa
        const userQuery = await pool.query('SELECT * FROM usuarios WHERE id = $1', [req.usuarioId]);
        if (userQuery.rows.length === 0) return res.status(404).json({ mensaje: 'Usuario no encontrado.' });
        const usuarioDb = userQuery.rows[0];

        let passwordFinal = usuarioDb.password; // Mantiene la contraseña actual por defecto

        // 2. Si el usuario intenta cambiar su contraseña...
        if (passwordActual && passwordNueva) {
            const validPassword = await bcrypt.compare(passwordActual, usuarioDb.password);
            if (!validPassword) {
                return res.status(400).json({ mensaje: 'La contraseña actual introducida es incorrecta.' });
            }
            // Si la clave actual es correcta, hasheamos la nueva
            passwordFinal = await bcrypt.hash(passwordNueva, 10);
        }

        // 3. Preparar la imagen si fue subida
        let fotoFinal = usuarioDb.foto_perfil;
        let fotoMimeFinal = usuarioDb.foto_perfil_mime || 'image/jpeg';
        if (req.file) {
            fotoFinal = req.file.buffer;
            fotoMimeFinal = req.file.mimetype;
        }

        // 4. Ejecutar actualización unificada en PostgreSQL
        await pool.query(
            `UPDATE usuarios 
             SET nombre = $1, apellido = $2, telefono = $3, fecha_nacimiento = $4, password = $5, foto_perfil = $6,
                 foto_perfil_mime = $7, password_version = password_version + $8
             WHERE id = $9`,
            [nombre.trim(), apellido.trim(), telefono || null, fecha_nacimiento || usuarioDb.fecha_nacimiento, passwordFinal, fotoFinal, fotoMimeFinal, passwordNueva ? 1 : 0, req.usuarioId]
        );

        // 5. Obtener los nuevos datos actualizados para responderle al frontend
        const updated = await pool.query('SELECT * FROM usuarios WHERE id = $1', [req.usuarioId]);
        const user = updated.rows[0];
        
        let fotoBase64 = null;
        if (user.foto_perfil) {
            fotoBase64 = `data:${user.foto_perfil_mime || 'image/jpeg'};base64,${user.foto_perfil.toString('base64')}`;
        }

        return res.json({
            mensaje: 'Perfil actualizado correctamente.',
            ...(passwordNueva ? { token: jwt.sign({ id: user.id, v: user.password_version }, JWT_SECRET, { expiresIn: '7d' }) } : {}),
            usuario: { 
                nombre: user.nombre, 
                apellido: user.apellido, 
                email: user.email, 
                telefono: user.telefono, 
                fecha_nacimiento: user.fecha_nacimiento, // Agregado
                foto_url: fotoBase64,
                rol_global: user.es_superadmin ? 'superadministrador' : 'ciudadano',
                instituciones: await getUserAccess(pool, user.id)
            }
        });

    } catch (err) {
        console.error("Error al guardar perfil:", err);
        return res.status(500).json({ mensaje: 'Error al guardar la información en el perfil.' });
    }
});

mountInstitutionRoutes(app, pool, verificarToken);

// Nunca exponer las rutas hasta completar las migraciones.
// Una migración fallida detiene el proceso para no operar con tablas incompletas.
const PORT = process.env.PORT || 3000;
initializeDatabase(pool)
  .then(() => app.listen(PORT, () => console.log('GeoAlerta activo en puerto ' + PORT)))
  .catch(error => {
    console.error('No se pudo inicializar PostgreSQL:', error);
    process.exit(1);
  });
