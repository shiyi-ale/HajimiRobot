import time
from smbus2 import SMBus


class Gimbal:
    MODE1 = 0x00
    PRESCALE = 0xFE
    LED0_ON_L = 0x06

    def __init__(
        self,
        bus_id=0,
        address=0x40,
        pan_ch=15,
        tilt_ch=0,

        # 校准后的安全极限
        pan_min=760,       # 左
        pan_max=2200,      # 右
        tilt_min=1020,     # 上
        tilt_max=2170,     # 下

        pan_center=1500,
        tilt_center=1500,
        freq=50,
    ):
        self.bus = SMBus(bus_id)
        self.address = address

        self.pan_ch = pan_ch
        self.tilt_ch = tilt_ch

        self.pan_min = pan_min
        self.pan_max = pan_max
        self.tilt_min = tilt_min
        self.tilt_max = tilt_max

        self.pan_center = pan_center
        self.tilt_center = tilt_center

        self.pan_us = pan_center
        self.tilt_us = tilt_center

        self.freq = freq
        self._init_pca9685()

    def _write8(self, reg, val):
        self.bus.write_byte_data(self.address, reg, val)

    def _read8(self, reg):
        return self.bus.read_byte_data(self.address, reg)

    def _init_pca9685(self):
        self._write8(self.MODE1, 0x00)
        time.sleep(0.05)

        prescale = int(round(25000000.0 / (4096 * self.freq)) - 1)

        oldmode = self._read8(self.MODE1)
        sleep_mode = (oldmode & 0x7F) | 0x10

        self._write8(self.MODE1, sleep_mode)
        self._write8(self.PRESCALE, prescale)
        self._write8(self.MODE1, oldmode)
        time.sleep(0.01)
        self._write8(self.MODE1, oldmode | 0xA1)

    @staticmethod
    def _clamp(value, low, high):
        return max(low, min(high, int(value)))

    def _set_pwm(self, channel, on, off):
        reg = self.LED0_ON_L + 4 * channel
        self.bus.write_i2c_block_data(self.address, reg, [
            on & 0xFF,
            on >> 8,
            off & 0xFF,
            off >> 8,
        ])

    def set_servo_us(self, channel, pulse_us):
        tick = int(pulse_us * 4096 / 20000)
        self._set_pwm(channel, 0, tick)

    def move_to(self, pan=None, tilt=None, smooth=False, step_us=20, delay=0.02):
        target_pan = self.pan_us if pan is None else self._clamp(pan, self.pan_min, self.pan_max)
        target_tilt = self.tilt_us if tilt is None else self._clamp(tilt, self.tilt_min, self.tilt_max)

        if smooth:
            start_pan = self.pan_us
            start_tilt = self.tilt_us

            max_delta = max(abs(target_pan - start_pan), abs(target_tilt - start_tilt))
            steps = max(1, int(max_delta / max(1, step_us)))

            for i in range(1, steps + 1):
                p = int(start_pan + (target_pan - start_pan) * i / steps)
                t = int(start_tilt + (target_tilt - start_tilt) * i / steps)

                self.set_servo_us(self.pan_ch, p)
                self.set_servo_us(self.tilt_ch, t)
                time.sleep(delay)
        else:
            self.set_servo_us(self.pan_ch, target_pan)
            self.set_servo_us(self.tilt_ch, target_tilt)

        self.pan_us = target_pan
        self.tilt_us = target_tilt

        return self.status()

    def center(self, smooth=True):
        return self.move_to(self.pan_center, self.tilt_center, smooth=smooth)

    def left(self, step=50, smooth=False):
        # 你的云台 PAN 数值变大 = 向左
        return self.move_to(pan=self.pan_us + step, smooth=smooth)

    def right(self, step=50, smooth=False):
        # 你的云台 PAN 数值变小 = 向右
        return self.move_to(pan=self.pan_us - step, smooth=smooth)

    def up(self, step=50, smooth=False):
        # 注意：你的云台 TILT 数值变小 = 向上
        return self.move_to(tilt=self.tilt_us - step, smooth=smooth)

    def down(self, step=50, smooth=False):
        # 注意：你的云台 TILT 数值变大 = 向下
        return self.move_to(tilt=self.tilt_us + step, smooth=smooth)

    def full_left(self, smooth=True):
        return self.move_to(pan=self.pan_min, smooth=smooth)

    def full_right(self, smooth=True):
        return self.move_to(pan=self.pan_max, smooth=smooth)

    def full_up(self, smooth=True):
        return self.move_to(tilt=self.tilt_min, smooth=smooth)

    def full_down(self, smooth=True):
        return self.move_to(tilt=self.tilt_max, smooth=smooth)

    def status(self):
        return {
            "pan_us": self.pan_us,
            "tilt_us": self.tilt_us,
            "pan_ch": self.pan_ch,
            "tilt_ch": self.tilt_ch,
        }

    def release(self):
        self._set_pwm(self.pan_ch, 0, 4096)
        self._set_pwm(self.tilt_ch, 0, 4096)

    def close(self):
        self.bus.close()
