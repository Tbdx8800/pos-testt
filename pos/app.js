/**
 * RealPhone POS — Punto de Venta Celulares y Tecnología
 * app.js — Lógica principal con atajos de teclado e inventario Excel
 */

const firebaseConfig = {
    apiKey: "AIzaSyAziX2ZYthQ6jMN9t5KoEk1qb88ZT29OMU",
    authDomain: "realphone-tickets.firebaseapp.com",
    projectId: "realphone-tickets",
    storageBucket: "realphone-tickets.firebasestorage.app",
    messagingSenderId: "461224250452",
    appId: "1:461224250452:web:9d2ed52a0e880c3e45f1c1"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
db.settings({
    cacheSizeBytes: firebase.firestore.CACHE_SIZE_UNLIMITED
});
db.enablePersistence().catch(function(err) {
    console.warn("Persistence error:", err);
});

(function () {

    // ==================== DATOS INICIALES ====================
    const defaultUsers = [
        { id: 'u1', username: 'admin',   password: '1234', role: 'admin',   fullName: 'Administrador Principal', branch: 'principal', active: true },
        { id: 'u2', username: 'gerente', password: '1234', role: 'tester',  fullName: 'Gerente de Sucursal',     branch: 'sucursal1', active: true },
        { id: 'u3', username: 'cliente', password: '1234', role: 'client',  fullName: 'Cliente Demo',            branch: 'principal', active: true }
    ];

    // ==================== ROLES ====================
    function isAdminOrTester() {
        return currentUser && (currentUser.role === 'admin' || currentUser.role === 'tester');
    }
    function isAdmin() {
        return currentUser && currentUser.role === 'admin';
    }
    function isTester() {
        return currentUser && currentUser.role === 'tester';
    }

    const defaultProducts = [
        { id: 'p1', sku: 'FUNDA-001', name: 'Funda Genérica para Celular',      category: 'fundas', cost: 30,  price: 99,   stock: 50 },
        { id: 'p2', sku: 'MICA-001',  name: 'Mica Normal Cristal Templado',     category: 'micas',  cost: 15,  price: 49,   stock: 100 }
    ];

    // ==================== ESTADO GLOBAL ====================
    let users         = [];
    let products      = [];
    let salesHistory  = [];
    let currentUser   = null;
    let currentBranch = 'principal';
    let ticketItems   = [];
    let ticketCounter = 1;
    let activeCategory = 'todas';
    let pendingImportData = [];
    let selectedExportType = 'full';
    let invRequests = []; // Solicitudes de inventario

    const defaultCategories = [
        { id: 'TOD', icon: '📦', name: 'Todas' },
        { id: 'FUN', icon: '🛡️', name: 'Fundas' },
        { id: 'MIC', icon: '📱', name: 'Micas' },
        { id: 'TEL', icon: '📞', name: 'Telefonía' }
    ];
    let categories = [];

    let phoneSales = {
        weekly: { total: 0, users: {} },
        monthly: { total: 0, users: {} },
        lastWeeklyReset: Date.now(),
        lastMonthlyReset: Date.now()
    };

    // ==================== PERSISTENCIA ====================
    const DATA_VERSION = '3.0'; // Cambiar para forzar reset de inventario

    function loadData() {
        try {
            const savedVersion = localStorage.getItem('realphone_version');
            if (savedVersion !== DATA_VERSION) {
                // Versión diferente → resetear a valores por defecto
                console.log('Datos actualizados a versión ' + DATA_VERSION + '. Reseteando inventario...');
                users        = JSON.parse(JSON.stringify(defaultUsers));
                products     = JSON.parse(JSON.stringify(defaultProducts));
                salesHistory = [];
                localStorage.setItem('realphone_version', DATA_VERSION);
                saveData();
                // Removed return; so Firebase listeners still run
            }
            // Cargar usuarios desde Firebase
            db.collection("users").onSnapshot((snapshot) => {
                users = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                if (users.length === 0) {
                    users = JSON.parse(JSON.stringify(defaultUsers));
                }
                
                // Si el usuario actual ya no existe o cambió, cerrar sesión
                if (currentUser) {
                    const stillExists = users.find(u => u.id === currentUser.id);
                    if (!stillExists || !stillExists.active) {
                        doLogout();
                    }
                }
            });

            // Forzar subida de usuarios locales y por defecto a la nube para garantizar el login
            const localUsers = JSON.parse(localStorage.getItem('realphone_users')) || [];
            const allUsersToSync = [...defaultUsers, ...localUsers];
            allUsersToSync.forEach(u => {
                if (u && u.id) db.collection("users").doc(u.id.toString()).set(u, { merge: true }).catch(console.error);
            });

            // Cargar solicitudes de inventario desde Firebase
            db.collection("invRequests").onSnapshot((snapshot) => {
                invRequests = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                renderInvRequests();
            });

            products     = JSON.parse(localStorage.getItem('realphone_products')) || JSON.parse(JSON.stringify(defaultProducts));
            salesHistory = JSON.parse(localStorage.getItem('realphone_sales'))    || [];
            ticketCounter= parseInt(localStorage.getItem('realphone_ticket_counter')) || 1;
            categories   = JSON.parse(localStorage.getItem('realphone_categories')) || JSON.parse(JSON.stringify(defaultCategories));
            
            // Migrar categorías antiguas a 3 letras mayúsculas
            let needsMigration = false;
            categories.forEach(c => {
                if (c.id === 'todas') { c.id = 'TOD'; needsMigration = true; }
                if (c.id === 'fundas') { c.id = 'FUN'; needsMigration = true; }
                if (c.id === 'micas') { c.id = 'MIC'; needsMigration = true; }
                if (c.id === 'telefonía' || c.id === 'telefonia') { c.id = 'TEL'; needsMigration = true; }
            });
            
            if (needsMigration) {
                products.forEach(p => {
                    if (p.category === 'fundas') p.category = 'FUN';
                    if (p.category === 'micas') p.category = 'MIC';
                    if (p.category === 'telefonía' || p.category === 'telefonia') p.category = 'TEL';
                });
                saveData();
            }

            phoneSales   = JSON.parse(localStorage.getItem('realphone_phone_sales')) || phoneSales;
            
            checkSalesResets();
        } catch (e) {
            console.error('Error cargando datos:', e);
            users = JSON.parse(JSON.stringify(defaultUsers));
            products = JSON.parse(JSON.stringify(defaultProducts));
            categories = JSON.parse(JSON.stringify(defaultCategories));
        }
    }

    function checkSalesResets() {
        const now = Date.now();
        const oneWeek = 7 * 24 * 60 * 60 * 1000;
        const oneMonth = 30 * 24 * 60 * 60 * 1000;
        
        if (now - phoneSales.lastWeeklyReset > oneWeek) {
            // Se asume que el corte se hizo o se fuerza el reinicio si pasó una semana sin corte.
            // Opcionalmente se puede mostrar un alert aquí.
            phoneSales.weekly = { total: 0, users: {} };
            phoneSales.lastWeeklyReset = now;
        }
        if (now - phoneSales.lastMonthlyReset > oneMonth) {
            phoneSales.monthly = { total: 0, users: {} };
            phoneSales.lastMonthlyReset = now;
        }
        saveData();
    }

    function saveData() {
        try {
            localStorage.setItem('realphone_users',    JSON.stringify(users));
            localStorage.setItem('realphone_products', JSON.stringify(products));
            localStorage.setItem('realphone_sales',    JSON.stringify(salesHistory));
            localStorage.setItem('realphone_ticket_counter', ticketCounter);
            localStorage.setItem('realphone_categories', JSON.stringify(categories));
            localStorage.setItem('realphone_phone_sales', JSON.stringify(phoneSales));
        } catch (e) {
            console.error('Error guardando datos:', e);
        }
    }

    // ==================== UTILIDADES ====================
    function formatMoney(amount) {
        return '$' + Number(amount).toFixed(2) + ' MXN';
    }

    function generateId() {
        return 'p' + Date.now() + Math.random().toString(36).slice(2, 6);
    }

    // ==================== TOAST NOTIFICATIONS ====================
    function showToast(message, type = 'info') {
        const container = document.getElementById('toastContainer');
        const icons = {
            success: 'fas fa-check-circle',
            error:   'fas fa-exclamation-circle',
            warning: 'fas fa-exclamation-triangle',
            info:    'fas fa-info-circle'
        };

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `<i class="${icons[type] || icons.info}"></i><span>${message}</span>`;
        container.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('toast-out');
            setTimeout(() => toast.remove(), 300);
        }, 3500);
    }

    // ==================== REFERENCIAS AL DOM ====================
    const loginOverlay       = document.getElementById('loginOverlay');
    const posContainer       = document.getElementById('posContainer');
    const loginError         = document.getElementById('loginError');
    const productListEl      = document.getElementById('productList');
    const ticketBody         = document.getElementById('ticketBody');
    const totalDisplay       = document.getElementById('totalDisplay');
    const paymentInput       = document.getElementById('paymentInput');
    const paymentDisplay     = document.getElementById('paymentDisplay');
    const changeDisplay      = document.getElementById('changeDisplay');
    const ticketNumberEl     = document.getElementById('ticketNumber');
    const searchInput        = document.getElementById('searchInput');
    const currentUserDisplay = document.getElementById('currentUserDisplay');
    const shortcutPanel      = document.getElementById('shortcutPanel');


    // ==================== AUTENTICACIÓN ====================
    document.getElementById('loginBtn').addEventListener('click', function () {
        const username = document.getElementById('loginUser').value.trim();
        const password = document.getElementById('loginPass').value.trim();

        if (!username || !password) {
            loginError.textContent = '⚠️ Ingresa usuario y contraseña';
            return;
        }

        // Buscar en los usuarios sincronizados (Firebase)
        let user = users.find(
            u => u.username && u.username.toLowerCase() === username.toLowerCase() && u.password === password
        );

        // Fallback a los usuarios antiguos en localStorage si no están en Firebase
        if (!user) {
            const localUsers = JSON.parse(localStorage.getItem('realphone_users')) || [];
            user = localUsers.find(
                u => u.username && u.username.toLowerCase() === username.toLowerCase() && u.password === password
            );
            
            // Si el usuario antiguo se loguea, lo migramos a Firebase automáticamente
            if (user && user.id) {
                db.collection("users").doc(user.id.toString()).set(user, { merge: true }).catch(console.error);
            }
        }

        if (!user) {
            // Fallback a los usuarios por defecto
            user = defaultUsers.find(
                u => u.username.toLowerCase() === username.toLowerCase() && u.password === password
            );
        }

        if (!user) {
            loginError.textContent = '❌ Usuario o contraseña incorrectos. (Prueba con admin / 1234)';
            return;
        }

        if (user.active === false) {
            loginError.textContent = '⚠️ Usuario desactivado';
            return;
        }

        // Login exitoso
        currentUser   = user;
        currentBranch = localStorage.getItem('realphone_current_store') || user.branch || 'Matriz';
        document.getElementById('branchSelect').value = currentBranch;
        localStorage.setItem('realphone_current_store', currentBranch);

        currentUserDisplay.innerHTML =
            '<i class="fas fa-user"></i> Le atiende: ' + (user.fullName || user.username);

        loginOverlay.classList.add('hidden');
        posContainer.style.display = 'flex';
        posContainer.style.paddingTop = '52px'; // Header height offset
        loginError.textContent = '';

        // Show header
        const posHdr = document.getElementById('posHeader');
        if (posHdr) {
            posHdr.style.display = 'flex';
            const uEl = document.getElementById('posHeaderUser');
            if (uEl) uEl.textContent = '| ' + (user.fullName || user.username) + ' [' + user.role + ']';
        }

        // Share session with Gestor de Tickets
        localStorage.setItem('realphone_currentUser1', JSON.stringify(user));

        // Apply permissions UI
        applyPermissionsUI();

        showToast('Bienvenido, ' + (user.fullName || user.username), 'success');
        renderProducts();
        updateTicketDisplay();
    });



    // Navegar con Enter en el login
    document.getElementById('loginUser').addEventListener('keypress', function (e) {
        if (e.key === 'Enter') document.getElementById('loginPass').focus();
    });
    document.getElementById('loginPass').addEventListener('keypress', function (e) {
        if (e.key === 'Enter') document.getElementById('loginBtn').click();
    });

    // Cerrar sesión
    document.getElementById('btnLogout').addEventListener('click', function () {
        const closeGestor = confirm('¿Cerrar sesión?\n\nPresiona Aceptar para cerrar sesión en AMBOS sistemas (POS y Gestor de Tickets).\nPresiona Cancelar para cerrar solo en el POS.');
        currentUser = null;
        ticketItems = [];
        loginOverlay.classList.remove('hidden');
        posContainer.style.display = 'none';
        posContainer.style.paddingTop = '0';
        document.getElementById('loginUser').value = '';
        document.getElementById('loginPass').value = '';
        const posHdr = document.getElementById('posHeader');
        if (posHdr) posHdr.style.display = 'none';
        if (closeGestor) {
            localStorage.removeItem('realphone_currentUser1');
        }
        showToast('Sesión cerrada', 'info');
    });

    // Cambio de sucursal
    document.getElementById('branchSelect').addEventListener('change', function (e) {
        if (currentUser && (currentUser.role === 'tester' || currentUser.role === 'admin')) {
            currentBranch = e.target.value;
            localStorage.setItem('realphone_current_store', currentBranch);
            showToast('Sucursal cambiada: ' + currentBranch, 'info');
        } else {
            showToast('No tienes permiso para cambiar sucursal', 'error');
            e.target.value = currentBranch;
        }
    });

    // ==================== PERMISSIONS UI ====================
    function applyPermissionsUI() {
        const isPriv = isAdminOrTester();
        // Inventory button
        const btnInv = document.getElementById('btnInventario');
        if (btnInv) btnInv.style.display = isPriv ? '' : 'none';
        // Add product button
        const btnAdd = document.getElementById('btnAddProduct');
        if (btnAdd) btnAdd.style.display = isPriv ? '' : 'none';
        // Category management
        document.querySelectorAll('.category-tab[data-cat-admin]').forEach(b => b.style.display = isPriv ? '' : 'none');
        // Requests button for clients
        let clientBtn = document.getElementById('btnClientRequest');
        if (!clientBtn && !isPriv && currentUser) {
            clientBtn = document.createElement('button');
            clientBtn.id = 'btnClientRequest';
            clientBtn.className = 'action-btn';
            clientBtn.style.cssText = 'border-color:rgba(99,102,241,0.3); color:#6366f1; background:rgba(99,102,241,0.08);';
            clientBtn.innerHTML = '<i class="fas fa-box-open"></i> Solicitar Inventario';
            clientBtn.addEventListener('click', openInvRequestModal);
            const actBtns = document.querySelector('.action-buttons');
            if (actBtns) actBtns.appendChild(clientBtn);
        }
        if (clientBtn) clientBtn.style.display = isPriv ? 'none' : '';
        // Pending requests panel for admin/tester
        const pendingPanel = document.getElementById('pendingInvRequests');
        if (pendingPanel) pendingPanel.style.display = isPriv ? '' : 'none';
    }

    // ==================== RENDERIZADO DE PRODUCTOS ====================
    function renderProducts(filterText = '') {
        if (!productListEl) return;

        const filtered = products.filter(p => {
            const matchCat   = activeCategory === 'todas' || p.category === activeCategory;
            const searchLower = filterText.toLowerCase();
            const matchSearch = !filterText ||
                p.name.toLowerCase().includes(searchLower) ||
                p.sku.toLowerCase().includes(searchLower);
            return matchCat && matchSearch;
        });

        if (filtered.length === 0) {
            productListEl.innerHTML =
                '<div style="text-align:center; color:var(--text-secondary); padding:2rem; font-weight:500;">No se encontraron productos</div>';
            return;
        }

        productListEl.innerHTML = filtered.map(p => `
            <div class="product-item" onclick="window.addToTicket('${p.id}')" title="Click para agregar al ticket">
                <div class="info">
                    <span class="sku">${p.sku}</span>
                    <span class="name">${p.name}</span>
                </div>
                <div>
                    <div class="price">${formatMoney(p.price)}</div>
                    <div class="stock-badge">Stock: ${p.stock}</div>
                </div>
            </div>
        `).join('');
    }

    // ==================== TICKET ====================
    window.addToTicket = function (productId) {
        const product = products.find(p => p.id === productId);
        if (!product) { showToast('Producto no encontrado', 'error'); return; }
        if (product.stock <= 0) { showToast('⚠️ Producto sin stock disponible', 'warning'); return; }

        const existing = ticketItems.find(i => i.id === productId);
        if (existing) {
            if (existing.qty >= product.stock) {
                showToast('Stock máximo alcanzado (' + product.stock + ' disponibles)', 'warning');
                return;
            }
            existing.qty += 1;
        } else {
            ticketItems.push({
                id:    product.id,
                sku:   product.sku,
                name:  product.name,
                price: product.price,
                cost:  product.cost,
                stock: product.stock,
                qty:   1
            });
        }
        updateTicketDisplay();
        showToast('Agregado: ' + product.name, 'success');
    };

    window.removeTicketItem = function (index) {
        const removed = ticketItems.splice(index, 1);
        updateTicketDisplay();
        if (removed.length) showToast('Eliminado: ' + removed[0].name, 'info');
    };

    function updateTicketDisplay() {
        if (!ticketBody) return;

        if (ticketItems.length === 0) {
            ticketBody.innerHTML =
                '<tr><td colspan="7" class="empty-ticket">0 Productos en la venta actual.</td></tr>';
        } else {
            ticketBody.innerHTML = ticketItems.map((item, idx) => `
                <tr>
                    <td>${item.sku}</td>
                    <td>${item.name}</td>
                    <td>${formatMoney(item.price)}</td>
                    <td>${item.qty}</td>
                    <td>${formatMoney(item.price * item.qty)}</td>
                    <td>${item.stock}</td>
                    <td><i class="fas fa-times-circle delete-icon"
                           onclick="window.removeTicketItem(${idx})"
                           title="Eliminar producto"></i></td>
                </tr>
            `).join('');
        }

        const total = ticketItems.reduce((s, i) => s + (i.price * i.qty), 0);
        totalDisplay.textContent = formatMoney(total);

        const pago = parseFloat(paymentInput.value) || 0;
        paymentDisplay.textContent = formatMoney(pago);
        changeDisplay.textContent  = formatMoney(Math.max(0, pago - total));
    }

    // ==================== COBRAR + AUTO-PRINT ====================
    document.getElementById('btnCobrar').addEventListener('click', function () {
        if (ticketItems.length === 0) {
            showToast('Agrega productos al ticket antes de cobrar', 'warning');
            return;
        }

        const total = ticketItems.reduce((s, i) => s + (i.price * i.qty), 0);
        const pago  = parseFloat(paymentInput.value) || 0;

        if (pago < total) {
            showToast('Pago insuficiente. Faltan: ' + formatMoney(total - pago), 'error');
            return;
        }

        if (!confirm(
            '¿Confirmar venta por ' + formatMoney(total) + '?\n' +
            'Pago: ' + formatMoney(pago) + '\n' +
            'Cambio: ' + formatMoney(pago - total)
        )) return;

        // Descontar stock
        ticketItems.forEach(item => {
            const prod = products.find(p => p.id === item.id);
            if (prod) prod.stock = Math.max(0, prod.stock - item.qty);
        });

        // Registrar venta
        const saleId = 'SALE-' + Date.now();
        const sale = {
            id:      saleId,
            date:    new Date().toISOString().slice(0, 10),
            time:    new Date().toLocaleTimeString(),
            branch:  currentBranch,
            cashier: currentUser ? (currentUser.fullName || currentUser.username) : 'N/A',
            items:   ticketItems.map(i => ({ ...i })),
            total:   total,
            profit:  ticketItems.reduce((s, i) => s + ((i.price - i.cost) * i.qty), 0),
            payment: pago,
            change:  pago - total
        };
        salesHistory.push(sale);

        // Metas: Verificar si se vendieron teléfonos
        let phonesSold = 0;
        ticketItems.forEach(item => {
            const prod = products.find(p => p.id === item.id);
            if (prod && prod.category === 'TEL') {
                phonesSold += item.qty;
            } else if (item.category === 'TEL') {
                phonesSold += item.qty; // Respaldo por si se borró el producto
            }
        });

        if (phonesSold > 0) {
            const uid = currentUser ? currentUser.username : 'desconocido';
            phoneSales.weekly.total += phonesSold;
            phoneSales.weekly.users[uid] = (phoneSales.weekly.users[uid] || 0) + phonesSold;
            
            phoneSales.monthly.total += phonesSold;
            phoneSales.monthly.users[uid] = (phoneSales.monthly.users[uid] || 0) + phonesSold;
        }

        saveData();

        showToast('✅ Venta registrada — Ticket #' + ticketCounter + ' — Total: ' + formatMoney(total), 'success');

        // AUTO-PRINT ticket de venta
        autoPrintSaleTicket(sale, ticketCounter);

        // Nuevo ticket
        ticketItems = [];
        paymentInput.value = '';
        ticketCounter++;
        ticketNumberEl.textContent = ticketCounter;
        updateTicketDisplay();
        renderProducts(searchInput.value);
    });

    // Auto-print function
    function autoPrintSaleTicket(sale, ticketNum) {
        const storeAddresses = {
            'principal':  'Av. Principal #100, Centro',
            'sucursal1':  'Calle 5 de Mayo #25, Col. Centro',
            'sucursal2':  'Blvd. Independencia #430',
            'sucursal3':  'Av. Juárez #88, Plaza Mayor',
            'sucursal4':  'Calle Morelos #15, Col. Juárez',
            'sucursal5':  'Carretera Nacional Km. 12'
        };
        const storeNames = {
            'principal': 'RealPhone Principal',
            'sucursal1': 'RealPhone Sucursal 1',
            'sucursal2': 'RealPhone Sucursal 2',
            'sucursal3': 'RealPhone Sucursal 3',
            'sucursal4': 'RealPhone Sucursal 4',
            'sucursal5': 'RealPhone Sucursal 5'
        };
        const storeName = storeNames[sale.branch] || sale.branch;
        const storeAddr = storeAddresses[sale.branch] || '';
        const itemsHtml = sale.items.map(i =>
            `<div class="flex-row"><span>${i.qty}x ${i.name}</span><span>$${(i.price * i.qty).toFixed(2)}</span></div>`
        ).join('');
        const receiptHTML = `<html><head><title>Ticket #${ticketNum}</title>
        <style>
            @page{margin:0} body{font-family:'Courier New',monospace;width:300px;margin:0 auto;color:#000;background:#fff;font-size:14px;padding:10px;box-sizing:border-box;}
            .header{text-align:center;margin-bottom:10px;} .header h1{font-size:18px;margin:0;font-weight:bold;} .header p{margin:2px 0;font-size:12px;}
            .divider{border-bottom:1px dashed #000;margin:8px 0;} .flex-row{display:flex;justify-content:space-between;margin-bottom:4px;font-size:13px;}
            .total{font-weight:bold;font-size:16px;margin-top:8px;border-top:1px dashed #000;padding-top:5px;}
            .footer{text-align:center;margin-top:16px;font-size:11px;}
        </style></head>
        <body onload="setTimeout(function(){window.print();window.close();},300);">
            <div class="header"><h1>${storeName}</h1><p>by Telcel</p><p style="font-size:10px;">${storeAddr}</p><p>Ticket de Venta #${ticketNum}</p><p>Fecha: ${sale.date} ${sale.time}</p></div>
            <div class="divider"></div>
            <div class="flex-row"><span>Le atendió:</span><span>${sale.cashier}</span></div>
            <div class="flex-row"><span>Sucursal:</span><span>${storeName}</span></div>
            <div class="divider"></div>
            ${itemsHtml}
            <div class="divider"></div>
            <div class="flex-row total"><span>TOTAL:</span><span>$${sale.total.toFixed(2)}</span></div>
            <div class="flex-row"><span>Pago con:</span><span>$${sale.payment.toFixed(2)}</span></div>
            <div class="flex-row"><span>Cambio:</span><span>$${sale.change.toFixed(2)}</span></div>
            <div class="footer"><p>*** Gracias por su preferencia ***</p><p>Conserve su ticket</p></div>
        </body></html>`;
        const w = window.open('', '_blank', 'width=350,height=600');
        if (w) { w.document.write(receiptHTML); w.document.close(); }
    }

    // ==================== BOTONES DE ACCIÓN ====================
    paymentInput.addEventListener('input', updateTicketDisplay);

    document.getElementById('btnDeleteItem').addEventListener('click', function () {
        if (ticketItems.length === 0) { showToast('No hay productos en el ticket', 'warning'); return; }
        const removed = ticketItems.pop();
        updateTicketDisplay();
        showToast('Eliminado: ' + removed.name, 'info');
    });

    document.getElementById('btnBuscar').addEventListener('click', function () {
        searchInput.focus();
        searchInput.select();
    });



    document.getElementById('btnPendiente').addEventListener('click', function () {
        if (ticketItems.length === 0) { showToast('No hay productos para dejar pendiente', 'warning'); return; }
        showToast('📋 Ticket #' + ticketCounter + ' guardado como pendiente', 'info');
    });

    // ==================== BÚSQUEDA ====================
    document.getElementById('btnSearch').addEventListener('click', function () {
        renderProducts(searchInput.value);
    });

    searchInput.addEventListener('input', function () {
        renderProducts(this.value);
    });

    searchInput.addEventListener('keypress', function (e) {
        if (e.key === 'Enter') renderProducts(this.value);
    });

    // ==================== CATEGORÍAS ====================
    function renderCategories() {
        const tabsContainer = document.getElementById('categoryTabs');
        const selectEl = document.getElementById('addCategory');
        if (!tabsContainer) return;

        let html = '';
        let selectHtml = '';
        categories.forEach(cat => {
            const isActive = activeCategory === cat.id ? 'active' : '';
            html += `<button class="category-tab ${isActive}" data-cat="${cat.id}">${cat.icon} ${cat.name}</button>`;
            
            // Llenar select excluyendo "todas"
            if (cat.id !== 'todas' && selectEl) {
                selectHtml += `<option value="${cat.id}">${cat.icon} ${cat.name}</option>`;
            }
        });
        tabsContainer.innerHTML = html;
        if (selectEl) selectEl.innerHTML = selectHtml;
    }

    document.getElementById('categoryTabs').addEventListener('click', function (e) {
        if (e.target.classList.contains('category-tab')) {
            document.querySelectorAll('.category-tab').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            activeCategory = e.target.dataset.cat;
            renderProducts(searchInput.value);
        }
    });

    const categoryModal = document.getElementById('categoryModal');
    const btnAddNewCategory = document.getElementById('btnAddNewCategory');
    if (btnAddNewCategory) {
        btnAddNewCategory.addEventListener('click', () => {
            categoryModal.style.display = 'flex';
        });
    }
    document.getElementById('btnCloseCategory').addEventListener('click', () => {
        categoryModal.style.display = 'none';
    });
    document.getElementById('btnSaveCategory').addEventListener('click', () => {
        const name = document.getElementById('newCatName').value.trim();
        const icon = document.getElementById('newCatIcon').value.trim() || '📦';
        if (!name) return showToast('El nombre es obligatorio', 'warning');

        const id = name.substring(0, 3).toUpperCase();
        if (categories.some(c => c.id === id)) return showToast('El ID de categoría ya existe', 'warning');

        categories.push({ id, name, icon });
        saveData();
        renderCategories();
        document.getElementById('newCatName').value = '';
        document.getElementById('newCatIcon').value = '';
        categoryModal.style.display = 'none';
        showToast('Categoría añadida', 'success');
    });

    // ==================== MODAL DE INVENTARIO ====================

    function openInventoryModal() {
        // Todos pueden abrir Configuración, pero los permisos se aplican dentro
        const configModal = document.getElementById('configModal');
        if (configModal) {
            configModal.style.display = 'flex';
        }
        resetImportState();
    }

    function closeInventoryModal() {
        const configModal = document.getElementById('configModal');
        if (configModal) {
            configModal.style.display = 'none';
        }
        resetImportState();
    }


    function resetImportState() {
        pendingImportData = [];
        const preview = document.getElementById('importPreviewConfig');
        const actions = document.getElementById('importActionsConfig');
        const status  = document.getElementById('importStatusConfig');
        if (preview) { preview.style.display = 'none'; preview.innerHTML = ''; }
        if (actions) actions.style.display = 'none';
        if (status) status.innerHTML = '';
    }

    const btnAddProduct = document.getElementById('btnAddProduct');
    if (btnAddProduct) {
        btnAddProduct.addEventListener('click', function() {
            if (!isAdminOrTester()) { showToast('Solo administradores o testers pueden agregar productos directamente', 'warning'); return; }
            openInventoryModal();
            document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => { c.classList.remove('active'); c.style.display = 'none'; });
            const tabBtn = document.querySelector('.modal-tab[data-tab="add"]');
            if (tabBtn) tabBtn.classList.add('active');
            const tabAdd = document.getElementById('tabAdd');
            if (tabAdd) { tabAdd.classList.add('active'); tabAdd.style.display = 'block'; }
            setTimeout(() => document.getElementById('addSku').focus(), 100);
        });
    }

    const btnCloseConfigNew = document.getElementById('btnCloseConfig');
    if (btnCloseConfigNew) {
        btnCloseConfigNew.addEventListener('click', closeInventoryModal);
    }


    // ==================== INVENTORY REQUEST MODAL ====================
    function openInvRequestModal() {
        const overlay = document.getElementById('invRequestOverlay');
        if (overlay) overlay.classList.remove('hidden');
        renderInvRequests();
    }

    document.getElementById('btnCloseInvRequest')?.addEventListener('click', () => {
        document.getElementById('invRequestOverlay')?.classList.add('hidden');
    });
    document.getElementById('btnCancelInvReq')?.addEventListener('click', () => {
        document.getElementById('invRequestOverlay')?.classList.add('hidden');
    });
    document.getElementById('btnSubmitInvReq')?.addEventListener('click', submitInvRequest);

    async function submitInvRequest() {
        const overlay = document.getElementById('invRequestOverlay');
        const type = document.getElementById('invReqType')?.value || 'entrada';
        const sku = document.getElementById('invReqSku')?.value.trim();
        const qty = parseInt(document.getElementById('invReqQty')?.value, 10);
        const note = document.getElementById('invReqNote')?.value.trim();

        if (!sku) {
            showToast('Ingresa el SKU del producto', 'warning');
            return;
        }
        if (isNaN(qty) || qty <= 0) {
            showToast('Ingresa una cantidad válida', 'warning');
            return;
        }
        if (!currentUser) {
            showToast('Inicia sesión para enviar la solicitud', 'warning');
            return;
        }

        const payload = {
            type: type === 'salida' ? 'salida' : 'entrada',
            sku,
            qty,
            note,
            requestedBy: currentUser.username || currentUser.fullName || 'Usuario',
            status: 'pending',
            createdAt: new Date().toISOString()
        };

        try {
            await db.collection('invRequests').add(payload);
            invRequests.push({ id: 'local-' + Date.now(), ...payload });
            renderInvRequests();
            overlay?.classList.add('hidden');
            showToast('Solicitud de inventario enviada', 'success');
            document.getElementById('invReqSku').value = '';
            document.getElementById('invReqQty').value = '';
            document.getElementById('invReqNote').value = '';
        } catch (err) {
            console.error(err);
            showToast('Error al enviar solicitud', 'error');
        }
    }
    function renderInvRequests() {
        const list = document.getElementById('invRequestsContainer');
        const modalList = document.getElementById('invRequestList');
        if (!list && !modalList) return;
        const pending = invRequests.filter(r => r.status === 'pending');
        const emptyHtml = '<div style="text-align:center; color:var(--text-secondary); padding:1rem; font-size:0.85rem;">No hay solicitudes pendientes</div>';
        if (pending.length === 0) {
            if (list) list.innerHTML = emptyHtml;
            if (modalList) modalList.innerHTML = emptyHtml;
            return;
        }

        const requestsHtml = pending.map(r => `
            <div class="inv-request-item" style="background:var(--bg); border:1px solid var(--border); border-radius:8px; padding:10px; display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <span class="req-type-badge ${r.type}" style="font-size:0.7rem; font-weight:bold; padding:2px 6px; border-radius:4px; text-transform:uppercase; background:var(--accent-light); color:var(--accent); margin-right:6px;">${r.type}</span>
                    <strong style="color:var(--text);">${r.sku}</strong> - ${r.qty || '-'} uds.
                    <div style="font-size:0.75rem; color:var(--text-secondary); margin-top:2px;">Por: ${r.requestedBy} - ${new Date(r.createdAt).toLocaleString()}</div>
                    ${r.type === 'add' ? `<div style="font-size:0.7rem; color:var(--text-secondary); margin-top:2px;">Nuevo Producto: ${r.name}</div>` : ''}
                </div>
                <div style="display:flex; gap:6px;">
                    <button class="action-btn" style="font-size:0.75rem; padding:5px 10px; color:var(--success); border-color:rgba(16,185,129,0.3);" onclick="window.approveInvRequest('${r.id}')"><i class="fas fa-check"></i></button>
                    <button class="action-btn danger" style="font-size:0.75rem; padding:5px 10px;" onclick="window.rejectInvRequest('${r.id}')"><i class="fas fa-times"></i></button>
                </div>
            </div>
        `).join('');

        if (list) list.innerHTML = requestsHtml;
        if (modalList) modalList.innerHTML = requestsHtml;
    }

    window.approveInvRequest = async function(reqId) {
        if (!isAdminOrTester()) return;
        const req = invRequests.find(r => r.id === reqId);
        if (!req) return;

        if (req.type === 'add') {
            const existing = products.find(p => p.sku === req.sku);
            if (existing) { showToast('El SKU ya existe. No se puede aprobar.', 'error'); return; }
            products.push({
                sku: req.sku, name: req.name, category: req.cat,
                cost: req.cost, price: req.price, stock: req.stock,
                active: true
            });
        } else {
            const prod = products.find(p => p.sku.toLowerCase() === req.sku.toLowerCase());
            if (!prod) { showToast('Producto no encontrado: ' + req.sku, 'error'); return; }
            if (req.type === 'entrada') prod.stock += req.qty;
            else prod.stock = Math.max(0, prod.stock - req.qty);
        }

        saveData();
        renderProducts(searchInput.value);

        try {
            await db.collection("invRequests").doc(reqId).delete();
            showToast('Solicitud aprobada', 'success');
        } catch (err) {
            console.error(err);
            showToast('Error al actualizar Firebase', 'error');
        }
    };

    window.rejectInvRequest = async function(reqId) {
        if (!isAdminOrTester()) return;
        try {
            await db.collection("invRequests").doc(reqId).delete();
            showToast('Solicitud rechazada', 'info');
        } catch (err) {
            console.error(err);
            showToast('Error al rechazar en Firebase', 'error');
        }
    };

    // Tabs del modal
    document.querySelectorAll('.modal-tab').forEach(tab => {
        tab.addEventListener('click', function () {
            document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            this.classList.add('active');
            const tabId = this.dataset.tab === 'add' ? 'tabAdd' : 
                          this.dataset.tab === 'stock' ? 'tabStock' : 
                          this.dataset.tab === 'importExport' ? 'tabImportExport' : 'tabAdd';
            const targetContent = document.getElementById(tabId);
            if (targetContent) {
                targetContent.classList.add('active');
                targetContent.style.display = 'block';
            }
        });
    });

    // ==================== AGREGAR PRODUCTO (FORMULARIO) ====================
    document.getElementById('addProductForm').addEventListener('submit', async function (e) {
        e.preventDefault();

        const sku   = document.getElementById('addSku').value.trim().toUpperCase();
        const name  = document.getElementById('addName').value.trim();
        const cat   = document.getElementById('addCategory').value;
        const cost  = parseFloat(document.getElementById('addCost').value) || 0;
        const price = parseFloat(document.getElementById('addPrice').value) || 0;
        const stock = parseInt(document.getElementById('addStock').value) || 0;

        if (!sku || !name) {
            showToast('Completa los campos obligatorios (SKU y Nombre)', 'warning');
            return;
        }

        if (price <= 0) {
            showToast('El precio de venta debe ser mayor a 0', 'warning');
            return;
        }

        if (!isAdminOrTester()) { 
            try {
                await db.collection("invRequests").add({
                    type: "add",
                    sku, name, cat, cost, price, stock,
                    requestedBy: currentUser.username,
                    status: "pending",
                    createdAt: new Date().toISOString()
                });
                showToast('Solicitud de producto enviada a administradores', 'success');
                this.reset();
                closeInventoryModal();
            } catch (err) {
                console.error(err);
                showToast('Error al enviar solicitud', 'error');
            }
            return; 
        }

        // Verificar SKU duplicado
        const existing = products.find(p => p.sku.toUpperCase() === sku);
        if (existing) {
            showToast('Ya existe un producto con SKU: ' + sku + ' (' + existing.name + ')', 'error');
            document.getElementById('addSku').focus();
            return;
        }

        const newProduct = {
            id:       generateId(),
            sku:      sku,
            name:     name,
            category: cat,
            cost:     cost,
            price:    price,
            stock:    stock
        };

        products.push(newProduct);
        saveData();
        renderProducts(searchInput.value);

        // Mostrar en "recién agregados"
        const recentEl = document.getElementById('recentlyAdded');
        const badge = `<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--success-light);border:1px solid rgba(16,185,129,0.2);border-radius:8px;margin-bottom:6px;font-size:0.85rem;">
            <i class="fas fa-check-circle" style="color:var(--success)"></i>
            <strong>${sku}</strong> — ${name} — $${price.toFixed(2)} — Stock: ${stock}
        </div>`;
        recentEl.innerHTML = badge + recentEl.innerHTML;

        showToast('✅ Producto agregado: ' + name, 'success');

        // Limpiar form y enfocar SKU para agregar otro
        this.reset();
        document.getElementById('addCost').value = '0';
        document.getElementById('addStock').value = '1';
        document.getElementById('addSku').focus();
    });

    function applyAdminTabs() {
        const isPriv = isAdminOrTester();
        const tabStock = document.getElementById('btnTabStock');
        const tabImportExport = document.getElementById('btnTabImportExport');
        const tabUsers = document.getElementById('btnTabUsers');
        const tabRequests = document.getElementById('btnTabRequests');

        if (tabStock) tabStock.style.display = isPriv ? 'inline-block' : 'none';
        if (tabImportExport) tabImportExport.style.display = isPriv ? 'inline-block' : 'none';
        if (tabUsers) tabUsers.style.display = isAdmin() ? 'inline-block' : 'none';
        if (tabRequests) tabRequests.style.display = isPriv ? 'inline-block' : 'none';
    }

    // ==================== INVENTARIO (NUEVOS TABS) ====================

    // Lógica de pestañas (Tabs) en Inventario
    document.querySelectorAll('.modal-tab').forEach(btn => {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.modal-tab').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
            
            this.classList.add('active');
            const targetId = 'tab' + this.dataset.tab.charAt(0).toUpperCase() + this.dataset.tab.slice(1);
            const targetContent = document.getElementById(targetId);
            if(targetContent) {
                targetContent.classList.add('active');
                targetContent.style.display = 'block';
            }
        });
    });

    // Lógica botones manuales de Stock
    document.getElementById('btnDoStockIn')?.addEventListener('click', () => {
        closeInventoryModal();
        handleStockEntry();
    });
    document.getElementById('btnDoStockOut')?.addEventListener('click', () => {
        closeInventoryModal();
        handleStockExit();
    });

    // Añadir categora (Admin)
    document.getElementById('btnAddNewCategory')?.addEventListener('click', () => {
        if(currentUser?.role !== 'admin') return showToast('Solo admin', 'error');
        const catName = prompt('Nombre de la nueva categora (ej. Telefonía):');
        if(!catName) return;
        const icon = prompt('Icono (emoji):') || '📦';
        const id = catName.substring(0, 3).toUpperCase();
        if(categories.some(c => c.id === id)) return showToast('El ID de categoría ya existe', 'warning');
        
        categories.push({ id, name: catName, icon });
        saveData();
        renderCategories();
        showToast('Categora añadida', 'success');
        
        // Refrescar selector en el form
        const select = document.getElementById('addCategory');
        const opt = document.createElement('option');
        opt.value = id; opt.textContent = catName;
        select.appendChild(opt);
        select.value = id;
    });

    // ==================== AÑADIR PRODUCTOS (MANUAL) ====================
    // ==================== IMPORTACIÓN DE EXCEL ====================
    const dropZone  = document.getElementById('dropZone') || document.getElementById('dropZoneConfig');
    const fileInput = document.getElementById('fileInput') || document.getElementById('excelFileConfig');

    if (dropZone && fileInput) {
        // Click en la zona de drop
        dropZone.addEventListener('click', () => fileInput.click());

        // Drag & Drop
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('drag-over');
        });

        dropZone.addEventListener('dragleave', () => {
            dropZone.classList.remove('drag-over');
        });

        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('drag-over');
            const files = e.dataTransfer.files;
            if (files.length > 0) processExcelFile(files[0]);
        });
    }

    if (fileInput) {
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) processExcelFile(e.target.files[0]);
            fileInput.value = ''; // Reset para permitir seleccionar el mismo archivo
        });
    }

    function processExcelFile(file) {
        const validTypes = [
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-excel'
        ];
        const ext = file.name.split('.').pop().toLowerCase();

        if (!validTypes.includes(file.type) && !['xlsx', 'xls'].includes(ext)) {
            showToast('Formato no válido. Solo se aceptan archivos .xlsx o .xls', 'error');
            return;
        }

        const statusEl = document.getElementById('importStatusConfig');
        if (!statusEl) return;
        statusEl.innerHTML = '<span class="status-badge warning"><i class="fas fa-spinner fa-spin"></i> Procesando archivo...</span>';

        const reader = new FileReader();
        reader.onload = function (e) {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });

                // Leer la primera hoja
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                const jsonData  = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

                // Remover la primera fila si es de encabezados (opcional, pero útil si el usuario la deja)
                // Checamos si la primera fila tiene "SKU" o "Descripción"
                if (jsonData.length > 0 && String(jsonData[0][0]).toLowerCase().includes('sku')) {
                    jsonData.shift();
                }

                if (jsonData.length === 0) {
                    statusEl.innerHTML = '<span class="status-badge error"><i class="fas fa-exclamation-circle"></i> El archivo está vacío</span>';
                    return;
                }

                // Mapear columnas estricto
                const mapped = mapImportData(jsonData);

                if (mapped.length === 0) {
                    statusEl.innerHTML = '<span class="status-badge error"><i class="fas fa-exclamation-circle"></i> No se encontraron columnas válidas</span>';
                    return;
                }

                pendingImportData = mapped;
                statusEl.innerHTML = `<span class="status-badge success"><i class="fas fa-check-circle"></i> ${mapped.length} productos leídos de "${file.name}"</span>`;

                // Mostrar preview
                renderImportPreview(mapped);
                const actionsEl = document.getElementById('importActionsConfig');
                if (actionsEl) actionsEl.style.display = 'flex';

            } catch (err) {
                console.error('Error procesando Excel:', err);
                statusEl.innerHTML = '<span class="status-badge error"><i class="fas fa-exclamation-circle"></i> Error al leer el archivo: ' + err.message + '</span>';
            }
        };

        reader.onerror = function () {
            statusEl.innerHTML = '<span class="status-badge error"><i class="fas fa-exclamation-circle"></i> Error al leer el archivo</span>';
        };

        reader.readAsArrayBuffer(file);
    }

    function mapImportData(jsonData) {
        // Mapeo estricto por columnas
        // A: SKU (0)
        // B: Descripción (1)
        // C: Existencia (2)
        // D: Precio (3)
        // E: Categoría (4)
        // F: Costo (5)
        
        return jsonData.map(row => {
            // jsonData es un array de arrays al usar header: 1
            const sku   = String(row[0] || '').trim();
            const name  = String(row[1] || '').trim();
            const stock = parseInt(row[2]) || 0;
            const price = parseFloat(row[3]) || 0;
            let rawCat  = String(row[4] || '').trim();
            if (!rawCat) rawCat = 'sin_categoria';
            const cat   = rawCat.toLowerCase().replace(/\s+/g, '_');
            const cost  = parseFloat(row[5]) || 0;

            if (!sku && !name) return null; // Fila vacía

            return {
                sku:      sku || 'SIN-SKU',
                name:     name || 'Producto sin nombre',
                category: cat,
                cost:     cost,
                price:    price,
                stock:    stock
            };
        }).filter(Boolean);
    }

    function renderImportPreview(data) {
        const previewEl = document.getElementById('importPreviewConfig');
        if (!previewEl) return;
        previewEl.style.display = 'block';

        let html = `
            <table class="ticket-table" style="font-size:0.8rem;">
                <thead>
                    <tr>
                        <th>Acción</th>
                        <th>SKU</th>
                        <th>Nombre</th>
                        <th>Categoría</th>
                        <th>Costo</th>
                        <th>Precio</th>
                        <th>Stock</th>
                    </tr>
                </thead>
                <tbody>
        `;

        const limit = Math.min(data.length, 100); // Mostrar max 100
        for (let i = 0; i < limit; i++) {
            const item = data[i];
            const existingIdx = products.findIndex(p => p.sku.toLowerCase() === item.sku.toLowerCase());

            let badge = '';
            if (existingIdx >= 0) {
                badge = '<span class="status-badge warning" style="padding:2px 4px;font-size:0.7rem;">Actualizar</span>';
            } else {
                badge = '<span class="status-badge success" style="padding:2px 4px;font-size:0.7rem;">Nuevo</span>';
            }

            html += `
                <tr>
                    <td>${badge}</td>
                    <td><strong>${item.sku}</strong></td>
                    <td>${item.name}</td>
                    <td>${item.category}</td>
                    <td>$${item.cost.toFixed(2)}</td>
                    <td>$${item.price.toFixed(2)}</td>
                    <td>${item.stock}</td>
                </tr>
            `;
        }

        if (data.length > limit) {
            html += `<tr><td colspan="7" style="text-align:center;color:#64748b;">... y ${data.length - limit} productos más ...</td></tr>`;
        }

        html += `</tbody></table>`;
        previewEl.innerHTML = html;
    }

    // Confirmar importación
    const btnConfirmImport = document.getElementById('btnConfirmImport') || document.getElementById('btnConfirmImportConfig');
    if (btnConfirmImport) btnConfirmImport.addEventListener('click', function () {
        if (pendingImportData.length === 0) {
            showToast('No hay datos para importar', 'warning');
            return;
        }

        let added   = 0;
        let updated = 0;

        pendingImportData.forEach(item => {
            const existingIdx = products.findIndex(p => p.sku.toLowerCase() === item.sku.toLowerCase());

            if (existingIdx >= 0) {
                // Actualizar producto existente
                products[existingIdx].name     = item.name;
                products[existingIdx].category = item.category;
                products[existingIdx].cost     = item.cost;
                products[existingIdx].price    = item.price;
                products[existingIdx].stock    = item.stock;
                updated++;
            } else {
                // Agregar nuevo producto
                products.push({
                    id:       generateId(),
                    sku:      item.sku,
                    name:     item.name,
                    category: item.category,
                    cost:     item.cost,
                    price:    item.price,
                    stock:    item.stock
                });
                added++;
            }
        });

        saveData();
        renderProducts(searchInput.value);
        resetImportState();

        showToast(`✅ Importación completada: ${added} nuevos, ${updated} actualizados`, 'success');
    });

    // Cancelar importación
    const btnCancelImport = document.getElementById('btnCancelImport') || document.getElementById('btnCancelImportConfig');
    if (btnCancelImport) btnCancelImport.addEventListener('click', resetImportState);

    // ==================== EXPORTACIÓN DE EXCEL ====================
    // Selección de tipo de exportación
    document.querySelectorAll('.export-option').forEach(opt => {
        opt.addEventListener('click', function () {
            document.querySelectorAll('.export-option').forEach(o => o.classList.remove('selected'));
            this.classList.add('selected');
            selectedExportType = this.dataset.type;
        });
    });

    const btnExport = document.getElementById('btnExport') || document.getElementById('btnExportConfig');
    if (btnExport) btnExport.addEventListener('click', function () {
        if (typeof XLSX === 'undefined') {
            showToast('Error: Librería SheetJS no cargada', 'error');
            return;
        }

        let wsData = [];
        const now = new Date();
        const dateStr = now.toISOString().slice(0, 10);

        switch (selectedExportType) {
            case 'full':
            case 'completo':
                wsData = products.map((p, idx) => ({
                    '#':          idx + 1,
                    'SKU':        p.sku,
                    'Nombre':     p.name,
                    'Categoría':  p.category,
                    'Costo':      p.cost,
                    'Precio':     p.price,
                    'Stock':      p.stock,
                    'Margen':     p.price - p.cost,
                    'Valor_Stock': p.price * p.stock
                }));
                break;

            case 'stock':
            case 'faltantes':
                wsData = products.filter(p => p.stock <= 0).map((p, idx) => ({
                    '#':      idx + 1,
                    'SKU':    p.sku,
                    'Nombre': p.name,
                    'Stock':  p.stock,
                    'Valor':  p.price * p.stock
                }));
                break;

            case 'template':
                wsData = [
                    { SKU: 'FUNDA-EJ', Nombre: 'Funda Genérica para Celular', Categoría: 'fundas', Costo: 30, Precio: 99, Stock: 50 },
                    { SKU: 'MICA-EJ', Nombre: 'Mica Normal Cristal Templado', Categoría: 'micas', Costo: 15, Precio: 49, Stock: 100 }
                ];
                break;
        }

        if (wsData.length === 0) {
            showToast('No hay datos para exportar', 'warning');
            return;
        }

        try {
            const ws = XLSX.utils.json_to_sheet(wsData);
            const wb = XLSX.utils.book_new();

            // Ajustar ancho de columnas
            const colWidths = Object.keys(wsData[0]).map(key => ({
                wch: Math.max(key.length, ...wsData.map(row => String(row[key] || '').length)) + 2
            }));
            ws['!cols'] = colWidths;

            const sheetNames = {
                full:      'Inventario_Completo',
                completo:  'Inventario_Completo',
                stock:     'Stock',
                faltantes: 'Stock',
                template:  'Plantilla'
            };

            XLSX.utils.book_append_sheet(wb, ws, sheetNames[selectedExportType] || 'Datos');

            const fileName = `RealPhone_POS_${sheetNames[selectedExportType]}_${dateStr}.xlsx`;
            XLSX.writeFile(wb, fileName);

            showToast('📥 Archivo descargado: ' + fileName, 'success');
        } catch (err) {
            console.error('Error exportando:', err);
            showToast('Error al exportar: ' + err.message, 'error');
        }
    });

    // ==================== TEMA ====================
    const POS_THEME_KEY = 'realphone_theme';
    function applyPosTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem(POS_THEME_KEY, theme);
        document.querySelectorAll('.theme-option-pos').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.theme === theme);
        });
    }
    applyPosTheme(localStorage.getItem(POS_THEME_KEY) || 'light');

    const btnThemePos = document.getElementById('btnThemePos');
    const themeDropPos = document.getElementById('themeDropdownPos');
    if (btnThemePos) {
        btnThemePos.addEventListener('click', (e) => {
            e.stopPropagation();
            themeDropPos.style.display = themeDropPos.style.display === 'none' ? 'block' : 'none';
        });
    }
    document.querySelectorAll('.theme-option-pos').forEach(btn => {
        btn.addEventListener('click', () => {
            applyPosTheme(btn.dataset.theme);
            if (themeDropPos) themeDropPos.style.display = 'none';
        });
    });
    document.addEventListener('click', (e) => {
        if (themeDropPos && themeDropPos.style.display !== 'none') {
            if (!themeDropPos.contains(e.target) && e.target !== btnThemePos) {
                themeDropPos.style.display = 'none';
            }
        }
    });

    // ==================== NAVEGACIÓN AL GESTOR ====================
    const btnGotoGestor = document.getElementById('btnGotoGestor');
    if (btnGotoGestor) {
        btnGotoGestor.addEventListener('click', function() {
            // Ensure session is shared
            if (currentUser) {
                localStorage.setItem('realphone_currentUser1', JSON.stringify(currentUser));
            }
            // Open Gestor in new tab or same window
            const gestorPath = '../gestor-tickets/index.html';
            window.open(gestorPath, '_blank');
        });
    }

    // ==================== VIDEOTUTORIAL CON VOZ ZEPHYR ====================
    const tutorialOverlay = document.getElementById('tutorialOverlay');
    const btnTutorial    = document.getElementById('btnTutorial');
    const btnCloseTut    = document.getElementById('btnCloseTutorial');
    const btnTutNext     = document.getElementById('btnTutNext');
    const btnTutPrev     = document.getElementById('btnTutPrev');
    const btnTutSpeak    = document.getElementById('btnTutSpeak');
    const btnTutStop     = document.getElementById('btnTutStop');
    const tutProgress    = document.getElementById('tutorialProgress');
    const voiceStatusEl  = document.getElementById('tutorialVoiceStatus');
    const voiceStatusTxt = document.getElementById('voiceStatusText');

    let tutStep = 0;
    let tutorialAudio = null;
    const TUTORIAL_STEPS = document.querySelectorAll('.tutorial-step');
    const TOTAL_STEPS = TUTORIAL_STEPS.length;

    function openTutorial() {
        tutStep = 0;
        if (tutorialOverlay) {
            tutorialOverlay.classList.add('active');
            tutorialOverlay.style.display = 'flex';
        }
        renderTutStep();
    }
    function closeTutorial() {
        if (tutorialOverlay) {
            tutorialOverlay.classList.remove('active');
            tutorialOverlay.style.display = 'none';
        }
        stopTutVoice();
    }
    function renderTutStep() {
        TUTORIAL_STEPS.forEach((s, i) => s.classList.toggle('active', i === tutStep));
        if (tutProgress) tutProgress.textContent = `Paso ${tutStep + 1} / ${TOTAL_STEPS}`;
        if (btnTutPrev) btnTutPrev.disabled = tutStep === 0;
        if (btnTutNext) btnTutNext.textContent = tutStep === TOTAL_STEPS - 1 ? 'Finalizar' : 'Siguiente ›';
        stopTutVoice();
        speakTutStep();
    }

    function getTutorialAudioFile(stepIndex) {
        const activeStep = TUTORIAL_STEPS[stepIndex];
        if (!activeStep) return null;
        const file = activeStep.dataset.audio || `audio ${stepIndex + 1}.mp3`;
        return `audios/${file}`;
    }

    function setVoiceStatus(text, speaking = false) {
        if (voiceStatusEl) voiceStatusEl.classList.toggle('speaking', speaking);
        if (voiceStatusTxt) voiceStatusTxt.textContent = text;
    }

    function speakTutStep() {
        const activeStep = TUTORIAL_STEPS[tutStep];
        if (!activeStep) return;
        const bodyEl = activeStep.querySelector('.tutorial-step-body');
        const text = bodyEl ? (bodyEl.innerText || bodyEl.textContent) : '';
        const audioFile = getTutorialAudioFile(tutStep);
        if (audioFile) {
            playTutorialAudio(audioFile, text);
        } else {
            speakTutStepTTS(text);
        }
    }

    function speakTutStepTTS(text) {
        if (!window.speechSynthesis) {
            setVoiceStatus('Voz no disponible', false);
            return;
        }
        const utt = new SpeechSynthesisUtterance(text);
        utt.lang = 'es-MX';
        utt.rate = 0.92;
        utt.pitch = 1.1;
        const voice = getZephyrVoice();
        if (voice) utt.voice = voice;
        utt.onstart = () => setVoiceStatus('Narrando con Zephyr...', true);
        utt.onend = () => setVoiceStatus('Voz lista', false);
        utt.onerror = () => setVoiceStatus('Error de voz', false);
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utt);
    }

    function playTutorialAudio(src, fallbackText) {
        stopTutVoice();
        tutorialAudio = new Audio(src);
        tutorialAudio.preload = 'auto';
        tutorialAudio.onplay = () => setVoiceStatus(`Reproduciendo ${src}`, true);
        tutorialAudio.onended = () => setVoiceStatus('Voz lista', false);
        tutorialAudio.onerror = () => {
            tutorialAudio = null;
            speakTutStepTTS(fallbackText);
        };
        tutorialAudio.play().catch(() => {
            tutorialAudio = null;
            speakTutStepTTS(fallbackText);
        });
    }

    function getZephyrVoice() {
        const voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
        return voices.find(v => v.name.toLowerCase().includes('zephyr')) ||
               voices.find(v => v.lang.startsWith('es') && v.name.toLowerCase().includes('fem')) ||
               voices.find(v => v.lang.startsWith('es')) ||
               voices[0];
    }

    function stopTutVoice() {
        if (window.speechSynthesis) window.speechSynthesis.cancel();
        if (tutorialAudio) {
            tutorialAudio.pause();
            tutorialAudio.currentTime = 0;
            tutorialAudio = null;
        }
        setVoiceStatus('Voz lista', false);
    }

    if (btnCloseTut) btnCloseTut.addEventListener('click', closeTutorial);
    if (btnTutNext) btnTutNext.addEventListener('click', () => {
        if (tutStep < TOTAL_STEPS - 1) { tutStep++; renderTutStep(); }
        else closeTutorial();
    });
    if (btnTutPrev) btnTutPrev.addEventListener('click', () => {
        if (tutStep > 0) { tutStep--; renderTutStep(); }
    });
    if (btnTutSpeak) btnTutSpeak.addEventListener('click', speakTutStep);
    if (btnTutStop)  btnTutStop.addEventListener('click', stopTutVoice);
    // Load voices async
    if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = function() {};

    // ==================== ATAJOS DE TECLADO ====================
    let shortcutPanelVisible = false;

    function toggleShortcutPanel() {
        shortcutPanelVisible = !shortcutPanelVisible;
        shortcutPanel.classList.toggle('visible', shortcutPanelVisible);
    }

    document.addEventListener('keydown', function (e) {
        // Permitir '?' incluso sin sesión para ver atajos
        if (e.key === '?' && !isTyping(e)) {
            e.preventDefault();
            toggleShortcutPanel();
            return;
        }

        // Cerrar modal/panel con Escape
        if (e.key === 'Escape') {
            const configModal = document.getElementById('configModal');
            if (configModal && configModal.style.display !== 'none') {
                configModal.style.display = 'none';
                e.preventDefault();
                return;
            }

            if (shortcutPanelVisible) {
                toggleShortcutPanel();
                e.preventDefault();
                return;
            }
        }

        if (!currentUser) return; // Solo si hay sesión activa

        // No interceptar atajos si el usuario está escribiendo en un input/textarea
        // EXCEPTO para las teclas de función
        const isFKey = /^F\d{1,2}$/.test(e.key);

        if (!isFKey && isTyping(e)) return;

        switch (e.key) {
            case 'F3':
                e.preventDefault();
                if (!isAdminOrTester()) { showToast('F3: Solo admin/tester puede registrar salidas', 'warning'); break; }
                handleStockExit();
                break;
            case 'F5':
                e.preventDefault();
                if (ticketItems.length > 0) {
                    const lastItem = ticketItems[ticketItems.length - 1];
                    const newQty = prompt('Cambiar cantidad de "' + lastItem.name + '":\nCantidad actual: ' + lastItem.qty, lastItem.qty);
                    if (newQty !== null) {
                        const q = parseInt(newQty);
                        if (!isNaN(q) && q > 0 && q <= lastItem.stock) {
                            lastItem.qty = q;
                            updateTicketDisplay();
                            showToast('Cantidad actualizada: ' + lastItem.name + ' → ' + q, 'success');
                        } else if (q <= 0) {
                            showToast('La cantidad debe ser mayor a 0', 'warning');
                        } else {
                            showToast('Stock insuficiente (máx: ' + lastItem.stock + ')', 'warning');
                        }
                    }
                } else {
                    showToast('No hay productos en el ticket para cambiar', 'warning');
                }
                break;
            case 'F6':
                e.preventDefault();
                document.getElementById('btnPendiente').click();
                break;
            case 'F7':
                e.preventDefault();
                if (!isAdminOrTester()) { showToast('F7: Solo admin/tester puede registrar entradas', 'warning'); break; }
                handleStockEntry();
                break;
            case 'F2':
                e.preventDefault();
                if (!isAdminOrTester()) { showToast('F2: Solo admin/tester puede agregar productos', 'warning'); break; }
                document.getElementById('btnAddProduct').click();
                break;
            case 'F8':
                e.preventDefault();
                openInventoryModal();
                break;
            case 'F9':
                e.preventDefault();
                handlePriceCheck();
                break;
            case 'F10':
                e.preventDefault();
                document.getElementById('btnBuscar').click();
                break;
            case 'F12':
                e.preventDefault();
                document.getElementById('btnCobrar').click();
                break;
            case 'Delete':
                if (!isTyping(e)) {
                    e.preventDefault();
                    document.getElementById('btnDeleteItem').click();
                }
                break;
        }

        // Ctrl+P: Artículo Común
        if (e.ctrlKey && e.key.toLowerCase() === 'p') {
            e.preventDefault();
            handleCommonProduct();
        }
    });

    // ==================== FUNCIONES DE ATAJOS ====================
    async function handleStockEntry() {
        const sku = prompt('🔹 Entrada de inventario\nIngresa el SKU del producto:');
        if (!sku) return;

        const product = products.find(p => p.sku.toLowerCase() === sku.toLowerCase());
        if (!product) {
            showToast('Producto no encontrado: ' + sku, 'error');
            return;
        }

        const qty = parseInt(prompt('Producto: ' + product.name + '\nStock actual: ' + product.stock + '\n\nCantidad a agregar:'));
        if (isNaN(qty) || qty <= 0) {
            showToast('Cantidad no válida', 'warning');
            return;
        }

        if (!isAdminOrTester()) {
            try {
                await db.collection("invRequests").add({
                    type: "entrada",
                    sku: product.sku,
                    name: product.name,
                    qty: qty,
                    requestedBy: currentUser.username,
                    status: "pending",
                    createdAt: new Date().toISOString()
                });
                showToast('Solicitud de entrada enviada a administradores', 'success');
            } catch (err) {
                console.error(err);
                showToast('Error al enviar solicitud', 'error');
            }
            return;
        }

        product.stock += qty;
        saveData();
        renderProducts(searchInput.value);
        showToast('✅ Entrada registrada: +' + qty + ' unidades de ' + product.name + ' (Stock: ' + product.stock + ')', 'success');
    }

    async function handleStockExit() {
        const sku = prompt('📤 Salida de inventario\nIngresa el SKU del producto:');
        if (!sku) return;

        const product = products.find(p => p.sku.toLowerCase() === sku.toLowerCase());
        if (!product) {
            showToast('Producto no encontrado: ' + sku, 'error');
            return;
        }

        const qty = parseInt(prompt('Producto: ' + product.name + '\nStock actual: ' + product.stock + '\n\nCantidad a retirar:'));
        if (isNaN(qty) || qty <= 0) {
            showToast('Cantidad no válida', 'warning');
            return;
        }

        if (qty > product.stock) {
            showToast('Stock insuficiente. Solo hay ' + product.stock + ' unidades.', 'warning');
            return;
        }

        if (!isAdminOrTester()) {
            try {
                await db.collection("invRequests").add({
                    type: "salida",
                    sku: product.sku,
                    name: product.name,
                    qty: qty,
                    requestedBy: currentUser.username,
                    status: "pending",
                    createdAt: new Date().toISOString()
                });
                showToast('Solicitud de salida enviada a administradores', 'success');
            } catch (err) {
                console.error(err);
                showToast('Error al enviar solicitud', 'error');
            }
            return;
        }

        product.stock -= qty;
        saveData();
        renderProducts(searchInput.value);
        showToast('📤 Salida registrada: -' + qty + ' unidades de ' + product.name + ' (Stock: ' + product.stock + ')', 'success');
    }

    function handlePriceCheck() {
        const sku = prompt('🔍 Verificador de Precios\nIngresa SKU o nombre del producto:');
        if (!sku) return;

        const product = products.find(p =>
            p.sku.toLowerCase() === sku.toLowerCase() ||
            p.name.toLowerCase().includes(sku.toLowerCase())
        );

        if (!product) {
            showToast('Producto no encontrado: ' + sku, 'error');
            return;
        }

        alert(
            '📋 VERIFICADOR DE PRECIOS\n' +
            '━━━━━━━━━━━━━━━━━━━━━━━━\n' +
            'SKU: ' + product.sku + '\n' +
            'Nombre: ' + product.name + '\n' +
            'Categoría: ' + product.category + '\n' +
            'Precio: ' + formatMoney(product.price) + '\n' +
            'Costo: ' + formatMoney(product.cost) + '\n' +
            'Margen: ' + formatMoney(product.price - product.cost) + '\n' +
            'Stock: ' + product.stock + ' unidades'
        );
    }

    function handleCommonProduct() {
        const name = prompt('🏷️ Artículo Común\nIngresa el nombre del producto:');
        if (!name) return;

        const price = parseFloat(prompt('Precio de venta:'));
        if (isNaN(price) || price <= 0) {
            showToast('Precio no válido', 'warning');
            return;
        }

        // Crear producto temporal y agregarlo al ticket
        const tempId = 'temp_' + Date.now();
        const tempProduct = {
            id:       tempId,
            sku:      'COMUN',
            name:     name,
            category: 'sin_categoria',
            cost:     0,
            price:    price,
            stock:    999
        };

        products.push(tempProduct);

        ticketItems.push({
            id:    tempId,
            sku:   'COMUN',
            name:  name,
            price: price,
            cost:  0,
            stock: 999,
            qty:   1
        });

        updateTicketDisplay();
        showToast('Artículo común agregado: ' + name, 'success');
    }

    // ==================== CONFIG & METAS ====================
    const configModal = document.getElementById('configModal');
    const welcomeModal = document.getElementById('welcomeModal');

    document.getElementById('btnConfig').addEventListener('click', () => {
        configModal.style.display = 'flex';
    });
    document.getElementById('btnCloseConfig').addEventListener('click', () => {
        configModal.style.display = 'none';
    });

    document.getElementById('btnMetas').addEventListener('click', () => {
        updateMetasUI();
        configModal.style.display = 'flex';
        // Switch to metas tab
        document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => { c.classList.remove('active'); c.style.display = 'none'; });
        const tabBtn = document.querySelector('.modal-tab[data-tab="metas"]');
        if (tabBtn) tabBtn.classList.add('active');
        const tabMetas = document.getElementById('tabMetas');
        if (tabMetas) { tabMetas.classList.add('active'); tabMetas.style.display = 'block'; }
    });

    // Enlaces de configuración
    document.getElementById('btnTutorialConfig').addEventListener('click', function () {
        configModal.style.display = 'none';
        openTutorial();
    });

    function updateMetasUI() {
        const txtWeekly = document.getElementById('txtWeekly');
        const barWeekly = document.getElementById('barWeekly');
        const txtMonthly = document.getElementById('txtMonthly');
        const barMonthly = document.getElementById('barMonthly');

        if (!phoneSales || !phoneSales.weekly || !phoneSales.monthly) {
            phoneSales = {
                weekly: { total: 0, users: {} },
                monthly: { total: 0, users: {} },
                lastWeeklyReset: Date.now(),
                lastMonthlyReset: Date.now()
            };
        }

        const weeklyTotal = phoneSales.weekly.total || 0;
        const monthlyTotal = phoneSales.monthly.total || 0;

        txtWeekly.textContent = `${weeklyTotal} / 15`;
        barWeekly.style.width = Math.min((weeklyTotal / 15) * 100, 100) + '%';
        
        txtMonthly.textContent = `${monthlyTotal} / 60`;
        barMonthly.style.width = Math.min((monthlyTotal / 60) * 100, 100) + '%';

        // Resumen usuarios
        const usersDiv = document.getElementById('metasUsers');
        usersDiv.innerHTML = '';
        for (const [uid, count] of Object.entries(phoneSales.weekly.users)) {
            const perc = ((count / weeklyTotal) * 100).toFixed(1);
            usersDiv.innerHTML += `<div><strong>${uid}</strong>: ${count} equipos (${isNaN(perc) ? 0 : perc}%)</div>`;
        }
    }

    // Bienvenida
    function checkWelcome() {
        if (!localStorage.getItem('realphone_welcomed')) {
            welcomeModal.style.display = 'flex';
        }
    }
    
    document.getElementById('btnWelcomeNo').addEventListener('click', () => {
        welcomeModal.style.display = 'none';
        localStorage.setItem('realphone_welcomed', 'true');
        showToast('Puedes acceder al tutorial desde la pestaña de "Configuración" si lo necesitas', 'info');
    });

    document.getElementById('btnWelcomeYes').addEventListener('click', () => {
        welcomeModal.style.display = 'none';
        localStorage.setItem('realphone_welcomed', 'true');
        openTutorial();
    });

    // Importación (Config)
    const excelFileConfig = document.getElementById('excelFileConfig');
    if (excelFileConfig) excelFileConfig.addEventListener('change', processExcelFile);
    
    // Ya no es necesario delegar los clics de Configuración porque los unificamos arriba
    /*
    document.getElementById('btnConfirmImportConfig').addEventListener('click', () => {
        document.getElementById('btnConfirmImport').click();
    });
    document.getElementById('btnCancelImportConfig').addEventListener('click', () => {
        document.getElementById('btnCancelImport').click();
    });

    // Exportar (Config)
    const btnExportConfig = document.getElementById('btnExportConfig');
    if (btnExportConfig) btnExportConfig.addEventListener('click', () => document.getElementById('btnExport').click());
    document.querySelectorAll('#configModal .export-option').forEach(opt => {
        opt.addEventListener('click', function () {
            document.querySelectorAll('#configModal .export-option').forEach(o => o.classList.remove('selected'));
            this.classList.add('selected');
            selectedExportType = this.dataset.type;
        });
    });
    */

    // ==================== INICIALIZACIÓN ====================
    loadData();
    console.log('Sistema RealPhone POS inicializado');
    console.log('Usuarios cargados:', users.length);
    console.log('Productos cargados:', products.length);
    console.log(
        'Usuarios disponibles:',
        users.map(u => ({ user: u.username, pass: u.password, role: u.role }))
    );

    renderCategories();
    renderProducts();
    updateTicketDisplay();
    checkWelcome();

})();
