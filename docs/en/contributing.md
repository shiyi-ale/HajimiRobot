[Docs](README.md) · [简体中文](../zh/contributing.md)

# Contributing

Use a focused branch and explain the user problem, behavioral change and validation. Never commit real environment files, databases, logs, videos, weights or keys. Catalogs contain relative paths, classes and checksums only.

Read architecture/API/validation first. Statistical changes need gap, midnight, ordering and coverage tests; grouping must not inflate duration. Check mobile, keyboard and both languages. Synchronize dependency locks and VERSION/package/OpenAPI metadata.

Run verify.ps1 and `scripts/check_release.py --staged` before committing. Findings show locations, never matched values. Preserve the repository’s existing licensing status; do not invent licenses for third-party dependencies or assets. Frigate inspiration and its pinned commit are documented without using its branding.
