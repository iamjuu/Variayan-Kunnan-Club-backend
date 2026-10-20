# Keralotsavam JSON datasets

Drop official dumps here (any JSON shape). Filenames:

- `Arts Categories.json` → Arts
- `Sports Categories.json` → Sports (empty event arrays are valid)
- `Athletics.json`, `Swimming.json`, `Games.json`, `Agricultural Games.json`, `Kalarippayattu.json` → Sports

`manifest.json` overrides the Arts/Sports mapping. Re-run `npm run seed` or `npm run import:competitions` after replacing files.
