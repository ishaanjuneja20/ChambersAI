# Avatar models (the six AI lawyers)

Decided 2026-10-19: each lawyer is a 3D head-and-shoulders model (`.glb`) with built-in mouth shapes, shown in the browser with three.js and moved by the voice
loudness and pitch (see `tools/glb_test.html`). Stylised or semi-realistic, one consistent style across all six. Rules from `docs/LAWYERS.md` apply:
label "AI Lawyer", nothing regional, no resemblance to any real person.

## File spec (every model must pass)

| Item | Requirement |
|---|---|
| Format | `.glb`, one file per lawyer, named `<id>.glb` (`criminal.glb`, `family.glb`, `consumer.glb`, `property.glb`, `labour.glb`, `constitutional.glb`) |
| Framing | Head and shoulders; neutral, mouth closed, eyes open, facing the camera |
| Mouth shapes | Must have at least `jawOpen` (ARKit) **or** `viseme_aa`; best: the full viseme set (`viseme_aa`, `viseme_O`, `viseme_U`, `viseme_E`, `viseme_I`) |
| Eyes | `eyeBlinkLeft` and `eyeBlinkRight` (or `eyesClosed`) |
| Size | Under 5 MB per file, under about 60k triangles, textures 2K or smaller (compress with `gltf-transform`: Draco or meshopt for geometry, KTX2 for textures) |
| Source | Generated or licensed for this use; the licence allows web apps and commercial use. Record it in `docs/AVATAR_SOURCES.md` |
| Check | Open it in `tools/glb_test.html`: the info line must list the mouth shapes, it must load in under 3 s, and the mouth must look natural with a real Fish Audio voice |

## Look brief (shared)

- Same style, lighting and framing for all six; they should look like a set.
- Smart-casual professional clothing (blazer or shirt). No court robes, no bands, no gavel or scales (the label is "AI Lawyer", not "Advocate").
- No religious, regional or community markers; neutral background (the app draws it).
- Ages and genders follow the table in `docs/LAWYERS.md`.

## Per lawyer

| id | Name | Look | Expression at rest |
|---|---|---|---|
| criminal | Rhea Kapoor | woman, mid-30s, hair tied back, dark blazer | calm, steady gaze |
| family | Meera Nair | woman, 40s, soft shoulder-length hair, warm colours | gentle, slight smile |
| consumer | Arjun Shah | man, early 30s, short hair, open-collar shirt and blazer | friendly, alert |
| property | Vikram Menon | man, 50s, greying hair, glasses, tie | patient, attentive |
| labour | Karan Oberoi | man, 40s, short hair, short beard, plain jacket | firm, level |
| constitutional | Ananya Iyer | woman, late 30s, neat hair, simple blazer | thoughtful |

## Workflow

1. Make **one** (criminal / Rhea) first. Test it in `tools/glb_test.html` with a real Fish Audio voice. If it looks good, lock the style.
2. Make the other five in the same tool with the same settings.
3. Compress each to the size above, name it `<id>.glb`, put it in the frontend's static folder (`avatars/`), and fill in `avatar` in `lawyers.json` (`/avatars/<id>.glb`).
4. Fill in `docs/AVATAR_SOURCES.md` for each (tool, date, licence, what the input was).
