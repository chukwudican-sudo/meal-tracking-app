---
name: scan-meal vision AI feature
overview: Build a third AI edge function, `scan-meal`, that takes a photo (inline base64, no Supabase Storage) and returns a minimal nutrition estimate (name/calories/macros, no ingredients), reusing the same shared helpers as `estimate-nutrition`/`fix-meal`; wire it into ScanTab's initial capture/upload flow only.
todos: []
isProject: false
---

## Sc