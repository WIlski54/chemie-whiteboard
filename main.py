import asyncio
import json
import random
import string
from datetime import datetime
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI()

# WICHTIG: CORS-Middleware hinzufügen
# Erlaubt deinem Frontend (chemie-whiteboard-app.onrender.com)
# mit deinem Backend (chemie-whiteboard-backend.onrender.com) zu kommunizieren.
origins = ["*"]  # Für den Test erlauben wir alle, später kannst du das einschränken

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Admin-Passwort (ändere das!)
ADMIN_PASSWORD = "lehrer2025"

# Dieses Dictionary speichert alle aktiven Räume und die WebSocket-Verbindungen.
# Format: { "raum_id": { "sockets": {websocket: user_info}, "state": {...}, "info": {...} } }
rooms = {}

# Farben für User-Avatare
USER_COLORS = [
    "#ef4444", "#f97316", "#f59e0b", "#eab308", "#84cc16",
    "#22c55e", "#10b981", "#14b8a6", "#06b6d4", "#0ea5e9",
    "#3b82f6", "#6366f1", "#8b5cf6", "#a855f7", "#d946ef",
    "#ec4899", "#f43f5e"
]

class RoomCreationRequest(BaseModel):
    room_name: str

class RoomJoinRequest(BaseModel):
    room_id: str
    username: str

class AdminLoginRequest(BaseModel):
    password: str

# --- NEUE HTTP-ENDPUNKTE ---

@app.post("/api/room/create")
async def create_room(request: RoomCreationRequest):
    # Erstelle eine zufällige, 8-stellige Raum-ID
    room_id = ''.join(random.choices(string.ascii_lowercase + string.digits, k=8))
    
    # Initialisiere den Raum im Speicher
    rooms[room_id] = {
        "sockets": {},  # Jetzt dict: {websocket: user_info}
        "state": {"items": [], "connections": []},
        "info": {
            "name": request.room_name,
            "created_at": datetime.now().isoformat(),
            "creator": None,
            "users": [],
            "locked": False
        }
    }
    
    print(f"✅ Raum erstellt: {room_id} (Name: {request.room_name})")
    print(f"📊 Aktive Räume: {list(rooms.keys())}")
    
    return {"success": True, "room_id": room_id}

@app.post("/api/room/join")
async def join_room(request: RoomJoinRequest):
    if request.room_id not in rooms:
        print(f"⚠️ Raum {request.room_id} existiert nicht, erstelle neuen Raum")
        rooms[request.room_id] = {
            "sockets": {},
            "state": {"items": [], "connections": []},
            "info": {
                "name": "Unbekannt",
                "created_at": datetime.now().isoformat(),
                "creator": request.username,
                "users": [],
                "locked": False
            }
        }
    
    # Prüfe ob Raum gesperrt ist
    if rooms[request.room_id]["info"].get("locked", False):
        print(f"🔒 Raum {request.room_id} ist gesperrt")
        return {"success": False, "error": "Dieser Raum wurde vom Lehrer gesperrt."}
    
    # Speichere Creator beim ersten Join
    if rooms[request.room_id]["info"]["creator"] is None:
        rooms[request.room_id]["info"]["creator"] = request.username
    
    # Weise User eine Farbe zu
    used_colors = [u.get("color") for u in rooms[request.room_id]["info"]["users"]]
    available_colors = [c for c in USER_COLORS if c not in used_colors]
    user_color = available_colors[0] if available_colors else USER_COLORS[0]
    
    # Füge User zur Liste hinzu (wenn noch nicht vorhanden)
    user_exists = any(u["username"] == request.username for u in rooms[request.room_id]["info"]["users"])
    if not user_exists:
        rooms[request.room_id]["info"]["users"].append({
            "username": request.username,
            "joined_at": datetime.now().isoformat(),
            "color": user_color
        })
    
    print(f"✅ User {request.username} tritt Raum {request.room_id} bei (Farbe: {user_color})")

    # Den aktuellen Zustand des Raumes zurückgeben, wenn jemand beitritt
    return {
        "success": True, 
        "user_id": ''.join(random.choices(string.ascii_lowercase, k=10)),
        "room_state": rooms[request.room_id]["state"],
        "user_color": user_color
    }

# --- ADMIN-ENDPUNKTE ---

@app.post("/api/admin/login")
async def admin_login(request: AdminLoginRequest):
    """Admin-Login prüfen"""
    if request.password == ADMIN_PASSWORD:
        print("✅ Admin erfolgreich eingeloggt")
        return {"success": True, "token": "admin_authenticated"}
    else:
        print("❌ Fehlgeschlagener Admin-Login-Versuch")
        return {"success": False, "error": "Falsches Passwort"}

@app.get("/api/admin/overview")
async def admin_overview(password: str = Query(...)):
    """Übersicht über alle Räume und User"""
    if password != ADMIN_PASSWORD:
        raise HTTPException(status_code=401, detail="Unauthorized")
    
    overview = []
    for room_id, data in rooms.items():
        overview.append({
            "room_id": room_id,
            "name": data["info"]["name"],
            "created_at": data["info"]["created_at"],
            "creator": data["info"]["creator"],
            "active_connections": len(data["sockets"]),
            "total_users": len(data["info"]["users"]),
            "users": data["info"]["users"],
            "items_count": len(data["state"]["items"]),
            "connections_count": len(data["state"]["connections"]),
            "locked": data["info"].get("locked", False)
        })
    
    print(f"📊 Admin-Übersicht abgerufen: {len(overview)} Räume")
    return {"rooms": overview}

@app.post("/api/admin/room/{room_id}/lock")
async def lock_room(room_id: str, password: str = Query(...)):
    """Raum sperren"""
    if password != ADMIN_PASSWORD:
        raise HTTPException(status_code=401, detail="Unauthorized")
    
    if room_id not in rooms:
        raise HTTPException(status_code=404, detail="Room not found")
    
    rooms[room_id]["info"]["locked"] = True
    print(f"🔒 Raum {room_id} wurde gesperrt")
    
    return {"success": True, "message": "Raum gesperrt"}

@app.post("/api/admin/room/{room_id}/unlock")
async def unlock_room(room_id: str, password: str = Query(...)):
    """Raum entsperren"""
    if password != ADMIN_PASSWORD:
        raise HTTPException(status_code=401, detail="Unauthorized")
    
    if room_id not in rooms:
        raise HTTPException(status_code=404, detail="Room not found")
    
    rooms[room_id]["info"]["locked"] = False
    print(f"🔓 Raum {room_id} wurde entsperrt")
    
    return {"success": True, "message": "Raum entsperrt"}

@app.delete("/api/admin/room/{room_id}")
async def delete_room(room_id: str, password: str = Query(...)):
    """Raum löschen"""
    if password != ADMIN_PASSWORD:
        raise HTTPException(status_code=401, detail="Unauthorized")
    
    if room_id not in rooms:
        raise HTTPException(status_code=404, detail="Room not found")
    
    # Alle WebSocket-Verbindungen schließen
    for ws in list(rooms[room_id]["sockets"].keys()):
        try:
            await ws.close(code=1000, reason="Raum vom Admin gelöscht")
        except:
            pass
    
    del rooms[room_id]
    print(f"🗑️ Raum {room_id} wurde vom Admin gelöscht")
    
    return {"success": True, "message": "Raum gelöscht"}


# --- BESTEHENDER WEBSOCKET-ENDPUNKT ---

@app.websocket("/ws/{room_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str):
    await websocket.accept()
    print(f"✅ WebSocket-Verbindung akzeptiert für Raum: {room_id}")

    # Client zum Raum hinzufügen
    if room_id not in rooms:
        print(f"❌ Raum {room_id} existiert nicht! Schließe WebSocket.")
        await websocket.close(code=1008)
        return
    
    # Prüfe ob Raum gesperrt ist
    if rooms[room_id]["info"].get("locked", False):
        print(f"🔒 WebSocket-Verbindung abgelehnt - Raum {room_id} ist gesperrt")
        await websocket.close(code=1008, reason="Raum gesperrt")
        return
    
    # Warte auf erste Nachricht mit User-Info
    try:
        init_data = await websocket.receive_text()
        init_msg = json.loads(init_data)
        
        if init_msg.get("type") == "join":
            user_info = {
                "username": init_msg.get("username"),
                "user_id": init_msg.get("user_id"),
                "color": init_msg.get("color"),
                "last_activity": datetime.now().isoformat()
            }
            rooms[room_id]["sockets"][websocket] = user_info
            
            print(f"👤 User {user_info['username']} verbunden mit Raum {room_id}")
            
            # Sende Join-Nachricht an alle anderen
            await broadcast_user_event(room_id, {
                "type": "user_joined",
                "user": user_info
            }, exclude=websocket)
            
            # Sende Liste aller aktuellen User an den neuen User
            current_users = [info for info in rooms[room_id]["sockets"].values()]
            await websocket.send_text(json.dumps({
                "type": "users_list",
                "users": current_users
            }))
            
    except Exception as e:
        print(f"❌ Fehler beim User-Join: {e}")
        await websocket.close(code=1008)
        return
    
    connection_count = len(rooms[room_id]["sockets"])
    print(f"👥 Raum {room_id} hat jetzt {connection_count} aktive Verbindung(en)")

    try:
        while True:
            data = await websocket.receive_text()
            msg = json.loads(data)
            
            # Update last_activity
            if websocket in rooms[room_id]["sockets"]:
                rooms[room_id]["sockets"][websocket]["last_activity"] = datetime.now().isoformat()
            
            # Handle verschiedene Message-Typen
            if msg.get("type") == "state_update":
                # Normales State-Update
                rooms[room_id]["state"] = msg.get("state", {})
                await broadcast_to_others(room_id, data, websocket)
                
            elif msg.get("type") == "activity":
                # Activity-Event (z.B. "bewegt Becherglas")
                await broadcast_to_others(room_id, data, websocket)
            
            elif msg.get("type") == "ping":
                # Keepalive
                await websocket.send_text(json.dumps({"type": "pong"}))

    except WebSocketDisconnect:
        # User hat Verbindung getrennt
        if websocket in rooms[room_id]["sockets"]:
            user_info = rooms[room_id]["sockets"][websocket]
            print(f"❌ User {user_info['username']} getrennt von Raum {room_id}")
            
            # Remove socket
            del rooms[room_id]["sockets"][websocket]
            
            # Broadcast Leave-Event
            await broadcast_user_event(room_id, {
                "type": "user_left",
                "user_id": user_info["user_id"]
            })
            
            remaining = len(rooms[room_id]["sockets"])
            print(f"👥 Raum {room_id} hat noch {remaining} Verbindung(en)")
            
            # Wenn der Raum leer ist, löschen
            if not rooms[room_id]["sockets"]:
                del rooms[room_id]
                print(f"🗑️ Raum {room_id} gelöscht (keine Verbindungen mehr)")
                print(f"📊 Aktive Räume: {list(rooms.keys())}")

async def broadcast_to_others(room_id: str, data: str, exclude_websocket: WebSocket):
    """Sende Nachricht an alle außer dem Sender"""
    if room_id not in rooms:
        return
    
    tasks = []
    for ws in rooms[room_id]["sockets"].keys():
        if ws != exclude_websocket:
            tasks.append(ws.send_text(data))
    
    if tasks:
        try:
            await asyncio.gather(*tasks, return_exceptions=True)
        except Exception as e:
            print(f"⚠️ Fehler beim Broadcast: {e}")

async def broadcast_user_event(room_id: str, event: dict, exclude: WebSocket = None):
    """Sende User-Event an alle (oder alle außer exclude)"""
    if room_id not in rooms:
        return
    
    data = json.dumps(event)
    tasks = []
    for ws in rooms[room_id]["sockets"].keys():
        if ws != exclude:
            tasks.append(ws.send_text(data))
    
    if tasks:
        try:
            await asyncio.gather(*tasks, return_exceptions=True)
        except Exception as e:
            print(f"⚠️ Fehler beim User-Event Broadcast: {e}")
