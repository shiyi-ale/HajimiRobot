import json
import logging
import os
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import ThreadingMixIn
from threading import Condition, Event, Lock, Thread

import cv2


def env_int(name, default):
    value = os.getenv(name)
    if value is None or value == "":
        return default
    return int(value)


def env_float(name, default):
    value = os.getenv(name)
    if value is None or value == "":
        return default
    return float(value)


HOST = os.getenv("CAMERA_HOST", "0.0.0.0")
PORT = env_int("CAMERA_PORT", 5000)
DEVICE = os.getenv(
    "CAMERA_DEVICE",
    "/dev/v4l/by-id/usb-HD_Camera_Manufacturer_USB_2.0_Camera-video-index0",
)
FRAME_WIDTH = env_int("CAMERA_WIDTH", 640)
FRAME_HEIGHT = env_int("CAMERA_HEIGHT", 480)
FPS = env_int("CAMERA_FPS", 20)
JPEG_QUALITY = env_int("CAMERA_JPEG_QUALITY", 60)
SCALE_NUM = env_int("CAMERA_SCALE_NUM", 1)
SCALE_DEN = env_int("CAMERA_SCALE_DEN", 2)
RETRY_INTERVAL = env_float("CAMERA_RETRY_INTERVAL", 1.0)
READ_RETRY_DELAY = env_float("CAMERA_READ_RETRY_DELAY", 0.05)
MAX_READ_FAILURES = env_int("CAMERA_MAX_READ_FAILURES", 10)
LOG_LEVEL = os.getenv("CAMERA_LOG_LEVEL", "INFO").upper()


logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("hajimi.camera_http_stream")

if SCALE_DEN <= 0:
    raise ValueError("CAMERA_SCALE_DEN must be > 0")
if SCALE_NUM <= 0:
    raise ValueError("CAMERA_SCALE_NUM must be > 0")
if FPS <= 0:
    raise ValueError("CAMERA_FPS must be > 0")


class CameraManager(object):
    def __init__(self):
        self._lock = Lock()
        self._frame_condition = Condition()
        self._stop_event = Event()
        self._producer_thread = None
        self._cap = None
        self._read_failures = 0
        self._last_error = None
        self._last_frame_ts = None
        self._last_encoded_ts = None
        self._latest_jpeg = None
        self._latest_frame_id = 0
        self._active_peers = 0

    def _configure_capture(self, cap):
        cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
        cap.set(cv2.CAP_PROP_FPS, FPS)
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, FRAME_WIDTH)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, FRAME_HEIGHT)
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

    def _open_camera_locked(self):
        cap = cv2.VideoCapture(DEVICE, cv2.CAP_V4L2)
        self._configure_capture(cap)
        if not cap.isOpened():
            cap.release()
            raise RuntimeError("Failed to open camera: %s" % DEVICE)
        self._cap = cap
        self._last_error = None
        logger.info("camera_opened device=%s width=%s height=%s fps=%s", DEVICE, FRAME_WIDTH, FRAME_HEIGHT, FPS)
        return cap

    def ensure_open(self):
        with self._lock:
            if self._cap is None or not self._cap.isOpened():
                if self._cap is not None:
                    self._cap.release()
                return self._open_camera_locked()
            return self._cap

    def reopen(self):
        while True:
            with self._lock:
                if self._cap is not None:
                    self._cap.release()
                    self._cap = None
                try:
                    return self._open_camera_locked()
                except RuntimeError as exc:
                    self._last_error = str(exc)
                    logger.warning("camera_reopen_failed error=%s", exc)
            time.sleep(RETRY_INTERVAL)

    def read_frame(self):
        with self._lock:
            try:
                if self._cap is None or not self._cap.isOpened():
                    if self._cap is not None:
                        self._cap.release()
                    self._open_camera_locked()
                ok, frame = self._cap.read()
            except Exception as exc:
                ok = False
                frame = None
                self._last_error = str(exc)

        if not ok:
            with self._lock:
                self._read_failures += 1
                failures = self._read_failures
            if failures >= MAX_READ_FAILURES:
                logger.warning("camera_read_failed threshold=%s reopening_camera=true", failures)
                self.reopen()
                with self._lock:
                    self._read_failures = 0
            time.sleep(READ_RETRY_DELAY)
            return False, None

        with self._lock:
            self._read_failures = 0
            self._last_frame_ts = time.time()
        return True, frame

    def start(self):
        with self._lock:
            if self._producer_thread is not None and self._producer_thread.is_alive():
                return
            self._stop_event.clear()
            self._producer_thread = Thread(target=self._producer_loop, name="camera-frame-producer")
            self._producer_thread.daemon = True
            self._producer_thread.start()

    def _producer_loop(self):
        logger.info("frame_producer_start fps=%s quality=%s", FPS, JPEG_QUALITY)
        frame_interval = 1.0 / FPS
        while not self._stop_event.is_set():
            started_at = time.time()
            ok, frame = self.read_frame()
            if ok:
                ok, jpeg = self._encode_frame(frame)
                if ok:
                    with self._frame_condition:
                        self._latest_jpeg = jpeg
                        self._latest_frame_id += 1
                        self._last_encoded_ts = time.time()
                        self._frame_condition.notify_all()
                else:
                    logger.warning("jpeg_encode_failed")

            elapsed = time.time() - started_at
            self._stop_event.wait(max(0.0, frame_interval - elapsed))
        logger.info("frame_producer_stop")

    def _encode_frame(self, frame):
        if SCALE_NUM != SCALE_DEN:
            scaled_width = max(1, int(frame.shape[1] * SCALE_NUM / SCALE_DEN))
            scaled_height = max(1, int(frame.shape[0] * SCALE_NUM / SCALE_DEN))
            frame = cv2.resize(
                frame,
                (scaled_width, scaled_height),
                interpolation=cv2.INTER_AREA,
            )

        ok, jpeg = cv2.imencode(
            ".jpg",
            frame,
            [int(cv2.IMWRITE_JPEG_QUALITY), JPEG_QUALITY],
        )
        if not ok:
            return False, None
        return True, jpeg.tobytes()

    def wait_for_jpeg(self, last_frame_id, timeout):
        deadline = time.time() + timeout
        with self._frame_condition:
            while self._latest_jpeg is None or self._latest_frame_id <= last_frame_id:
                remaining = deadline - time.time()
                if remaining <= 0:
                    return None, last_frame_id
                self._frame_condition.wait(remaining)
            return self._latest_jpeg, self._latest_frame_id

    def add_peer(self):
        with self._lock:
            self._active_peers += 1

    def remove_peer(self):
        with self._lock:
            self._active_peers = max(0, self._active_peers - 1)

    def health(self):
        with self._lock:
            camera_open = self._cap is not None and self._cap.isOpened()
            active_peers = self._active_peers
            last_error = self._last_error
            last_frame_ts = self._last_frame_ts
        with self._frame_condition:
            last_encoded_ts = self._last_encoded_ts
            latest_frame_id = self._latest_frame_id

        if camera_open and last_encoded_ts is not None:
            pipeline_state = "streaming_ready"
            status = "ok"
        elif camera_open:
            pipeline_state = "warming_up"
            status = "degraded"
        else:
            pipeline_state = "degraded"
            status = "degraded"
        return {
            "status": status,
            "role": "jetson-embedded-video-endpoint",
            "camera_open": camera_open,
            "pipeline_state": pipeline_state,
            "active_peers": active_peers,
            "device": DEVICE,
            "implementation": "mjpeg_http_latest_frame",
            "stream": {
                "transport": "http",
                "format": "mjpeg",
                "path": "/video",
                "fps": FPS,
            },
            "last_error": last_error,
            "last_frame_ts": last_frame_ts,
            "last_encoded_ts": last_encoded_ts,
            "latest_frame_id": latest_frame_id,
        }

    def config(self):
        output_width = max(1, int(FRAME_WIDTH * SCALE_NUM / SCALE_DEN))
        output_height = max(1, int(FRAME_HEIGHT * SCALE_NUM / SCALE_DEN))
        return {
            "codec": "MJPEG",
            "resolution": {"width": output_width, "height": output_height},
            "source_resolution": {"width": FRAME_WIDTH, "height": FRAME_HEIGHT},
            "fps": FPS,
            "quality": JPEG_QUALITY,
            "scale": {"num": SCALE_NUM, "den": SCALE_DEN},
            "role": "http-stream-endpoint",
            "camera_device": DEVICE,
            "transport": "http",
            "stream_path": "/video",
            "health_path": "/healthz",
            "viewer_path": "/",
            "implementation": "latest-frame-mjpeg-service",
        }

    def close(self):
        self._stop_event.set()
        with self._frame_condition:
            self._frame_condition.notify_all()
        if self._producer_thread is not None and self._producer_thread.is_alive():
            self._producer_thread.join(2.0)
        with self._lock:
            if self._cap is not None:
                self._cap.release()
                self._cap = None


camera_manager = CameraManager()


class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


class StreamHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path in ("/", "/index.html"):
            self._write_html(self._viewer_html())
            return

        if self.path == "/healthz":
            self._write_json(200, camera_manager.health())
            return

        if self.path == "/video/config":
            self._write_json(200, camera_manager.config())
            return

        if self.path == "/video":
            self._stream_video()
            return

        self.send_error(404)

    def _stream_video(self):
        self.send_response(200)
        self.send_header("Cache-Control", "no-cache, private")
        self.send_header("Pragma", "no-cache")
        self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
        self.end_headers()

        logger.info("stream_client_connected client=%s", self.client_address[0])
        camera_manager.add_peer()
        last_frame_id = 0

        try:
            while True:
                jpeg, last_frame_id = camera_manager.wait_for_jpeg(last_frame_id, 2.0)
                if jpeg is None:
                    continue

                try:
                    self.wfile.write(b"--frame\r\n")
                    self.wfile.write(b"Content-Type: image/jpeg\r\n")
                    self.wfile.write(("Content-Length: %d\r\n\r\n" % len(jpeg)).encode("utf-8"))
                    self.wfile.write(jpeg)
                    self.wfile.write(b"\r\n")
                except (BrokenPipeError, ConnectionResetError, OSError):
                    logger.info("stream_client_disconnected client=%s", self.client_address[0])
                    return
        finally:
            camera_manager.remove_peer()

    def _write_json(self, status_code, payload):
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _write_html(self, html):
        data = html.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _viewer_html(self):
        return """\
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Hajimi Jetson Camera</title>
  <style>
    body { margin: 0; background: #111; color: #eee; font-family: sans-serif; text-align: center; }
    main { padding: 24px; }
    img { max-width: 95vw; max-height: 82vh; border: 2px solid #444; background: #000; }
    p { color: #bbb; }
  </style>
</head>
<body>
  <main>
    <h1>Hajimi Jetson Camera Stream</h1>
    <p>Embedded-side MJPEG debug and integration stream.</p>
    <img src="/video" alt="Jetson camera stream">
  </main>
</body>
</html>
"""

    def log_message(self, format, *args):
        return


if __name__ == "__main__":
    logger.info("service_start host=%s port=%s device=%s", HOST, PORT, DEVICE)
    camera_manager.start()
    server = ThreadedHTTPServer((HOST, PORT), StreamHandler)
    try:
        server.serve_forever()
    finally:
        logger.info("service_stop")
        camera_manager.close()
