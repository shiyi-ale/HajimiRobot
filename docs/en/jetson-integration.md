[Docs](README.md) · [简体中文](../zh/jetson-integration.md)

# Jetson and model integration

Local inference uses CUDA PyTorch YOLO with user-supplied six-class weights and video. Model names must match classes. models/catalog.json is an experiment catalog, not downloadable weights.

Jetson uses detection batches, heartbeats and configuration endpoints while scheduling frames locally. Keep device_id stable, rotate session_id at restart, and increment frame_id per session. Plan globally unique camera IDs and synchronize UTC clocks.

Reuse services/intelligence/edge_sender.py for a SQLite outbox: persist before retrying batches, retain capture timestamps, and rely on server deduplication. Keep tokens in local configuration.

Desktop GPU inference does not validate Nano TensorRT deployment. Convert outputs to the same boxes format and verify dimensions, normalization, names, precision and empty frames. Multi-pet identity and cross-camera deduplication are not implemented. Reports select one camera. Nano memory, power, FPS and speedup claims require real hardware validation and are not established by this UI release.
