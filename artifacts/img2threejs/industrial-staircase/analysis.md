# Multi-view analysis: industrial timber staircase

## Suitability verdict

`pass -> real-time procedural game prop`. Four isolated orthographic-like views expose the front,
rear and both side profiles. Silhouette, tread count, width, rail layout and material families are
readable. Exact dimensions are not supplied, so dimensions below are proportional rather than
manufacturing-grade.

## Layer 1 — identification

- Primary type: freestanding industrial timber staircase with a small upper landing.
- Domain: object / architectural prop.
- Confidence: 0.96.
- Intended use: static real-time browser prop, future traversable/collidable set piece.

## Layer 2 — overall form and silhouette

- Bounding volume: long triangular stair prism, approximately `length 2.05 : height 1 : width 1.12`.
- Bilateral symmetry around the center handrail.
- Fifteen repeated tread modules rise at a constant pitch to a short rectangular landing.
- Both lateral faces are closed by triangular timber-board panels on a continuous base rail.
- Tubular guard rails follow the incline, continue horizontally around the landing and terminate in
  vertical posts.

## Layer 3 — macro / meso / micro

Macro assemblies:

1. Stair flight: paired lanes of repeated tread/riser modules.
2. Structural enclosure: two triangular boarded side walls, underside beams and base rails.
3. Guard system: left, center and right inclined rails with posts and landing returns.

Meso components:

- 15 paired step modules; center stair seam/channel; top landing deck.
- left/right triangular side panels; vertical board rhythm; diagonal edge/stringer caps.
- underside transverse supports and central vertical support visible from the rear.
- three inclined top rails; lower mid rails; repeated vertical posts; landing posts and returns.

Micro feature groups:

- chipped teal paint on tread fronts and upper side cap;
- warm brown timber with vertical grain, dark seams and damp lower staining;
- oxidized dark metal rails with lighter worn edges;
- fastener rows at tread ends, side caps and rail post sockets;
- bevels on board, tread and base-rail edges;
- cavity-darkened gaps between boards and under tread noses.

## Layer 4 — spatial relationships

- Each tread overlaps its riser and is supported between the two side panels.
- The center channel divides the width into two equal lanes and supports the central handrail.
- Side panels sit on base rails and overlap the diagonal stringer caps.
- Rail posts are socketed into side/stringer caps and the center channel; inclined rails join post
  tops, with a second rail below.
- Landing deck is flush with the final tread and enclosed by short horizontal rail returns.

## Layer 5 — materials and PBR response

- Timber: dielectric, brown low-saturation albedo, roughness `0.72–0.92`, longitudinal grain and
  cavity AO, darker damp staining near the base.
- Painted stair surfaces: aged desaturated teal paint over timber/metal, roughness `0.58–0.82`,
  edge chips exposing brown substrate, shallow scratches along traffic direction.
- Rail metal: metalness `0.78–0.95`, roughness `0.5–0.72`, dark oxidation with lower-roughness worn
  crests and joint collars.

## Layer 6 — colour and finish

- Timber dominant: dark umber-brown; secondary honey-brown worn strips; near-black seams.
- Paint dominant: dark desaturated blue-green; lighter grey-green worn edges.
- Rails: dark brown-grey oxidized metal with sparse warm highlights.

## Layer 7 — identity-defining features

1. paired stair lanes split by a narrow center channel;
2. approximately fifteen thin repeated tread noses;
3. three parallel handrail lines, including the central divider;
4. closed triangular side faces made from vertical timber boards;
5. diagonal teal-painted stringer/cap above the side boards;
6. short upper landing with vertical terminal posts and horizontal returns;
7. rear underside ladder rhythm and central vertical support;
8. chipped teal paint concentrated on noses and diagonal caps;
9. fastener rows at post sockets and tread ends;
10. heavy damp staining along the lower base rail.

## Layer 8 — uncertainty

- Exact tread rise/run and total dimensions are inferred from image ratios.
- Hidden internal joists, tread attachments and far-side post sockets are approximated symmetrically.
- Reference lighting is baked into the photographs; extracted PBR evidence is approximate.
- The final prop will be structurally faithful for gameplay distance, not construction documentation.

## Definition of done

- From both side views the triangular boarded enclosure, 15-step rhythm and inclined guard profile
  match the reference proportions.
- From the front and rear, the paired lanes, center channel and three rail lines remain legible.
- Timber, worn teal paint and oxidized rail metal remain distinct under neutral and grazing light.
- Every macro assembly is named, clickable/explodable, and exposes collider and socket metadata.
