"""Remove checkerboard backgrounds from trust logo uploads."""
from __future__ import annotations

from collections import deque
from pathlib import Path

from PIL import Image

ASSETS = Path(
    r"C:\Users\antod\.cursor\projects\c-Users-antod-OneDrive-Bureau-swiipr\assets"
)
OUT = Path(__file__).resolve().parents[1] / "public" / "trust-logos"

LOGOS = [
    ("natixis.png", "72bb564905f8e6e75f2ba8745a87dc57"),
    ("doctolib.png", "979ea8db90429a080c49169a43c24f2a"),
    ("carrefour.png", "c6b5c564eaf98d0e20258a5a92097b92"),
    ("mckinsey.png", "1783415679723_09bh2m"),
    ("loreal.png", "1783415730083_24nr9e"),
    ("societe-generale.png", "975f2be0-c456-45e0-991b-6216ae643c14"),
    ("bnp-paribas.png", "a6526378-a4c9-40af-aa8a-fd06c4fcda24"),
    ("sanofi.png", "140afa87-29d3-45e9-81c6-986c391496b6"),
    ("lazard.png", "f0fa6051-2b46-42fa-9adc-b6b808765503"),
    ("bredin-prat.png", "a7ecaf3c-2efa-4ef3-8ca1-d24009dc74de"),
    ("publicis.png", "ff01990d-eb0d-4641-9ab7-fd0db99b725a"),
    ("mistral-ai.png", "4e451c35-6ce3-4c0f-84d4-4b75f230a12d"),
]

WS_ROOT = Path.home() / "AppData" / "Roaming" / "Cursor" / "User" / "workspaceStorage"


def resolve_asset(stub: Path) -> Path:
    if stub.is_file():
        return stub
    marker = "_images_"
    if marker in stub.name:
        rest = stub.name.split(marker, 1)[1]
        for images_dir in WS_ROOT.glob("*/images"):
            candidate = images_dir / rest
            if candidate.is_file():
                return candidate
    raise FileNotFoundError(stub)


def find_asset(token: str) -> Path:
    matches = [path for path in ASSETS.glob("*.png") if token in path.name]
    if len(matches) != 1:
        raise FileNotFoundError(f"{token}: {len(matches)} matches")
    return resolve_asset(matches[0])


def luminance(r: int, g: int, b: int) -> float:
    return 0.299 * r + 0.587 * g + 0.114 * b


def gray_spread(r: int, g: int, b: int) -> int:
    return max(r, g, b) - min(r, g, b)


def is_checkerboard_gray(r: int, g: int, b: int) -> bool:
    """Neutral grays from checkerboard tiles (keep near-black logo ink)."""
    if gray_spread(r, g, b) > 14:
        return False
    lum = luminance(r, g, b)
    return lum >= 28


def is_light_fill(r: int, g: int, b: int) -> bool:
    """Interior white / light-gray boxes and watermark text."""
    if gray_spread(r, g, b) > 18:
        return False
    return luminance(r, g, b) >= 125


def should_remove_background(r: int, g: int, b: int) -> bool:
    return is_checkerboard_gray(r, g, b) or is_light_fill(r, g, b)


def colors_match(a: tuple[int, int, int], b: tuple[int, int, int], tolerance: int = 36) -> bool:
    return max(abs(a[0] - b[0]), abs(a[1] - b[1]), abs(a[2] - b[2])) <= tolerance


def flood_remove_edges(px, width: int, height: int, predicate) -> None:
    visited = [[False] * width for _ in range(height)]
    queue: deque[tuple[int, int]] = deque()

    for x in range(width):
        queue.append((x, 0))
        queue.append((x, height - 1))
    for y in range(height):
        queue.append((0, y))
        queue.append((width - 1, y))

    while queue:
        x, y = queue.popleft()
        if visited[y][x]:
            continue
        visited[y][x] = True

        r, g, b, a = px[x, y]
        if a == 0 or not predicate(r, g, b):
            continue

        px[x, y] = (r, g, b, 0)
        seed = (r, g, b)
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if nx < 0 or ny < 0 or nx >= width or ny >= height or visited[ny][nx]:
                continue
            nr, ng, nb, na = px[nx, ny]
            if na == 0:
                continue
            if predicate(nr, ng, nb) and colors_match(seed, (nr, ng, nb)):
                queue.append((nx, ny))


def remove_background(img: Image.Image) -> Image.Image:
    rgba = img.convert("RGBA")
    px = rgba.load()
    width, height = rgba.size

    # Pass 1: remove all neutral checkerboard / light panel pixels globally.
    for y in range(height):
        for x in range(width):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            if should_remove_background(r, g, b):
                px[x, y] = (r, g, b, 0)

    # Pass 2: flood from edges for any remaining edge-connected neutrals.
    flood_remove_edges(px, width, height, should_remove_background)

    bbox = rgba.getbbox()
    if bbox:
        rgba = rgba.crop(bbox)
    return rgba


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for out_name, token in LOGOS:
        src = find_asset(token)
        processed = remove_background(Image.open(src))
        processed.save(OUT / out_name, optimize=True)
        print(f"saved {out_name} ({processed.size[0]}x{processed.size[1]})")


if __name__ == "__main__":
    main()
