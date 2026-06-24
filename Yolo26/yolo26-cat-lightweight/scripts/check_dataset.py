from pathlib import Path

import yaml


DATA_YAML = Path("dataset/data.yaml")
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".bmp"}


def count_files(path: Path, suffixes: set[str]) -> int:
    return sum(1 for f in path.rglob("*") if f.suffix.lower() in suffixes)


with DATA_YAML.open("r", encoding="utf-8") as f:
    data = yaml.safe_load(f)

root = Path(data["path"])
print("Dataset root:", root)

for split in ["train", "val", "test"]:
    image_dir = root / data[split]
    label_split = "valid" if split == "val" else split
    label_dir = root / label_split / "labels"

    print()
    print(f"[{split}]")
    print("images:", image_dir)
    print("labels:", label_dir)
    print("image count:", count_files(image_dir, IMAGE_SUFFIXES))
    print("label count:", count_files(label_dir, {".txt"}))

print()
print("Classes:")
for i, name in enumerate(data["names"]):
    print(i, name)
