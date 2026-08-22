# Project guidance

- Keep the world fully 3D, but constrain player locomotion to the authored Catmull-Rom route. Do not switch to free third-person movement unless the user asks for it.
- Preserve keyboard and multi-touch controls in every gameplay change.
- Drive both visible ground and traversal collision from `app/game/level.ts`.
- Build important original props through the img2threejs intake/spec/factory workflow and preserve their reference and assessment artifacts.
- Use a fixed simulation step; rendering frame rate must not change movement or jump distance.
- Prefer procedural primitives and original art direction. Do not copy characters, layouts, textures, audio, or recognizable assets from Playdead games.
- Cap device pixel ratio and avoid expensive post-processing unless mobile performance is measured.
- Do not add emoji to code or interface text.
- Run `npm run lint` and the production build after meaningful changes.
