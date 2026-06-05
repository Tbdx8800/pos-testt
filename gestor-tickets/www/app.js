import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, onSnapshot, doc, setDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyAziX2ZYthQ6jMN9t5KoEk1qb88ZT29OMU",
    authDomain: "realphone-tickets.firebaseapp.com",
    projectId: "realphone-tickets",
    storageBucket: "realphone-tickets.firebasestorage.app",
    messagingSenderId: "461224250452",
    appId: "1:461224250452:web:9d2ed52a0e880c3e45f1c1"
};

const app = initializeApp(firebaseConfig);
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({tabManager: persistentMultipleTabManager()})
});

const STORAGE_STORE = 'realphone_current_store';

// ==================== STORE ADDRESSES ====================
const STORE_ADDRESSES = {
    "Matriz": "Lázaro Cárdenas 179 Col. Centro",
    "Sunny": "53 Príncipe Tacámba Col. Centro",
    "Hospital": "99 Álvaro Obregón Col. Centro",
    "David": "Av. Madero Oriente Col. Centro",
    "Portal": "34 Portal Nicolás de Regulés Col. Centro",
    "Coppel": "486 Lic. Isidro Favela Col. Los Pinos"
};

// ==================== CLOUD / DB ABSTRACTION ====================
const DB = {
    getStore: () => localStorage.getItem(STORAGE_STORE) || '',
    setStore: (store) => localStorage.setItem(STORAGE_STORE, store),
    removeStore: () => localStorage.removeItem(STORAGE_STORE),
    clearTickets: async () => {
        // Para borrar todo, en Firestore tendríamos que iterar cada documento
        // Por seguridad, esto ahora solo borra la tienda local.
        alert("La función de borrar base de datos completa se deshabilitó temporalmente por seguridad en la nube.");
    }
};

let users = [];
let facturas = [];
let reparaciones = [];
let apartados = [];
let encargos = [];
let currentStore = DB.getStore();
let currentUser1 = null;
let currentUser2 = null;

// ==================== FIREBASE REAL-TIME LISTENERS ====================
let dataLoaded = { users: false, facturas: false, reparaciones: false, apartados: false, encargos: false };

function checkAllDataLoaded() {
    if (dataLoaded.users && dataLoaded.facturas && dataLoaded.reparaciones && dataLoaded.apartados && dataLoaded.encargos) {
        initApp();
    }
}

onSnapshot(collection(db, "users"), (snapshot) => {
    users = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    // Si no hay usuarios en la nube, creamos los por defecto
    if (users.length === 0) {
        const defaultUsers = [
            { id: '0', username: 'USUARIO', password: 'KJFHSKLJKFDKSLSLFKJSDLKFJSDFLKKSDJFJBANKBBSDFK', role: 'admin' },
        ];
        defaultUsers.forEach(u => setDoc(doc(db, "users", u.id), u));
    }

    // Si hay alguien logueado, actualizar su data (por si le cambiaron la clave)
    if (currentUser1) {
        const updated1 = users.find(u => u.id === currentUser1.id);
        if (updated1) currentUser1 = updated1;
    }
    if (currentUser2) {
        const updated2 = users.find(u => u.id === currentUser2.id);
        if (updated2) currentUser2 = updated2;
    }

    if (currentUser1) applyRolesAndUI(); // Refrescar UI si ya estaban logueados

    if (!dataLoaded.users) { dataLoaded.users = true; checkAllDataLoaded(); }
});

onSnapshot(collection(db, "facturas"), (snapshot) => {
    facturas = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    // Ordenar de más reciente a más antiguo por timestamp
    facturas.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    if (currentUser1) {
        updateStatsFacturas();
        renderFacturas();
    }

    if (!dataLoaded.facturas) { dataLoaded.facturas = true; checkAllDataLoaded(); }
});

onSnapshot(collection(db, "reparaciones"), (snapshot) => {
    reparaciones = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    reparaciones.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    if (currentUser1) {
        updateStatsReparaciones();
        renderReparaciones();
    }

    if (!dataLoaded.reparaciones) { dataLoaded.reparaciones = true; checkAllDataLoaded(); }
});

onSnapshot(collection(db, "apartados"), (snapshot) => {
    apartados = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    apartados.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    if (currentUser1) { updateStatsApartado(); renderApartados(); }
    if (!dataLoaded.apartados) { dataLoaded.apartados = true; checkAllDataLoaded(); }
});

onSnapshot(collection(db, "encargos"), (snapshot) => {
    encargos = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    encargos.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    if (currentUser1) { updateStatsEncargos(); renderEncargos(); }
    if (!dataLoaded.encargos) { dataLoaded.encargos = true; checkAllDataLoaded(); }
});

// ==================== DOM ELEMENTS ====================
// Modals & Auth
const setupModal = document.getElementById('setupModal');
const setupStoreSelect = document.getElementById('setupStoreSelect');
const btnSaveSetup = document.getElementById('btnSaveSetup');

const loginScreen = document.getElementById('loginScreen');
const loginForm = document.getElementById('loginForm');
const loginError = document.getElementById('loginError');

const activeUsersBar = document.getElementById('activeUsersBar');
const activeUsersContainer = document.getElementById('activeUsersContainer');
const btnAddCoworker = document.getElementById('btnAddCoworker');
const btnLogout = document.getElementById('btnLogout');

const addCoworkerModal = document.getElementById('addCoworkerModal');
const addCoworkerForm = document.getElementById('addCoworkerForm');
const coworkerError = document.getElementById('coworkerError');
const btnCancelCoworker = document.getElementById('btnCancelCoworker');

// Generales
const headerStoreName = document.getElementById('headerStoreName');
const tabAdminBtn = document.getElementById('tabAdminBtn');
const tabBtns = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

// Change Password
const btnChangePassword = document.getElementById('btnChangePassword');
const changePasswordModal = document.getElementById('changePasswordModal');
const changePasswordForm = document.getElementById('changePasswordForm');
const passwordChangeError = document.getElementById('passwordChangeError');
const btnCancelChangePassword = document.getElementById('btnCancelChangePassword');

// Forms & Inputs
const atendioFactura = document.getElementById('atendioFactura');
const atendioReparacion = document.getElementById('atendioReparacion');
const atendioApartado = document.getElementById('atendioApartado');
const atendioEncargo = document.getElementById('atendioEncargo');
const tiendaFactura = document.getElementById('tiendaFactura');
const tiendaReparacion = document.getElementById('tiendaReparacion');
const tiendaApartado = document.getElementById('tiendaApartado');
const tiendaEncargo = document.getElementById('tiendaEncargo');

// Facturas Elements
const countPendingFacturas = document.getElementById('countPendingFacturas');
const countDoneFacturas = document.getElementById('countDoneFacturas');
const countCancelledFacturas = document.getElementById('countCancelledFacturas');
const formFactura = document.getElementById('ticketFormFactura');
const containerFacturas = document.getElementById('ticketsContainerFacturas');
const btnDeleteOldFacturas = document.getElementById('btnDeleteOldFacturas');

// Reparaciones Elements
const countPendingReparaciones = document.getElementById('countPendingReparaciones');
const countDoneReparaciones = document.getElementById('countDoneReparaciones');
const countCancelledReparaciones = document.getElementById('countCancelledReparaciones');
const formReparacion = document.getElementById('ticketFormReparacion');
const containerReparaciones = document.getElementById('ticketsContainerReparaciones');
const filterReparaciones = document.getElementById('filterStatusReparaciones');
const btnClearReparaciones = document.getElementById('btnClearCompletedReparaciones');
const searchByFacturas = document.getElementById('searchByFacturas');
const searchInputFacturas = document.getElementById('searchInputFacturas');
const searchByReparaciones = document.getElementById('searchByReparaciones');
const searchInputReparaciones = document.getElementById('searchInputReparaciones');
const searchStoreFacturas = document.getElementById('searchStoreFacturas');
const searchStoreReparaciones = document.getElementById('searchStoreReparaciones');

// Apartado Elements
const containerApartado = document.getElementById('ticketsContainerApartado');
const formApartado = document.getElementById('ticketFormApartado');
const filterApartado = document.getElementById('filterStatusApartado');
const btnClearApartado = document.getElementById('btnClearCompletedApartado');
const searchInputApartado = document.getElementById('searchInputApartado');
const searchStoreApartado = document.getElementById('searchStoreApartado');

// Encargos Elements
const containerEncargos = document.getElementById('ticketsContainerEncargos');
const formEncargo = document.getElementById('ticketFormEncargo');
const filterEncargos = document.getElementById('filterStatusEncargos');
const btnClearEncargos = document.getElementById('btnClearCompletedEncargos');
const searchInputEncargos = document.getElementById('searchInputEncargos');
const searchStoreEncargos = document.getElementById('searchStoreEncargos');

// Confirm Ticket Modal
const confirmTicketModal = document.getElementById('confirmTicketModal');
const confirmTicketBody = document.getElementById('confirmTicketBody');
const btnCancelConfirmTicket = document.getElementById('btnCancelConfirmTicket');
const btnAcceptConfirmTicket = document.getElementById('btnAcceptConfirmTicket');

// Payment Confirm Modal
const paymentConfirmModal = document.getElementById('paymentConfirmModal');
const paymentConfirmBody = document.getElementById('paymentConfirmBody');
const btnCancelPaymentConfirm = document.getElementById('btnCancelPaymentConfirm');
const btnAcceptPaymentConfirm = document.getElementById('btnAcceptPaymentConfirm');

// Phone toggle for Reparaciones
const clientPhoneReparacionInput = document.getElementById('clientPhoneReparacion');
const noPhoneReparacionCheckbox = document.getElementById('noPhoneReparacion');
if (noPhoneReparacionCheckbox) {
    noPhoneReparacionCheckbox.addEventListener('change', function() {
        if (this.checked) {
            clientPhoneReparacionInput.value = '';
            clientPhoneReparacionInput.disabled = true;
            clientPhoneReparacionInput.placeholder = 'Sin número';
        } else {
            clientPhoneReparacionInput.disabled = false;
            clientPhoneReparacionInput.placeholder = 'Ej: 555 123 4567';
        }
    });
}

// Admin Elements
const usersContainer = document.getElementById('usersContainer');
const btnResetStore = document.getElementById('btnResetStore');
const btnResetDB = document.getElementById('btnResetDB');
const adminCurrentStore = document.getElementById('adminCurrentStore');


// ==================== INITIALIZATION ====================
function initApp() {
    if (!currentStore) {
        setupModal.classList.remove('hidden');
    } else {
        loginScreen.classList.remove('hidden');
    }
}

btnSaveSetup.addEventListener('click', () => {
    if (setupStoreSelect.value) {
        currentStore = setupStoreSelect.value;
        DB.setStore(currentStore);
        setupModal.classList.add('hidden');
        loginScreen.classList.remove('hidden');
    } else {
        alert("Selecciona una tienda primero.");
    }
});

// ==================== AUTH / LOGIN ====================
function findUser(username, password) {
    return users.find(u => u.username.toLowerCase() === username.toLowerCase() && u.password === password);
}

loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const u = document.getElementById('loginUsername').value;
    const p = document.getElementById('loginPassword').value;

    const user = findUser(u, p);
    if (user) {
        currentUser1 = user;
        loginScreen.classList.add('hidden');
        loginError.style.display = 'none';
        loginForm.reset();

        applyRolesAndUI();
    } else {
        loginError.style.display = 'block';
    }
});

btnLogout.addEventListener('click', () => {
    currentUser1 = null;
    currentUser2 = null;
    loginScreen.classList.remove('hidden');
    activeUsersBar.style.display = 'none';
});

btnAddCoworker.addEventListener('click', () => {
    addCoworkerModal.classList.remove('hidden');
});
btnCancelCoworker.addEventListener('click', () => {
    addCoworkerModal.classList.add('hidden');
    addCoworkerForm.reset();
});

addCoworkerForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const u = document.getElementById('coworkerUsername').value;
    const p = document.getElementById('coworkerPassword').value;

    const user = findUser(u, p);
    if (user) {
        // No permitir que el mismo inicie dos veces
        if (user.id === currentUser1.id) {
            coworkerError.textContent = "Este usuario ya inició sesión.";
            coworkerError.style.display = 'block';
            return;
        }

        currentUser2 = user;
        addCoworkerModal.classList.add('hidden');
        coworkerError.style.display = 'none';
        addCoworkerForm.reset();

        applyRolesAndUI();
    } else {
        coworkerError.textContent = "Credenciales incorrectas.";
        coworkerError.style.display = 'block';
    }
});

// ==================== CHANGE PASSWORD ====================
btnChangePassword.addEventListener('click', () => {
    changePasswordModal.classList.remove('hidden');
});

btnCancelChangePassword.addEventListener('click', () => {
    changePasswordModal.classList.add('hidden');
    changePasswordForm.reset();
    passwordChangeError.style.display = 'none';
});

changePasswordForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const currentPass = document.getElementById('currentPassword').value;
    const newPass = document.getElementById('newPassword').value;

    if (currentUser1.password === currentPass) {
        currentUser1.password = newPass;
        setDoc(doc(db, "users", currentUser1.id), currentUser1);

        changePasswordModal.classList.add('hidden');
        changePasswordForm.reset();
        passwordChangeError.style.display = 'none';
        alert('Contraseña actualizada correctamente.');
    } else {
        passwordChangeError.textContent = 'La contraseña actual es incorrecta.';
        passwordChangeError.style.display = 'block';
    }
});

// ==================== ROLES & UI SETUP ====================
function isAdmin() {
    return (currentUser1 && (currentUser1.role === 'admin' || currentUser1.role === 'tester')) || (currentUser2 && (currentUser2.role === 'admin' || currentUser2.role === 'tester'));
}

function isTester() {
    return (currentUser1 && currentUser1.role === 'tester') || (currentUser2 && currentUser2.role === 'tester');
}

function applyRolesAndUI() {
    headerStoreName.textContent = `- ${currentStore}`;
    adminCurrentStore.textContent = currentStore;

    // Active Users Bar UI
    activeUsersBar.style.display = 'flex';
    activeUsersContainer.innerHTML = '';

    const chip1 = document.createElement('div');
    chip1.className = 'user-chip';
    chip1.innerHTML = `<i class="fa-solid fa-user"></i> ${currentUser1.username} ${currentUser1.role === 'admin' ? '<span class="admin-badge">Admin</span>' : ''}`;
    activeUsersContainer.appendChild(chip1);

    if (currentUser2) {
        const chip2 = document.createElement('div');
        chip2.className = 'user-chip';
        // Botón para cerrar sesión de coworker
        chip2.innerHTML = `<i class="fa-solid fa-user"></i> ${currentUser2.username} ${currentUser2.role === 'admin' ? '<span class="admin-badge">Admin</span>' : ''}
                           <i class="fa-solid fa-xmark" style="cursor:pointer; margin-left:0.5rem; color:#ef4444;" id="btnRemoveCoworker"></i>`;
        activeUsersContainer.appendChild(chip2);
        btnAddCoworker.style.display = 'none'; // Max 2

        document.getElementById('btnRemoveCoworker').addEventListener('click', () => {
            currentUser2 = null;
            applyRolesAndUI();
        });
    } else {
        btnAddCoworker.style.display = 'inline-flex';
    }

    // Atendio Selects Configuration
    let atendioOptions = `<option value="">Seleccione personal</option>`;
    atendioOptions += `<option value="${currentUser1.username}">${currentUser1.username}</option>`;
    if (currentUser2) {
        atendioOptions += `<option value="${currentUser2.username}">${currentUser2.username}</option>`;
    }
    atendioFactura.innerHTML = atendioOptions;
    atendioReparacion.innerHTML = atendioOptions;
    atendioApartado.innerHTML = atendioOptions;
    atendioEncargo.innerHTML = atendioOptions;

    // Auto-select if only 1 user
    if (!currentUser2) {
        atendioFactura.value = currentUser1.username;
        atendioReparacion.value = currentUser1.username;
        atendioApartado.value = currentUser1.username;
        atendioEncargo.value = currentUser1.username;
    }

    // Permissions logic
    if (isAdmin()) {
        tabAdminBtn.classList.remove('hidden');
        btnDeleteOldFacturas.style.display = 'inline-flex';
        btnClearReparaciones.style.display = 'inline-flex';
        if (btnClearApartado) btnClearApartado.style.display = 'inline-flex';
        if (btnClearEncargos) btnClearEncargos.style.display = 'inline-flex';
        btnChangePassword.style.display = 'inline-flex';

        document.querySelectorAll('.admin-search-option').forEach(el => {
            el.style.display = 'flex';
        });

        tiendaFactura.disabled = false;
        tiendaReparacion.disabled = false;
        if (tiendaApartado) tiendaApartado.disabled = false;
        if (tiendaEncargo) tiendaEncargo.disabled = false;

        renderAdminUsers();
    } else {
        tabAdminBtn.classList.add('hidden');
        btnDeleteOldFacturas.style.display = 'none';
        btnClearReparaciones.style.display = 'none';
        if (btnClearApartado) btnClearApartado.style.display = 'none';
        if (btnClearEncargos) btnClearEncargos.style.display = 'none';
        btnChangePassword.style.display = 'none';

        document.querySelectorAll('.admin-search-option').forEach(el => el.style.display = 'none');
        if (searchStoreFacturas) searchStoreFacturas.value = '';
        if (searchStoreReparaciones) searchStoreReparaciones.value = '';

        tiendaFactura.value = currentStore;
        tiendaFactura.disabled = true;
        tiendaReparacion.value = currentStore;
        tiendaReparacion.disabled = true;
        if (tiendaApartado) { tiendaApartado.value = currentStore; tiendaApartado.disabled = true; }
        if (tiendaEncargo) { tiendaEncargo.value = currentStore; tiendaEncargo.disabled = true; }

        if (tabAdminBtn.classList.contains('active')) {
            document.querySelector('[data-tab="tab-facturas"]').click();
        }
    }

    updateStatsFacturas();
    updateStatsReparaciones();
    updateStatsApartado();
    updateStatsEncargos();
    renderFacturas();
    renderReparaciones();
    renderApartados();
    renderEncargos();
}


// ==================== TABS ====================
tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        tabBtns.forEach(b => b.classList.remove('active'));
        tabContents.forEach(c => {
            c.classList.remove('active');
            c.style.display = ''; // Limpiar cualquier display inline que pueda dar problema
        });

        btn.classList.add('active');
        const content = document.getElementById(btn.dataset.tab);
        if (content) content.classList.add('active');
    });
});

// ==================== TICKETS LOGIC ====================
function getDisplayFacturas() {
    let list = isAdmin() ? facturas : facturas.filter(t => t.tienda === currentStore);
    if (isAdmin() && searchStoreFacturas) {
        const storeVal = searchStoreFacturas.value;
        if (storeVal) list = list.filter(t => t.tienda === storeVal);
    }
    if (searchInputFacturas) {
        let searchVal = searchInputFacturas.value.toLowerCase().trim();
        if (searchVal) {
            list = list.filter(t => {
                // Buscar por nombre de cliente
                const clientStr = (t.client || '').toLowerCase();
                if (clientStr.includes(searchVal)) return true;

                // Buscar por fecha (coincidencia directa)
                const dateStr = (t.createdAt || t.date || '').toLowerCase();
                if (dateStr.includes(searchVal)) return true;

                // Buscar por fecha en formato corto (d/m o d/m/yyyy)
                let [d, m, y] = searchVal.split('/');
                if (d && m) {
                    let shortD = parseInt(d, 10).toString();
                    let shortM = parseInt(m, 10).toString();
                    let shortSearch = `${shortD}/${shortM}`;
                    if (y) shortSearch += `/${y}`;
                    if (dateStr.includes(shortSearch)) return true;
                }
                return false;
            });
        }
    }
    return list;
}

function getDisplayReparaciones() {
    let list = isAdmin() ? reparaciones : reparaciones.filter(t => t.tienda === currentStore);
    const filter = filterReparaciones.value;
    if (filter !== 'Todos') list = list.filter(t => t.status === filter);
    if (isAdmin() && searchStoreReparaciones) {
        const storeVal = searchStoreReparaciones.value;
        if (storeVal) list = list.filter(t => t.tienda === storeVal);
    }
    if (searchInputReparaciones) {
        let searchVal = searchInputReparaciones.value.toLowerCase().trim();
        if (searchVal) {
            list = list.filter(t => {
                // Buscar por nombre de cliente
                const clientStr = (t.client || '').toLowerCase();
                if (clientStr.includes(searchVal)) return true;

                // Buscar por fecha (coincidencia directa)
                const dateStr = (t.createdAt || t.date || '').toLowerCase();
                if (dateStr.includes(searchVal)) return true;

                // Buscar por fecha en formato corto
                let [d, m, y] = searchVal.split('/');
                if (d && m) {
                    let shortD = parseInt(d, 10).toString();
                    let shortM = parseInt(m, 10).toString();
                    let shortSearch = `${shortD}/${shortM}`;
                    if (y) shortSearch += `/${y}`;
                    if (dateStr.includes(shortSearch)) return true;
                }
                return false;
            });
        }
    }
    return list;
}

// Funciones saveFacturas y saveReparaciones eliminadas porque Firebase actualiza automáticamente
// a través de onSnapshot. Solo enviaremos los datos con setDoc.

// ==================== CONFIRM TICKET MODAL ====================
let _pendingTicketData = null; // datos del ticket en espera de confirmación
let _pendingTicketType = null; // 'factura' | 'reparacion'
let _pendingTicketForm = null; // ref al form para resetear

function showConfirmModal(fields, onAccept) {
    confirmTicketBody.innerHTML = fields.map(f => `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:0.6rem 0.75rem; background:#f8fafc; border-radius:8px; border:1px solid #e2e8f0;">
            <span style="color:var(--text-muted); font-size:0.9rem;">${f.label}</span>
            <strong style="color:var(--primary-dark); font-size:0.95rem;">${f.value}</strong>
        </div>
    `).join('');
    confirmTicketModal.classList.remove('hidden');
    btnAcceptConfirmTicket.onclick = () => {
        confirmTicketModal.classList.add('hidden');
        onAccept();
    };
}

btnCancelConfirmTicket.addEventListener('click', () => {
    confirmTicketModal.classList.add('hidden');
    _pendingTicketData = null;
});

formFactura.addEventListener('submit', (e) => {
    e.preventDefault();
    const clientName = document.getElementById('clientNameFactura').value;
    const phone = document.getElementById('clientPhone').value;
    const totalCost = parseFloat(document.getElementById('costTotalFactura').value).toFixed(2);
    const tienda = isAdmin() ? document.getElementById('tiendaFactura').value : currentStore;
    const atendio = document.getElementById('atendioFactura').value;

    const fields = [
        { label: '👤 Nombre del cliente', value: clientName },
        { label: '📞 Teléfono', value: phone || 'No proporcionado' },
        { label: '💰 Costo total', value: `$${totalCost}` },
    ];

    showConfirmModal(fields, () => {
        let newTicket = {
            id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(),
            type: 'Factura',
            client: clientName,
            phone: phone,
            tienda: tienda,
            atendio: atendio,
            totalCost: totalCost,
            advanceCost: totalCost,
            status: 'Realizado',
            createdAt: new Date().toLocaleString(),
            timestamp: Date.now(),
            completedAt: new Date().toLocaleString(),
            paymentConfirmed: false
        };
        setDoc(doc(db, "facturas", newTicket.id), newTicket);
        e.target.reset();
        applyRolesAndUI();
    });
});

formReparacion.addEventListener('submit', (e) => {
    e.preventDefault();
    const clientName = document.getElementById('clientNameReparacion').value;
    const noPhone = document.getElementById('noPhoneReparacion').checked;
    const phone = noPhone ? 'Sin número' : (document.getElementById('clientPhoneReparacion').value || 'No proporcionado');
    const model = document.getElementById('deviceModel').value;
    const repairType = document.getElementById('repairType').value;
    const tienda = isAdmin() ? document.getElementById('tiendaReparacion').value : currentStore;
    const atendio = document.getElementById('atendioReparacion').value;
    const totalCost = parseFloat(document.getElementById('costTotalReparacion').value).toFixed(2);
    const advanceCost = parseFloat(document.getElementById('costAdvanceReparacion').value || '0').toFixed(2);

    const fields = [
        { label: '👤 Nombre del cliente', value: clientName },
        { label: '📞 Teléfono', value: phone },
        { label: '📱 Modelo del equipo', value: model },
        { label: '💰 Costo total', value: `$${totalCost}` },
        { label: '🤝 Anticipo', value: `$${advanceCost}` },
    ];

    showConfirmModal(fields, () => {
        let newTicket = {
            id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(),
            type: 'Reparación',
            client: clientName,
            phone: phone,
            model: model,
            repairType: repairType,
            tienda: tienda,
            atendio: atendio,
            totalCost: totalCost,
            advanceCost: advanceCost,
            status: 'Pendiente',
            createdAt: new Date().toLocaleString(),
            timestamp: Date.now(),
            completedAt: null
        };
        setDoc(doc(db, "reparaciones", newTicket.id), newTicket);
        e.target.reset();
        // Reset phone checkbox
        const noPhoneCb = document.getElementById('noPhoneReparacion');
        const phoneinput = document.getElementById('clientPhoneReparacion');
        if (noPhoneCb) noPhoneCb.checked = false;
        if (phoneinput) { phoneinput.disabled = false; phoneinput.placeholder = 'Ej: 555 123 4567'; }
        applyRolesAndUI();
    });
});

window.updateTicketStatus = function (id, newStatus, type) {
    let collection = type === 'Factura' ? facturas : reparaciones;
    const ticketIndex = collection.findIndex(t => t.id === id);
    if (ticketIndex !== -1) {
        collection[ticketIndex].status = newStatus;
        if (newStatus === 'Realizado' || newStatus === 'Cancelado') {
            collection[ticketIndex].completedAt = new Date().toLocaleString();
            if (newStatus === 'Realizado') {
                collection[ticketIndex].advanceCost = collection[ticketIndex].totalCost;
            }
        } else {
            collection[ticketIndex].completedAt = null;
        }

        if (type === 'Factura') {
            setDoc(doc(db, "facturas", collection[ticketIndex].id), collection[ticketIndex]);
        } else {
            setDoc(doc(db, "reparaciones", collection[ticketIndex].id), collection[ticketIndex]);
        }
    }
}

window.deleteTicket = function (id, type) {
    if (!isAdmin()) return;
    if (confirm('¿Estás seguro de eliminar este ticket?')) {
        if (type === 'Factura') {
            deleteDoc(doc(db, "facturas", id));
        } else {
            deleteDoc(doc(db, "reparaciones", id));
        }
    }
}

filterReparaciones.addEventListener('change', renderReparaciones);

if (searchInputFacturas) searchInputFacturas.addEventListener('input', renderFacturas);
if (searchStoreFacturas) searchStoreFacturas.addEventListener('change', renderFacturas);

if (searchInputReparaciones) searchInputReparaciones.addEventListener('input', renderReparaciones);
if (searchStoreReparaciones) searchStoreReparaciones.addEventListener('change', renderReparaciones);

// Botones de limpiar búsqueda
const clearSearchFacturasBtn = document.getElementById('clearSearchFacturas');
if (clearSearchFacturasBtn) {
    clearSearchFacturasBtn.addEventListener('click', () => {
        if (searchInputFacturas) { searchInputFacturas.value = ''; renderFacturas(); }
    });
}
const clearSearchReparacionesBtn = document.getElementById('clearSearchReparaciones');
if (clearSearchReparacionesBtn) {
    clearSearchReparacionesBtn.addEventListener('click', () => {
        if (searchInputReparaciones) { searchInputReparaciones.value = ''; renderReparaciones(); }
    });
}

btnClearReparaciones.addEventListener('click', () => {
    if (!isAdmin()) return;
    if (confirm('¿Eliminar todos los tickets Realizados y Cancelados de Reparación?')) {
        const toDelete = reparaciones.filter(t => t.status !== 'Pendiente');
        toDelete.forEach(t => deleteDoc(doc(db, "reparaciones", t.id)));
    }
});

btnDeleteOldFacturas.addEventListener('click', () => {
    if (!isAdmin()) return;
    if (confirm('¿Eliminar las facturas de hace más de 1 mes?')) {
        const ONE_MONTH_MS = 30 * 24 * 60 * 60 * 1000;
        const now = Date.now();
        const toDelete = facturas.filter(t => {
            if (t.timestamp) return (now - t.timestamp) > ONE_MONTH_MS;
            return false;
        });
        toDelete.forEach(t => deleteDoc(doc(db, "facturas", t.id)));
    }
});

function updateStatsFacturas() {
    const allFac = isAdmin() ? facturas : facturas.filter(t => t.tienda === currentStore);
    if (countPendingFacturas) countPendingFacturas.textContent = allFac.filter(t => t.status === 'Pendiente').length;
    if (countDoneFacturas) countDoneFacturas.textContent = allFac.filter(t => t.status === 'Realizado').length;
    if (countCancelledFacturas) countCancelledFacturas.textContent = allFac.filter(t => t.status === 'Cancelado').length;
}

function updateStatsReparaciones() {
    const list = getDisplayReparaciones(); // esto sin filter extra
    const allRep = isAdmin() ? reparaciones : reparaciones.filter(t => t.tienda === currentStore);
    countPendingReparaciones.textContent = allRep.filter(t => t.status === 'Pendiente').length;
    countDoneReparaciones.textContent = allRep.filter(t => t.status === 'Realizado').length;
    countCancelledReparaciones.textContent = allRep.filter(t => t.status === 'Cancelado').length;
}

// ==================== PAYMENT CONFIRM MODAL ====================
let _pendingPaymentTicketId = null;

btnCancelPaymentConfirm.addEventListener('click', () => {
    paymentConfirmModal.classList.add('hidden');
    _pendingPaymentTicketId = null;
});
btnAcceptPaymentConfirm.addEventListener('click', () => {
    if (!_pendingPaymentTicketId) return;
    const ticketIdx = facturas.findIndex(t => t.id === _pendingPaymentTicketId);
    if (ticketIdx !== -1) {
        facturas[ticketIdx].paymentConfirmed = true;
        facturas[ticketIdx].paymentConfirmedAt = new Date().toLocaleString();
        facturas[ticketIdx].paymentConfirmedBy = currentUser1 ? currentUser1.username : 'Admin';
        setDoc(doc(db, "facturas", facturas[ticketIdx].id), facturas[ticketIdx]);
    }
    paymentConfirmModal.classList.add('hidden');
    _pendingPaymentTicketId = null;
});

window.openPaymentConfirm = function(id) {
    const ticket = facturas.find(t => t.id === id);
    if (!ticket) return;
    _pendingPaymentTicketId = id;
    paymentConfirmBody.innerHTML = `
        <div style="margin-bottom:0.5rem;"><strong>Cliente:</strong> ${ticket.client}</div>
        <div style="margin-bottom:0.5rem;"><strong>Teléfono:</strong> ${ticket.phone || 'N/A'}</div>
        <div style="margin-bottom:0.5rem;"><strong>Total:</strong> $${ticket.totalCost}</div>
        <div><strong>Fecha:</strong> ${ticket.createdAt}</div>
    `;
    paymentConfirmModal.classList.remove('hidden');
};

function renderTicketCard(ticket) {
    let statusIcon = '';
    if (ticket.status === 'Pendiente') statusIcon = '<i class="fa-solid fa-clock"></i>';
    if (ticket.status === 'Realizado') statusIcon = '<i class="fa-solid fa-check"></i>';
    if (ticket.status === 'Cancelado') statusIcon = '<i class="fa-solid fa-xmark"></i>';

    let pendingCost = (parseFloat(ticket.totalCost) - parseFloat(ticket.advanceCost)).toFixed(2);
    let creationDate = ticket.createdAt || ticket.date;

    const adminDeleteMarkup = isAdmin() ? `<button class="btn-delete" onclick="deleteTicket('${ticket.id}', '${ticket.type}')" title="Eliminar Ticket"><i class="fa-solid fa-trash"></i></button>` : '';

    // ---- Button visibility rules ----
    // FACTURAS:
    //   - Si está Cancelado: NO mostrar botón "Realizado" ni "Pendiente"
    //   - Si está Realizado: NO mostrar botón "Cancelado" (ya fue realizado)
    //   - Botón de pago confirmado solo para admin/tester y si NO está ya confirmado
    // REPARACIONES:
    //   - Si está Realizado o Cancelado: NO mostrar ningún botón de cambio de estado

    let actionButtons = `<button class="btn-status" onclick="printTicket('${ticket.id}', '${ticket.type}')" title="Imprimir Ticket"><i class="fa-solid fa-print" style="color:#475569"></i></button>`;

    if (ticket.type === 'Factura') {
        if (ticket.status === 'Realizado') {
            // No mostrar Cancelado (ya realizado, sólo confirmar pago)
        } else if (ticket.status === 'Cancelado') {
            // No mostrar Realizado ni Pendiente
        } else {
            // Pendiente o cualquier otro: mostrar Realizado y Cancelado
            actionButtons += `<button class="btn-status" onclick="updateTicketStatus('${ticket.id}', 'Realizado', '${ticket.type}')" title="Marcar como Realizado"><i class="fa-solid fa-check" style="color:var(--status-done)"></i></button>`;
            actionButtons += `<button class="btn-status" onclick="updateTicketStatus('${ticket.id}', 'Cancelado', '${ticket.type}')" title="Marcar como Cancelado"><i class="fa-solid fa-xmark" style="color:var(--status-cancelled)"></i></button>`;
        }
        // Botón de confirmación de pago (solo admin/tester)
        if (isAdmin() && ticket.status === 'Realizado' && !ticket.paymentConfirmed) {
            actionButtons += `<button class="btn-status btn-pay-confirm" onclick="openPaymentConfirm('${ticket.id}')" title="Confirmar Pago (Admin)"><i class="fa-solid fa-money-bill-wave" style="color:#10b981"></i></button>`;
        }
        if (ticket.paymentConfirmed) {
            actionButtons += `<span class="payment-confirmed-badge" title="Pago confirmado por ${ticket.paymentConfirmedBy || 'Admin'}"><i class="fa-solid fa-circle-check"></i> Pago OK</span>`;
        }
    } else {
        // REPARACIONES
        if (ticket.status === 'Pendiente') {
            // Puede cambiar a Realizado o Cancelado
            actionButtons += `<button class="btn-status" onclick="updateTicketStatus('${ticket.id}', 'Realizado', '${ticket.type}')" title="Marcar como Realizado"><i class="fa-solid fa-check" style="color:var(--status-done)"></i></button>`;
            actionButtons += `<button class="btn-status" onclick="updateTicketStatus('${ticket.id}', 'Cancelado', '${ticket.type}')" title="Marcar como Cancelado"><i class="fa-solid fa-xmark" style="color:var(--status-cancelled)"></i></button>`;
        }
        // Si está Realizado o Cancelado: NO mostrar botones de cambio de estado
    }

    actionButtons += adminDeleteMarkup;

    // Phone display: reparaciones may have phone too
    const phoneDisplay = ticket.phone ? `<div><i class="fa-solid fa-phone" style="width:20px"></i> Tel: <strong>${ticket.phone}</strong></div>` : '';

    return `
        <div class="ticket-card" data-status="${ticket.status}">
            <div class="ticket-top">
                <div class="ticket-info">
                    <h3>${ticket.type} - ${ticket.client}</h3>
                    <div style="display:flex; gap:1rem; margin-top: 0.5rem; flex-wrap:wrap; font-size:0.85rem;">
                        <span style="background:var(--bg-color); padding: 0.2rem 0.5rem; border-radius:4px;"><i class="fa-solid fa-store" style="color:var(--primary-light)"></i> <strong>${ticket.tienda || 'N/A'}</strong></span>
                        <span style="background:var(--bg-color); padding: 0.2rem 0.5rem; border-radius:4px;"><i class="fa-solid fa-user-tag" style="color:var(--primary-light)"></i> <strong>${ticket.atendio || 'N/A'}</strong></span>
                    </div>
                    <div class="ticket-details">
                        ${ticket.type === 'Factura' ? `
                            <div><i class="fa-solid fa-phone" style="width:20px"></i> Teléfono: <strong>${ticket.phone || 'N/A'}</strong></div>
                        ` : `
                            ${phoneDisplay}
                            <div><i class="fa-solid fa-mobile-button" style="width:20px"></i> Modelo: <strong>${ticket.model}</strong></div>
                            <div><i class="fa-solid fa-wrench" style="width:20px"></i> Falla/Reparación: <strong>${ticket.repairType}</strong></div>
                        `}
                    </div>
                    <div class="cobro-badge">
                        <div>Total: <strong>$${ticket.totalCost}</strong> &bull; Anticipo: <strong>$${ticket.advanceCost}</strong></div>
                        ${parseFloat(pendingCost) > 0 ? `<div style="margin-top: 0.25rem; font-size:0.8rem; color:#ef4444;">Por cobrar: $${pendingCost}</div>` : `<div style="margin-top: 0.25rem; font-size:0.8rem; color:#10b981;">Totalmente pagado</div>`}
                    </div>
                </div>
                <div style="text-align: right;">
                    <div class="ticket-badge-status">${statusIcon} ${ticket.status}</div>
                </div>
            </div>
            
            <div class="ticket-bottom" style="display:flex; justify-content:space-between; align-items:flex-end;">
                <div class="ticket-date-area">
                    <div class="ticket-date"><i class="fa-regular fa-calendar-plus"></i> Creado: <strong>${creationDate}</strong></div>
                    ${ticket.completedAt ? `<div class="ticket-date" style="margin-top:0.25rem; color: ${ticket.status === 'Realizado' ? 'var(--status-done)' : 'var(--status-cancelled)'}"><i class="fa-solid fa-flag-checkered"></i> Concluido: <strong>${ticket.completedAt}</strong></div>` : ''}
                    ${ticket.paymentConfirmed ? `<div class="ticket-date" style="margin-top:0.25rem; color:#10b981;"><i class="fa-solid fa-circle-check"></i> Pago confirmado por <strong>${ticket.paymentConfirmedBy || 'Admin'}</strong> el ${ticket.paymentConfirmedAt || ''}</div>` : ''}
                </div>
                <div class="ticket-actions">
                    ${actionButtons}
                </div>
            </div>
        </div>
    `;
}

function renderFacturas() {
    const list = getDisplayFacturas();
    if (list.length === 0) {
        containerFacturas.innerHTML = `<div class="empty-state"><i class="fa-solid fa-inbox"></i><p>No hay facturas para mostrar.</p></div>`;
        return;
    }
    containerFacturas.innerHTML = list.map(renderTicketCard).join('');
}

function renderReparaciones() {
    const list = getDisplayReparaciones();
    if (list.length === 0) {
        containerReparaciones.innerHTML = `<div class="empty-state"><i class="fa-solid fa-inbox"></i><p>No hay reparaciones para mostrar.</p></div>`;
        return;
    }
    containerReparaciones.innerHTML = list.map(renderTicketCard).join('');
}

// ==================== ADMIN PANEL LOGIC ====================
function saveUsers() {
    // Ya no se usa localmente. Se envía directo a Firebase con setDoc.
}

function renderAdminUsers() {
    usersContainer.innerHTML = '';
    users.forEach(u => {
        const isSelf = (currentUser1 && currentUser1.id === u.id) || (currentUser2 && currentUser2.id === u.id);
        
        let canModify = false;
        if (isTester()) {
            canModify = true; // tester can modify anyone
        } else if (isAdmin() && u.role !== 'admin' && u.role !== 'tester') {
            canModify = true; // admin can modify clients
        } else if (isSelf) {
            canModify = true; // anyone can modify themselves in theory, but this UI only shows for admins
        }

        let roleBadge = '';
        if (u.role === 'tester') roleBadge = '<span class="admin-badge" style="background:var(--primary-dark)">Tester</span>';
        else if (u.role === 'admin') roleBadge = '<span class="admin-badge">Admin</span>';

        let passDisplay = u.password;
        if (u.role === 'tester' && !isTester()) {
            passDisplay = '********';
        }

        usersContainer.innerHTML += `
            <div class="user-list-item">
                <div>
                    <h3 style="font-size:1rem;">${u.username} ${roleBadge}</h3>
                    <div style="font-size:0.8rem; color:#666; font-family:monospace;">Pass: ${passDisplay}</div>
                </div>
                <div>
                    ${canModify ? `<button class="btn btn-outline" style="color:#666; border-color:#ccc; padding:0.4rem 0.6rem; font-size:0.85rem;" onclick="promptResetPassword('${u.id}')">Cambiar Clave</button>` : ''}
                    ${(canModify && !isSelf && u.role !== 'tester') ? `<button class="btn btn-delete" style="padding:0.4rem 0.6rem; font-size:0.85rem;" onclick="deleteUser('${u.id}')"><i class="fa-solid fa-trash"></i></button>` : ''}
                </div>
            </div>
        `;
    });
    // Add new user btn
    usersContainer.innerHTML += `
        <div style="margin-top:1rem;">
            <button class="btn btn-outline" style="color:var(--primary-dark); border-color:var(--primary-dark); padding:0.4rem 0.8rem;" onclick="promptNewUser()">+ Añadir Empleado</button>
        </div>
    `;
}

window.promptResetPassword = function (id) {
    const newPass = prompt("Ingresa la nueva contraseña:");
    if (newPass) {
        let userIdx = users.findIndex(u => u.id === id);
        if (userIdx > -1) {
            users[userIdx].password = newPass;
            setDoc(doc(db, "users", id), users[userIdx]);
            alert("Contraseña actualizada. Los cambios se reflejarán en breve.");
        }
    }
}
window.promptNewUser = function () {
    const username = prompt("Nombre del empleado:");
    if (!username) return;
    const password = prompt("Contraseña temporal (ej: 123):");
    if (!password) return;
    const newUser = { id: Date.now().toString(), username, password, role: 'client' };
    setDoc(doc(db, "users", newUser.id), newUser);
}
window.deleteUser = function (id) {
    if (confirm("¿Eliminar usuario?")) {
        deleteDoc(doc(db, "users", id));
    }
}

btnResetStore.addEventListener('click', () => {
    if (confirm("ESTO BORRARÁ LA TIENDA DE ESTE EQUIPO.\nLa computadora se reiniciará a la configuración inicial y requerirá volver a seleccionar a qué tienda pertenece.\n¿Continuar?")) {
        DB.removeStore();
        location.reload();
    }
});

btnResetDB.addEventListener('click', () => {
    if (prompt("Escribe CONFIRMAR para borrar todos los tickets.") === "CONFIRMAR") {
        DB.clearTickets();
        location.reload();
    }
});

// ==================== PHONE VALIDATION ====================
const clientPhoneFacturaInput = document.getElementById('clientPhone');
if (clientPhoneFacturaInput) {
    clientPhoneFacturaInput.addEventListener('input', function (e) {
        let value = this.value.replace(/[^0-9\s]/g, '');
        let numCount = 0;
        let limitIndex = value.length;
        for (let i = 0; i < value.length; i++) {
            if (/[0-9]/.test(value[i])) { numCount++; if (numCount === 10) { limitIndex = i + 1; break; } }
        }
        if (numCount >= 10) value = value.substring(0, limitIndex);
        this.value = value;
    });
}

// Misma validación para el teléfono de Reparaciones (clientPhoneReparacionInput ya declarado arriba)
if (clientPhoneReparacionInput) {
    clientPhoneReparacionInput.addEventListener('input', function (e) {
        if (this.disabled) return; // ignorar si "Sin teléfono" está marcado
        let value = this.value.replace(/[^0-9\s]/g, '');
        let numCount = 0;
        let limitIndex = value.length;
        for (let i = 0; i < value.length; i++) {
            if (/[0-9]/.test(value[i])) { numCount++; if (numCount === 10) { limitIndex = i + 1; break; } }
        }
        if (numCount >= 10) value = value.substring(0, limitIndex);
        this.value = value;
    });
}

// ==================== IMPRESIÓN ====================
window.printTicket = function (id, type) {
    let collection = type === 'Factura' ? facturas : reparaciones;
    const ticket = collection.find(t => t.id === id);
    if (!ticket) return;

    let pendingCost = (parseFloat(ticket.totalCost) - parseFloat(ticket.advanceCost)).toFixed(2);
    let receiptHTML = `
    <html>
    <head>
        <title>Ticket ${ticket.id}</title>
        <style>
            @page { margin: 0; }
            body { font-family: 'Courier New', monospace; width: 300px; margin: 0 auto; color: #000; background: #fff; font-size: 14px; padding: 10px; box-sizing: border-box; }
            .header { text-align: center; margin-bottom: 10px; }
            .header h1 { font-size: 18px; margin: 0; font-weight: bold;}
            .header p { margin: 2px 0; font-size: 12px; }
            .divider { border-bottom: 1px dashed #000; margin: 10px 0; }
            .flex-row { display: flex; justify-content: space-between; margin-bottom: 5px;}
            .item { text-align: left; margin-bottom: 5px; word-wrap: break-word;}
            .total { font-weight: bold; font-size: 16px; margin-top: 10px; border-top: 1px dashed #000; padding-top: 5px;}
            .footer { text-align: center; margin-top: 20px; font-size: 12px; }
        </style>
    </head>
    <body onload="setTimeout(function(){ window.print(); }, 200);">
        <div class="header">
            <h1>REALPHONE</h1>
            <p>by Telcel</p>
            <p>Sucursal: ${ticket.tienda || 'N/A'}</p>
            <p style="font-size: 10px;">${ticket.tienda ? (STORE_ADDRESSES[ticket.tienda] || '') : ''}</p>
            <p>Ticket de ${ticket.type.toUpperCase()}</p>
            <p>Fecha: ${ticket.createdAt || ticket.date}</p>
        </div>
        <div class="divider"></div>
        <div class="item"><strong>Cliente:</strong> ${ticket.client}</div>
        ${ticket.type === 'Factura' ? `<div class="item"><strong>Teléfono:</strong> ${ticket.phone}</div>` : ''}
        ${ticket.type === 'Reparación' ? `
            <div class="item"><strong>Modelo:</strong> ${ticket.model}</div>
            <div class="item"><strong>Detalle:</strong> ${ticket.repairType}</div>
        ` : ''}
        <div class="item"><strong>Atendió:</strong> ${ticket.atendio || 'N/A'}</div>
        <div class="item"><strong>Estado:</strong> ${ticket.status}</div>
        <div class="divider"></div>
        <div class="flex-row"><span>Costo Total:</span> <span>$${ticket.totalCost}</span></div>
        <div class="flex-row"><span>Anticipo:</span> <span>$${ticket.advanceCost}</span></div>
        <div class="flex-row total"><span>Restante:</span> <span>$${parseFloat(pendingCost) > 0 ? pendingCost : '0.00'}</span></div>
        <div class="footer"><p>*** Gracias por su preferencia ***</p></div>
    </body>
    </html>`;

    const printIframe = document.createElement('iframe');
    printIframe.style.position = 'absolute'; printIframe.style.width = '0'; printIframe.style.height = '0'; printIframe.style.border = 'none';
    document.body.appendChild(printIframe);
    printIframe.contentDocument.open(); printIframe.contentDocument.write(receiptHTML); printIframe.contentDocument.close();
    setTimeout(() => { if (document.body.contains(printIframe)) document.body.removeChild(printIframe); }, 3000);
};


// ==================== APARTADO LOGIC ====================
function getDisplayApartados() {
    let list = isAdmin() ? apartados : apartados.filter(t => t.tienda === currentStore);
    const filter = filterApartado ? filterApartado.value : 'Todos';
    if (filter !== 'Todos') list = list.filter(t => t.status === filter);
    if (isAdmin() && searchStoreApartado && searchStoreApartado.value) {
        list = list.filter(t => t.tienda === searchStoreApartado.value);
    }
    if (searchInputApartado && searchInputApartado.value.trim()) {
        const val = searchInputApartado.value.toLowerCase().trim();
        list = list.filter(t => {
            if ((t.client || '').toLowerCase().includes(val)) return true;
            const d = (t.createdAt || '').toLowerCase();
            if (d.includes(val)) return true;
            let [dd, mm, yy] = val.split('/');
            if (dd && mm) {
                let s = `${parseInt(dd)  }/${parseInt(mm)}`;
                if (yy) s += `/${yy}`;
                if (d.includes(s)) return true;
            }
            return false;
        });
    }
    return list;
}

function updateStatsApartado() {
    const all = isAdmin() ? apartados : apartados.filter(t => t.tienda === currentStore);
    const pEl = document.getElementById('countPendingApartado');
    const dEl = document.getElementById('countDoneApartado');
    const cEl = document.getElementById('countCancelledApartado');
    if (pEl) pEl.textContent = all.filter(t => t.status === 'Pendiente').length;
    if (dEl) dEl.textContent = all.filter(t => t.status === 'Concluido').length;
    if (cEl) cEl.textContent = all.filter(t => t.status === 'Cancelado').length;
}

function renderApartados() {
    if (!containerApartado) return;
    const list = getDisplayApartados();
    if (list.length === 0) {
        containerApartado.innerHTML = `<div class="empty-state"><i class="fa-solid fa-bookmark"></i><p>No hay apartados para mostrar.</p></div>`;
        return;
    }
    containerApartado.innerHTML = list.map(renderTicketCardApartadoEncargo).join('');
}

if (formApartado) {
    formApartado.addEventListener('submit', (e) => {
        e.preventDefault();
        const clientName = document.getElementById('clientNameApartado').value;
        const equipo = document.getElementById('equipoApartado').value;
        const tienda = isAdmin() ? tiendaApartado.value : currentStore;
        const atendio = atendioApartado.value;
        const costo = parseFloat(document.getElementById('costoApartado').value).toFixed(2);
        const adelanto = parseFloat(document.getElementById('adelantoApartado').value || '0').toFixed(2);

        const fields = [
            { label: '👤 Nombre del cliente', value: clientName },
            { label: '📱 Equipo apartado', value: equipo },
            { label: '💰 Costo total del equipo', value: `$${costo}` },
            { label: '🤝 Adelanto de apartado', value: `$${adelanto}` },
        ];
        showConfirmModal(fields, () => {
            const ticket = {
                id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(),
                type: 'Apartado',
                client: clientName,
                equipo,
                tienda,
                atendio,
                totalCost: costo,
                advanceCost: adelanto,
                status: 'Pendiente',
                createdAt: new Date().toLocaleString(),
                timestamp: Date.now(),
                completedAt: null
            };
            setDoc(doc(db, 'apartados', ticket.id), ticket);
            e.target.reset();
            applyRolesAndUI();
        });
    });
}

if (filterApartado) filterApartado.addEventListener('change', renderApartados);
if (searchInputApartado) searchInputApartado.addEventListener('input', renderApartados);
if (searchStoreApartado) searchStoreApartado.addEventListener('change', renderApartados);
const clearSearchApartadoBtn = document.getElementById('clearSearchApartado');
if (clearSearchApartadoBtn) clearSearchApartadoBtn.addEventListener('click', () => { if (searchInputApartado) { searchInputApartado.value = ''; renderApartados(); } });

if (btnClearApartado) {
    btnClearApartado.addEventListener('click', () => {
        if (!isAdmin()) return;
        if (confirm('¿Eliminar todos los apartados Concluidos y Cancelados?')) {
            apartados.filter(t => t.status !== 'Pendiente').forEach(t => deleteDoc(doc(db, 'apartados', t.id)));
        }
    });
}

// ==================== ENCARGOS LOGIC ====================
function getDisplayEncargos() {
    let list = isAdmin() ? encargos : encargos.filter(t => t.tienda === currentStore);
    const filter = filterEncargos ? filterEncargos.value : 'Todos';
    if (filter !== 'Todos') list = list.filter(t => t.status === filter);
    if (isAdmin() && searchStoreEncargos && searchStoreEncargos.value) {
        list = list.filter(t => t.tienda === searchStoreEncargos.value);
    }
    if (searchInputEncargos && searchInputEncargos.value.trim()) {
        const val = searchInputEncargos.value.toLowerCase().trim();
        list = list.filter(t => {
            if ((t.client || '').toLowerCase().includes(val)) return true;
            const d = (t.createdAt || '').toLowerCase();
            if (d.includes(val)) return true;
            let [dd, mm, yy] = val.split('/');
            if (dd && mm) {
                let s = `${parseInt(dd)}/${parseInt(mm)}`;
                if (yy) s += `/${yy}`;
                if (d.includes(s)) return true;
            }
            return false;
        });
    }
    return list;
}

function updateStatsEncargos() {
    const all = isAdmin() ? encargos : encargos.filter(t => t.tienda === currentStore);
    const pEl = document.getElementById('countPendingEncargos');
    const dEl = document.getElementById('countDoneEncargos');
    const cEl = document.getElementById('countCancelledEncargos');
    if (pEl) pEl.textContent = all.filter(t => t.status === 'Pendiente').length;
    if (dEl) dEl.textContent = all.filter(t => t.status === 'Concluido').length;
    if (cEl) cEl.textContent = all.filter(t => t.status === 'Cancelado').length;
}

function renderEncargos() {
    if (!containerEncargos) return;
    const list = getDisplayEncargos();
    if (list.length === 0) {
        containerEncargos.innerHTML = `<div class="empty-state"><i class="fa-solid fa-box-archive"></i><p>No hay encargos para mostrar.</p></div>`;
        return;
    }
    containerEncargos.innerHTML = list.map(renderTicketCardApartadoEncargo).join('');
}

if (formEncargo) {
    formEncargo.addEventListener('submit', (e) => {
        e.preventDefault();
        const clientName = document.getElementById('clientNameEncargo').value;
        const contacto = document.getElementById('contactoEncargo').value || 'No proporcionado';
        const equipo = document.getElementById('equipoEncargo').value;
        const tienda = isAdmin() ? tiendaEncargo.value : currentStore;
        const atendio = atendioEncargo.value;
        const costo = parseFloat(document.getElementById('costoEncargo').value).toFixed(2);
        const anticipo = parseFloat(document.getElementById('anticipoEncargo').value || '0').toFixed(2);

        const fields = [
            { label: '👤 Nombre del cliente', value: clientName },
            { label: '📞 Número de contacto', value: contacto },
            { label: '📦 Equipo a encargar', value: equipo },
            { label: '💰 Costo total', value: `$${costo}` },
            { label: '🤝 Anticipo', value: `$${anticipo}` },
        ];
        showConfirmModal(fields, () => {
            const ticket = {
                id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(),
                type: 'Encargo',
                client: clientName,
                phone: contacto,
                equipo,
                tienda,
                atendio,
                totalCost: costo,
                advanceCost: anticipo,
                status: 'Pendiente',
                createdAt: new Date().toLocaleString(),
                timestamp: Date.now(),
                completedAt: null
            };
            setDoc(doc(db, 'encargos', ticket.id), ticket);
            e.target.reset();
            applyRolesAndUI();
        });
    });
}

if (filterEncargos) filterEncargos.addEventListener('change', renderEncargos);
if (searchInputEncargos) searchInputEncargos.addEventListener('input', renderEncargos);
if (searchStoreEncargos) searchStoreEncargos.addEventListener('change', renderEncargos);
const clearSearchEncargosBtn = document.getElementById('clearSearchEncargos');
if (clearSearchEncargosBtn) clearSearchEncargosBtn.addEventListener('click', () => { if (searchInputEncargos) { searchInputEncargos.value = ''; renderEncargos(); } });

if (btnClearEncargos) {
    btnClearEncargos.addEventListener('click', () => {
        if (!isAdmin()) return;
        if (confirm('¿Eliminar todos los encargos Concluidos y Cancelados?')) {
            encargos.filter(t => t.status !== 'Pendiente').forEach(t => deleteDoc(doc(db, 'encargos', t.id)));
        }
    });
}

// ==================== RENDER CARD (Apartado / Encargo) ====================
function renderTicketCardApartadoEncargo(ticket) {
    let statusIcon = '';
    if (ticket.status === 'Pendiente') statusIcon = '<i class="fa-solid fa-clock"></i>';
    if (ticket.status === 'Concluido') statusIcon = '<i class="fa-solid fa-check"></i>';
    if (ticket.status === 'Cancelado') statusIcon = '<i class="fa-solid fa-xmark"></i>';

    const pendingCost = (parseFloat(ticket.totalCost) - parseFloat(ticket.advanceCost)).toFixed(2);
    const adminDeleteMarkup = isAdmin()
        ? `<button class="btn-delete" onclick="deleteTicketAE('${ticket.id}','${ticket.type}')" title="Eliminar"><i class="fa-solid fa-trash"></i></button>`
        : '';

    let actionButtons = `<button class="btn-status" onclick="printTicketAE('${ticket.id}','${ticket.type}')" title="Imprimir"><i class="fa-solid fa-print" style="color:#475569"></i></button>`;
    if (ticket.status === 'Pendiente') {
        actionButtons += `<button class="btn-status" onclick="updateStatusAE('${ticket.id}','Concluido','${ticket.type}')" title="Concluido"><i class="fa-solid fa-check" style="color:var(--status-concluido)"></i> Concluido</button>`;
        actionButtons += `<button class="btn-status" onclick="updateStatusAE('${ticket.id}','Cancelado','${ticket.type}')" title="Cancelado"><i class="fa-solid fa-xmark" style="color:var(--status-cancelled)"></i> Cancelado</button>`;
    }
    actionButtons += adminDeleteMarkup;

    const extraDetail = ticket.type === 'Encargo' && ticket.phone
        ? `<div><i class="fa-solid fa-phone" style="width:20px"></i> Contacto: <strong>${ticket.phone}</strong></div>`
        : '';

    return `
        <div class="ticket-card" data-status="${ticket.status}">
            <div class="ticket-top">
                <div class="ticket-info">
                    <h3>${ticket.type} - ${ticket.client}</h3>
                    <div style="display:flex; gap:1rem; margin-top:0.5rem; flex-wrap:wrap; font-size:0.85rem;">
                        <span style="background:var(--bg-color); padding:0.2rem 0.5rem; border-radius:4px;"><i class="fa-solid fa-store" style="color:var(--primary-light)"></i> <strong>${ticket.tienda || 'N/A'}</strong></span>
                        <span style="background:var(--bg-color); padding:0.2rem 0.5rem; border-radius:4px;"><i class="fa-solid fa-user-tag" style="color:var(--primary-light)"></i> <strong>${ticket.atendio || 'N/A'}</strong></span>
                    </div>
                    <div class="ticket-details">
                        ${extraDetail}
                        <div><i class="fa-solid fa-box" style="width:20px"></i> Equipo: <strong>${ticket.equipo || 'N/A'}</strong></div>
                    </div>
                    <div class="cobro-badge">
                        <div>Total: <strong>$${ticket.totalCost}</strong> &bull; ${ticket.type === 'Apartado' ? 'Adelanto' : 'Anticipo'}: <strong>$${ticket.advanceCost}</strong></div>
                        ${parseFloat(pendingCost) > 0 ? `<div style="margin-top:0.25rem;font-size:0.8rem;color:#ef4444;">Por cobrar: $${pendingCost}</div>` : `<div style="margin-top:0.25rem;font-size:0.8rem;color:#10b981;">Totalmente pagado</div>`}
                    </div>
                </div>
                <div style="text-align:right;">
                    <div class="ticket-badge-status">${statusIcon} ${ticket.status}</div>
                </div>
            </div>
            <div class="ticket-bottom" style="display:flex;justify-content:space-between;align-items:flex-end;">
                <div class="ticket-date-area">
                    <div class="ticket-date"><i class="fa-regular fa-calendar-plus"></i> Creado: <strong>${ticket.createdAt}</strong></div>
                    ${ticket.completedAt ? `<div class="ticket-date" style="margin-top:0.25rem;color:${ticket.status === 'Concluido' ? 'var(--status-concluido)' : 'var(--status-cancelled)'}"><i class="fa-solid fa-flag-checkered"></i> Cerrado: <strong>${ticket.completedAt}</strong></div>` : ''}
                </div>
                <div class="ticket-actions">${actionButtons}</div>
            </div>
        </div>
    `;
}

window.updateStatusAE = function(id, newStatus, type) {
    const col = type === 'Apartado' ? apartados : encargos;
    const dbCol = type === 'Apartado' ? 'apartados' : 'encargos';
    const idx = col.findIndex(t => t.id === id);
    if (idx !== -1) {
        col[idx].status = newStatus;
        col[idx].completedAt = new Date().toLocaleString();
        setDoc(doc(db, dbCol, col[idx].id), col[idx]);
    }
};

window.deleteTicketAE = function(id, type) {
    if (!isAdmin()) return;
    if (confirm('¿Eliminar este ticket?')) {
        const dbCol = type === 'Apartado' ? 'apartados' : 'encargos';
        deleteDoc(doc(db, dbCol, id));
    }
};

window.printTicketAE = function(id, type) {
    const col = type === 'Apartado' ? apartados : encargos;
    const ticket = col.find(t => t.id === id);
    if (!ticket) return;
    const pending = (parseFloat(ticket.totalCost) - parseFloat(ticket.advanceCost)).toFixed(2);
    const adelantoLabel = type === 'Apartado' ? 'Adelanto' : 'Anticipo';
    const receiptHTML = `<html><head><title>Ticket ${ticket.id}</title>
    <style>
        @page{margin:0} body{font-family:'Courier New',monospace;width:300px;margin:0 auto;color:#000;background:#fff;font-size:14px;padding:10px;box-sizing:border-box;}
        .header{text-align:center;margin-bottom:10px;} .header h1{font-size:18px;margin:0;font-weight:bold;} .header p{margin:2px 0;font-size:12px;}
        .divider{border-bottom:1px dashed #000;margin:10px 0;} .flex-row{display:flex;justify-content:space-between;margin-bottom:5px;}
        .item{text-align:left;margin-bottom:5px;word-wrap:break-word;} .total{font-weight:bold;font-size:16px;margin-top:10px;border-top:1px dashed #000;padding-top:5px;}
        .footer{text-align:center;margin-top:20px;font-size:12px;}
    </style></head>
    <body onload="setTimeout(function(){window.print();},200);">
        <div class="header"><h1>REALPHONE</h1><p>by Telcel</p><p>Sucursal: ${ticket.tienda||'N/A'}</p>
        <p style="font-size:10px;">${ticket.tienda?(STORE_ADDRESSES[ticket.tienda]||''):''}</p>
        <p>Ticket de ${ticket.type.toUpperCase()}</p><p>Fecha: ${ticket.createdAt}</p></div>
        <div class="divider"></div>
        <div class="item"><strong>Cliente:</strong> ${ticket.client}</div>
        ${ticket.phone && type==='Encargo'?`<div class="item"><strong>Contacto:</strong> ${ticket.phone}</div>`:''}
        <div class="item"><strong>Equipo:</strong> ${ticket.equipo||'N/A'}</div>
        <div class="item"><strong>Atendió:</strong> ${ticket.atendio||'N/A'}</div>
        <div class="item"><strong>Estado:</strong> ${ticket.status}</div>
        <div class="divider"></div>
        <div class="flex-row"><span>Costo Total:</span><span>$${ticket.totalCost}</span></div>
        <div class="flex-row"><span>${adelantoLabel}:</span><span>$${ticket.advanceCost}</span></div>
        <div class="flex-row total"><span>Restante:</span><span>$${parseFloat(pending)>0?pending:'0.00'}</span></div>
        <div class="footer"><p>*** Gracias por su preferencia ***</p></div>
    </body></html>`;
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:absolute;width:0;height:0;border:none;';
    document.body.appendChild(iframe);
    iframe.contentDocument.open(); iframe.contentDocument.write(receiptHTML); iframe.contentDocument.close();
    setTimeout(() => { if (document.body.contains(iframe)) document.body.removeChild(iframe); }, 3000);
};

// Also extend the existing updateTicketStatus for Apartado/Encargo compatibility
const _origUpdateTicketStatus = window.updateTicketStatus;
window.updateTicketStatus = function(id, newStatus, type) {
    if (type === 'Apartado' || type === 'Encargo') {
        window.updateStatusAE(id, newStatus, type);
    } else {
        _origUpdateTicketStatus(id, newStatus, type);
    }
};

// ==================== THEME SYSTEM ====================
const THEME_KEY = 'realphone_theme';
const btnThemeToggle = document.getElementById('btnThemeToggle');
const themeDropdown = document.getElementById('themeDropdown');

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_KEY, theme);
    // Mark active option
    document.querySelectorAll('.theme-option').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.theme === theme);
    });
}

// Load saved theme on start (default: light)
applyTheme(localStorage.getItem(THEME_KEY) || 'light');

if (btnThemeToggle) {
    btnThemeToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        themeDropdown.classList.toggle('hidden');
    });
}

document.querySelectorAll('.theme-option').forEach(btn => {
    btn.addEventListener('click', () => {
        applyTheme(btn.dataset.theme);
        themeDropdown.classList.add('hidden');
    });
});

document.addEventListener('click', (e) => {
    if (themeDropdown && !themeDropdown.classList.contains('hidden')) {
        if (!themeDropdown.contains(e.target) && e.target !== btnThemeToggle) {
            themeDropdown.classList.add('hidden');
        }
    }
});

// ==================== NOVEDADES TOGGLE ====================
const btnToggleNovedades = document.getElementById('btnToggleNovedades');
const novedadesBody = document.getElementById('novedadesBody');
const novedadesChevron = document.getElementById('novedadesChevron');
const novedadesCard = novedadesBody?.closest('.novedades-card');
const NOVEDADES_KEY = 'realphone_novedades_open';

function initNovedades() {
    const isOpen = localStorage.getItem(NOVEDADES_KEY) !== 'false';
    if (!isOpen) {
        novedadesBody?.classList.add('collapsed');
        btnToggleNovedades?.classList.add('rotated');
        novedadesCard?.classList.add('collapsed');
    }
}
initNovedades();

if (btnToggleNovedades) {
    btnToggleNovedades.addEventListener('click', () => {
        const isCollapsed = novedadesBody.classList.contains('collapsed');
        novedadesBody.classList.toggle('collapsed', !isCollapsed);
        btnToggleNovedades.classList.toggle('rotated', !isCollapsed);
        novedadesCard?.classList.toggle('collapsed', !isCollapsed);
        localStorage.setItem(NOVEDADES_KEY, isCollapsed ? 'true' : 'false');
    });
}

// ==================== MENSAJE SECRETO ====================
const SECRETO_KEY = '0305';
const secretoHeaderTrigger = document.getElementById('secretoHeaderTrigger');
const secretoBody = document.getElementById('secretoBody');
const secretoCard = document.getElementById('secretoCard');
const secretoGate = document.getElementById('secretoGate');
const secretoCompose = document.getElementById('secretoCompose');
const secretoKeyInput = document.getElementById('secretoKeyInput');
const btnSecretoUnlock = document.getElementById('btnSecretoUnlock');
const secretoError = document.getElementById('secretoError');
const secretoMessages = document.getElementById('secretoMessages');
const secretoMsgInput = document.getElementById('secretoMsgInput');
const btnSecretoSend = document.getElementById('btnSecretoSend');
const secretoTitleText = document.getElementById('secretoTitleText');
const secretoLockIcon = document.getElementById('secretoLockIcon');
const secretoChevron = document.getElementById('secretoChevron');

let secretoUnlocked = false;

// Firebase real-time listener — always active, renders for everyone
// Messages auto-expire after 24 hours
const SECRETO_TTL = 24 * 60 * 60 * 1000; // 1 day in ms

let secretoMsgs = [];
onSnapshot(collection(db, 'mensajes_secretos'), (snapshot) => {
    const now = Date.now();
    secretoMsgs = [];
    snapshot.docs.forEach(d => {
        const data = { id: d.id, ...d.data() };
        // Auto-delete messages older than 24h
        if (now - (data.timestamp || 0) > SECRETO_TTL) {
            deleteDoc(doc(db, 'mensajes_secretos', d.id));
        } else {
            secretoMsgs.push(data);
        }
    });
    secretoMsgs.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    renderSecretoMessages();
});

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function timeAgo(timestamp) {
    const diff = Date.now() - timestamp;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'ahora mismo';
    if (mins < 60) return `hace ${mins} min`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `hace ${hrs}h`;
    return 'hace 1 día';
}

function renderSecretoMessages() {
    if (!secretoMessages) return;
    if (secretoMsgs.length === 0) {
        secretoMessages.innerHTML = `<div class="secreto-empty"><i class="fa-solid fa-ghost"></i>Aún no hay mensajes. ¡Sé el primero!</div>`;
        return;
    }
    secretoMessages.innerHTML = secretoMsgs.map(m => `
        <div class="secreto-msg-bubble">
            ${escapeHtml(m.text)}
            <div class="secreto-msg-meta">${timeAgo(m.timestamp || 0)} &mdash; expira en 24h</div>
        </div>
    `).join('');
    secretoMessages.scrollTop = secretoMessages.scrollHeight;
}

// Toggle panel open/close
if (secretoHeaderTrigger) {
    secretoHeaderTrigger.addEventListener('click', () => {
        const isOpen = !secretoBody.classList.contains('hidden');
        secretoBody.classList.toggle('hidden', isOpen);
        secretoCard.classList.toggle('open', !isOpen);
        if (!isOpen) {
            // Just opened — update title
            secretoTitleText.textContent = secretoUnlocked ? 'Mensaje Secreto' : '· · ·';
            renderSecretoMessages();
        }
    });
}

// Unlock write access with key
function unlockSecreto() {
    if (secretoKeyInput.value === SECRETO_KEY) {
        secretoGate.classList.add('hidden');
        secretoCompose?.classList.remove('hidden');
        secretoCard.classList.add('unlocked');
        secretoTitleText.textContent = 'Mensaje Secreto';
        if (secretoLockIcon) secretoLockIcon.className = 'fa-solid fa-lock-open secreto-lock-icon';
        secretoUnlocked = true;
        secretoMsgInput?.focus();
    } else {
        secretoError?.classList.remove('hidden');
        if (secretoKeyInput) secretoKeyInput.value = '';
        if (secretoError) {
            secretoError.style.animation = 'none';
            void secretoError.offsetWidth;
            secretoError.style.animation = '';
        }
        setTimeout(() => secretoError?.classList.add('hidden'), 2500);
    }
}

if (btnSecretoUnlock) btnSecretoUnlock.addEventListener('click', unlockSecreto);
if (secretoKeyInput) {
    secretoKeyInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') unlockSecreto(); });
}

// Send message (only when unlocked)
function sendSecretoMessage() {
    if (!secretoUnlocked) return;
    const text = secretoMsgInput?.value.trim();
    if (!text) return;
    const msg = {
        id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(),
        text,
        createdAt: new Date().toLocaleString(),
        timestamp: Date.now()
    };
    setDoc(doc(db, 'mensajes_secretos', msg.id), msg);
    if (secretoMsgInput) secretoMsgInput.value = '';
}

if (btnSecretoSend) btnSecretoSend.addEventListener('click', sendSecretoMessage);
if (secretoMsgInput) {
    secretoMsgInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendSecretoMessage(); });
}

// INITIAL CALL eliminado de aquí. Se llama ahora desde checkAllDataLoaded()
// initApp();
