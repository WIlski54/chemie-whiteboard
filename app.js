// API Configuration
const API_URL = 'https://chemie-whiteboard-backend.onrender.com/api';

// Session Data
let sessionData = {
    roomId: null,
    userId: null,
    username: null,
    isCreator: false,
    userColor: null
};

let websocket = null;
let isWebSocketConnected = false;
let adminPassword = null;
let activeUsers = [];
let userActivityTimeout = {};

// Tab Switching
function switchTab(tab) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    
    if (tab === 'create') {
        document.querySelectorAll('.tab')[0].classList.add('active');
        document.getElementById('createTab').classList.add('active');
    } else if (tab === 'join') {
        document.querySelectorAll('.tab')[1].classList.add('active');
        document.getElementById('joinTab').classList.add('active');
    } else if (tab === 'admin') {
        document.querySelectorAll('.tab')[2].classList.add('active');
        document.getElementById('adminTab').classList.add('active');
    }
}

// Update Sync Indicator
function updateSyncIndicator(connected) {
    const syncDot = document.getElementById('syncDot');
    const syncStatus = document.getElementById('syncStatus');
    
    if (connected) {
        syncDot.classList.remove('disconnected');
        syncStatus.textContent = 'Synchronisiert';
    } else {
        syncDot.classList.add('disconnected');
        syncStatus.textContent = 'Getrennt';
    }
}

// Create Room
async function createRoom(event) {
    event.preventDefault();
    const username = document.getElementById('createName').value;
    const roomName = document.getElementById('roomName').value;
    
    console.log('🔨 Erstelle Raum:', roomName);
    
    try {
        const response = await fetch(`${API_URL}/room/create`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ room_name: roomName })
        });
        const data = await response.json();
        
        console.log('✅ Raum erstellt:', data);
        
        if (data.success) {
            sessionData.roomId = data.room_id;
            sessionData.username = username;
            sessionData.isCreator = true;
            
            await joinCreatedRoom(data.room_id, username);
            alert(`Raum erstellt! Raum-ID: ${data.room_id}\n\nGib diese ID an deine Schüler weiter.`);
        } else {
            alert('Fehler beim Erstellen des Raums.');
        }
    } catch (error) {
        console.error('❌ Fehler beim Erstellen:', error);
        alert('Verbindungsfehler. Überprüfe deine Internetverbindung.');
    }
}

async function joinCreatedRoom(roomId, username) {
    try {
        console.log('👤 Trete erstelltem Raum bei:', roomId);
        const response = await fetch(`${API_URL}/room/join`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                room_id: roomId,
                username: username
            })
        });
        const data = await response.json();
        console.log('✅ Join Response:', data);
        
        if (data.success) {
            sessionData.userId = data.user_id;
            sessionData.userColor = data.user_color || '#2563eb';
            startWhiteboard();
        }
    } catch (error) {
        console.error('❌ Fehler beim Beitreten:', error);
    }
}

// Join Room
async function joinRoom(event) {
    event.preventDefault();
    const username = document.getElementById('joinName').value;
    const roomId = document.getElementById('roomId').value;
    
    console.log('🚪 Trete Raum bei:', roomId, 'als', username);
    
    try {
        const response = await fetch(`${API_URL}/room/join`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                room_id: roomId,
                username: username
            })
        });
        const data = await response.json();
        
        console.log('✅ Join Response:', data);
        
        if (data.success) {
            sessionData.roomId = roomId;
            sessionData.userId = data.user_id;
            sessionData.username = username;
            sessionData.isCreator = false;
            sessionData.userColor = data.user_color || '#2563eb';
            
            if (data.room_state) {
                console.log('🔥 Lade initialen Raum-State:', data.room_state);
                app.state.placedItems = data.room_state.items || [];
                app.state.connections = data.room_state.connections || [];
            }
            startWhiteboard();
        } else {
            alert(data.error || 'Fehler beim Beitreten.');
        }
    } catch (error) {
        console.error('❌ Fehler:', error);
        alert('Raum nicht gefunden oder Verbindungsfehler.');
    }
}

// Start Whiteboard
function startWhiteboard() {
    console.log('🎨 Starte Whiteboard für Raum:', sessionData.roomId);
    
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('app').classList.add('active');
    
    document.getElementById('roomInfoDisplay').textContent = 
        `Raum: ${sessionData.roomId} | ${sessionData.username}`;
    
    app.init();
    app.render();
    app.updateUI();
    
    startWebSocketConnection();
    renderUsersList();
}

function startWebSocketConnection() {
    const ws_url = `wss://chemie-whiteboard-backend.onrender.com/ws/${sessionData.roomId}`;
    console.log('🔌 Verbinde WebSocket:', ws_url);
    
    updateSyncIndicator(false);
    websocket = new WebSocket(ws_url);

    websocket.onopen = (event) => {
        console.log("✅ WebSocket-Verbindung erfolgreich hergestellt!");
        isWebSocketConnected = true;
        updateSyncIndicator(true);
        
        websocket.send(JSON.stringify({
            type: 'join',
            username: sessionData.username,
            user_id: sessionData.userId,
            color: sessionData.userColor
        }));
    };

    websocket.onmessage = (event) => {
        console.log("📨 Empfange Update:", event.data.substring(0, 100) + '...');
        
        try {
            const msg = JSON.parse(event.data);
            
            if (msg.type === 'users_list') {
                activeUsers = msg.users || [];
                renderUsersList();
            } else if (msg.type === 'user_joined') {
                console.log('👋 User beigetreten:', msg.user.username);
                activeUsers.push(msg.user);
                renderUsersList();
                showNotification(`${msg.user.username} ist beigetreten`, msg.user.color);
            } else if (msg.type === 'user_left') {
                activeUsers = activeUsers.filter(u => u.user_id !== msg.user_id);
                renderUsersList();
            } else if (msg.type === 'state_update') {
                if (msg.state.items !== undefined && msg.state.connections !== undefined) {
                    console.log('✅ State aktualisiert:', {
                        items: msg.state.items.length,
                        connections: msg.state.connections.length
                    });
                    app.state.placedItems = msg.state.items;
                    app.state.connections = msg.state.connections;
                    app.render();
                    app.updateUI();
                }
            } else if (msg.type === 'activity') {
                showActivityBadge(msg);
            }
        } catch (e) {
            console.error('❌ Fehler beim Parsen:', e);
        }
    };

    websocket.onclose = (event) => {
        console.log("❌ WebSocket-Verbindung geschlossen.", 
            "Code:", event.code, 
            "Reason:", event.reason);
        isWebSocketConnected = false;
        updateSyncIndicator(false);
        activeUsers = [];
        renderUsersList();
        
        if (sessionData.roomId) {
            console.log('🔄 Versuche Reconnect in 3 Sekunden...');
            setTimeout(() => {
                console.log('🔄 Reconnect...');
                startWebSocketConnection();
                renderUsersList();
            }, 3000);
        }
    };

    websocket.onerror = (error) => {
        console.error("⚠️ WebSocket-Fehler:", error);
        isWebSocketConnected = false;
        updateSyncIndicator(false);
    };
}

function sendUpdate() {
    console.log('📤 Versuche Update zu senden...', {
        hasRoomId: !!sessionData.roomId,
        hasWebSocket: !!websocket,
        wsReadyState: websocket?.readyState,
        isConnected: isWebSocketConnected
    });
    
    if (!sessionData.roomId || !websocket || websocket.readyState !== WebSocket.OPEN) {
        console.warn('⚠️ Update NICHT gesendet! Verbindung nicht bereit.');
        return;
    }
    
    const payload = {
        type: 'state_update',
        state: {
            items: app.state.placedItems,
            connections: app.state.connections
        }
    };

    console.log('✉️ Sende State Update');
    
    try {
        websocket.send(JSON.stringify(payload));
        console.log('✅ Update erfolgreich gesendet');
    } catch (e) {
        console.error('❌ Fehler beim Senden:', e);
    }
}

function sendActivity(action, itemType) {
    if (!websocket || websocket.readyState !== WebSocket.OPEN) return;
    
    const activity = {
        type: 'activity',
        user_id: sessionData.userId,
        username: sessionData.username,
        color: sessionData.userColor,
        action: action,
        item_type: itemType,
        timestamp: Date.now()
    };
    
    try {
        websocket.send(JSON.stringify(activity));
    } catch (e) {
        console.error('❌ Fehler beim Senden der Aktivität:', e);
    }
}

function renderUsersList() {
    const usersList = document.getElementById('usersList');
    const userCount = document.getElementById('userCount');
    
    const selfExists = activeUsers.some(u => u.user_id === sessionData.userId);
    let allUsers = [...activeUsers];
    if (!selfExists && sessionData.userId) {
        allUsers.unshift({
            user_id: sessionData.userId,
            username: sessionData.username,
            color: sessionData.userColor,
            isSelf: true
        });
    }
    
    userCount.textContent = allUsers.length;
    
    if (allUsers.length === 0) {
        usersList.innerHTML = '<div style="text-align: center; color: #9ca3af; padding: 1rem;">Keine Nutzer online</div>';
        return;
    }
    
    usersList.innerHTML = allUsers.map(user => {
        const isActive = userActivityTimeout[user.user_id];
        const initials = user.username.substring(0, 2).toUpperCase();
        
        return `
            <div class="user-item ${isActive ? 'active' : ''}">
                <div class="user-avatar" style="background-color: ${user.color};">
                    ${initials}
                </div>
                <div class="user-info">
                    <div class="user-name">
                        ${user.username}${user.isSelf ? ' (Du)' : ''}
                    </div>
                    <div class="user-status">
                        ${isActive ? '🖱️ Aktiv' : '💤 Ruhig'}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function showNotification(message, color) {
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 5rem;
        right: 2rem;
        background: ${color};
        color: white;
        padding: 1rem 1.5rem;
        border-radius: 0.5rem;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        font-weight: 500;
        z-index: 1000;
        animation: slideIn 0.3s;
    `;
    notification.textContent = message;
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

function showActivityBadge(activity) {
    const badge = document.createElement('div');
    badge.className = 'activity-badge';
    badge.style.borderColor = activity.color;
    badge.style.color = activity.color;
    badge.textContent = `${activity.username}: ${activity.action}`;
    
    badge.style.top = '6rem';
    badge.style.left = '50%';
    badge.style.transform = 'translateX(-50%)';
    
    document.getElementById('activityBadges').appendChild(badge);
    
    userActivityTimeout[activity.user_id] = true;
    renderUsersList();
    
    setTimeout(() => {
        badge.style.animation = 'fadeOut 0.3s';
        setTimeout(() => badge.remove(), 300);
    }, 2000);
    
    setTimeout(() => {
        delete userActivityTimeout[activity.user_id];
        renderUsersList();
    }, 5000);
}

function showRoomInfo() {
    alert(`Raum-ID: ${sessionData.roomId}\nDein Name: ${sessionData.username}\n\nTeile die Raum-ID mit anderen!`);
}

// --- ADMIN-FUNKTIONEN ---

async function adminLogin(event) {
    event.preventDefault();
    const password = document.getElementById('adminPassword').value;
    
    console.log('🔒 Admin-Login Versuch');
    
    try {
        const response = await fetch(`${API_URL}/admin/login`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ password: password })
        });
        const data = await response.json();
        
        if (data.success) {
            console.log('✅ Admin erfolgreich eingeloggt');
            adminPassword = password;
            showAdminDashboard();
        } else {
            alert('Falsches Passwort!');
        }
    } catch (error) {
        console.error('❌ Admin-Login Fehler:', error);
        alert('Verbindungsfehler beim Login.');
    }
}

function showAdminDashboard() {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('adminApp').style.display = 'flex';
    refreshAdminData();
    
    setInterval(refreshAdminData, 5000);
}

async function refreshAdminData() {
    if (!adminPassword) return;
    
    try {
        const response = await fetch(`${API_URL}/admin/overview?password=${encodeURIComponent(adminPassword)}`);
        const data = await response.json();
        
        console.log('📊 Admin-Daten geladen:', data);
        
        displayAdminStats(data.rooms);
        displayAdminRooms(data.rooms);
    } catch (error) {
        console.error('❌ Fehler beim Laden der Admin-Daten:', error);
    }
}

function displayAdminStats(rooms) {
    const totalRooms = rooms.length;
    const totalConnections = rooms.reduce((sum, r) => sum + r.active_connections, 0);
    const totalUsers = rooms.reduce((sum, r) => sum + r.total_users, 0);
    const lockedRooms = rooms.filter(r => r.locked).length;
    
    document.getElementById('adminStats').innerHTML = `
        <div style="background: white; padding: 1.5rem; border-radius: 0.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
            <div style="font-size: 2rem; font-weight: bold; color: #2563eb;">${totalRooms}</div>
            <div style="color: #6b7280; margin-top: 0.5rem;">Aktive Räume</div>
        </div>
        <div style="background: white; padding: 1.5rem; border-radius: 0.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
            <div style="font-size: 2rem; font-weight: bold; color: #22c55e;">${totalConnections}</div>
            <div style="color: #6b7280; margin-top: 0.5rem;">Live-Verbindungen</div>
        </div>
        <div style="background: white; padding: 1.5rem; border-radius: 0.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
            <div style="font-size: 2rem; font-weight: bold; color: #a855f7;">${totalUsers}</div>
            <div style="color: #6b7280; margin-top: 0.5rem;">Nutzer (gesamt)</div>
        </div>
        <div style="background: white; padding: 1.5rem; border-radius: 0.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
            <div style="font-size: 2rem; font-weight: bold; color: #ef4444;">${lockedRooms}</div>
            <div style="color: #6b7280; margin-top: 0.5rem;">Gesperrte Räume</div>
        </div>
    `;
}

function displayAdminRooms(rooms) {
    if (rooms.length === 0) {
        document.getElementById('adminRoomsList').innerHTML = `
            <div style="text-align: center; padding: 3rem; color: #9ca3af;">
                <div style="font-size: 3rem; margin-bottom: 1rem;">🔭</div>
                <div>Keine aktiven Räume vorhanden</div>
            </div>
        `;
        return;
    }
    
    document.getElementById('adminRoomsList').innerHTML = rooms.map(room => {
        const createdDate = new Date(room.created_at).toLocaleString('de-DE');
        
        return `
            <div style="border: 2px solid ${room.locked ? '#ef4444' : '#e5e7eb'}; border-radius: 0.5rem; padding: 1rem; margin-bottom: 1rem; background: ${room.locked ? '#fef2f2' : 'white'};">
                <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 1rem;">
                    <div style="flex: 1;">
                        <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem;">
                            <h3 style="font-size: 1.125rem; font-weight: bold; color: #1f2937;">${room.name}</h3>
                            ${room.locked ? '<span style="background: #ef4444; color: white; padding: 0.25rem 0.5rem; border-radius: 0.25rem; font-size: 0.75rem; font-weight: bold;">🔒 GESPERRT</span>' : ''}
                        </div>
                        <div style="font-family: monospace; color: #6b7280; font-size: 0.875rem;">ID: ${room.room_id}</div>
                        <div style="color: #6b7280; font-size: 0.875rem; margin-top: 0.25rem;">Erstellt: ${createdDate}</div>
                        <div style="color: #6b7280; font-size: 0.875rem;">Ersteller: ${room.creator || 'Unbekannt'}</div>
                    </div>
                    <div style="text-align: right;">
                        <div style="display: inline-block; background: #eff6ff; color: #2563eb; padding: 0.5rem 1rem; border-radius: 0.5rem; margin-bottom: 0.5rem;">
                            <div style="font-size: 1.5rem; font-weight: bold;">${room.active_connections}</div>
                            <div style="font-size: 0.75rem;">Live</div>
                        </div>
                    </div>
                </div>
                
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 0.75rem; margin-bottom: 1rem; padding: 0.75rem; background: #f9fafb; border-radius: 0.5rem;">
                    <div>
                        <div style="color: #6b7280; font-size: 0.75rem;">Nutzer gesamt</div>
                        <div style="font-weight: bold; color: #1f2937;">${room.total_users}</div>
                    </div>
                    <div>
                        <div style="color: #6b7280; font-size: 0.75rem;">Geräte</div>
                        <div style="font-weight: bold; color: #1f2937;">${room.items_count}</div>
                    </div>
                    <div>
                        <div style="color: #6b7280; font-size: 0.75rem;">Verbindungen</div>
                        <div style="font-weight: bold; color: #1f2937;">${room.connections_count}</div>
                    </div>
                </div>
                
                ${room.users.length > 0 ? `
                    <details style="margin-bottom: 1rem;">
                        <summary style="cursor: pointer; color: #2563eb; font-weight: 500; padding: 0.5rem;">
                            👥 ${room.users.length} Nutzer anzeigen
                        </summary>
                        <div style="margin-top: 0.5rem; padding: 0.75rem; background: #f9fafb; border-radius: 0.5rem;">
                            ${room.users.map(user => `
                                <div style="padding: 0.5rem 0; border-bottom: 1px solid #e5e7eb;">
                                    <strong>${user.username}</strong>
                                    <span style="color: #6b7280; font-size: 0.875rem; margin-left: 0.5rem;">
                                        ${new Date(user.joined_at).toLocaleString('de-DE')}
                                    </span>
                                </div>
                            `).join('')}
                        </div>
                    </details>
                ` : ''}
                
                <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
                    ${room.locked ? `
                        <button onclick="unlockRoom('${room.room_id}')" 
                                style="padding: 0.5rem 1rem; background: #22c55e; color: white; border: none; border-radius: 0.5rem; cursor: pointer; font-weight: 500;">
                            🔓 Entsperren
                        </button>
                    ` : `
                        <button onclick="lockRoom('${room.room_id}')" 
                                style="padding: 0.5rem 1rem; background: #f97316; color: white; border: none; border-radius: 0.5rem; cursor: pointer; font-weight: 500;">
                            🔒 Sperren
                        </button>
                    `}
                    <button onclick="deleteRoom('${room.room_id}')" 
                            style="padding: 0.5rem 1rem; background: #ef4444; color: white; border: none; border-radius: 0.5rem; cursor: pointer; font-weight: 500;">
                        🗑️ Löschen
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

async function lockRoom(roomId) {
    if (!confirm('Möchtest du diesen Raum wirklich sperren? Neue Verbindungen werden verhindert.')) return;
    
    try {
        const response = await fetch(`${API_URL}/admin/room/${roomId}/lock?password=${encodeURIComponent(adminPassword)}`, {
            method: 'POST'
        });
        const data = await response.json();
        
        if (data.success) {
            console.log(`🔒 Raum ${roomId} gesperrt`);
            refreshAdminData();
        }
    } catch (error) {
        console.error('❌ Fehler beim Sperren:', error);
        alert('Fehler beim Sperren des Raums.');
    }
}

async function unlockRoom(roomId) {
    try {
        const response = await fetch(`${API_URL}/admin/room/${roomId}/unlock?password=${encodeURIComponent(adminPassword)}`, {
            method: 'POST'
        });
        const data = await response.json();
        
        if (data.success) {
            console.log(`🔓 Raum ${roomId} entsperrt`);
            refreshAdminData();
        }
    } catch (error) {
        console.error('❌ Fehler beim Entsperren:', error);
        alert('Fehler beim Entsperren des Raums.');
    }
}

async function deleteRoom(roomId) {
    if (!confirm('Möchtest du diesen Raum wirklich löschen? Alle Verbindungen werden getrennt und der Raum ist unwiederbringlich verloren!')) return;
    
    try {
        const response = await fetch(`${API_URL}/admin/room/${roomId}?password=${encodeURIComponent(adminPassword)}`, {
            method: 'DELETE'
        });
        const data = await response.json();
        
        if (data.success) {
            console.log(`🗑️ Raum ${roomId} gelöscht`);
            refreshAdminData();
        }
    } catch (error) {
        console.error('❌ Fehler beim Löschen:', error);
        alert('Fehler beim Löschen des Raums.');
    }
}

function logoutAdmin() {
    adminPassword = null;
    document.getElementById('adminApp').style.display = 'none';
    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('adminPassword').value = '';
}

// Whiteboard App
// Whiteboard App mit iPad-Touch-Fixes
const app = {
    state: {
        selectedTool: null,
        placedItems: [],
        connections: [],
        selectedItem: null,
        isDragging: false,
        isResizing: false,
        connectionMode: false,
        firstDevice: null,
        dragOffset: { x: 0, y: 0 },
        initialScale: 1,
        resizeStartPos: { x: 0, y: 0 },
        isExporting: false,
        hadInteraction: false,  // NEU: Track ob Drag/Resize stattfand
        renderScheduled: false,  // NEU: Verhindert zu viele Render-Calls
        touchStartTime: 0  // NEU: Für Click-Detection bei Touch
    },

    equipment: [
        { id: 'becherglas', name: 'Becherglas', img: `<img src="images/becherglas.png" alt="Becherglas" style="width:100%; height:100%; object-fit:contain;">` },
        { id: 'erlenmeyerkolben', name: 'Erlenmeyerkolben', img: `<img src="images/erlenmeyerkolben.png" alt="Erlenmeyerkolben" style="width:100%; height:100%; object-fit:contain;">` },
        { id: 'reagenzglas', name: 'Reagenzglas', img: `<img src="images/reagenzglas.png" alt="Reagenzglas" style="width:100%; height:100%; object-fit:contain;">` },
        { id: 'messzylinder', name: 'Messzylinder', img: `<img src="images/messzylinder.png" alt="Messzylinder" style="width:100%; height:100%; object-fit:contain;">` },
        { id: 'rundkolben', name: 'Rundkolben', img: `<img src="images/rundkolben.png" alt="Rundkolben" style="width:100%; height:100%; object-fit:contain;">` },
        { id: 'stehkolben', name: 'Stehkolben', img: `<img src="images/stehkolben.png" alt="Stehkolben" style="width:100%; height:100%; object-fit:contain;">` },
        { id: 'spitzkolben', name: 'Spitzkolben', img: `<img src="images/spitzkolben.png" alt="Spitzkolben" style="width:100%; height:100%; object-fit:contain;">` },
        { id: 'saugflasche', name: 'Saugflasche', img: `<img src="images/saugflasche.png" alt="Saugflasche" style="width:100%; height:100%; object-fit:contain;">` },
        { id: 'trichter', name: 'Trichter', img: `<img src="images/trichter.png" alt="Trichter" style="width:100%; height:100%; object-fit:contain;">` },
        { id: 'tropftrichter', name: 'Tropftrichter', img: `<img src="images/tropftrichter.png" alt="Tropftrichter" style="width:100%; height:100%; object-fit:contain;">` },
        { id: 'uhrglas', name: 'Uhrglas', img: `<img src="images/uhrglas.png" alt="Uhrglas" style="width:100%; height:100%; object-fit:contain;">` },
        { id: 'wanne', name: 'Pneumatische Wanne', img: `<img src="images/wanne.png" alt="Pneumatische Wanne" style="width:100%; height:100%; object-fit:contain;">` },
        { id: 'spritzflasche', name: 'Spritzflasche', img: `<img src="images/spritzflasche.png" alt="Spritzflasche" style="width:100%; height:100%; object-fit:contain;">` },
        { id: 'liebigkuehler', name: 'Liebigkühler', img: `<img src="images/liebigkuehler.png" alt="Liebigkühler" style="width:100%; height:100%; object-fit:contain;">` },
        { id: 'u-rohr', name: 'U-Rohr', img: `<img src="images/urohr.png" alt="U-Rohr" style="width:100%; height:100%; object-fit:contain;">` },
        { id: 'pipette', name: 'Pipette', img: `<img src="images/pipette.png" alt="Pipette" style="width:100%; height:100%; object-fit:contain;">` },
        { id: 'buerette', name: 'Bürette', img: `<img src="images/buerette.png" alt="Bürette" style="width:100%; height:100%; object-fit:contain;">` },
        { id: 'kolbenprober', name: 'Kolbenprober', img: `<img src="images/kolbenprober.png" alt="Kolbenprober" style="width:100%; height:100%; object-fit:contain;">` },
        { id: 'stativ', name: 'Stativ', img: `<img src="images/stativ.png" alt="Stativ" style="width:100%; height:100%; object-fit:contain;">` },
        { id: 'stativring', name: 'Stativring', img: `<img src="images/stativring.png" alt="Stativring" style="width:100%; height:100%; object-fit:contain;">` },
        { id: 'stativklammer', name: 'Stativklammer', img: `<img src="images/stativklammer.png" alt="Stativklammer" style="width:100%; height:100%; object-fit:contain;">` },
        { id: 'muffe', name: 'Muffe', img: `<img src="images/muffe.png" alt="Muffe" style="width:100%; height:100%; object-fit:contain;">` },
        { id: 'reagenzglasgestell', name: 'Reagenzglasgestell', img: `<img src="images/reagenzglasgestell.png" alt="Reagenzglasgestell" style="width:100%; height:100%; object-fit:contain;">` },
        { id: 'reagenzglasklammer', name: 'Reagenzglasklammer', img: `<img src="images/reagenzglasklammer.png" alt="Reagenzglasklammer" style="width:100%; height:100%; object-fit:contain;">` },
        { id: 'gasbrenner', name: 'Gasbrenner', img: `<img src="images/gasbrenner.png" alt="Gasbrenner" style="width:100%; height:100%; object-fit:contain;">` },
        { id: 'dreifuss', name: 'Dreifuß', img: `<img src="images/dreifuss.png" alt="Dreifuß" style="width:100%; height:100%; object-fit:contain;">` },
        { id: 'mineralfasernetz', name: 'Mineralfasernetz', img: `<img src="images/mineralfasernetz.png" alt="Mineralfasernetz" style="width:100%; height:100%; object-fit:contain;">` },
        { id: 'tondreieck', name: 'Tondreieck', img: `<img src="images/tondreieck.png" alt="Tondreieck" style="width:100%; height:100%; object-fit:contain;">` },
        { id: 'abdampfschale', name: 'Abdampfschale', img: `<img src="images/abdampfschale.png" alt="Abdampfschale" style="width:100%; height:100%; object-fit:contain;">` },
        { id: 'moerserschale', name: 'Mörserschale', img: `<img src="images/moerserschale.png" alt="Mörserschale" style="width:100%; height:100%; object-fit:contain;">` },
        { id: 'pistill', name: 'Pistill', img: `<img src="images/pistill.png" alt="Pistill" style="width:100%; height:100%; object-fit:contain;">` },
        { id: 'tiegel', name: 'Porzellantiegel', img: `<img src="images/tiegel.png" alt="Tiegel" style="width:100%; height:100%; object-fit:contain;">` },
        { id: 'tiegelzange', name: 'Tiegelzange', img: `<img src="images/tiegelzange.png" alt="Tiegelzange" style="width:100%; height:100%; object-fit:contain;">` },
        { id: 'spatel', name: 'Spatel', img: `<img src="images/spatel.png" alt="Spatel" style="width:100%; height:100%; object-fit:contain;">` },
        { id: 'loeffel', name: 'Verbrennungslöffel', img: `<img src="images/loeffel.png" alt="Löffel" style="width:100%; height:100%; object-fit:contain;">` },
        { id: 'schutzbrille', name: 'Schutzbrille', img: `<img src="images/schutzbrille.png" alt="Schutzbrille" style="width:100%; height:100%; object-fit:contain;">` },
        { id: 'stopfen', name: 'Stopfen', img: `<img src="images/stopfen.png" alt="Stopfen" style="width:100%; height:100%; object-fit:contain;">` },
        { id: 'wasserstrahlpumpe', name: 'Wasserstrahlpumpe', img: `<img src="images/wasserstrahlpumpe.png" alt="Wasserstrahlpumpe" style="width:100%; height:100%; object-fit:contain;">` }
    ],

    init() {
        console.log('🎨 Initialisiere App');
        this.renderPalette();
        this.setupEventListeners();
        this.updateUI();
    },

    renderPalette() {
        const palette = document.getElementById('palette');
        palette.innerHTML = this.equipment.map(eq => `
            <button class="equipment-btn" data-id="${eq.id}" onclick="app.selectTool('${eq.id}')">
                <div class="equipment-icon">${eq.img || eq.svg}</div>
                <div class="equipment-name">${eq.name}</div>
            </button>
        `).join('');
    },

    setupEventListeners() {
        const canvas = document.getElementById('canvas');
        const fileInput = document.getElementById('fileInput');

        // Desktop Click-Event (nur wenn KEINE Touch-Interaktion stattfand)
        canvas.addEventListener('click', (e) => {
            if (!this.state.hadInteraction) {
                this.handleCanvasClick(e);
            }
        });

        // Mouse Events
        canvas.addEventListener('mousedown', (e) => this.handleStart(e));
        
        // Touch Events - NUR EINMAL!
        canvas.addEventListener('touchstart', (e) => {
            this.handleStart(e);
        }, { passive: false });

        // Globale Move-Listener
        document.addEventListener('mousemove', (e) => this.handleMove(e));
        document.addEventListener('touchmove', (e) => this.handleMove(e), { passive: false });

        // Globale End-Listener
        document.addEventListener('mouseup', (e) => this.handleEnd(e));
        document.addEventListener('touchend', (e) => this.handleEnd(e));
        document.addEventListener('touchcancel', (e) => this.handleEnd(e));

        // File Input
        fileInput.addEventListener('change', (e) => this.loadSetup(e));
        document.getElementById('labelInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.saveLabel();
        });
    },

    selectTool(id) {
        console.log('🔧 Tool ausgewählt:', id);
        this.state.selectedTool = id;
        this.state.selectedItem = null;
        this.updateUI();
    },

    handleCanvasClick(e) {
        if (this.state.isDragging || this.state.isResizing) return;

        const canvas = document.getElementById('canvas');
        const rect = canvas.getBoundingClientRect();
        const x = (e.clientX || e.touches?.[0]?.clientX) - rect.left;
        const y = (e.clientY || e.touches?.[0]?.clientY) - rect.top;

        if (!x || !y) return;

        const clickedElement = e.target.closest('.item');
        const clickedResize = e.target.closest('.resize-handle');
        
        if (clickedResize) {
            return;
        } else if (clickedElement) {
            const itemId = parseInt(clickedElement.dataset.id);
            const item = this.state.placedItems.find(i => i.id === itemId);
            
            if (this.state.connectionMode && item) {
                this.handleConnection(item);
            } else if (item) {
                this.state.selectedItem = item;
                this.state.selectedTool = null;
                this.render();
                this.updateUI();
            }
        } else if (this.state.selectedTool) {
            const relativeX = x / rect.width;
            const relativeY = y / rect.height;
            this.placeItem(relativeX, relativeY);
        } else {
            this.state.selectedItem = null;
            this.updateUI();
        }
    },

    placeItem(relX, relY) {
        console.log('➕ Platziere Item:', this.state.selectedTool, 'bei', Math.round(relX*100)+'%', Math.round(relY*100)+'%');
        const equipment = this.equipment.find(e => e.id === this.state.selectedTool);
        const newItem = {
            id: Date.now(),
            type: this.state.selectedTool,
            x: relX,
            y: relY,
            rotation: 0,
            scale: 1,
            label: ''
        };
        this.state.placedItems.push(newItem);
        this.state.selectedTool = null;
        this.state.selectedItem = null;
        this.render();
        this.updateUI();
        sendUpdate();
        sendActivity('platziert ' + (equipment?.name || this.state.selectedTool), this.state.selectedTool);
    },

    handleConnection(item) {
        if (!this.state.firstDevice) {
            console.log('🔗 Erstes Gerät ausgewählt:', item.type);
            this.state.firstDevice = item;
            this.updateUI();
        } else if (this.state.firstDevice.id !== item.id) {
            console.log('🔗 Verbindung erstellt von', this.state.firstDevice.type, 'zu', item.type);
            this.state.connections.push({
                id: Date.now(),
                from: this.state.firstDevice.id,
                to: item.id,
                type: 'solid'
            });
            this.state.firstDevice = null;
            this.state.connectionMode = false;
            this.render();
            this.updateUI();
            sendUpdate();
            sendActivity('verbindet Geräte', 'connection');
        }
    },

    handleStart(e) {
        // Reset Interaction-Flag
        this.state.hadInteraction = false;
        this.state.touchStartTime = Date.now();
        
        // Verhindere Default bei Touch
        if (e.type === 'touchstart') {
            e.preventDefault();
            e.stopPropagation();
        }

        const targetItem = e.target.closest('.item');
        const targetResizeHandle = e.target.closest('.resize-handle');
        
        if (!targetItem) {
            // Klick auf leere Fläche
            if (this.state.selectedTool) {
                // Tool platzieren
                const canvas = document.getElementById('canvas');
                const rect = canvas.getBoundingClientRect();
                const clientX = e.clientX || (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
                const clientY = e.clientY || (e.touches && e.touches[0] ? e.touches[0].clientY : 0);
                const x = clientX - rect.left;
                const y = clientY - rect.top;
                
                const relativeX = x / rect.width;
                const relativeY = y / rect.height;
                this.placeItem(relativeX, relativeY);
                this.state.hadInteraction = true;
            }
            return;
        }

        const itemId = parseInt(targetItem.dataset.id);
        const item = this.state.placedItems.find(i => i.id === itemId);
        if (!item) return;

        const canvas = document.getElementById('canvas');
        const rect = canvas.getBoundingClientRect();
        
        const clientX = e.clientX || (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
        const clientY = e.clientY || (e.touches && e.touches[0] ? e.touches[0].clientY : 0);
        const x = clientX - rect.left;
        const y = clientY - rect.top;

        this.state.selectedItem = item;
        this.state.hadInteraction = true;

        if (targetResizeHandle) {
            // RESIZE STARTEN
            console.log('🔧 Resize gestartet');
            this.state.isResizing = true;
            this.state.initialScale = item.scale || 1;
            this.state.resizeStartPos = { x, y };
        } else {
            // DRAG STARTEN
            console.log('👆 Drag gestartet');
            const relX = x / rect.width;
            const relY = y / rect.height;
            this.state.isDragging = true;
            this.state.dragOffset = {
                x: relX - item.x,
                y: relY - item.y
            };
        }
        this.updateUI();
    },

    handleMove(e) {
        if ((!this.state.isDragging && !this.state.isResizing) || !this.state.selectedItem) return;

        this.state.hadInteraction = true;

        // Performance-Optimierung: Throttle mit requestAnimationFrame
        if (this.state.renderScheduled) return;
        this.state.renderScheduled = true;

        requestAnimationFrame(() => {
            const canvas = document.getElementById('canvas');
            const rect = canvas.getBoundingClientRect();
            
            // Verbesserte Touch-Koordinaten-Behandlung
            let x, y;
            if (e.type.startsWith('touch')) {
                if (e.touches && e.touches.length > 0) {
                    x = e.touches[0].clientX - rect.left;
                    y = e.touches[0].clientY - rect.top;
                } else {
                    this.state.renderScheduled = false;
                    return;
                }
            } else {
                x = e.clientX - rect.left;
                y = e.clientY - rect.top;
            }

            if (this.state.isResizing) {
                const deltaX = x - (this.state.resizeStartPos.x || 0);
                const deltaY = y - (this.state.resizeStartPos.y || 0);
                const delta = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
                const direction = (deltaX + deltaY) > 0 ? 1 : -1;
                const scaleFactor = 1 + (direction * delta * 0.003);
                let newScale = this.state.initialScale * scaleFactor;
                newScale = Math.max(0.5, Math.min(3, newScale));
                this.state.selectedItem.scale = newScale;
            } else if (this.state.isDragging) {
                const relX = x / rect.width;
                const relY = y / rect.height;
                this.state.selectedItem.x = Math.max(0, Math.min(1, relX - this.state.dragOffset.x));
                this.state.selectedItem.y = Math.max(0, Math.min(1, relY - this.state.dragOffset.y));
            }

            this.render();
            this.updateUI();
            this.state.renderScheduled = false;
        });
    },

    handleEnd(e) {
        const touchDuration = Date.now() - this.state.touchStartTime;
        
        if (this.state.isDragging || this.state.isResizing) {
            console.log('📤 Sende Update nach Drag/Resize');
            const equipment = this.equipment.find(e => e.id === this.state.selectedItem?.type);
            if (this.state.isDragging) {
                sendActivity('verschiebt ' + (equipment?.name || 'Objekt'), this.state.selectedItem?.type);
            } else if (this.state.isResizing) {
                sendActivity('skaliert ' + (equipment?.name || 'Objekt'), this.state.selectedItem?.type);
            }
            sendUpdate();
        }
        
        this.state.isDragging = false;
        this.state.isResizing = false;
        this.state.renderScheduled = false;
        
        // Kurzer Tap ohne Bewegung = Click-Verhalten für Touch
        if (e.type.startsWith('touch') && touchDuration < 200 && !this.state.hadInteraction) {
            const targetItem = e.target.closest('.item');
            if (targetItem) {
                const itemId = parseInt(targetItem.dataset.id);
                const item = this.state.placedItems.find(i => i.id === itemId);
                
                if (this.state.connectionMode && item) {
                    this.handleConnection(item);
                    this.state.hadInteraction = true;
                }
            }
        }
        
        // Verzögertes Zurücksetzen des Interaction-Flags
        setTimeout(() => {
            this.state.hadInteraction = false;
        }, 50);
        
        this.updateUI();
    },

    // Rest der Methoden bleiben unverändert...
    rotateItem() {
        if (!this.state.selectedItem) return;
        console.log('🔄 Drehe Item:', this.state.selectedItem.type);
        this.state.selectedItem.rotation = (this.state.selectedItem.rotation + 90) % 360;
        this.render();
        const equipment = this.equipment.find(e => e.id === this.state.selectedItem.type);
        sendActivity('dreht ' + (equipment?.name || 'Objekt'), this.state.selectedItem.type);
        sendUpdate();
    },

    deleteItem() {
        if (!this.state.selectedItem) return;
        console.log('🗑️ Lösche Item:', this.state.selectedItem.type);
        const equipment = this.equipment.find(e => e.id === this.state.selectedItem.type);
        this.state.connections = this.state.connections.filter(conn => 
            conn.from !== this.state.selectedItem.id && conn.to !== this.state.selectedItem.id
        );
        this.state.placedItems = this.state.placedItems.filter(item => 
            item.id !== this.state.selectedItem.id
        );
        this.state.selectedItem = null;
        this.render();
        this.updateUI();
        sendActivity('löscht ' + (equipment?.name || 'Objekt'), equipment?.id || 'unknown');
        sendUpdate();
    },

    addLabel() {
        document.getElementById('labelInput').value = this.state.selectedItem?.label || '';
        document.getElementById('labelPanel').classList.remove('hidden');
        document.getElementById('controlPanel').classList.add('hidden');
        document.getElementById('labelInput').focus();
    },

    saveLabel() {
        if (!this.state.selectedItem) return;
        console.log('🏷️ Label gespeichert:', document.getElementById('labelInput').value);
        this.state.selectedItem.label = document.getElementById('labelInput').value;
        this.cancelLabel();
        this.render();
        sendUpdate();
    },

    cancelLabel() {
        document.getElementById('labelPanel').classList.add('hidden');
        document.getElementById('controlPanel').classList.remove('hidden');
    },

    startConnectionMode() {
        console.log('🔗 Verbindungsmodus gestartet');
        this.state.connectionMode = true;
        this.state.firstDevice = null;
        this.state.selectedItem = null;
        this.state.selectedTool = null;
        this.updateUI();
    },

    cancelConnectionMode() {
        console.log('❌ Verbindungsmodus abgebrochen');
        this.state.connectionMode = false;
        this.state.firstDevice = null;
        this.updateUI();
    },

    showClearConfirm() {
        document.getElementById('clearModal').classList.remove('hidden');
    },

    hideClearConfirm() {
        document.getElementById('clearModal').classList.add('hidden');
    },

    clearAll() {
        console.log('🗑️ Lösche alles');
        this.state.placedItems = [];
        this.state.connections = [];
        this.state.selectedItem = null;
        this.state.selectedTool = null;
        this.state.connectionMode = false;
        this.state.firstDevice = null;
        this.hideClearConfirm();
        this.render();
        this.updateUI();
        sendUpdate();
    },

    saveSetup() {
        console.log('💾 Speichere Setup');
        const setup = {
            version: '1.0',
            timestamp: new Date().toISOString(),
            items: this.state.placedItems,
            connections: this.state.connections
        };
        
        const dataStr = JSON.stringify(setup, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(dataBlob);
        
        const link = document.createElement('a');
        link.href = url;
        link.download = `versuchsaufbau-${Date.now()}.json`;
        link.click();
        
        URL.revokeObjectURL(url);
    },

    triggerFileInput() {
        document.getElementById('fileInput').click();
    },

    loadSetup(event) {
        const file = event.target.files?.[0];
        if (!file) return;
        
        console.log('📂 Lade Setup aus Datei:', file.name);
        
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const setup = JSON.parse(e.target.result);
                
                if (setup.items && Array.isArray(setup.items)) {
                    this.state.placedItems = setup.items;
                }
                if (setup.connections && Array.isArray(setup.connections)) {
                    this.state.connections = setup.connections;
                }
                
                console.log('✅ Setup geladen:', {
                    items: this.state.placedItems.length,
                    connections: this.state.connections.length
                });
                
                this.state.selectedItem = null;
                this.state.selectedTool = null;
                this.state.connectionMode = false;
                this.state.firstDevice = null;
                
                this.render();
                this.updateUI();
                sendUpdate();
                alert('Versuchsaufbau erfolgreich geladen!');
            } catch (error) {
                console.error('❌ Fehler beim Laden:', error);
                alert('Fehler beim Laden der Datei.');
            }
        };
        
        reader.readAsText(file);
        event.target.value = '';
    },

    async exportToPDF(mode = 'fit') {
        if (this.state.isExporting) return;
        console.log("📄 Exportiere zu PDF ...");
        this.state.isExporting = true;

        const pdfBtn = document.getElementById('pdfBtn');
        const pdfBtnText = document.getElementById('pdfBtnText');
        pdfBtn.disabled = true;
        pdfBtnText.textContent = 'Erstelle PDF ...';

        try {
            const stage = document.getElementById('canvas') || document.getElementById('stage');
            if (!stage) throw new Error('Stage nicht gefunden');

            const canvas = await html2canvas(stage, {
                backgroundColor: '#ffffff',
                scale: 2
            });
            const imgData = canvas.toDataURL('image/png');

            const cw = canvas.width;
            const ch = canvas.height;
            const landscape = cw >= ch;

            const { jsPDF } = window.jspdf;

            if (mode === 'true') {
                const pxToPt = 72 / 96;
                const pdfW = cw * pxToPt;
                const pdfH = ch * pxToPt;

                const pdf = new jsPDF({
                    orientation: landscape ? 'l' : 'p',
                    unit: 'pt',
                    format: [pdfW, pdfH]
                });
                pdf.addImage(imgData, 'PNG', 0, 0, pdfW, pdfH);
                pdf.save(`versuchsaufbau_original_${Date.now()}.pdf`);
            } else {
                const pdf = new jsPDF({
                    orientation: landscape ? 'l' : 'p',
                    unit: 'pt',
                    format: 'a4'
                });

                const pageW = pdf.internal.pageSize.getWidth();
                const pageH = pdf.internal.pageSize.getHeight();
                const margin = 24;

                const maxW = pageW - 2 * margin;
                const maxH = pageH - 2 * margin;

                let renderW = maxW;
                let renderH = (ch / cw) * renderW;
                if (renderH > maxH) {
                    renderH = maxH;
                    renderW = (cw / ch) * renderH;
                }
                const x = (pageW - renderW) / 2;
                const y = (pageH - renderH) / 2;

                pdf.addImage(imgData, 'PNG', x, y, renderW, renderH);
                const timestamp = new Date().toLocaleString('de-DE');
                pdf.setFontSize(10);
                pdf.text(`Versuchsaufbau – Exportiert am ${timestamp}`, margin, pageH - 20);
                pdf.save(`versuchsaufbau_A4_${Date.now()}.pdf`);
            }

            console.log("✅ PDF erfolgreich exportiert");
        } catch (error) {
            console.error("❌ Fehler beim PDF-Export:", error);
            alert("Fehler beim PDF-Export.");
        } finally {
            this.state.isExporting = false;
            pdfBtn.disabled = false;
            pdfBtnText.textContent = 'PDF Export';
        }
    },

    render() {
        this.renderItems();
        this.renderConnections();
    },

    renderItems() {
        const container = document.getElementById('itemsContainer');
        const canvas = document.getElementById('canvas');
        const canvasWidth = canvas.clientWidth;
        const canvasHeight = canvas.clientHeight;
        
        container.innerHTML = this.state.placedItems.map(item => {
            const equipment = this.equipment.find(e => e.id === item.type);
            if (!equipment) return '';
            
            const size = 80 * (item.scale || 1);
            const absoluteX = item.x * canvasWidth;
            const absoluteY = item.y * canvasHeight;
            const isSelected = this.state.selectedItem?.id === item.id;
            const isDragging = this.state.isDragging && isSelected;
            
            return `
                <div class="item ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''}"
                     style="left: ${absoluteX - size/2}px; top: ${absoluteY - size/2}px; width: ${size}px; height: ${size}px;"
                     data-id="${item.id}">
                    <div class="item-content" style="transform: rotate(${item.rotation}deg);">
                        ${equipment.img || equipment.svg}
                    </div>
                    ${isSelected ? `
                        <div class="resize-handle">
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="white">
                                <path d="M14 2L2 14M14 8L8 14" stroke="white" stroke-width="2" stroke-linecap="round"/>
                            </svg>
                        </div>
                    ` : ''}
                    ${item.label ? `<div class="label" style="top: ${size + 8}px;">${item.label}</div>` : ''}
                </div>
            `;
        }).join('');
    },

    renderConnections() {
        const svg = document.getElementById('connectionsSvg');
        const canvas = document.getElementById('canvas');
        const canvasWidth = canvas.clientWidth;
        const canvasHeight = canvas.clientHeight;
        
        svg.innerHTML = this.state.connections.map(conn => {
            const fromItem = this.state.placedItems.find(item => item.id === conn.from);
            const toItem = this.state.placedItems.find(item => item.id === conn.to);
            
            if (!fromItem || !toItem) return '';
            
            const fromX = fromItem.x * canvasWidth;
            const fromY = fromItem.y * canvasHeight;
            const toX = toItem.x * canvasWidth;
            const toY = toItem.y * canvasHeight;
            
            return `
                <g>
                    <line x1="${fromX}" y1="${fromY}" 
                          x2="${toX}" y2="${toY}" 
                          stroke="#2563eb" stroke-width="3" 
                          stroke-dasharray="${conn.type === 'dashed' ? '8,4' : 'none'}"/>
                    <line class="connection-line" 
                          x1="${fromX}" y1="${fromY}" 
                          x2="${toX}" y2="${toY}" 
                          stroke="transparent" stroke-width="20" 
                          style="cursor: pointer; pointer-events: auto;"
                          onclick="app.deleteConnection(${conn.id})"/>
                </g>
            `;
        }).join('');
    },

    deleteConnection(id) {
        console.log('🗑️ Lösche Verbindung:', id);
        this.state.connections = this.state.connections.filter(c => c.id !== id);
        this.render();
        sendUpdate();
    },

    updateUI() {
        document.getElementById('saveBtn').disabled = this.state.placedItems.length === 0;
        document.getElementById('pdfBtn').disabled = this.state.placedItems.length === 0 || this.state.isExporting;
        
        const connectBtn = document.getElementById('connectBtn');
        if (this.state.connectionMode) {
            connectBtn.className = 'btn btn-orange';
            connectBtn.textContent = 'Abbrechen';
            connectBtn.onclick = () => this.cancelConnectionMode();
        } else {
            connectBtn.className = 'btn btn-green';
            connectBtn.textContent = 'Verbinden';
            connectBtn.onclick = () => this.startConnectionMode();
        }

        document.querySelectorAll('.equipment-btn').forEach(btn => {
            if (btn.dataset.id === this.state.selectedTool) {
                btn.classList.add('selected');
            } else {
                btn.classList.remove('selected');
            }
        });

        const controlPanel = document.getElementById('controlPanel');
        const labelPanel = document.getElementById('labelPanel');
        if (!labelPanel.classList.contains('hidden')) {
            controlPanel.classList.add('hidden');
        } else if (this.state.selectedItem) {
            controlPanel.classList.remove('hidden');
        } else {
            controlPanel.classList.add('hidden');
        }

        const instruction = document.getElementById('instruction');
        if (this.state.placedItems.length === 0 && !this.state.selectedTool && !this.state.connectionMode) {
            instruction.textContent = 'Wähle ein Gerät und tippe auf die Fläche';
            instruction.className = 'instruction instruction-gray';
            instruction.classList.remove('hidden');
        } else if (this.state.selectedTool) {
            instruction.textContent = 'Tippe auf die Fläche zum Platzieren';
            instruction.className = 'instruction instruction-blue';
            instruction.classList.remove('hidden');
        } else if (this.state.connectionMode && !this.state.firstDevice) {
            instruction.textContent = 'Tippe auf das ERSTE Gerät';
            instruction.className = 'instruction instruction-green';
            instruction.classList.remove('hidden');
        } else if (this.state.connectionMode && this.state.firstDevice) {
            instruction.textContent = 'Tippe auf das ZWEITE Gerät';
            instruction.className = 'instruction instruction-green';
            instruction.classList.remove('hidden');
        } else {
            instruction.classList.add('hidden');
        }

        const statusBadge = document.getElementById('statusBadge');
        if (this.state.isDragging) {
            statusBadge.textContent = 'Verschieben...';
            statusBadge.className = 'status-badge status-green';
            statusBadge.classList.remove('hidden');
        } else if (this.state.isResizing) {
            const scale = Math.round((this.state.selectedItem?.scale || 1) * 100);
            statusBadge.textContent = `Größe anpassen... (${scale}%)`;
            statusBadge.className = 'status-badge status-purple';
            statusBadge.classList.remove('hidden');
        } else {
            statusBadge.classList.add('hidden');
        }
    }
};

// Event Listeners beim Laden registrieren
document.addEventListener('DOMContentLoaded', function() {
    console.log('📱 DOM geladen, registriere Event Listeners...');
    
    const createForm = document.getElementById('createForm');
    const joinForm = document.getElementById('joinForm');
    const adminForm = document.getElementById('adminForm');
    
    if (createForm) {
        console.log('✅ Create Form gefunden');
        createForm.addEventListener('submit', createRoom);
    } else {
        console.error('❌ Create Form NICHT gefunden!');
    }
    
    if (joinForm) {
        console.log('✅ Join Form gefunden');
        joinForm.addEventListener('submit', joinRoom);
    } else {
        console.error('❌ Join Form NICHT gefunden!');
    }
    
    if (adminForm) {
        console.log('✅ Admin Form gefunden');
        adminForm.addEventListener('submit', adminLogin);
    } else {
        console.error('❌ Admin Form NICHT gefunden!');
    }
    
    console.log('✅ Alle Event Listeners registriert');
});

// iOS Touch-Event Fix
if (/iPad|iPhone|iPod/.test(navigator.userAgent)) {
    console.log('📱 iOS Device erkannt - aktiviere Touch-Fixes');
    document.addEventListener('touchstart', function(){}, {passive: true});
}

