const API_URL = window.location.origin;
let usuarioActual = null;
let emailEnVerificacion = '';

document.addEventListener("DOMContentLoaded", () => {
    // === VALIDACIÓN DE SESIÓN AUTOMÁTICA AL CARGAR ===
    verificarSesionActiva();

    // Controladores de Pestañas
    document.getElementById('tabLoginBtn').addEventListener('click', () => switchTab('login'));
    document.getElementById('tabRegisterBtn').addEventListener('click', () => switchTab('register'));
    document.getElementById('goToForgotLink').addEventListener('click', () => switchTab('forgot'));
    
    // Asignar el comportamiento a TODOS los botones de "Volver al Login"
    document.querySelectorAll('.go-back-login').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            switchTab('login');
        });
    });

    // Controladores de Formularios
    document.getElementById('loginForm').addEventListener('submit', handleLogin);
    document.getElementById('forgotForm').addEventListener('submit', handleForgot);
    document.getElementById('resetPasswordForm').addEventListener('submit', handleResetReal);
    document.getElementById('registerForm').addEventListener('submit', handleRegister);
    document.getElementById('verifyForm').addEventListener('submit', handleVerify);

    // Controladores para Reenviar Códigos (Tanto para Verificación como para Reset)
    document.getElementById('btnResendCode').addEventListener('click', handleResendCode);
    document.getElementById('btnResendResetCode').addEventListener('click', handleResendResetCode);

    // Guardar cambios y perfil
    document.getElementById('btnSaveProfile').addEventListener('click', (e) => {
        e.preventDefault();
        saveProfile();
    });
    document.getElementById('btnLogout').addEventListener('click', logout);
    
    document.getElementById('userMenuBtn').addEventListener('click', toggleProfileDropdown);
    document.getElementById('profileDropdown').addEventListener('click', (e) => e.stopPropagation());

    document.getElementById('profFotoFile').addEventListener('change', function() {
        const label = document.getElementById('fileNameLabel');
        label.innerText = this.files[0] ? this.files[0].name : "Seleccionar foto de tu equipo";
    });

    document.querySelectorAll('.toggle-password').forEach(button => {
        button.addEventListener('click', function() {
            const targetId = this.getAttribute('data-target');
            const input = document.getElementById(targetId);
            const icon = this.querySelector('i');
            input.type = input.type === 'password' ? 'text' : 'password';
            icon.className = input.type === 'password' ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash';
        });
    });
});

async function verificarSesionActiva() {
    const token = localStorage.getItem('token');
    if (!token) return; 

    try {
        const response = await fetch(`${API_URL}/api/auth/me`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();

        if (response.ok) {
            usuarioActual = data.usuario;
            cargarDashboard();
        } else {
            localStorage.removeItem('token');
        }
    } catch (err) {
        console.error('Error al verificar sesión automática:', err);
    }
}

function showNotification(message, type = 'error') {
    const alertDiv = document.getElementById('globalAlert');
    alertDiv.className = `custom-alert alert-${type}`;
    alertDiv.innerHTML = `<i class="fa-solid ${type === 'error' ? 'fa-circle-xmark' : 'fa-circle-check'}"></i> ${message}`;
    alertDiv.classList.remove('hidden');
}

function clearNotification() {
    document.getElementById('globalAlert').classList.add('hidden');
}

function switchTab(type) {
    clearNotification();
    
    document.getElementById('loginForm').classList.add('hidden');
    document.getElementById('registerForm').classList.add('hidden');
    document.getElementById('verifyForm').classList.add('hidden');
    document.getElementById('forgotForm').classList.add('hidden');
    document.getElementById('resetPasswordForm').classList.add('hidden');
    
    document.getElementById('authTabs').classList.remove('hidden');
    document.getElementById('oauthContainer').classList.remove('hidden');
    document.getElementById('dividerText').classList.remove('hidden');

    const tabs = document.querySelectorAll('.tab-btn');
    tabs.forEach(t => t.classList.remove('active'));

    if (type === 'login') {
        document.getElementById('tabLoginBtn').classList.add('active');
        document.getElementById('loginForm').classList.remove('hidden');
    } else if (type === 'register') {
        document.getElementById('tabRegisterBtn').classList.add('active');
        document.getElementById('registerForm').classList.remove('hidden');
    } else if (type === 'forgot') {
        document.getElementById('authTabs').classList.add('hidden');
        document.getElementById('oauthContainer').classList.add('hidden');
        document.getElementById('dividerText').classList.add('hidden');
        document.getElementById('forgotForm').classList.remove('hidden');
    } else if (type === 'reset') {
        document.getElementById('authTabs').classList.add('hidden');
        document.getElementById('oauthContainer').classList.add('hidden');
        document.getElementById('dividerText').classList.add('hidden');
        document.getElementById('resetPasswordForm').classList.remove('hidden');
    } else if (type === 'verify') {
        document.getElementById('authTabs').classList.add('hidden');
        document.getElementById('oauthContainer').classList.add('hidden');
        document.getElementById('dividerText').classList.add('hidden');
        document.getElementById('verifyForm').classList.remove('hidden');
    }
}

async function handleLogin(e) {
    e.preventDefault();
    clearNotification();
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;

    try {
        const response = await fetch(`${API_URL}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const data = await response.json();

        if (response.ok) {
            localStorage.setItem('token', data.token);
            usuarioActual = data.usuario;
            cargarDashboard();
        } else {
            // CORRECCIÓN: Si el mensaje contiene "verificado", asumimos que existe pero requiere activarse
            if (data.mensaje && data.mensaje.toLowerCase().includes('verificado')) {
                emailEnVerificacion = email; 
                switchTab('verify');
                showNotification('Tu cuenta existe pero no está verificada. Por favor, introduce el código de activación.', 'error');
            } else {
                showNotification(data.mensaje || 'Credenciales incorrectas.', 'error');
            }
        }
    } catch (err) {
        showNotification('El servidor no responde.', 'error');
    }
}

// Reenvío de código para activar cuenta por primera vez
async function handleResendCode() {
    clearNotification();
    if (!emailEnVerificacion) {
        showNotification('Escribe tu correo primero intentando iniciar sesión.', 'error');
        return;
    }
    try {
        // Usamos la ruta correspondiente del backend para disparar un código nuevo
        const res = await fetch(`${API_URL}/api/auth/forgot-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: emailEnVerificacion })
        });
        const data = await res.json();
        if (res.ok) {
            showNotification('¡Código de activación reenviado a tu correo electrónico!', 'success');
        } else {
            showNotification(data.mensaje || 'No se pudo reenviar.', 'error');
        }
    } catch (err) {
        showNotification('Error al conectar con el servidor.', 'error');
    }
}

// Reenvío de código para el formulario de Restablecer contraseña
async function handleResendResetCode() {
    clearNotification();
    if (!emailEnVerificacion) {
        showNotification('No se ha detectado un correo de restablecimiento.', 'error');
        return;
    }
    try {
        const res = await fetch(`${API_URL}/api/auth/forgot-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: emailEnVerificacion })
        });
        if (res.ok) {
            showNotification('¡Código de restablecimiento reenviado con éxito!', 'success');
        } else {
            showNotification('No se pudo reenviar el código.', 'error');
        }
    } catch (err) {
        showNotification('Error en el servidor.', 'error');
    }
}

function cargarDashboard() {
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('dashboardScreen').classList.remove('hidden');
    
    document.getElementById('dashWelcomeName').innerText = usuarioActual.nombre;
    document.getElementById('navUserName').innerText = `${usuarioActual.nombre} ${usuarioActual.apellido}`;
    
    if (usuarioActual.foto_url) {
        document.getElementById('navAvatar').src = usuarioActual.foto_url;
    } else {
        document.getElementById('navAvatar').src = `https://ui-avatars.com/api/?name=${usuarioActual.nombre}+${usuarioActual.apellido}&background=ef4444&color=fff`;
    }

    document.getElementById('profNombre').value = usuarioActual.nombre;
    document.getElementById('profApellido').value = usuarioActual.apellido;
    document.getElementById('profTelefono').value = usuarioActual.telefono || '';
}

async function saveProfile() {
    const token = localStorage.getItem('token');
    const nombre = document.getElementById('profNombre').value;
    const apellido = document.getElementById('profApellido').value;
    const telefono = document.getElementById('profTelefono').value;
    const fileInput = document.getElementById('profFotoFile');

    const formData = new FormData();
    formData.append('nombre', nombre);
    formData.append('apellido', apellido);
    formData.append('telefono', telefono);
    if (fileInput.files[0]) {
        formData.append('foto_perfil', fileInput.files[0]);
    }

    try {
        const res = await fetch(`${API_URL}/api/usuario/perfil`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData
        });
        const data = await res.json();
        if (res.ok) {
            usuarioActual = data.usuario;
            cargarDashboard();
            document.getElementById('profileDropdown').classList.add('hidden');
            alert('¡Perfil actualizado con éxito!');
        } else {
            alert(data.mensaje || 'Error al actualizar.');
        }
    } catch (e) {
        alert('Error de conexión al guardar el perfil.');
    }
}

async function handleForgot(e) {
    e.preventDefault();
    clearNotification();
    const email = document.getElementById('forgotEmail').value;
    try {
        const res = await fetch(`${API_URL}/api/auth/forgot-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        const data = await res.json();
        if (res.ok) {
            emailEnVerificacion = email;
            switchTab('reset');
            showNotification(data.mensaje, 'success');
        } else {
            showNotification(data.mensaje || 'El correo no existe.', 'error');
        }
    } catch (err) { 
        showNotification('Error al contactar con el servidor.', 'error'); 
    }
}

async function handleResetReal(e) {
    e.preventDefault();
    clearNotification();
    const codigo = document.getElementById('resetCode').value;
    const nuevaPassword = document.getElementById('resetNewPassword').value;

    try {
        const res = await fetch(`${API_URL}/api/auth/reset-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: emailEnVerificacion, codigo, nuevaPassword })
        });
        const data = await res.json();

        if (res.ok) {
            switchTab('login');
            showNotification(data.mensaje, 'success');
        } else {
            showNotification(data.mensaje || 'Código incorrecto.', 'error');
        }
    } catch (err) {
        showNotification('Error al cambiar la contraseña.', 'error');
    }
}

async function handleRegister(e) {
    e.preventDefault();
    clearNotification();
    const nombre = document.getElementById('regNombre').value;
    const apellido = document.getElementById('regApellido').value;
    const email = document.getElementById('regEmail').value;
    const fecha_nacimiento = document.getElementById('regFecha').value;
    const password = document.getElementById('regPassword').value;

    try {
        const res = await fetch(`${API_URL}/api/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nombre, apellido, email, fecha_nacimiento, password })
        });
        const data = await res.json();

        if (res.ok) {
            emailEnVerificacion = email;
            switchTab('verify'); 
            showNotification(data.mensaje, 'success');
        } else {
            showNotification(data.mensaje || 'Error al crear cuenta.', 'error');
        }
    } catch (err) { 
        showNotification('Error de conexión en el servidor.', 'error'); 
    }
}

async function handleVerify(e) {
    e.preventDefault();
    clearNotification();
    const codigo = document.getElementById('verifyCode').value;
    try {
        const res = await fetch(`${API_URL}/api/auth/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: emailEnVerificacion, codigo })
        });
        const data = await res.json();
        if (res.ok) {
            switchTab('login');
            showNotification(data.mensaje, 'success');
        } else {
            showNotification(data.mensaje || 'Código inválido.', 'error');
        }
    } catch (err) { 
        showNotification('Error al verificar.', 'error'); 
    }
}

function toggleProfileDropdown(event) {
    event.stopPropagation();
    document.getElementById('profileDropdown').classList.toggle('hidden');
}

document.addEventListener('click', () => {
    const dropdown = document.getElementById('profileDropdown');
    if (dropdown) dropdown.classList.add('hidden');
});

function logout() {
    localStorage.removeItem('token');
    document.getElementById('dashboardScreen').classList.add('hidden');
    document.getElementById('loginScreen').classList.remove('hidden');
    switchTab('login');
}
