#!/usr/bin/env python3

import socket


class BluetoothCar:
    def __init__(
        self,
        addr="00:25:06:01:09:07",
        port=1,
        auto_connect=True,
    ):
        self.addr = addr
        self.port = port
        self.sock = None

        if auto_connect:
            self.connect()

    def connect(self):
        if self.sock is not None:
            return

        print(f"正在连接 HC-05: {self.addr} ...")

        self.sock = socket.socket(
            socket.AF_BLUETOOTH,
            socket.SOCK_STREAM,
            socket.BTPROTO_RFCOMM
        )

        self.sock.connect((self.addr, self.port))
        print("HC-05 连接成功")

    def close(self):
        if self.sock is not None:
            try:
                self.sock.close()
            finally:
                self.sock = None
                print("蓝牙断开")

    def send_cmd(self, cmd):
        if self.sock is None:
            raise RuntimeError("蓝牙未连接，请先调用 connect()")

        self.sock.send(cmd.encode("ascii"))
        print(f"发送: {cmd}")

    def forward(self):
        self.send_cmd("F")

    def backward(self):
        self.send_cmd("B")

    def left(self):
        self.send_cmd("L")

    def right(self):
        self.send_cmd("R")

    def stop(self):
        self.send_cmd("S")

    def feed(self):
        self.send_cmd("G")
        print("执行投喂")
        return True

    def handle_key(self, key):
        key = key.upper()

        if key in ("W", "F"):
            self.forward()
            return "forward"

        if key in ("X", "B"):
            self.backward()
            return "backward"

        if key in ("A", "L"):
            self.left()
            return "left"

        if key in ("D", "R"):
            self.right()
            return "right"

        if key in ("S", " "):
            self.stop()
            return "stop"

        if key == "G":
            self.feed()
            return "feed"

        return None

    def __enter__(self):
        self.connect()
        return self

    def __exit__(self, exc_type, exc, tb):
        try:
            self.stop()
        except Exception:
            pass
        self.close()
