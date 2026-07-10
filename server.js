const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Asegurar que las columnas nuevas existan en la tabla usuarios si no existían
const inicializarTabla = async () => {
    try {
        await pool.query(`
            ALTER TABLE usuarios 
            ADD COLUMN IF NOT EXISTS telefono VARCHAR(20),
            ADD COLUMN IF NOT EXISTS foto_url TEXT;
        `);
        console.log('Columnas de perfil verificadas con éxito. 🛠️');
    } catch (e) {
        console.log('Nota sobre columnas adicionales:', e.message);
    }
};
inicializarTabla();

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Middleware para verificar JWT y proteger la edición de perfil
const verificarToken = (req, res, next) => {
    const token = req.headers['authorization'];
    if (!token) return res.status(403).json({ mensaje: 'Token requerido.' });
    
    try {
        const decoded = jwt.verify(token.split(' ')[1], process.env.JWT_SECRET || 'SECRETO_TEMPORAL');
        req.usuarioId = decoded.id;
        next();
    } catch (err) {
        return res.status(401).json({ mensaje: 'Token inválido o expirado.' });
    }
};

// =========================================================================
// RUTA: REGISTRO
// =========================================================================
app.post('/api/auth/register', async (req, res) => {
    const { nombre, apellido, email, fecha_nacimiento, password } = req.body;
    try {
        const usuarioExiste = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
        if (usuarioExiste.rows.length > 0) {
            return res.status(400).json({ mensaje: 'El correo electrónico ya está registrado.' });
        }

        const salt = await bcrypt.genSalt(10);
        const passwordHasheada = await bcrypt.hash(password, salt);
        const codigoVerificacion = Math.floor(100000 + Math.random() * 900000).toString();

        await pool.query(
            `INSERT INTO usuarios (nombre, apellido, email, fecha_nacimiento, password, auth_provider, codigo_verificacion) 
             VALUES ($1, $2, $3, $4, $5, 'manual', $6)`,
            [nombre, apellido, email, fecha_nacimiento, passwordHasheada, codigoVerificacion]
        );

        try {
            // Envío con Brevo HTTP API
            await fetch('https://api.brevo.com/v3/smtp/email', {
                method: 'POST',
                headers: {
                    'accept': 'application/json',
                    'api-key': process.env.BREVO_API_KEY,
                    'content-type': 'application/json'
                },
                body: JSON.stringify({
                    sender: { name: 'GeoAlerta', email: 'jesusmedrandam@gmail.com' },
                    to: [{ email: email, name: nombre }],
                    subject: 'Código de Verificación - GeoAlerta',
                    htmlContent: `<p>Tu código es: <strong>${codigoVerificacion}</strong></p>`
                })
            });
            return res.status(201).json({ mensaje: 'Código enviado a tu correo.' });
        } catch (e) {
            return res.status(202).json({ mensaje: 'Usuario creado. Error de sincronización de correo.' });
        }
    } catch (error) {
        res.status(500).json({ mensaje: 'Error interno en el servidor.' });
    }
});

// =========================================================================
// RUTA: VERIFICACIÓN
// =========================================================================
app.post('/api/auth/verify', async (req, res) => {
    const { email, codigo } = req.body;
    try {
        const result = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
        if (result.rows.length === 0) return res.status(404).json({ mensaje: 'Usuario no encontrado.' });

        if (result.rows[0].codigo_verificacion === codigo) {
            await pool.query('UPDATE usuarios SET verificado = true, codigo_verificacion = NULL WHERE email = $1', [email]);
            return res.json({ mensaje: 'Cuenta verificada exitosamente.' });
        } else {
            return res.status(400).json({ mensaje: 'Código incorrecto.' });
        }
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al verificar.' });
    }
});

// =========================================================================
// RUTA: LOGIN (Modificada para devolver datos básicos del perfil)
// =========================================================================
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
        if (result.rows.length === 0) return res.status(400).json({ mensaje: 'Credenciales inválidas.' });

        const usuario = result.rows[0];
        if (!usuario.verificado) return res.status(401).json({ mensaje: 'Por favor, verifica tu correo primero.' });

        const passwordCorrecta = await bcrypt.compare(password, usuario.password);
        if (!passwordCorrecta) return res.status(400).json({ mensaje: 'Credenciales inválidas.' });

        const token = jwt.sign({ id: usuario.id }, process.env.JWT_SECRET || 'SECRETO_TEMPORAL', { expiresIn: '24h' });
        
        res.json({ 
            token, 
            mensaje: 'Ingreso exitoso.',
            usuario: {
                nombre: usuario.nombre,
                apellido: usuario.apellido,
                email: usuario.email,
                telefono: usuario.telefono || '',
                foto_url: usuario.foto_url || ''
            }
        });
    } catch (error) {
        res.status(500).json({ mensaje: 'Error en el servidor.' });
    }
});

// =========================================================================
// RUTA: RECUPERAR CONTRASEÑA (Olvidada)
// =========================================================================
app.post('/api/auth/forgot-password', async (req, res) => {
    const { email } = req.body;
    try {
        const result = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
        if (result.rows.length === 0) return res.status(404).json({ mensaje: 'El correo no está registrado.' });

        const codigoRecuperacion = Math.floor(100000 + Math.random() * 900000).toString();
        await pool.query('UPDATE usuarios SET codigo_verificacion = $1 WHERE email = $2', [codigoRecuperacion, email]);

        try {
            await fetch('https://api.brevo.com/v3/smtp/email', {
                method: 'POST',
                headers: {
                    'accept': 'application/json',
                    'api-key': process.env.BREVO_API_KEY,
                    'content-type': 'application/json'
                },
                body: JSON.stringify({
                    sender: { name: 'GeoAlerta', email: 'jesusmedrandam@gmail.com' },
                    to: [{ email }],
                    subject: 'Recuperación de Contraseña - GeoAlerta',
                    htmlContent: `<p>Has solicitado restablecer tu contraseña. Tu código temporal de acceso es: <strong>${codigoRecuperacion}</strong></p>`
                })
            });
            res.json({ mensaje: 'Se envió un código temporal de recuperación a tu correo.' });
        } catch (e) {
            res.status(500).json({ mensaje: 'Error al despachar el correo.' });
        }
    } catch (error) {
        res.status(500).json({ mensaje: 'Error interno en el servidor.' });
    }
});

// =========================================================================
// RUTA: ACTUALIZAR PERFIL (Protegida)
// =========================================================================
app.put('/api/usuario/perfil', verificarToken, async (req, res) => {
    const { nombre, apellido, telefono, foto_url } = req.body;
    try {
        await pool.query(
            'UPDATE usuarios SET nombre = $1, apellido = $2, telefono = $3, foto_url = $4 WHERE id = $5',
            [nombre, apellido, telefono, foto_url, req.usuarioId]
        );
        res.json({ mensaje: 'Perfil actualizado correctamente.' });
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al actualizar el perfil.' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor en puerto ${PORT}`));
