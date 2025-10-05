import asyncio
import json
import random
import string
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
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


# Dieses Dictionary speichert alle aktiven Räume und die WebSocket-Verbindungen.
# Format: { "raum_id": { "sockets": {websocket1, websocket2, ...}, "state": {...} } }
rooms = {}

class RoomCreationRequest(BaseModel):
    room_name: str

class RoomJoinRequest(BaseModel):
    room_id: str
    username: str

# --- NEUE HTTP-ENDPUNKTE ---

@app.post("/api/room/create")
async def create_room(request: RoomCreationRequest):
    # Erstelle eine zufällige, 8-stellige Raum-ID
    room_id = ''.join(random.choices(string.ascii_lowercase + string.digits, k=8))
    
    # Initialisiere den Raum im Speicher
    rooms[room_id] = {
        "sockets": set(),
        "state": {"items": [], "connections": []}
    }
    
    print(f"✅ Raum erstellt: {room_id} (Name: {request.room_name})")
    print(f"📊 Aktive Räume: {list(rooms.keys())}")
    
    return {"success": True, "room_id": room_id}

@app.post("/api/room/join")
async def join_room(request: RoomJoinRequest):
    if request.room_id not in rooms:
        print(f"⚠️ Raum {request.room_id} existiert nicht, erstelle neuen Raum")
        # Optional: Raum erstellen, wenn er nicht existiert
        # raise HTTPException(status_code=404, detail="Room not found")
        rooms[request.room_id] = {
            "sockets": set(),
            "state": {"items": [], "connections": []}
        }
    else:
        print(f"✅ User {request.username} tritt Raum {request.room_id} bei")

    # Den aktuellen Zustand des Raumes zurückgeben, wenn jemand beitritt
    return {
        "success": True, 
        "user_id": ''.join(random.choices(string.ascii_lowercase, k=10)), # Simuliere eine User-ID
        "room_state": rooms[request.room_id]["state"]
    }


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
