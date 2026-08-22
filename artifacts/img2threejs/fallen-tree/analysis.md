# Fallen dead tree — image analysis

## 1. Identification

- Target: uprooted dead tree trunk with an exposed root crown, primary broken branches, and a forked distal end.
- Broad class: botanical-like static game prop.
- `primaryDomain`: `object`.
- Confidence: 0.97.
- Intended use: real-time browser environment prop, viewed from medium distance and several camera angles.

## 2. Overall form and silhouette

- Bounding form: one long, tapering, slightly curved organic trunk, approximately 5.2 trunk-base diameters long.
- Silhouette: asymmetric and heavily interrupted by the root crown, one tall proximal branch, several short broken branch stubs, and a two-prong distal fork.
- Topology strategy: the trunk is a `continuous-sculpt` curve sweep; branches and roots are `fiber-strand` tube networks attached to the trunk/root crown. The root crown is a clustered continuous mass rather than a box or sphere.

## 3. Macro → meso → micro hierarchy

- Macro:
  - tapering main trunk;
  - exposed root crown;
  - distal fork assembly.
- Meso:
  - tall proximal broken branch;
  - upper mid-trunk stub;
  - lower mid-trunk branch pair;
  - six primary roots emerging radially from the crown;
  - three main splinter groups at broken ends.
- Micro:
  - longitudinal bark ridges and cavities;
  - irregular missing-bark patches exposing lighter wood;
  - wet low-roughness streaks on upper-facing bark;
  - dark soil staining concentrated around root sockets;
  - narrow cracks running with the grain;
  - small chips on branch fractures.

## 4. Spatial relationships

- `<root-crown, blends-into, proximal-trunk>` through a broad continuous overlap.
- `<primary-roots, embedded-in, root-crown>` with each root starting inside the crown volume and tapering outward.
- `<branches, embedded-in, main-trunk>` at visible sockets; every branch needs overlap to avoid floating joints.
- `<distal-prongs, split-from, distal-trunk>` as two connected tapering continuations, not detached sticks.
- Branch and root pivots sit at their attachment sockets for later bending or destruction.

## 5. Materials and PBR response

- Bark: dielectric, charcoal-brown albedo, roughness approximately 0.72–0.92 with wet streaks at 0.38–0.55, strong longitudinal normal/bump relief, cavity-biased AO.
- Exposed dry wood: desaturated warm gray-brown, roughness 0.78–0.9, sharp fibrous splinter relief.
- Root soil: dark neutral brown local override, roughness 0.9–1.0, concentrated in cavities and root contact zones.
- Independent channels are required for bark albedo variation, roughness variation, height/normal ridges, and cavity AO.

## 6. Color and finish

- Dominant: very dark cool brown, low value and low saturation.
- Secondary: medium gray-brown on worn bark plates.
- Accent: pale tan-gray exposed fibers at fresh fractures.
- Finish: mostly matte and weathered with localized wet satin streaks.

## 7. Identity-defining details

1. Dense radial root silhouette at the proximal end.
2. Hollow-looking dark cavity inside the root crown.
3. Tall broken branch rising from the proximal third.
4. Two-prong fork at the distal end.
5. Long light exposed-wood strip on the upper trunk.
6. Short upper mid-trunk stub angled upward.
7. Lower mid-trunk broken branch pair.
8. Longitudinal bark ridge bands along the full trunk.
9. Cavity-darkened cracks between bark plates.
10. Pale splinter clusters on every major fracture.
11. Wet gloss variation on upper-facing bark.
12. Dark soil staining around root sockets.

## 8. Uncertainty and limits

- The underside, far side, and internal root crown are hidden by the single three-quarter view.
- Exact root count and back-side branch layout are undetermined.
- Bark microrelief is partly baked into photographic lighting, so extracted height and roughness are evidence rather than exact recovery.
- Hidden-side structures will be inferred with deterministic variation and must be reported as approximate.

## Suitability verdict

`conditional → stylized real-time game prop`.

The object occupies most of the frame, has a strong silhouette, readable materials, and can be approximated with curve sweeps, tubes, and procedural bark. The condition is the organic single-view target: unseen roots and the far side cannot be exact. The accepted target is a strong medium-distance game reconstruction, not photogrammetry or manufacturing-accurate geometry.
