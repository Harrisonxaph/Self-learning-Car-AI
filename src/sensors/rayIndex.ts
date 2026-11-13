// Ray casts through the track index (P2-11 step 3; docs/plans/p2-11-plan.md). NOT YET USED by the simulation: step 4 wires it in.
//
// The same results as `castRay` and `castRays` in ./rays, bit for bit, with only the boundary segments near each ray tested: the index (sim/trackIndex.ts) picks
// the candidates and the unchanged `raySegment` computes each distance. Nearest-of-all does not depend on the order candidates are visited, except that a
// distance of +0 and one of -0 compare equal; ties are therefore broken towards the lower segment number, which is the one brute force meets first.
import type { VehiclePhysics } from '../sim/config';
import { candidateBuffer, collectRayCandidates, type TrackIndex } from '../sim/trackIndex';
import type { Pose, Vec2 } from '../sim/track';
import { castRay, raySegment, resolveSensorConfig, sensorOrigin, type RayHit, type RayReading, type SensorConfig, type SensorReadings } from './rays';

/**
 * As `castRay` against both of the track's boundaries. Validates exactly as `castRay` does (it calls it with no boundaries first, which throws the same
 * RangeError for a bad origin, angle or range and otherwise does nothing).
 */
export function castRayIndexed(index: TrackIndex, origin: Vec2, angle: number, maxDistance: number): RayHit {
  castRay(origin, angle, maxDistance, []);
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const count = collectRayCandidates(index, origin.x, origin.y, dx, dy, maxDistance);
  const ids = candidateBuffer(index);
  let nearest = Infinity;
  let nearestId = -1;
  for (let k = 0; k < count; k += 1) {
    const id = ids[k] as number;
    const t = raySegment(origin, dx, dy, index.segA[id]!, index.segB[id]!);
    if (t < nearest || (t === nearest && id < nearestId)) {
      nearest = t;
      nearestId = id;
    }
  }
  return nearest <= maxDistance ? { distance: nearest, hit: true } : { distance: maxDistance, hit: false };
}

/** As `castRays`, with the index. Same validation, same readings, bit for bit. */
export function castRaysIndexed(pose: Pose, index: TrackIndex, physics: Pick<VehiclePhysics, 'wheelbase'>, config: SensorConfig): SensorReadings {
  resolveSensorConfig(config);
  const origin = sensorOrigin(pose, physics);
  const rays = config.anglesDegrees.map((degrees): RayReading => {
    const angle = pose.heading + (degrees * Math.PI) / 180;
    const { distance, hit } = castRayIndexed(index, origin, angle, config.maxDistance);
    return {
      angle,
      distance,
      normalised: distance / config.maxDistance,
      hit,
      end: { x: origin.x + Math.cos(angle) * distance, y: origin.y + Math.sin(angle) * distance },
    };
  });
  return { origin, rays };
}
