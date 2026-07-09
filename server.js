const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();

// Middlewares estándar
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Configuración de la conexión a PostgreSQL en Render
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Probar conexión con la Base de Datos
pool.connect((err, client, release) => {
    if (err) {
        return console.error('Error adquiriendo el cliente de la BD:', err.stack);
    }
    console.log('Conexión exitosa a PostgreSQL en Render 🚀');
    release();
});

// Configuración optimizada de Nodemailer
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', 
    port: 587,
    secure: false, 
    family: 4, // Intenta forzar IPv4 en entornos compatibles
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    },
    tls: {
        rejectUnauthorized: false,
        servername: 'smtp.gmail.com'
    },
    connectionTimeout: 10000, 
    socketTimeout: 10000
});

// RUTA PRINCIPAL: Carga tu index.html al entrar al link de Render
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// =========================================================================
// 1. RUTA: REGISTRO MANUAL DE USUARIOS Y ENVÍO DE CÓDIGO
// =========================================================================
app.post('/api/auth/register', async (req, res) => {
    const { nombre, apellido, email, fecha_nacimiento, password } = req.body;
    try {
        // Verificar si el correo ya existe
        const usuarioExiste = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
        if (usuarioExiste.rows.length > 0) {
            return res.status(400).json({ mensaje: 'El correo electrónico ya está registrado.' });
        }

        // Encriptar contraseña
        const salt = await bcrypt.genSalt(10);
        const passwordHasheada = await bcrypt.hash(password, salt);
        
        // Generar un código aleatorio de 6 dígitos
        const codigoVerificacion = Math.floor(100000 + Math.random() * 900000).toString();

        // Insertar en la Base de Datos
        await pool.query(
            `INSERT INTO usuarios (nombre, apellido, email, fecha_nacimiento, password, auth_provider, codigo_verificacion) 
             VALUES ($1, $2, $3, $4, $5, 'manual', $6)`,
            [nombre, apellido, email, fecha_nacimiento, passwordHasheada, codigoVerificacion]
        );

        // Opciones del correo electrónico
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'Código de Verificación - GeoAlerta',
            text: `Hola ${nombre}, tu código de verificación para GeoAlerta es: ${codigoVerificacion}`
        };

        // Bloque aislado para enviar el correo sin romper la respuesta del servidor
        try {
            await transporter.sendMail(mailOptions);
            console.log(`✅ Correo enviado con éxito a ${email}`);
            return res.status(201).json({ mensaje: 'Usuario registrado. Código enviado al correo.' });
        } catch (mailError) {
            console.error('❌ Error de Nodemailer (Fallo de red/puerto en Render):', mailError.message);
            // Devolvemos un código 202 para que el frontend abra el modal de igual forma
            return res.status(202).json({ 
                mensaje: 'Usuario creado. Nota: No se pudo despachar el correo (Restricción de red en Render). Usa el código de pgAdmin para verificar.' 
            });
        }

    } catch (error) {
        console.error('Error general en registro:', error);
        res.status(500).json({ mensaje: 'Error interno en el servidor al procesar el registro.' });
    }
});

// =========================================================================
// 2. RUTA: VERIFICAR EL CÓDIGO INTRODUCIDO POR EL USUARIO
// =========================================================================
app.post('/api/auth/verify', async (req, res) => {
    const { email, codigo } = req.body;
    try {
        const result = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
        if (result.rows.length === 0) {
            return res.status(404).json({ mensaje: 'Usuario no encontrado.' });
        }

        const usuario = result.rows[0];
        
        // Validar si el código coincide
        if (usuario.codigo_verificacion === codigo) {
            // Actualizar estado a verificado y limpiar el código usado
            await pool.query('UPDATE usuarios SET verificado = true, codigo_verificacion = NULL WHERE email = $1', [email]);
            return res.json({ mensaje: 'Cuenta verificada exitosamente. Ya puedes iniciar sesión.' });
        } else {
            return res.status(400).json({ mensaje: 'El código introducido es incorrecto.' });
        }
    } catch (error) {
        console.error('Error en verification:', error);
        res.status(500).json({ mensaje: 'Error interno al procesar la verificación.' });
    }
});

// =========================================================================
// 3. RUTA: INICIAR SESIÓN (LOGIN)
// =========================================================================
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
        if (result.rows.length === 0) {
            return res.status(400).json({ mensaje: 'Credenciales inválidas.' });
        }

        const usuario = result.rows[0];
        
        // Validar si la cuenta ya pasó por la verificación por código
        if (!usuario.verificado) {
            return res.status(401).json({ mensaje: 'Por favor, verifica tu correo usando el código enviado antes de ingresar.' });
        }

        // Comparar contraseña encriptada
        const passwordCorrecta = await bcrypt.compare(password, usuario.password);
        if (!passwordCorrecta) {
            return res.status(400).json({ mensaje: 'Credenciales inválidas.' });
        }

        // Generar sesión JWT firmada por 24 horas
        const token = jwt.sign({ id: usuario.id }, process.env.JWT_SECRET, { expiresIn: '24h' });
        res.json({ token, mensaje: 'Ingreso exitoso al sistema.' });

    } catch (error) {
        console.error('Error en el login:', error);
        res.status(500).json({ mensaje: 'Error interno en el servidor al intentar loguear.' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor corriendo con éxito en el puerto ${PORT}`);
});
