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
    
    return {"success": True, "room_id": room_id}

@app.post("/api/room/join")
async def join_room(request: RoomJoinRequest):
    if request.room_id not in rooms:
        # Optional: Raum erstellen, wenn er nicht existiert
        # raise HTTPException(status_code=404, detail="Room not found")
        rooms[request.room_id] = {
            "sockets": set(),
            "state": {"items": [], "connections": []}
        }

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

    # Client zum Raum hinzufügen
    if room_id not in rooms:
        # Verbindung ablehnen, wenn der Raum nicht existiert
        await websocket.close(code=1008)
        return
        
    rooms[room_id]["sockets"].add(websocket)

    try:
        while True:
            # Auf eine Nachricht vom Client warten (das ist der Whiteboard-Zustand)
            data = await websocket.receive_text()
            
            # Den neuen Zustand für den Raum speichern
            rooms[room_id]["state"] = json.loads(data)
            
            # Die empfangene Nachricht an alle ANDEREN Clients im selben Raum senden
            tasks = []
            for client in rooms[room_id]["sockets"]:
                if client != websocket:
                    tasks.append(client.send_text(data))
            
            if tasks:
                await asyncio.gather(*tasks)

    except WebSocketDisconnect:
        # Client aus dem Raum entfernen, wenn die Verbindung abbricht
        rooms[room_id]["sockets"].remove(websocket)
        # Wenn der Raum leer ist, löschen wir ihn (optional, spart Speicher)
        if not rooms[room_id]["sockets"]:
            del rooms[room_id]
