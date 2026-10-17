"""ROI motion filtering and monotonic-time inference scheduling, shared with edge."""
import cv2
import numpy as np
from .models import CameraConfig

class Scheduler:
    def __init__(self, config: CameraConfig):
        self.c = config
        self.reset()

    def reset(self, now=0.):
        self.started = now
        self.high_since = self.low_since = None
        self.state = 'warming'
        self.last_inference = float('-inf')

    def update(self, ratio, now, global_change=False):
        if global_change:
            self.reset(now)
        if now - self.started < self.c.warmup_sec:
            self.state = 'warming'
            return False
        if ratio >= self.c.rise_ratio:
            self.low_since = None
            if self.high_since is None:
                self.high_since = now
            self.state = 'active' if now - self.high_since >= self.c.rise_sec else 'candidate'
        elif ratio < self.c.fall_ratio:
            self.high_since = None
            if self.low_since is None:
                self.low_since = now
            if self.state == 'warming' or now - self.low_since >= self.c.fall_sec:
                self.state = 'idle'
        else:
            self.high_since = None
            self.low_since = None
            if self.state == 'warming':
                self.state = 'candidate'
        fps = {'idle': self.c.idle_fps, 'candidate': self.c.candidate_fps, 'active': self.c.active_fps}[self.state]
        if now - self.last_inference >= 1 / fps - 1e-6:
            self.last_inference = now
            return True
        return False

class MotionDetector:
    def __init__(self, config):
        self.c = config
        self.reset()

    def reset(self):
        self.background = cv2.createBackgroundSubtractorMOG2(history=250, varThreshold=25, detectShadows=True)
        self.previous_gray = None

    def measure(self, frame):
        small = cv2.resize(frame, (320, 180))
        gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
        global_change = False
        if self.previous_gray is not None:
            global_change = float(np.mean(cv2.absdiff(gray, self.previous_gray) > 45)) > .8
        self.previous_gray = gray
        fg = (self.background.apply(small) == 255).astype('uint8') * 255
        fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        mask = np.zeros((180, 320), dtype=np.uint8)
        points = np.array([(round(x * 319), round(y * 179)) for x, y in self.c.roi], np.int32)
        cv2.fillPoly(mask, [points], 255)
        ratio = np.count_nonzero(fg & mask) / max(1, np.count_nonzero(mask))
        return float(ratio), global_change
