from __future__ import annotations

import asyncio

from fastapi import APIRouter, Header, HTTPException, Query, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field

from .services.nearby import BridgeRooms, NearbyError, Radar, verify_device

router = APIRouter(prefix='/v1')
rooms = BridgeRooms()
radar = Radar(rooms)

radar_sockets: dict[str, set[WebSocket]] = {}
room_sockets: dict[str, set[tuple[str, WebSocket]]] = {}


def push(socket: WebSocket, payload: dict) -> None:
    async def send() -> None:
        try:
            await socket.send_json(payload)
        except Exception:
            pass
    try:
        asyncio.get_running_loop().create_task(send())
    except RuntimeError:
        pass


def on_radar_event(device: str, event: dict) -> None:
    for socket in list(radar_sockets.get(device, ())):
        push(socket, event)


def on_room_event(code: str, event: dict) -> None:
    for device, socket in list(room_sockets.get(code, ())):
        if event['event'] == 'message':
            push(socket, {'event': 'message', 'message': rooms.view_for(event['message'], device)})
        else:
            push(socket, event)


radar.subscribe(on_radar_event)
rooms.subscribe(on_room_event)


def who(device_id: str | None, secret: str | None) -> str:
    try:
        return verify_device(device_id, secret)
    except NearbyError as error:
        raise HTTPException(error.status, error.detail) from error


def guard(call, *args, **kwargs):
    try:
        return call(*args, **kwargs)
    except NearbyError as error:
        raise HTTPException(error.status, error.detail) from error


class BridgeMessageIn(BaseModel):
    session_id: str = Field(min_length=1, max_length=16)
    sender_role: str = Field(max_length=16)
    text: str = Field(min_length=1, max_length=2000)
    client_id: str | None = Field(None, max_length=80)


class Heartbeat(BaseModel):
    role: str = Field(max_length=16)
    lat: float | None = Field(None, ge=-90, le=90)
    lon: float | None = Field(None, ge=-180, le=180)
    beacon: str | None = Field(None, max_length=64)


class OfferReply(BaseModel):
    offer_id: str = Field(min_length=1, max_length=40)
    accept: bool


@router.post('/bridge/conversations')
async def bridge_create(x_device_id: str | None = Header(None), x_device_secret: str | None = Header(None)):
    return guard(rooms.create, who(x_device_id, x_device_secret))


@router.post('/bridge/conversations/{code}/join')
async def bridge_join(code: str, x_device_id: str | None = Header(None), x_device_secret: str | None = Header(None)):
    return guard(rooms.join, code, who(x_device_id, x_device_secret))


@router.get('/bridge/conversations/{code}')
async def bridge_get(code: str, x_device_id: str | None = Header(None), x_device_secret: str | None = Header(None)):
    return guard(rooms.get, code, who(x_device_id, x_device_secret))


@router.post('/bridge/message')
async def bridge_post(body: BridgeMessageIn, x_device_id: str | None = Header(None), x_device_secret: str | None = Header(None)):
    device = who(x_device_id, x_device_secret)
    return guard(rooms.post, body.session_id, device, body.sender_role, body.text, body.client_id)


@router.get('/bridge/messages')
async def bridge_messages(session_id: str = Query(max_length=16), after_id: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=200),
                          x_device_id: str | None = Header(None), x_device_secret: str | None = Header(None)):
    return guard(rooms.messages, session_id, who(x_device_id, x_device_secret), after_id, limit)


@router.post('/radar/heartbeat')
async def radar_heartbeat(body: Heartbeat, x_device_id: str | None = Header(None), x_device_secret: str | None = Header(None)):
    return guard(radar.heartbeat, who(x_device_id, x_device_secret), body.role, body.lat, body.lon, body.beacon)


@router.post('/radar/respond')
async def radar_respond(body: OfferReply, x_device_id: str | None = Header(None), x_device_secret: str | None = Header(None)):
    return guard(radar.respond, who(x_device_id, x_device_secret), body.offer_id, body.accept)


@router.post('/radar/leave')
async def radar_leave(x_device_id: str | None = Header(None), x_device_secret: str | None = Header(None)):
    radar.leave(who(x_device_id, x_device_secret))
    return {'active': False}


async def identify(socket: WebSocket) -> str | None:
    await socket.accept()
    try:
        hello = await asyncio.wait_for(socket.receive_json(), timeout=10)
        return verify_device(hello.get('device_id'), hello.get('secret'))
    except (NearbyError, asyncio.TimeoutError, ValueError, AttributeError):
        await socket.close(code=4401)
        return None


@router.websocket('/radar/ws')
async def radar_socket(socket: WebSocket):
    device = await identify(socket)
    if device is None:
        return
    radar_sockets.setdefault(device, set()).add(socket)
    await socket.send_json({'event': 'state', **radar.state(device)})
    try:
        while True:
            data = await socket.receive_json()
            try:
                if data.get('type') == 'heartbeat':
                    beat = Heartbeat(**{key: data.get(key) for key in ('role', 'lat', 'lon', 'beacon')})
                    state = radar.heartbeat(device, beat.role, beat.lat, beat.lon, beat.beacon)
                elif data.get('type') == 'respond':
                    state = radar.respond(device, str(data.get('offer_id', '')), bool(data.get('accept')))
                elif data.get('type') == 'leave':
                    radar.leave(device)
                    state = radar.state(device)
                else:
                    continue
                await socket.send_json({'event': 'state', **state})
            except NearbyError as error:
                await socket.send_json({'event': 'error', 'detail': error.detail})
            except ValueError as error:
                await socket.send_json({'event': 'error', 'detail': str(error)[:200]})
    except WebSocketDisconnect:
        pass
    finally:
        radar_sockets.get(device, set()).discard(socket)
        if not radar_sockets.get(device):
            radar_sockets.pop(device, None)


@router.websocket('/bridge/ws/{code}')
async def bridge_socket(socket: WebSocket, code: str):
    device = await identify(socket)
    if device is None:
        return
    if not rooms.is_member(code, device):
        await socket.close(code=4403)
        return
    entry = (device, socket)
    room_sockets.setdefault(code, set()).add(entry)
    await socket.send_json({'event': 'state', **rooms.get(code, device)})
    try:
        while True:
            data = await socket.receive_json()
            if data.get('type') != 'message':
                continue
            try:
                sent = rooms.post(code, device, str(data.get('sender_role', '')), str(data.get('text', '')), data.get('client_id'))
                await socket.send_json({'event': 'sent', 'message': sent})
            except NearbyError as error:
                await socket.send_json({'event': 'error', 'detail': error.detail})
    except WebSocketDisconnect:
        pass
    finally:
        room_sockets.get(code, set()).discard(entry)
        if not room_sockets.get(code):
            room_sockets.pop(code, None)
