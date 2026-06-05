/**
 * RealPhone POS — Punto de Venta Celulares y Tecnología
 * app.js — Lógica principal con atajos de teclado e inventario Excel
 */

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

    // ==================== PERSISTENCIA ====================
    const DATA_VERSION = '3.0'; // Cambiar para forzar reset de inventario

    function loadData() {
        try {
            const savedVersion = localStorage.getItem('realphone_version');
            if (savedVersion !== DATA_VERSION) {
                // Versión diferente → resetear a valores por defecto
                console.log('Datos actualizados a versión ' + DATA_VERSION + '. Reseteando inventario...');
                users        = structuredClone(defaultUsers);
                products     = structuredClone(defaultProducts);
                salesHistory = [];
                localStorage.setItem('realphone_version', DATA_VERSION);
                saveData();
                return;
            }
            users        = JSON.parse(localStorage.getItem('realphone_users'))    || structuredClone(defaultUsers);
            products     = JSON.parse(localStorage.getItem('realphone_products')) || structuredClone(defaultProducts);
            salesHistory = JSON.parse(localStorage.getItem('realphone_sales'))    || [];
        } catch (e) {
            console.error('Error cargando datos:', e);
            users        = structuredClone(defaultUsers);
            products     = structuredClone(defaultProducts);
            salesHistory = [];
        }
    }

    function saveData() {
        try {
            localStorage.setItem('realphone_users',    JSON.stringify(users));
            localStorage.setItem('realphone_products', JSON.stringify(products));
            localStorage.setItem('realphone_sales',    JSON.stringify(salesHistory));
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
    const inventoryModal     = document.getElementById('inventoryModal');
    const shortcutPanel      = document.getElementById('shortcutPanel');

    // ==================== AUTENTICACIÓN ====================
    document.getElementById('loginBtn').addEventListener('click', function () {
        const username = document.getElementById('loginUser').value.trim();
        const password = document.getElementById('loginPass').value.trim();

        if (!username || !password) {
            loginError.textContent = '⚠️ Ingresa usuario y contraseña';
            return;
        }

        const user = users.find(
            u => u.username.toLowerCase() === username.toLowerCase() && u.password === password
        );

        if (!user) {
            loginError.textContent = '❌ Usuario o contraseña incorrectos';
            return;
        }

        if (!user.active) {
            loginError.textContent = '⚠️ Usuario desactivado';
            return;
        }

        // Login exitoso
        currentUser   = user;
        currentBranch = user.branch;
        document.getElementById('branchSelect').value = currentBranch;
        currentUserDisplay.innerHTML =
            '<i class="fas fa-user"></i> Le atiende: ' + user.fullName;

        loginOverlay.classList.add('hidden');
        posContainer.style.display = 'flex';
        posContainer.style.paddingTop = '52px'; // Header height offset
        loginError.textContent = '';

        // Show header
        const posHdr = document.getElementById('posHeader');
        if (posHdr) {
            posHdr.style.display = 'flex';
            const uEl = document.getElementById('posHeaderUser');
            if (uEl) uEl.textContent = '| ' + user.fullName + ' [' + user.role + ']';
        }

        // Share session with Gestor de Tickets
        localStorage.setItem('realphone_currentUser1', JSON.stringify(user));

        // Apply permissions UI
        applyPermissionsUI();

        showToast('Bienvenido, ' + user.fullName, 'success');
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

    // Cambio de sucursal (solo tester)
    document.getElementById('branchSelect').addEventListener('change', function (e) {
        if (currentUser && currentUser.role === 'tester') {
            currentBranch = e.target.value;
            showToast('Sucursal cambiada: ' + currentBranch, 'info');
        } else if (currentUser) {
            e.target.value = currentBranch;
            showToast('Solo el Tester puede cambiar la sucursal asignada', 'warning');
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
            cashier: currentUser ? currentUser.fullName : 'N/A',
            items:   ticketItems.map(i => ({ ...i })),
            total:   total,
            profit:  ticketItems.reduce((s, i) => s + ((i.price - i.cost) * i.qty), 0),
            payment: pago,
            change:  pago - total
        };
        salesHistory.push(sale);
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
    document.getElementById('categoryTabs').addEventListener('click', function (e) {
        if (e.target.classList.contains('category-tab')) {
            document.querySelectorAll('.category-tab').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            activeCategory = e.target.dataset.cat;
            renderProducts(searchInput.value);
        }
    });

    // ==================== MODAL DE INVENTARIO ====================
    function openInventoryModal() {
        if (!isAdminOrTester()) {
            showToast('Solo administradores o testers pueden abrir el inventario', 'warning');
            return;
        }
        inventoryModal.classList.add('active');
        resetImportState();
    }

    function closeInventoryModal() {
        inventoryModal.classList.remove('active');
        resetImportState();
    }

    function resetImportState() {
        pendingImportData = [];
        const preview = document.getElementById('importPreview');
        const actions = document.getElementById('importActions');
        const status  = document.getElementById('importStatus');
        if (preview) { preview.style.display = 'none'; preview.innerHTML = ''; }
        if (actions) actions.style.display = 'none';
        if (status) status.innerHTML = '';
    }

    document.getElementById('btnInventario').addEventListener('click', openInventoryModal);
    document.getElementById('btnAddProduct').addEventListener('click', function() {
        if (!isAdminOrTester()) { showToast('Solo administradores o testers pueden agregar productos', 'warning'); return; }
        openInventoryModal();
        document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        document.querySelector('.modal-tab[data-tab="add"]').classList.add('active');
        document.getElementById('tabAdd').classList.add('active');
        setTimeout(() => document.getElementById('addSku').focus(), 100);
    });
    document.getElementById('btnCloseInventory').addEventListener('click', closeInventoryModal);
    inventoryModal.addEventListener('click', function (e) {
        if (e.target === inventoryModal) closeInventoryModal();
    });

    // ==================== INVENTORY REQUEST MODAL ====================
    function openInvRequestModal() {
        const overlay = document.getElementById('invRequestOverlay');
        if (!overlay) return;
        const pendingPanel = document.getElementById('pendingInvRequests');
        if (pendingPanel) pendingPanel.style.display = isAdminOrTester() ? '' : 'none';
        if (isAdminOrTester()) renderPendingRequests();
        overlay.style.display = 'flex';
        overlay.style.flexDirection = 'column';
        overlay.style.alignItems = 'center';
        overlay.style.justifyContent = 'center';
    }
    function closeInvRequestModal() {
        const overlay = document.getElementById('invRequestOverlay');
        if (overlay) overlay.style.display = 'none';
    }
    const btnCloseInvReq = document.getElementById('btnCloseInvRequest');
    if (btnCloseInvReq) btnCloseInvReq.addEventListener('click', closeInvRequestModal);
    const btnCancelInvReq = document.getElementById('btnCancelInvReq');
    if (btnCancelInvReq) btnCancelInvReq.addEventListener('click', closeInvRequestModal);

    const btnSubmitInvReq = document.getElementById('btnSubmitInvReq');
    if (btnSubmitInvReq) btnSubmitInvReq.addEventListener('click', function() {
        const type = document.getElementById('invReqType').value;
        const sku  = document.getElementById('invReqSku').value.trim();
        const qty  = parseInt(document.getElementById('invReqQty').value) || 0;
        const note = document.getElementById('invReqNote').value.trim();
        if (!sku || qty <= 0) { showToast('Completa SKU y cantidad', 'warning'); return; }
        const req = {
            id: 'req-' + Date.now(),
            type, sku, qty, note,
            requestedBy: currentUser ? currentUser.fullName : 'Cliente',
            requestedAt: new Date().toLocaleString(),
            status: 'pendiente'
        };
        const requests = JSON.parse(localStorage.getItem('realphone_inv_requests') || '[]');
        requests.push(req);
        localStorage.setItem('realphone_inv_requests', JSON.stringify(requests));
        showToast('Solicitud enviada. Un administrador la revisará pronto.', 'success');
        closeInvRequestModal();
    });

    function renderPendingRequests() {
        const list = document.getElementById('invRequestList');
        if (!list) return;
        const requests = JSON.parse(localStorage.getItem('realphone_inv_requests') || '[]');
        const pending = requests.filter(r => r.status === 'pendiente');
        if (pending.length === 0) {
            list.innerHTML = '<div style="text-align:center; color:var(--text-secondary); padding:1rem; font-size:0.85rem;">No hay solicitudes pendientes</div>';
            return;
        }
        list.innerHTML = pending.map(r => `
            <div class="inv-request-item">
                <div>
                    <span class="req-type-badge ${r.type}">${r.type.toUpperCase()}</span>
                    <strong style="margin-left:6px;">${r.sku}</strong> — ${r.qty} uds.
                    <div style="font-size:0.75rem; color:var(--text-secondary); margin-top:2px;">${r.requestedBy} — ${r.requestedAt}${r.note ? ' — ' + r.note : ''}</div>
                </div>
                <div style="display:flex; gap:6px;">
                    <button class="action-btn" style="font-size:0.75rem; padding:5px 10px; color:var(--success); border-color:rgba(16,185,129,0.3);" onclick="window.approveInvRequest('${r.id}')"><i class="fas fa-check"></i></button>
                    <button class="action-btn danger" style="font-size:0.75rem; padding:5px 10px;" onclick="window.rejectInvRequest('${r.id}')"><i class="fas fa-times"></i></button>
                </div>
            </div>
        `).join('');
    }

    window.approveInvRequest = function(reqId) {
        if (!isAdminOrTester()) return;
        const requests = JSON.parse(localStorage.getItem('realphone_inv_requests') || '[]');
        const req = requests.find(r => r.id === reqId);
        if (!req) return;
        const prod = products.find(p => p.sku.toLowerCase() === req.sku.toLowerCase());
        if (!prod) { showToast('Producto no encontrado: ' + req.sku, 'error'); return; }
        if (req.type === 'entrada') prod.stock += req.qty;
        else prod.stock = Math.max(0, prod.stock - req.qty);
        saveData();
        req.status = 'aprobado';
        localStorage.setItem('realphone_inv_requests', JSON.stringify(requests));
        renderProducts(searchInput.value);
        renderPendingRequests();
        showToast('Solicitud aprobada: ' + req.type + ' de ' + req.qty + ' uds. de ' + req.sku, 'success');
    };

    window.rejectInvRequest = function(reqId) {
        if (!isAdminOrTester()) return;
        const requests = JSON.parse(localStorage.getItem('realphone_inv_requests') || '[]');
        const req = requests.find(r => r.id === reqId);
        if (!req) return;
        req.status = 'rechazado';
        localStorage.setItem('realphone_inv_requests', JSON.stringify(requests));
        renderPendingRequests();
        showToast('Solicitud rechazada', 'info');
    };

    // Tabs del modal
    document.querySelectorAll('.modal-tab').forEach(tab => {
        tab.addEventListener('click', function () {
            document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            this.classList.add('active');
            const tabMap = { add: 'tabAdd', import: 'tabImport', export: 'tabExport' };
            const tabId = tabMap[this.dataset.tab] || 'tabAdd';
            document.getElementById(tabId).classList.add('active');
        });
    });

    // ==================== AGREGAR PRODUCTO (FORMULARIO) ====================
    document.getElementById('addProductForm').addEventListener('submit', function (e) {
        e.preventDefault();
        if (!isAdminOrTester()) { showToast('Sin permisos para agregar productos', 'warning'); return; }

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

    // ==================== IMPORTACIÓN DE EXCEL ====================
    const dropZone  = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');

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

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) processExcelFile(e.target.files[0]);
        fileInput.value = ''; // Reset para permitir seleccionar el mismo archivo
    });

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

        const statusEl = document.getElementById('importStatus');
        statusEl.innerHTML = '<span class="status-badge warning"><i class="fas fa-spinner fa-spin"></i> Procesando archivo...</span>';

        const reader = new FileReader();
        reader.onload = function (e) {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });

                // Leer la primera hoja
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                const jsonData  = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

                if (jsonData.length === 0) {
                    statusEl.innerHTML = '<span class="status-badge error"><i class="fas fa-exclamation-circle"></i> El archivo está vacío</span>';
                    return;
                }

                // Mapear columnas (flexible)
                const mapped = mapImportData(jsonData);

                if (mapped.length === 0) {
                    statusEl.innerHTML = '<span class="status-badge error"><i class="fas fa-exclamation-circle"></i> No se encontraron columnas válidas (SKU, Nombre, Precio)</span>';
                    return;
                }

                pendingImportData = mapped;
                statusEl.innerHTML = `<span class="status-badge success"><i class="fas fa-check-circle"></i> ${mapped.length} productos leídos de "${file.name}"</span>`;

                // Mostrar preview
                renderImportPreview(mapped);
                document.getElementById('importActions').style.display = 'flex';

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
        // Mapeo flexible de columnas — soporta varios nombres
        const colMap = {
            sku:      ['sku', 'codigo', 'código', 'code', 'cod', 'clave'],
            name:     ['nombre', 'name', 'descripcion', 'descripción', 'producto', 'articulo', 'artículo'],
            category: ['categoria', 'categoría', 'category', 'cat', 'tipo'],
            cost:     ['costo', 'cost', 'precio_costo', 'costo_unitario'],
            price:    ['precio', 'price', 'precio_venta', 'pvp', 'precio_unitario'],
            stock:    ['stock', 'existencia', 'existencias', 'cantidad', 'qty', 'inventario', 'disponible']
        };

        function findCol(row, aliases) {
            const keys = Object.keys(row);
            for (const alias of aliases) {
                const found = keys.find(k => k.toLowerCase().trim() === alias);
                if (found) return row[found];
            }
            return undefined;
        }

        return jsonData
            .map(row => {
                const sku   = String(findCol(row, colMap.sku)  || '').trim();
                const name  = String(findCol(row, colMap.name) || '').trim();
                const cat   = String(findCol(row, colMap.category) || 'sin_categoria').trim().toLowerCase().replace(/\s+/g, '_');
                const cost  = parseFloat(findCol(row, colMap.cost))  || 0;
                const price = parseFloat(findCol(row, colMap.price)) || 0;
                const stock = parseInt(findCol(row, colMap.stock))   || 0;

                if (!sku && !name) return null; // Fila vacía

                return {
                    sku:      sku || 'SIN-SKU',
                    name:     name || 'Producto sin nombre',
                    category: cat,
                    cost:     cost,
                    price:    price,
                    stock:    stock
                };
            })
            .filter(Boolean);
    }

    function renderImportPreview(data) {
        const previewEl = document.getElementById('importPreview');
        previewEl.style.display = 'block';

        let html = `<table>
            <thead>
                <tr>
                    <th>#</th>
                    <th>SKU</th>
                    <th>Nombre</th>
                    <th>Categoría</th>
                    <th>Costo</th>
                    <th>Precio</th>
                    <th>Stock</th>
                    <th>Estado</th>
                </tr>
            </thead>
            <tbody>`;

        data.forEach((item, idx) => {
            const existing = products.find(p => p.sku.toLowerCase() === item.sku.toLowerCase());
            const status = existing
                ? '<span class="status-badge warning"><i class="fas fa-sync"></i> Actualizar</span>'
                : '<span class="status-badge success"><i class="fas fa-plus"></i> Nuevo</span>';

            html += `<tr>
                <td>${idx + 1}</td>
                <td>${item.sku}</td>
                <td>${item.name}</td>
                <td>${item.category}</td>
                <td>${formatMoney(item.cost)}</td>
                <td>${formatMoney(item.price)}</td>
                <td>${item.stock}</td>
                <td>${status}</td>
            </tr>`;
        });

        html += '</tbody></table>';
        previewEl.innerHTML = html;
    }

    // Confirmar importación
    document.getElementById('btnConfirmImport').addEventListener('click', function () {
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
    document.getElementById('btnCancelImport').addEventListener('click', resetImportState);

    // ==================== EXPORTACIÓN DE EXCEL ====================
    // Selección de tipo de exportación
    document.querySelectorAll('.export-option').forEach(opt => {
        opt.addEventListener('click', function () {
            document.querySelectorAll('.export-option').forEach(o => o.classList.remove('selected'));
            this.classList.add('selected');
            selectedExportType = this.dataset.type;
        });
    });

    document.getElementById('btnExport').addEventListener('click', function () {
        if (typeof XLSX === 'undefined') {
            showToast('Error: Librería SheetJS no cargada', 'error');
            return;
        }

        let wsData = [];
        const now = new Date();
        const dateStr = now.toISOString().slice(0, 10);

        switch (selectedExportType) {
            case 'full':
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
                wsData = products.map((p, idx) => ({
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
                full:     'Inventario_Completo',
                stock:    'Stock',
                template: 'Plantilla'
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
    const TUTORIAL_STEPS = document.querySelectorAll('.tutorial-step');
    const TOTAL_STEPS = TUTORIAL_STEPS.length;

    function openTutorial() {
        tutStep = 0;
        tutorialOverlay.classList.add('active');
        renderTutStep();
    }
    function closeTutorial() {
        tutorialOverlay.classList.remove('active');
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

    function getZephyrVoice() {
        const voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
        // Try to find Zephyr or best Spanish voice
        return voices.find(v => v.name.toLowerCase().includes('zephyr')) ||
               voices.find(v => v.lang.startsWith('es') && v.name.toLowerCase().includes('fem')) ||
               voices.find(v => v.lang.startsWith('es')) ||
               voices[0];
    }

    function speakTutStep() {
        if (!window.speechSynthesis) return;
        const activeStep = TUTORIAL_STEPS[tutStep];
        if (!activeStep) return;
        const bodyEl = activeStep.querySelector('.tutorial-step-body');
        if (!bodyEl) return;
        const text = bodyEl.innerText || bodyEl.textContent;
        const utt = new SpeechSynthesisUtterance(text);
        utt.lang = 'es-MX';
        utt.rate = 0.92;
        utt.pitch = 1.1;
        const voice = getZephyrVoice();
        if (voice) utt.voice = voice;
        utt.onstart = () => {
            if (voiceStatusEl) voiceStatusEl.classList.add('speaking');
            if (voiceStatusTxt) voiceStatusTxt.textContent = 'Narrando con Zephyr...';
        };
        utt.onend = () => {
            if (voiceStatusEl) voiceStatusEl.classList.remove('speaking');
            if (voiceStatusTxt) voiceStatusTxt.textContent = 'Voz lista';
        };
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utt);
    }

    function stopTutVoice() {
        if (window.speechSynthesis) window.speechSynthesis.cancel();
        if (voiceStatusEl) voiceStatusEl.classList.remove('speaking');
        if (voiceStatusTxt) voiceStatusTxt.textContent = 'Voz lista';
    }

    if (btnTutorial) btnTutorial.addEventListener('click', openTutorial);
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
            if (inventoryModal.classList.contains('active')) {
                closeInventoryModal();
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

    function isTyping(e) {
        const tag = (e.target || e.srcElement).tagName;
        return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    }

    // ==================== FUNCIONES DE ATAJOS ====================
    function handleStockEntry() {
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

        product.stock += qty;
        saveData();
        renderProducts(searchInput.value);
        showToast('✅ Entrada registrada: +' + qty + ' unidades de ' + product.name + ' (Stock: ' + product.stock + ')', 'success');
    }

    function handleStockExit() {
        if (!isAdminOrTester()) { showToast('Sin permisos para registrar salidas', 'warning'); return; }
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

    // ==================== INICIALIZACIÓN ====================
    loadData();
    console.log('Sistema RealPhone POS inicializado');
    console.log('Usuarios cargados:', users.length);
    console.log('Productos cargados:', products.length);
    console.log(
        'Usuarios disponibles:',
        users.map(u => ({ user: u.username, pass: u.password, role: u.role }))
    );

    renderProducts();
    updateTicketDisplay();

})();
