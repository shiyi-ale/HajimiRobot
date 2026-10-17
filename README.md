<div align="right">

[English](./README.md) | [简体中文](./README.zh-CN.md)

</div>

<div align="center">
  <img src="./assets/logo.png" alt="HajimiRobot logo" width="820" />
</div>

# HajimiRobot — AI-Powered Mobile Pet-Care Robot

**Embedded robotics · Edge AI · Computer vision · Full-stack AIoT · Engineering prototyping**

HajimiRobot is a collaborative engineering prototype developed in the context of the **UESTC × ESIGELEC** project program. It combines a mobile robot, a camera gimbal, an STM32 microcontroller, a Jetson Nano edge computer, a web control console, and a six-class cat-behavior recognition pipeline.

The motivating problem: stationary pet-care devices are limited in how they can observe and interact with pets across a home. This project explores **mobile monitoring, remotely controlled feeding, visual behavior recognition, and event-based reporting** in one integrated system.

> **Scope:** This is an educational/research engineering prototype, not a commercially certified pet-care product. This README distinguishes implemented software, reported experiments, and future ideas.

## At a glance

| Area | Technology / evidence |
|---|---|
| Robot platform | Jetson Nano A02 + STM32F407; omni-directional chassis; feeding actuator |
| Interfaces | HC-05 Bluetooth; I2C PCA9685 + MG90S pan/tilt servos; PWM/GPIO |
| Edge services | Python FastAPI bridge; dual MJPEG camera services; user-level systemd |
| Web console | React 19, TypeScript, Vite, Tailwind CSS 4; Node.js/Express backend |
| Vision | YOLO26, six cat-behavior classes, ONNX and TensorRT FP16 deployment |
| Model optimization | Wavelet Feature Distillation (WFD), teacher YOLO26x → student YOLO26n |
| Engineering process | Hardware/software integration, peripheral debugging, API testing, latency measurement |

## System architecture

~~~text
Browser (React / TypeScript)
      |
      | HTTP / WebSocket
      v
Local Express backend (port 3001)
      |
      +---- Camera services on Jetson (ports 5000 / 5001)
      |
      +---- Jetson FastAPI Bridge (port 8000)
                    |
                    +-- Camera / YOLO events
                    +-- I2C → PCA9685 → pan/tilt servos
                    +-- Bluetooth HC-05 → STM32F407
                                            |
                                            +-- mobile chassis
                                            +-- feeding actuator
~~~

The division of work is intentional: **Jetson handles perception and application-level coordination; STM32 handles lower-level robot control.** See the [Jetson services](./Jetson-Edge/README.md), [Web Console](./Web-Console/README.md), and [Hardware](./Hardware/README.md) for actual modules.

## What the prototype demonstrates

### 1. Embedded hardware and integration

- An STM32F407 control path for mobile chassis and feeding commands, integrated with Jetson via an HC-05 Bluetooth link.
- A two-axis camera gimbal using PCA9685 and MG90S servos.
- Debugging across actuator power, I2C device discovery, command routing, and safe servo movement limits.
- A custom STM32 PCB **designed/manufactured as a team effort**, documented in the project presentation. The publicly committed hardware folder currently focuses on the car-control firmware; it does **not** represent a complete public PCB fabrication package.

**Practical debugging example:** On the tested Jetson assembly, the I2C scan observed PCA9685-related addresses at 0x40/0x70 on bus 0. Calibration recorded approximate PAN 710–2250 μs and TILT 970–2220 μs pulse ranges. These are specific to that assembly, not universal motor limits.

> **Hardware safety:** PCA9685 logic VCC and servo power V+ are distinct. Use an appropriately rated servo power supply and a common ground. Confirm wiring and calibrate limits before trying any example on another robot.

### 2. YOLO26 visual behavior recognition

The computer-vision pipeline recognizes six categories:

| Class | Meaning |
|---|---|
| eating | Feeding/eating behavior |
| playing | Play |
| rest | Resting |
| sitting | Sitting |
| stretching | Stretching |
| yawning | Yawning |

The September 2026 presentation describes **8,149 annotated images** and a reported **70/20/10 training/validation/test split**, followed by YOLO26 training, evaluation, conversion and edge deployment.

**Wavelet Feature Distillation (WFD):** The larger YOLO26x teacher provides frequency-aware training guidance to a lightweight YOLO26n student. The final student remains a conventional YOLO26n for inference: the teacher and WFD training operations are not required on the device.

| Model / experiment | Parameters | FLOPs | Test mAP50-95 |
|---|---:|---:|---:|
| YOLO26n baseline | 2.4 M | 5.4 B | 0.827 |
| YOLO26n + conventional KD | 2.4 M | 5.4 B | 0.829 |
| YOLO26n + WFD (from YOLO26x) | 2.4 M | 5.4 B | **0.843** |
| YOLO26x teacher | 55.7 M | 193.9 B | 0.859 |

WFD improved the student from **0.827 to 0.843 mAP50-95 (+1.6 percentage points)** while preserving the lightweight inference architecture. The YOLO26n has approximately **95.7% fewer parameters** and **97.2% fewer FLOPs** than YOLO26x.

Detailed notes and the model-weight inventory: [YOLO26 experiments](./Yolo26/yolo26-cat-lightweight/README.md) · [weights manifest](./Yolo26/yolo26-cat-lightweight/weights_manifest.md).

**Reproducibility note:** Large datasets, model weights, ONNX exports and TensorRT engines are **not** distributed in this repository. The figures above are reported experiment results, not a claim that a fresh checkout can reproduce every training run.

### 3. Jetson Nano edge inference

Reported comparison on **Jetson Nano A02**, with **FP16, batch 1, input size 320**:

| Metric | ONNX Runtime | TensorRT |
|---|---:|---:|
| Model-only inference | 45.3 ms | **17.5 ms** |
| End-to-end latency | 139.6 ms | **127.4 ms** |
| End-to-end throughput | 7.2 FPS | **7.8 FPS** |

TensorRT achieved about **2.6× model-only inference speedup**. The **end-to-end latency improvement is about 8.7%**, because capture and processing overhead remain. These are not the same benchmark as the separate T4-based model comparisons.

### 4. Web UI, device APIs and behavior reports

The [Web Console](./Web-Console/README.md) provides:

- Dashboard, monitoring, control, reports and settings screens.
- Dual-camera MJPEG monitoring, local recording, car and gimbal controls.
- Feeding and auto-tracking controls exposed through the service layer.
- YOLO behavior event history and daily report visualizations.
- Chinese/English UI support.

The backend records at most one repeated event of a given behavior class per hour, to reduce duplicated timeline entries. **Hourly events are snapshots, not continuous measurements of total time spent in a behavior.**

Some views and APIs work without the physical robot; video, motion and feeding depend on deployed hardware and services. An exposed command endpoint does not by itself prove that every actuator has passed extended field tests.

## Repository map

~~~text
HajimiRobot/
├── assets/                       # project logo
├── Hardware/                     # STM32 car-control project
│   └── car_ctl/
├── Jetson-Edge/                  # bridge, camera and deployment
│   └── jetson_services_bundle/
├── Web-Console/                  # React UI + Express backend
│   ├── src/
│   ├── server/
│   ├── scripts/
│   └── docs/
├── Yolo26/                       # YOLO26 lightweight experiments
│   └── yolo26-cat-lightweight/
├── README.md
└── README.zh-CN.md
~~~

| Module | Read more |
|---|---|
| Frontend/backend integration | [Web-Console/README.md](./Web-Console/README.md) |
| Jetson runtime | [Jetson-Edge/README.md](./Jetson-Edge/README.md) |
| STM32 controls | [Hardware/README.md](./Hardware/README.md) |
| Computer-vision experiments | [Yolo26/README.md](./Yolo26/README.md) |
| Integration lessons | [June 2026 engineering notes](./Web-Console/docs/project-and-jetson-integration-summary-2026-06-24.md) |

## Quick start — web console

Requirements: Node.js/npm. A configured Jetson and physical robot are needed for live hardware functions.

~~~bash
git clone https://github.com/shiyi-ale/HajimiRobot.git
cd HajimiRobot/Web-Console
npm install
cp .env.example .env.local
~~~

Edit the Jetson addresses in `.env.local` for **your own network**:

~~~dotenv
VITE_BACKEND_ORIGIN="http://127.0.0.1:3001"
JETSON_CAMERA_BASE_URL="http://<jetson-ip>:5000"
JETSON_CAMERA_2_BASE_URL="http://<jetson-ip>:5001"
JETSON_BRIDGE_BASE_URL="http://<jetson-ip>:8000"
~~~

Run in separate terminals:

~~~bash
npm run dev
~~~

~~~bash
npm run dev:server
~~~

Check code quality:

~~~bash
npm run lint
~~~

On an already configured Jetson, check the bridge:

~~~bash
systemctl --user status hajimi-bridge.service
curl http://127.0.0.1:8000/healthz
curl http://127.0.0.1:8000/api/status
~~~

The provided instructions are a **web-console quick start**, not an automated flash-and-deploy workflow for the MCU, PCB and model assets.

## Engineering workflow and test evidence

This project is best understood as a cross-disciplinary engineering cycle:

1. **Problem & users:** identify the gaps between fixed feeding devices, camera monitoring and mobile interaction.
2. **Alternative analysis:** compare smart feeders, pet cameras, mobile pet robots and AI-only applications.
3. **System breakdown:** split responsibilities among browser, Express, Jetson, STM32 and actuators.
4. **Build & integration:** implement interfaces and hardware connections in independently testable modules.
5. **Verification:** inspect power rails, I2C/Bluetooth communication, APIs, model quality and edge latency.
6. **Iteration:** optimize lightweight perception and document integration issues and limitations.
7. **Demonstration:** connect the physical prototype, control console and behavior reporting.

Useful verification tasks for future contributors include power/wiring checks, servo calibration, stop-command response, video stability, feeding actuation reliability, class-wise recognition results and end-to-end timing. These are **suggested acceptance criteria**, not a claim that a complete automated acceptance suite is already published.

## Potential STEM / maker-learning modules

Because the system spans multiple difficulty levels, it can be **adapted** into progressive project-based learning activities. This is a proposed teaching breakdown, **not a claim of previous classroom delivery**.

| Stage | Student challenge | Learning objective / deliverable |
|---|---|---|
| Introductory | Control a servo and build a small camera gimbal | PWM, I2C, calibration; safe working demo |
| Introductory–intermediate | Control a mobile chassis | GPIO, motor control, communication; drive/stop demo |
| Intermediate | Make a robot control dashboard | Python/HTTP concepts, browser UI; working remote-control page |
| Intermediate | Train a pet-behavior detector | Data annotation, validation, error analysis; evaluated CV model |
| Advanced | Run a detector on edge hardware | ONNX/TensorRT, latency, constraints; benchmark record |
| Integrated capstone | Build a pet-care prototype | Requirements, BOM, integration, test log, video and presentation |

A potential project assessment can use **problem definition, design rationale, prototype functionality, measurement quality, debugging evidence, documentation and individual contribution**. Students should build and explain their own work rather than copy a complete solution.

## Project status and roadmap

**Documented prototype / experiments:** web control console, Jetson bridge and camera services, STM32 control project, pan/tilt and mobile/feeding control integration, six-class YOLO experiments, WFD results, TensorRT benchmarks, and event/reporting workflow. Public reproducibility varies by component.

**Future work, not completed product features:** automatic docking/charging, reliable autonomous pet finding, multi-pet identity recognition, obstacle avoidance upgrades, native mobile app, longitudinal anomaly detection and expanded intelligent-agent memory/care planning.

## People and attribution

**Zhao Hangjian — Software Development / AI Algorithm Engineering**

Responsibilities documented in the team presentation: **software development, system integration and AI algorithm design**. Hardware PCB design/manufacturing, assembly, debugging, product planning and coordination were shared across a multidisciplinary project team. This README does not attribute all team deliverables to a single contributor.

Project context: **University of Electronic Science and Technology of China (UESTC) × ESIGELEC (France)**. Project supervisor: **Louis Lecrosnier**. Presentation dated **September 1, 2026**.

---

**HajimiRobot: connecting perception, control and real-world engineering.**
