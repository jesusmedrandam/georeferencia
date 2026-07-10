const API_URL = window.location.origin;
let usuarioActual = null;
let emailEnVerificacion = '';

// Al cargar el documento de manera segura
document.addEventListener("DOMContentLoaded", () => {
    
    // Controladores de Pestañas y Enlaces
    document.getElementById('tabLoginBtn').addEventListener('click', () => switchTab('login'));
    document.getElementById('tabRegisterBtn').addEventListener('click', () => switchTab('register'));
    document.getElementById('goToForgotLink').addEventListener('click', () => switchTab('forgot'));
    
    document.querySelectorAll('.go-back-login').forEach(btn => {
        btn.addEventListener('click', () => switchTab('login'));
    });

    // Controladores de Envío de Formularios (REPARADOS)
    document.getElementById('loginForm').addEventListener('submit', handleLogin);
    document.getElementById('forgotForm').addEventListener('submit', handleForgot);
    document.getElementById('resetPasswordForm').addEventListener('submit', handleResetReal);
    document.getElementById('registerForm').addEventListener('submit', handleRegister);
    document.getElementById('verifyForm').addEventListener('submit', handleVerify);

    // Botones del Dashboard
    document.getElementById('btnSaveProfile').addEventListener('click', saveProfile);
    document.getElementById('btnLogout').addEventListener('click', logout);
    
    // Listener para el menú desplegable del perfil
    document.getElementById('userMenuBtn').addEventListener('click', toggleProfileDropdown);
    document.getElementById('profileDropdown').addEventListener('click', (e) => e.stopPropagation());

    // Listener para el input de tipo archivo
    document.getElementById('profFotoFile').addEventListener('change', function() {
        const label = document.getElementById('fileNameLabel');
        if (this.files && this.files[0]) {
            label.innerText = this.files[0].name;
        } else {
            label.innerText = "Seleccionar foto de tu equipo";
        }
    });

    // Ocultar contraseñas dinámico
    document.querySelectorAll('.toggle-password').forEach(button => {
        button.addEventListener('click', function() {
            const targetId = this.getAttribute('data-target');
            const input = document.getElementById(targetId);
            const icon = this.querySelector('i');
            if (input.type === 'password') {
                input.type = 'text';
                icon.className = 'fa-solid fa-eye-slash';
            } else {
                input.type = 'password';
                icon.className = 'fa-solid fa-eye';
            }
        });
    });
});

// Mensajes y Alertas
function showNotification(message, type = 'error') {
    const alertDiv = document.getElementById('globalAlert');
    alertDiv.className = `custom-alert alert-${type}`;
    alertDiv.innerHTML = type === 'error' ? `<i class="fa-solid fa-circle-xmark"></i> ${message}` : `<i class="fa-solid fa-circle-check"></i> ${message}`;
    alertDiv.classList.remove('hidden');
}

function clearNotification() {
    document.getElementById('globalAlert').classList.add('hidden');
}

function clearAllInputs() {
    const inputs = document.querySelectorAll('input:not([type="button"]):not([type="submit"])');
    inputs.forEach(input => {
        if(input.id !== 'profNombre' && input.id !== 'profApellido' && input.id !== 'profTelefono') {
            input.value = '';
        }
    });
    document.getElementById('fileNameLabel').innerText = "Seleccionar foto de tu equipo";
    document.getElementById('profFotoFile').value = '';
}

function switchTab(type) {
    clearNotification();
    clearAllInputs();
    
    const tabs = document.querySelectorAll('.tab-btn');
    tabs.forEach(t => t.classList.remove('active'));
    
    document.getElementById('loginForm').classList.add('hidden');
    document.getElementById('registerForm').classList.add('hidden');
    document.getElementById('verifyForm').classList.add('hidden');
    document.getElementById('forgotForm').classList.add('hidden');
    document.getElementById('resetPasswordForm').classList.add('hidden');
    document.getElementById('authTabs').classList.remove('hidden');
    document.getElementById('oauthContainer').classList.remove('hidden');
    document.getElementById('dividerText').classList.remove('hidden');

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
    }
}

function toggleProfileDropdown(event) {
    event.stopPropagation();
    document.getElementById('profileDropdown').classList.toggle('hidden');
}

document.addEventListener('click', () => {
    const dropdown = document.getElementById('profileDropdown');
    if(dropdown) dropdown.classList.add('hidden');
});

// FUNCIONES HTTP (CONEXIONES AL BACKEND)

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
            clearAllInputs();
            cargarDashboard();
        } else {
            showNotification(data.mensaje, 'error');
        }
    } catch (err) {
        showNotification('Los datos son incorrectos o el servidor no responde.', 'error');
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
            alert('Perfil guardado con éxito.');
        }
    } catch (e) {
        console.error("Error al guardar perfil:", e);
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
            showNotification(data.mensaje, 'error');
        }
    } catch (err) { showNotification('Error al procesar la solicitud.', 'error'); }
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
            showNotification(data.mensaje, 'error');
        }
    } catch (err) {
        showNotification('No se pudo actualizar la contraseña.', 'error');
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

        if (res.status === 201 || res.status === 202) {
            emailEnVerificacion = email;
            document.getElementById('registerForm').classList.add('hidden');
            document.getElementById('authTabs').classList.add('hidden');
            document.getElementById('oauthContainer').classList.add('hidden');
            document.getElementById('dividerText').classList.add('hidden');
            document.getElementById('verifyForm').classList.remove('hidden');
            showNotification('Usuario registrado. Ingresa tu código.', 'success');
        } else {
            showNotification(data.mensaje, 'error');
        }
    } catch (err) { showNotification('Error de red.', 'error'); }
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
            showNotification(data.mensaje, 'error');
        }
    } catch (err) { showNotification('Error.', 'error'); }
}

function logout() {
    localStorage.removeItem('token');
    document.getElementById('dashboardScreen').classList.add('hidden');
    document.getElementById('loginScreen').classList.remove('hidden');
    switchTab('login');
}
