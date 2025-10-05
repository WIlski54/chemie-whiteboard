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
# Format: { "raum_id": { "sockets": {websocket1, websocket2, ...}, "state": {...}, "info": {...} } }
rooms = {}

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
        "sockets": set(),
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
            "sockets": set(),
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
    
    # Füge User zur Liste hinzu (wenn noch nicht vorhanden)
    user_exists = any(u["username"] == request.username for u in rooms[request.room_id]["info"]["users"])
    if not user_exists:
        rooms[request.room_id]["info"]["users"].append({
            "username": request.username,
            "joined_at": datetime.now().isoformat()
        })
    
    print(f"✅ User {request.username} tritt Raum {request.room_id} bei")

    # Den aktuellen Zustand des Raumes zurückgeben, wenn jemand beitritt
    return {
        "success": True, 
        "user_id": ''.join(random.choices(string.ascii_lowercase, k=10)),
        "room_state": rooms[request.room_id]["state"]
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
    for ws in list(rooms[room_id]["sockets"]):
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
        # Verbindung ablehnen, wenn der Raum nicht existiert
        print(f"❌ Raum {room_id} existiert nicht! Schließe WebSocket.")
        await websocket.close(code=1008)
        return
    
    # Prüfe ob Raum gesperrt ist
    if rooms[room_id]["info"].get("locked", False):
        print(f"🔒 WebSocket-Verbindung abgelehnt - Raum {room_id} ist gesperrt")
        await websocket.close(code=1008, reason="Raum gesperrt")
        return
        
    rooms[room_id]["sockets"].add(websocket)
    connection_count = len(rooms[room_id]["sockets"])
    print(f"👥 Raum {room_id} hat jetzt {connection_count} aktive Verbindung(en)")

    try:
        while True:
            # Auf eine Nachricht vom Client warten (das ist der Whiteboard-Zustand)
            data = await websocket.receive_text()
            
            # Debug: Zeige ersten Teil der Nachricht
            preview = data[:150] + "..." if len(data) > 150 else data
            print(f"📨 Update empfangen für Raum {room_id}: {preview}")
            
            # Den neuen Zustand für den Raum speichern
            try:
                rooms[room_id]["state"] = json.loads(data)
            except json.JSONDecodeError as e:
                print(f"⚠️ JSON Parse Error: {e}")
                continue
            
            # Die empfangene Nachricht an alle ANDEREN Clients im selben Raum senden
            other_clients = [client for client in rooms[room_id]["sockets"] if client != websocket]
            print(f"📤 Sende Update an {len(other_clients)} andere Client(s)")
            
            tasks = []
            for client in other_clients:
                tasks.append(client.send_text(data))
            
            if tasks:
                try:
                    await asyncio.gather(*tasks)
                    print(f"✅ Update erfolgreich verteilt an {len(tasks)} Client(s)")
                except Exception as e:
                    print(f"⚠️ Fehler beim Verteilen: {e}")

    except WebSocketDisconnect:
        # Client aus dem Raum entfernen, wenn die Verbindung abbricht
        print(f"❌ Client getrennt von Raum {room_id}")
        rooms[room_id]["sockets"].remove(websocket)
        remaining = len(rooms[room_id]["sockets"])
        print(f"👥 Raum {room_id} hat noch {remaining} Verbindung(en)")
        
        # Wenn der Raum leer ist, löschen wir ihn (optional, spart Speicher)
        if not rooms[room_id]["sockets"]:
            del rooms[room_id]
            print(f"🗑️ Raum {room_id} gelöscht (keine Verbindungen mehr)")
            print(f"📊 Aktive Räume: {list(rooms.keys())}")
