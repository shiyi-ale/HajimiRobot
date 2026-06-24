#!/usr/bin/env python3

import json
import os
import subprocess
import threading
import urllib.error
import urllib.request
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from car_driver import BluetoothCar
from gimbal_driver import Gimbal


app = FastAPI(title="Hajime Jetson Bridge")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


car: Optional[BluetoothCar] = None
gimbal: Optional[Gimbal] = None

car_lock = threading.Lock()
gimbal_lock = threading.Lock()

last_car_action = "stop"
CAMERA_BASE_URL = os.getenv("CAMERA_BASE_URL", "http://127.0.0.1:5000").rstrip("/")
CAMERA_PUBLIC_BASE_URL = os.getenv("CAMERA_PUBLIC_BASE_URL", CAMERA_BASE_URL).rstrip("/")
CAMERA_PROXY_TIMEOUT = float(os.getenv("CAMERA_PROXY_TIMEOUT", "5"))

state = {
    "car_connected": False,
    "gimbal_ready": False,
    "last_error": None,
}

def camera_url(path: str) -> str:
    if not path.startswith("/"):
        path = "/" + path
    return CAMERA_BASE_URL + path


def camera_public_url(path: str) -> str:
    if not path.startswith("/"):
        path = "/" + path
    return CAMERA_PUBLIC_BASE_URL + path


def camera_proxy_error(exc: Exception):
    state["last_error"] = f"camera proxy failed: {exc}"
    raise HTTPException(status_code=502, detail=state["last_error"])


def fetch_camera_json(path: str):
    try:
        with urllib.request.urlopen(camera_url(path), timeout=CAMERA_PROXY_TIMEOUT) as response:
            return json.loads(response.read().decode("utf-8"))
    except (OSError, ValueError, urllib.error.URLError) as exc:
        camera_proxy_error(exc)


class GimbalMoveRequest(BaseModel):
    pan: Optional[int] = None
    tilt: Optional[int] = None
    smooth: bool = True


def init_gimbal():
    global gimbal

    if gimbal is None:
        gimbal = Gimbal(
            bus_id=0,
            address=0x40,
            pan_ch=15,
            tilt_ch=0,
            pan_min=760,
            pan_max=2200,
            tilt_min=1020,
            tilt_max=2170,
            pan_center=1500,
            tilt_center=1500,
        )
        state["gimbal_ready"] = True

    return gimbal


def init_car():
    global car

    if car is None:
        car = BluetoothCar(
            addr="00:25:06:01:09:07",
            port=1,
            auto_connect=True,
        )
        state["car_connected"] = True

    return car


def safe_car_stop():
    global last_car_action

    try:
        if car is not None:
            with car_lock:
                car.stop()
                last_car_action = "stop"
    except Exception as e:
        state["last_error"] = f"car stop failed: {e}"


@app.on_event("startup")
def startup():
    try:
        init_gimbal()
    except Exception as e:
        state["gimbal_ready"] = False
        state["last_error"] = f"gimbal init failed: {e}"

    try:
        init_car()
    except Exception as e:
        state["car_connected"] = False
        state["last_error"] = f"car init failed: {e}"


@app.on_event("shutdown")
def shutdown():
    safe_car_stop()

    try:
        if gimbal is not None:
            gimbal.center(smooth=True)
            gimbal.close()
    except Exception:
        pass

    try:
        if car is not None:
            car.close()
    except Exception:
        pass


@app.get("/healthz")
def healthz():
    return {
        "ok": True,
        "service": "jetson_bridge",
        "car_connected": state["car_connected"],
        "gimbal_ready": state["gimbal_ready"],
        "last_error": state["last_error"],
        "car_command_mode": "single_character_per_request",
        "car_watchdog_timeout": 0,
        "car_pulse_seconds": 0,
        "car_stop_burst_count": 1,
        "car_stop_burst_interval": 0,
    }


@app.get("/api/status")
def api_status():
    result = {
        "ok": True,
        "car_connected": state["car_connected"],
        "gimbal_ready": state["gimbal_ready"],
        "last_car_action": last_car_action,
        "last_error": state["last_error"],
    }

    if gimbal is not None:
        result["gimbal"] = gimbal.status()

    result["car_command_mode"] = "single_character_per_request"
    result["car_watchdog_timeout"] = 0
    result["car_pulse_seconds"] = 0
    result["car_stop_burst_count"] = 1
    result["car_stop_burst_interval"] = 0

    return result


@app.get("/video")
def video_redirect():
    return RedirectResponse(url=camera_public_url("/video"))


@app.get("/api/video/live")
def api_video_live():
    return RedirectResponse(url=camera_public_url("/video"))


@app.get("/api/video/config")
def api_video_config():
    return fetch_camera_json("/video/config")


@app.get("/api/video/healthz")
def api_video_healthz():
    return fetch_camera_json("/healthz")


@app.post("/api/system/shutdown")
def api_system_shutdown(confirm: bool = False):
    if not confirm:
        raise HTTPException(
            status_code=400,
            detail="add ?confirm=true to shut down this Jetson",
        )

    shutdown_command = (
        "sleep 1; "
        "systemctl --user stop hajimi-camera.service; "
        "systemctl --user stop hajimi-bridge.service; "
        "systemctl poweroff || loginctl poweroff || sudo -n shutdown -h now"
    )

    try:
        subprocess.Popen(
            [
                "systemd-run",
                "--user",
                "--unit",
                "hajimi-shutdown",
                "--collect",
                "/bin/sh",
                "-lc",
                shutdown_command,
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except Exception as exc:
        state["last_error"] = f"shutdown scheduling failed: {exc}"
        raise HTTPException(status_code=500, detail=state["last_error"])

    return {
        "ok": True,
        "message": "shutdown scheduled",
    }


@app.post("/api/car/reconnect")
def car_reconnect():
    global car

    try:
        if car is not None:
            car.close()

        car = None
        init_car()

        return {
            "ok": True,
            "car_connected": True,
        }

    except Exception as e:
        state["car_connected"] = False
        state["last_error"] = str(e)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/car/{action}")
def car_action(action: str):
    global last_car_action

    action = action.lower()

    try:
        c = init_car()

        with car_lock:
            if action in ("forward", "f"):
                c.forward()
                last_car_action = "forward"

            elif action in ("backward", "back", "b"):
                c.backward()
                last_car_action = "backward"

            elif action in ("left", "l"):
                c.left()
                last_car_action = "left"

            elif action in ("right", "r"):
                c.right()
                last_car_action = "right"

            elif action in ("stop", "s"):
                c.stop()
                last_car_action = "stop"

            elif action in ("feed", "g"):
                executed = c.feed()
                return {
                    "ok": True,
                    "action": "feed",
                    "executed": executed,
                }

            else:
                raise HTTPException(
                    status_code=400,
                    detail=f"unknown car action: {action}",
                )

        return {
            "ok": True,
            "action": last_car_action,
            "command_mode": "single_character_per_request",
            "pulse_seconds": 0,
        }

    except HTTPException:
        raise

    except Exception as e:
        state["car_connected"] = False
        state["last_error"] = str(e)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/gimbal/{action}")
def gimbal_action(action: str, step: int = 20):
    action = action.lower()

    try:
        g = init_gimbal()

        with gimbal_lock:
            if action == "up":
                result = g.up(step=step, smooth=False)

            elif action == "down":
                result = g.down(step=step, smooth=False)

            elif action == "left":
                result = g.left(step=step, smooth=False)

            elif action == "right":
                result = g.right(step=step, smooth=False)

            elif action == "center":
                result = g.center(smooth=True)

            elif action == "release":
                g.release()
                result = g.status()

            elif action == "full_left":
                result = g.full_left(smooth=True)

            elif action == "full_right":
                result = g.full_right(smooth=True)

            elif action == "full_up":
                result = g.full_up(smooth=True)

            elif action == "full_down":
                result = g.full_down(smooth=True)

            else:
                raise HTTPException(
                    status_code=400,
                    detail=f"unknown gimbal action: {action}",
                )

        return {
            "ok": True,
            "action": action,
            "gimbal": result,
        }

    except HTTPException:
        raise

    except Exception as e:
        state["gimbal_ready"] = False
        state["last_error"] = str(e)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/gimbal/move")
def gimbal_move(req: GimbalMoveRequest):
    try:
        g = init_gimbal()

        with gimbal_lock:
            result = g.move_to(
                pan=req.pan,
                tilt=req.tilt,
                smooth=req.smooth,
            )

        return {
            "ok": True,
            "gimbal": result,
        }

    except Exception as e:
        state["last_error"] = str(e)
        raise HTTPException(status_code=500, detail=str(e))
