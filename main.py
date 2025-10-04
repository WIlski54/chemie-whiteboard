import asyncio
import json
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse

app = FastAPI()

# Dieses Dictionary speichert alle aktiven Räume.
# Format: { "raum_id": {websocket1, websocket2, ...} }
rooms = {}

@app.websocket("/ws/{room_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str):
    await websocket.accept()

    # Client zum Raum hinzufügen
    if room_id not in rooms:
        rooms[room_id] = set()
    rooms[room_id].add(websocket)

    try:
        while True:
            # Auf eine Nachricht vom Client warten
            data = await websocket.receive_text()
            
            # Die empfangene Nachricht an alle ANDEREN Clients im selben Raum senden
            # Wir nutzen asyncio.gather, um alle Nachrichten parallel zu versenden
            tasks = []
            for client in rooms[room_id]:
                if client != websocket:
                    tasks.append(client.send_text(data))
            await asyncio.gather(*tasks)

    except WebSocketDisconnect:
        # Client aus dem Raum entfernen, wenn die Verbindung abbricht
        rooms[room_id].remove(websocket)
        # Wenn der Raum leer ist, löschen wir ihn
        if not rooms[room_id]:
            del rooms[room_id]